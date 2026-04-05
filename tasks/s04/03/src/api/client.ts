import { hubApiKey, requestTimeoutMs, retryCount, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { VerifyCallResult, VerifyEnvelopeAnswer } from '../types.js'

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function singleCall(answer: VerifyEnvelopeAnswer): Promise<VerifyCallResult> {
  const payload = {
    apikey: hubApiKey,
    task: 'domatowo',
    answer,
  }

  const action = typeof answer.action === 'string' ? answer.action : 'unknown'
  log.apiRequest(action, answer)

  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  const durationMs = Date.now() - startedAt

  const parsed = parseJson(raw)
  log.apiResponse(action, {
    ok: response.ok,
    status: response.status,
    durationMs,
    preview: raw.length > 280 ? `${raw.slice(0, 280)}...` : raw,
  })

  return {
    ok: response.ok,
    status: response.status,
    raw,
    json: parsed,
    durationMs,
  }
}

export async function callVerify(answer: VerifyEnvelopeAnswer): Promise<VerifyCallResult> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await singleCall(answer)
    } catch (error: unknown) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      log.warn('Verify call failed, retrying', { action: answer.action, attempt, retryCount, message })
      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  }

  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function reset(): Promise<VerifyCallResult> {
  return callVerify({ action: 'reset' })
}

export async function getMap(symbols?: string[]): Promise<VerifyCallResult> {
  const answer: VerifyEnvelopeAnswer = { action: 'getMap' }
  if (symbols && symbols.length > 0) {
    answer.symbols = symbols
  }
  return callVerify(answer)
}

export async function createTransporter(passengers: number): Promise<VerifyCallResult> {
  return callVerify({ action: 'create', type: 'transporter', passengers })
}

export async function createScout(): Promise<VerifyCallResult> {
  return callVerify({ action: 'create', type: 'scout' })
}

export async function moveUnit(unitId: string, where: string): Promise<VerifyCallResult> {
  return callVerify({ action: 'move', object: unitId, where })
}

export async function inspectPosition(unitId: string): Promise<VerifyCallResult> {
  return callVerify({ action: 'inspect', object: unitId })
}

export async function dismount(object: string, passengers: number): Promise<VerifyCallResult> {
  return callVerify({ action: 'dismount', object, passengers })
}

export async function getObjects(): Promise<VerifyCallResult> {
  return callVerify({ action: 'getObjects' })
}

export async function searchSymbol(symbol: string): Promise<VerifyCallResult> {
  return callVerify({ action: 'searchSymbol', symbol })
}

export async function getLogs(): Promise<VerifyCallResult> {
  return callVerify({ action: 'getLogs' })
}

export async function getExpenses(): Promise<VerifyCallResult> {
  return callVerify({ action: 'expenses' })
}

export async function callHelicopter(destination: string): Promise<VerifyCallResult> {
  return callVerify({ action: 'callHelicopter', destination })
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}
