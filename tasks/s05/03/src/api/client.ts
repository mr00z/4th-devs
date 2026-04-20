import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { ShellCommandResult } from '../types.js'
import { extractFlag, truncate } from '../utils.js'

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

function getOutputText(raw: string, json: unknown): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return raw
  const record = json as Record<string, unknown>
  for (const key of ['message', 'output', 'stdout', 'result', 'answer']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return raw
}

function isRateLimited(result: ShellCommandResult): boolean {
  return result.status === 429 || getCode(result.json) === -9999
}

function shouldRetry(result: ShellCommandResult): boolean {
  return isRateLimited(result) || result.status >= 500
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(8000, 500 * (2 ** attempt))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function singleRemoteCommand(cmd: string): Promise<ShellCommandResult> {
  const payload = { apikey: hubApiKey, task: taskName, answer: { cmd } }
  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  const json = parseJson(raw)
  const durationMs = Date.now() - startedAt
  const result: ShellCommandResult = {
    ok: response.ok,
    status: response.status,
    cmd,
    raw,
    json,
    outputText: getOutputText(raw, json),
    durationMs,
    flag: extractFlag(raw),
  }
  log.info('Remote shell response', { status: result.status, durationMs, preview: truncate(raw, 500) })
  return result
}

export async function runRemoteCommand(cmd: string): Promise<ShellCommandResult> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      log.tool('Remote shell request', { attempt, cmd })
      const result = await singleRemoteCommand(cmd)
      if (result.ok || result.flag || !shouldRetry(result) || attempt === retryCount) {
        return result
      }
      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Remote shell request will retry', { attempt, delayMs, status: result.status })
      await sleep(delayMs)
    } catch (error: unknown) {
      lastError = error
      if (attempt === retryCount) break
      const delayMs = getBackoffDelayMs(attempt)
      log.warn('Remote shell request failed, retrying', { attempt, delayMs, error: String(error) })
      await sleep(delayMs)
    }
  }
  throw new Error(`Remote shell call failed after retries: ${String(lastError)}`)
}

export { extractFlag }
