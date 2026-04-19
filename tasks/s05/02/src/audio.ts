import log from './logger.js'
import { aiApiKey, speechApiEndpoint, sttModel, transcriptionsApiEndpoint, ttsModel, ttsVoice } from './config.js'

function extractTranscript(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const directText = 'text' in data && typeof data.text === 'string' ? data.text.trim() : ''
  if (directText) return directText
  const verboseText = 'transcript' in data && typeof data.transcript === 'string' ? data.transcript.trim() : ''
  return verboseText
}

export function decodeBase64Audio(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64')
}

export function encodeBase64Audio(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export async function textToSpeech(text: string): Promise<Uint8Array> {
  log.tool('TTS request', { model: ttsModel, voice: ttsVoice, text })
  const response = await fetch(speechApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify({
      model: ttsModel,
      voice: ttsVoice,
      input: text,
      format: 'mp3',
    }),
  })

  if (!response.ok) {
    const raw = await response.text()
    throw new Error(`TTS failed (${response.status}): ${raw}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function speechToText(bytes: Uint8Array, mimeType = 'audio/mpeg', fileName = 'operator.mp3'): Promise<string> {
  log.tool('STT request', { model: sttModel, bytes: bytes.byteLength, mimeType, fileName })
  const form = new FormData()
  const blob = new Blob([Buffer.from(bytes)], { type: mimeType })
  form.append('file', blob, fileName)
  form.append('model', sttModel)

  const response = await fetch(transcriptionsApiEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: form,
  })

  const raw = await response.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    throw new Error(`STT failed (${response.status}): ${raw}`)
  }

  return extractTranscript(parsed)
}
