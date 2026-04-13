import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { FinalReport, VerifyCallResult } from '../types.js'

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function getPayloadCode(json: unknown): number | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null
  }
  const code = (json as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

function getPayloadMessage(json: unknown): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return ''
  }
  const message = (json as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

function getRequestedAction(answer: unknown): string {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return ''
  }
  const action = (answer as { action?: unknown }).action
  return typeof action === 'string' ? action : ''
}

function isRateLimited(result: VerifyCallResult): boolean {
  return getPayloadCode(result.json) === -9999 || result.status === 429
}

function isSuccessfulVerifyResult(answer: unknown, result: VerifyCallResult): boolean {
  const action = getRequestedAction(answer)
  const code = getPayloadCode(result.json)
  if (!result.ok) {
    return false
  }
  if (code === null) {
    return true
  }
  if (action === 'start') {
    return code === 110
  }
  return code === 0 || code === 100 || code === 101
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(8000, 500 * (2 ** attempt))
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

async function callVerify(answer: unknown, options?: { retries?: number }): Promise<VerifyCallResult> {
  const retries = options?.retries ?? retryCount
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      log.info('Verify request', { attempt, answer })
      const result = await singleCall(answer)
      if (isSuccessfulVerifyResult(answer, result)) {
        return result
      }
      const code = getPayloadCode(result.json)
      const message = getPayloadMessage(result.json)
      if (!isRateLimited(result) || attempt === retries) {
        throw new Error(`Verify request rejected (status=${result.status}, code=${String(code)}, message=${message || 'n/a'})`)
      }
      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Verify rate limited, retrying', { attempt, delayMs, status: result.status, code, message })
      await sleep(delayMs)
    } catch (error: unknown) {
      lastError = error
      if (attempt === retries) {
        break
      }
      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Verify request failed, retrying', { attempt, delayMs, error: String(error) })
      await sleep(delayMs)
    }
  }
  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function startSession(): Promise<VerifyCallResult> {
  return callVerify({ action: 'start' }, { retries: 0 })
}

export async function listen(): Promise<VerifyCallResult> {
  return callVerify({ action: 'listen' })
}

export async function transmit(report: FinalReport): Promise<VerifyCallResult> {
  return callVerify({ action: 'transmit', ...report })
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}
