import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { ParsedHubPayload, VerifyCallResult } from '../types.js'

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function getCode(json: unknown): number | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const code = (json as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

function getStringField(json: unknown, key: string): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
  const value = (json as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function getAttachmentBase64(json: unknown): string | null {
  for (const key of ['attachment', 'audio', 'recording', 'file']) {
    const value = getStringField(json, key)
    if (value) return value
  }
  return null
}

function getMimeType(json: unknown): string | null {
  const direct = getStringField(json, 'meta') || getStringField(json, 'mime') || getStringField(json, 'mimeType')
  return direct || null
}

export function parseHubPayload(raw: string, json: unknown): ParsedHubPayload {
  const message = getStringField(json, 'message')
  const callerTranscript = getStringField(json, 'transcription')
    || getStringField(json, 'transcript')
    || getStringField(json, 'callerTranscript')
  const text = getStringField(json, 'text') || callerTranscript
  return {
    code: getCode(json),
    message,
    text,
    callerTranscript,
    audioBase64: getAttachmentBase64(json),
    mimeType: getMimeType(json),
    hint: getStringField(json, 'hint'),
  }
}

function isRateLimited(result: VerifyCallResult): boolean {
  return result.status === 429 || getCode(result.json) === -9999
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * (2 ** attempt))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function singleCall(answer: unknown): Promise<VerifyCallResult> {
  const payload = { apikey: hubApiKey, task: taskName, answer }
  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  const durationMs = Date.now() - startedAt
  log.info('Verify response', { status: response.status, durationMs, preview: raw.slice(0, 500) })
  return {
    ok: response.ok,
    status: response.status,
    raw,
    json: parseJson(raw),
    durationMs,
  }
}

async function callVerify(answer: unknown, retries = retryCount): Promise<VerifyCallResult> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      log.info('Verify request', { attempt, answerPreview: JSON.stringify(answer).slice(0, 200) })
      const result = await singleCall(answer)
      if (result.ok || /\{FLG:[^}]+\}/.test(result.raw)) return result
      if (!isRateLimited(result)) return result

      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Verify rate limited, retrying', { attempt, delayMs })
      await sleep(delayMs)
    } catch (error: unknown) {
      lastError = error
      if (attempt === retries) break
      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Verify request failed, retrying', { attempt, delayMs, error: String(error) })
      await sleep(delayMs)
    }
  }
  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function startSession(): Promise<VerifyCallResult> {
  return callVerify({ action: 'start' }, 0)
}

export async function sendAudio(audioBase64: string): Promise<VerifyCallResult> {
  return callVerify({ audio: audioBase64 })
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}
