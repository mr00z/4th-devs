import log from './logger.js'
import { heartbeatIntervalMs, maxRestarts } from './config.js'
import { decodeBase64Audio, encodeBase64Audio, speechToText, textToSpeech } from './audio.js'
import { extractFlag, parseHubPayload, sendAudio, startSession } from './api/client.js'
import { applyHubFeedback, applyInboundTurn, assertTurnLimit, chooseNextUtteranceWithModel, createInitialSessionState, createOutboundTurn, logInterpretation, maybeMarkCompletedFromRaw, registerOutboundTurn, summarizeState } from './conversation.js'
import { interpretOperatorReply } from './llm.js'
import type { InboundTurn, RunSummary } from './types.js'

class ConversationAttemptError extends Error {
  constructor(message: string, readonly recoveryNotes: string[]) {
    super(message)
  }
}

function audioExtension(mimeType: string | null): string {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.includes('wav')) return '.wav'
  if (normalized.includes('ogg')) return '.ogg'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a'
  return '.bin'
}

async function transcribePayloadAudio(sessionIndex: number, turnIndex: number, base64: string, mimeType: string | null): Promise<string> {
  const bytes = decodeBase64Audio(base64)
  const ext = audioExtension(mimeType)
  const savedPath = log.saveBytes(`session-${sessionIndex}/inbound/${String(turnIndex).padStart(2, '0')}${ext}`, bytes)
  const transcript = await speechToText(bytes, mimeType || 'audio/mpeg', `operator-${sessionIndex}-${turnIndex}${ext === '.bin' ? '.mp3' : ext}`)
  log.saveText(`session-${sessionIndex}/transcripts/inbound-${String(turnIndex).padStart(2, '0')}.txt`, transcript)
  log.info('Inbound audio transcribed', { sessionIndex, turnIndex, path: savedPath, transcript })
  return transcript
}

