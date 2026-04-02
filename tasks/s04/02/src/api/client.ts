import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
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
    task: taskName,
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
      const msg = error instanceof Error ? error.message : String(error)
      log.warn('Verify call failed, retrying', { action: answer.action, attempt, retryCount, message: msg })
      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  }

  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function startServiceWindow(): Promise<VerifyCallResult> {
  return callVerify({ action: 'start' })
}

export async function getDocumentation(): Promise<VerifyCallResult> {
  return callVerify({ action: 'get', param: 'documentation' })
}

export async function enqueueGet(param: 'weather' | 'powerplantcheck' | 'turbinecheck'): Promise<VerifyCallResult> {
  return callVerify({ action: 'get', param })
}

export async function enqueueUnlockCodeGenerator(input: {
  startDate: string
  startHour: string
  windMs: number
  pitchAngle: number
}): Promise<VerifyCallResult> {
  return callVerify({ action: 'unlockCodeGenerator', ...input })
}

export async function pollGetResult(): Promise<VerifyCallResult> {
  return callVerify({ action: 'getResult' })
}

export async function submitBatchConfig(configs: Record<string, { pitchAngle: number; turbineMode: 'production' | 'idle'; unlockCode: string }>): Promise<VerifyCallResult> {
  return callVerify({ action: 'config', configs })
}

export async function callDone(): Promise<VerifyCallResult> {
  return callVerify({ action: 'done' })
}
