import { hubApiKey, requestTimeoutMs, taskName, verifyUrl } from './config.js'
import log from './logger.js'
import type { VerifyAction, VerifyActionUpdate, VerifyApiResponse } from './types.js'

function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function callVerify(answer: VerifyAction): Promise<VerifyApiResponse> {
  const payload = {
    apikey: hubApiKey,
    task: taskName,
    answer,
  }

  log.api.request({
    action: answer.action,
    page: 'page' in answer ? answer.page : undefined,
    id: 'id' in answer ? answer.id : undefined,
  })

  const startTime = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const duration = Date.now() - startTime

  const raw = await response.text()
  const json = parseJson(raw)
  const flag = extractFlag(raw)

  log.api.response({
    action: answer.action,
    status: response.status,
    ok: response.ok,
    duration: `${duration}ms`,
    raw: raw,
    flag,
  })

  return {
    ok: response.ok,
    status: response.status,
    raw,
    json,
    flag,
  }
}

export function callHelp(): Promise<VerifyApiResponse> {
  return callVerify({ action: 'help' })
}

export function callUpdate(payload: Omit<VerifyActionUpdate, 'action'>): Promise<VerifyApiResponse> {
  return callVerify({ action: 'update', ...payload })
}

export function callDone(): Promise<VerifyApiResponse> {
  return callVerify({ action: 'done' })
}
