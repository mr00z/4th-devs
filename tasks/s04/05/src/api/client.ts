import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { VerifyCallResult } from '../types.js'

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

function isRateLimited(result: VerifyCallResult): boolean {
  return getPayloadCode(result.json) === -9999
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(8000, 500 * (2 ** attempt))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function singleCall(answer: unknown): Promise<VerifyCallResult> {
  const payload = {
    apikey: hubApiKey,
    task: taskName,
    answer,
  }

  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  const raw = await response.text()
  const durationMs = Date.now() - startedAt
  log.info('Verify response', {
    status: response.status,
    durationMs,
    preview: raw.slice(0, 500),
  })

  return {
    ok: response.ok,
    status: response.status,
    raw,
    json: parseJson(raw),
    durationMs,
  }
}

export async function callVerify(answer: unknown): Promise<VerifyCallResult> {
  let lastError: unknown = null
  let lastResult: VerifyCallResult | null = null

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      log.info('Verify request', { attempt, answer })
      const result = await singleCall(answer)
      if (!isRateLimited(result)) {
        return result
      }

      lastResult = result
      if (attempt < retryCount) {
        const delayMs = getBackoffDelayMs(attempt)
        log.warn('Verify rate limited, backing off before retry', {
          attempt,
          delayMs,
          answer,
        })
        await sleep(delayMs)
        continue
      }

      return result
    } catch (error: unknown) {
      lastError = error
      if (attempt < retryCount) {
        const delayMs = getBackoffDelayMs(attempt)
        log.warn('Verify request failed, backing off before retry', {
          attempt,
          delayMs,
          error: String(error),
        })
        await sleep(delayMs)
      }
    }
  }

  if (lastResult) {
    return lastResult
  }

  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function getWarehouseHelp(): Promise<VerifyCallResult> {
  return callVerify({ tool: 'help' })
}

export async function queryDatabase(query: string): Promise<VerifyCallResult> {
  return callVerify({ tool: 'database', query })
}

export async function generateSignature(args: {
  login: string
  birthday: string
  destination: string | number
}): Promise<VerifyCallResult> {
  return callVerify({
    tool: 'signatureGenerator',
    action: 'generate',
    login: args.login,
    birthday: args.birthday,
    destination: args.destination,
  })
}

export async function getOrders(id?: string): Promise<VerifyCallResult> {
  return callVerify({
    tool: 'orders',
    action: 'get',
    ...(id ? { id } : {}),
  })
}

export async function createOrder(args: {
  title: string
  creatorID: number
  destination: string | number
  signature: string
}): Promise<VerifyCallResult> {
  return callVerify({
    tool: 'orders',
    action: 'create',
    ...args,
  })
}

export async function appendOrderItems(args: {
  id: string
  items: Record<string, number>
}): Promise<VerifyCallResult> {
  return callVerify({
    tool: 'orders',
    action: 'append',
    id: args.id,
    items: args.items,
  })
}

export async function deleteOrder(id: string): Promise<VerifyCallResult> {
  return callVerify({
    tool: 'orders',
    action: 'delete',
    id,
  })
}

export async function resetOrders(): Promise<VerifyCallResult> {
  return callVerify({ tool: 'reset' })
}

export async function done(): Promise<VerifyCallResult> {
  return callVerify({ tool: 'done' })
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}