async function runSingleSession(sessionIndex: number, recoveryNotes: string[]): Promise<RunSummary> {
  log.info('Starting phonecall session', { sessionIndex })
  const startResult = await startSession()
  log.saveText(`session-${sessionIndex}/start-response.json`, `${startResult.raw}\n`)

  let state = createInitialSessionState(sessionIndex, recoveryNotes)
  const transcriptParts: string[] = []

  for (; ;) {
    assertTurnLimit(state)
    const outboundText = await chooseNextUtteranceWithModel(state)
    const outbound = createOutboundTurn(state, outboundText)
    log.info('Prepared outbound turn', { ...outbound, state: summarizeState(state) })

    const outboundAudio = await textToSpeech(outboundText)
    log.saveBytes(`session-${sessionIndex}/outbound/${String(outbound.turnIndex).padStart(2, '0')}.mp3`, outboundAudio)
    log.saveText(`session-${sessionIndex}/transcripts/outbound-${String(outbound.turnIndex).padStart(2, '0')}.txt`, outboundText)

    state = registerOutboundTurn(state, outboundText)
    transcriptParts.push(`ME: ${outboundText}`)

    const response = await sendAudio(encodeBase64Audio(outboundAudio))
    log.saveText(`session-${sessionIndex}/responses/turn-${String(outbound.turnIndex).padStart(2, '0')}.json`, `${response.raw}\n`)

    const flag = extractFlag(response.raw)
    if (flag) {
      return { flag, transcript: transcriptParts.join('\n'), restarts: sessionIndex - 1, finalRaw: response.raw }
    }

    const payload = parseHubPayload(response.raw, response.json)
    if (!response.ok) {
      const feedback = [
        payload.message,
        payload.callerTranscript ? `Hub transcription of our last message: ${payload.callerTranscript}` : '',
      ].filter(Boolean).join(' ')
      state = applyHubFeedback(state, feedback, payload.hint)
      log.warn('Hub rejected turn, feeding feedback into recovery loop', {
        sessionIndex,
        turnIndex: outbound.turnIndex,
        status: response.status,
        code: payload.code,
        feedback,
        hint: payload.hint,
        state: summarizeState(state),
      })
      if (state.stage === 'burned') {
        throw new ConversationAttemptError(`Session burned by hub feedback at turn ${outbound.turnIndex}.`, state.recoveryNotes)
      }
      continue
    }
    if (payload.audioBase64) {
      const inboundAudioBytes = decodeBase64Audio(payload.audioBase64)
      const inboundMp3Path = log.saveBytes(
        `session-${sessionIndex}/inbound-mp3/${String(outbound.turnIndex).padStart(2, '0')}.mp3`,
        inboundAudioBytes,
      )
      log.info('Inbound audio saved as mp3', {
        sessionIndex,
        turnIndex: outbound.turnIndex,
        path: inboundMp3Path,
        sourceMimeType: payload.mimeType || 'unknown',
      })
    }
    if (payload.callerTranscript) {
      log.info('Hub caller transcription', {
        sessionIndex,
        turnIndex: outbound.turnIndex,
        callerTranscript: payload.callerTranscript,
        hint: payload.hint,
      })
    }
    let transcript = payload.callerTranscript.trim() || payload.text.trim()
    if (!transcript && payload.audioBase64) {
      transcript = (await transcribePayloadAudio(sessionIndex, outbound.turnIndex, payload.audioBase64, payload.mimeType)).trim()
    }
    if (!transcript) {
      transcript = payload.message.trim()
    }
    transcriptParts.push(`OPERATOR: ${transcript || '[brak treści]'}`)

    log.info('Operator said', {
      sessionIndex,
      turnIndex: outbound.turnIndex,
      transcript: transcript || '[brak treści]',
    })

    const interpretation = await interpretOperatorReply(
      transcript || payload.message || '',
      transcriptParts.join('\n'),
      state.stage,
      payload.hint,
    )

    const inboundTurn: InboundTurn = {
      sessionIndex,
      turnIndex: outbound.turnIndex,
      payload,
      transcript,
      interpretation,
    }

    logInterpretation(inboundTurn)
    state = applyInboundTurn(state, inboundTurn)
    state = maybeMarkCompletedFromRaw(state, response.raw)

    if (state.stage === 'completed') {
      return {
        flag: extractFlag(response.raw),
        transcript: transcriptParts.join('\n'),
        restarts: sessionIndex - 1,
        finalRaw: response.raw,
      }
    }

    if (state.stage === 'burned') {
      throw new ConversationAttemptError(`Session burned by operator at turn ${outbound.turnIndex}.`, state.recoveryNotes)
    }

    if (state.stage === 'awaiting_statuses' && payload.hint) {
      log.info('Hub hint received', { sessionIndex, turnIndex: outbound.turnIndex, hint: payload.hint })
    }
  }
}

async function runAgent(): Promise<RunSummary> {
  let lastError: unknown = null
  let recoveryNotes: string[] = []
  for (let sessionIndex = 1; sessionIndex <= maxRestarts; sessionIndex += 1) {
    try {
      const summary = await runSingleSession(sessionIndex, recoveryNotes)
      log.saveText('final-answer.json', `${JSON.stringify(summary, null, 2)}\n`)
      return summary
    } catch (error: unknown) {
      lastError = error
      if (error instanceof ConversationAttemptError) {
        recoveryNotes = error.recoveryNotes
      }
      log.warn('Session attempt failed', { sessionIndex, error: String(error) })
      log.saveText(`session-${sessionIndex}/failure.txt`, `${String(error)}\n`)
    }
  }
  throw new Error(`All ${maxRestarts} session attempts failed. Last error: ${String(lastError)}`)
}

async function main(): Promise<void> {
  log.info('S05E02 phonecall agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', { elapsedMs: Date.now() - startedAt, logFile: log.filePath })
  }, Math.max(5000, heartbeatIntervalMs))
  ticker.unref()

  try {
    const result = await runAgent()
    if (result.flag) {
      log.success('FLAG FOUND', result)
      console.log(result.flag)
    } else {
      log.warn('Run finished without flag', result)
      console.log(result.finalRaw)
      process.exitCode = 1
    }
  } catch (error: unknown) {
    log.error('Phonecall agent failed', { error: String(error) })
    process.exitCode = 1
  } finally {
    clearInterval(ticker)
  }
}

main().catch((error: unknown) => {
  log.error('Unexpected error', { error: String(error) })
  process.exitCode = 1
})
