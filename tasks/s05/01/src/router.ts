import { readFileSync } from 'node:fs'
import { analyzeImageWithVision, analyzeSavedTextFileWithLlm, analyzeTextWithLlm, transcribeAudioAttachment } from './llm.js'
import { extractCluesFromCsv } from './parsers/csv.js'
import { extractCluesFromJson } from './parsers/json.js'
import { decodeTaTiSignal, looksLikeTaTiSignal } from './parsers/morse.js'
import { extractCluesFromText, normalizeText, textLooksMostlyNoise } from './parsers/text.js'
import { extractCluesFromXml } from './parsers/xml.js'
import { saveAttachment } from './workspace.js'
import type { CaptureRecord, Clue, ListenPayload } from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseListenPayload(json: unknown): ListenPayload | null {
  return isObject(json) ? json as ListenPayload : null
}

function isTerminalMessage(message: string): boolean {
  return /(enough data|wystarczaj[aą]co du[żz]o danych|no more|koniec|wystarczy)/i.test(message)
}

function mergeClues(...lists: Clue[][]): Clue[] {
  return lists.flat().filter((clue) => clue.confidence > 0 && clue.value !== '')
}

export async function routeCapture(index: number, json: unknown, llmContext?: string): Promise<CaptureRecord> {
  const payload = parseListenPayload(json)
  const sourceId = `capture:${index}`
  if (!payload) {
    return { id: sourceId, index, kind: 'unknown', raw: null, message: 'Non-object payload', clues: [], discardedReason: 'invalid payload' }
  }

  const message = typeof payload.message === 'string' ? payload.message : ''
  if ((payload.code === 101 || isTerminalMessage(message) || /dostatecznie duzo materialu|bateri[ea].*padl/i.test(message)) && !payload.transcription && !payload.attachment) {
    return { id: sourceId, index, kind: 'terminal', raw: payload, message, clues: [] }
  }

  if (typeof payload.transcription === 'string') {
    const rawText = payload.transcription
    const normalized = normalizeText(rawText)
    let decodedText = normalized
    let clues: Clue[] = []
    let summary = normalized.slice(0, 800)

    if (looksLikeTaTiSignal(rawText)) {
      const decoded = decodeTaTiSignal(rawText)
      decodedText = decoded.text || normalized
      clues = mergeClues(extractCluesFromText(decodedText, sourceId))
      if (decoded.confidence < 0.5 || clues.length === 0) {
        clues = mergeClues(clues, await analyzeTextWithLlm(rawText, sourceId, llmContext))
      }
      summary = `decoded: ${decodedText}`
    } else if (textLooksMostlyNoise(rawText)) {
      clues = await analyzeTextWithLlm(rawText, sourceId, llmContext)
      if (clues.length === 0) {
        return { id: sourceId, index, kind: 'text', raw: payload, message, transcription: rawText, decodedText: normalized, clues: [], discardedReason: 'noise-like transcription' }
      }
    } else {
      clues = extractCluesFromText(normalized, sourceId)
      if (clues.length === 0 || (clues.length < 2 && /Syjon|wsp[oó]łrz[eę]dne|magazyn|telefon|powierzch/i.test(normalized))) {
        clues = mergeClues(clues, await analyzeTextWithLlm(normalized, sourceId, llmContext))
      }
    }

    return {
      id: sourceId,
      index,
      kind: 'text',
      raw: payload,
      message,
      transcription: rawText,
      decodedText,
      summary,
      clues,
    }
  }

  if (typeof payload.attachment === 'string') {
    const mimeType = typeof payload.meta === 'string' && payload.meta.trim() ? payload.meta.trim() : 'application/octet-stream'
    const bytes = Buffer.from(payload.attachment, 'base64')
    const saved = saveAttachment(index, mimeType, bytes)
    let decodedText = ''
    let summary = `${mimeType} ${saved.relativePath}`
    let clues: Clue[] = []
    if (mimeType.includes('json')) {
      decodedText = bytes.toString('utf8')
      const parsed = extractCluesFromJson(decodedText, sourceId)
      clues = parsed.clues
      summary = parsed.summary
      if (clues.length === 0 && parsed.parsed) clues = await analyzeSavedTextFileWithLlm(decodedText, saved, sourceId, llmContext)
    } else if (mimeType.includes('csv') || saved.extension === '.csv') {
      decodedText = bytes.toString('utf8')
      const parsed = extractCluesFromCsv(decodedText, sourceId)
      clues = parsed.clues
      summary = parsed.summary
      if (clues.length === 0) clues = await analyzeSavedTextFileWithLlm(decodedText, saved, sourceId, llmContext)
    } else if (mimeType.includes('xml') || saved.extension === '.xml') {
      decodedText = bytes.toString('utf8')
      const parsed = extractCluesFromXml(decodedText, sourceId)
      clues = parsed.clues
      summary = parsed.summary
      if (clues.length === 0) clues = await analyzeSavedTextFileWithLlm(decodedText, saved, sourceId, llmContext)
    } else if (mimeType.startsWith('text/')) {
      decodedText = bytes.toString('utf8')
      clues = extractCluesFromText(decodedText, sourceId)
      summary = decodedText.slice(0, 1000)
      clues = mergeClues(clues, await analyzeSavedTextFileWithLlm(decodedText, saved, sourceId, llmContext))
    } else if (mimeType.startsWith('image/')) {
      clues = await analyzeImageWithVision(bytes, saved, sourceId, llmContext)
    } else if (mimeType.startsWith('audio/')) {
      const transcribed = await transcribeAudioAttachment(bytes, saved, sourceId, llmContext)
      decodedText = transcribed.text
      summary = transcribed.text ? transcribed.text.slice(0, 1000) : summary
      clues = transcribed.clues
    } else {
      let maybeText = ''
      try {
        maybeText = readFileSync(saved.path, 'utf8')
      } catch {
        maybeText = ''
      }
      if (/^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]+$/.test(maybeText)) {
        decodedText = maybeText
        clues = extractCluesFromText(decodedText, sourceId)
        clues = mergeClues(clues, await analyzeSavedTextFileWithLlm(decodedText, saved, sourceId, llmContext))
      }
    }
    return {
      id: sourceId,
      index,
      kind: 'attachment',
      raw: payload,
      message,
      attachment: saved,
      decodedText,
      summary,
      clues,
    }
  }

  return { id: sourceId, index, kind: 'unknown', raw: payload, message, clues: [], discardedReason: 'unrecognized payload shape' }
}
