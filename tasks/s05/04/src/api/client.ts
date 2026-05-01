import { disarmHash, extractFlag, parseCurrentColumn, parseRadioHintJson, parseScannerResponse, parseStartGameJson, parseStrictJson } from '../utils.js'
import { hubApiBaseUrl, hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { MoveCommand, MoveRocketResult, RadioHintResult, ScannerResult, StartGameResult, VerifyCallResult } from '../types.js'
import { askScannerParser } from '../llm.js'

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function getBackoffDelayMs(attempt: number): number {
  return Math.min(8_000, 500 * (2 ** attempt))
}

async function retry<T>(label: string, action: (attempt: number) => Promise<T>, attempts = retryCount): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt)
    } catch (error: unknown) {
      lastError = error
      if (error instanceof NonRetryableError) throw error
      if (attempt === attempts) break
      const delayMs = getBackoffDelayMs(attempt)
      log.warn(`${label} failed, retrying`, { attempt, delayMs, error: String(error) })
      await sleep(delayMs)
    }
  }
  throw new Error(`${label} failed after retries: ${String(lastError)}`)
}

async function readResponse(response: Response): Promise<{ raw: string; json: unknown }> {
  const raw = await response.text()
  return { raw, json: parseStrictJson(raw) }
}

async function singleVerify(command: MoveCommand | 'start'): Promise<VerifyCallResult> {
  const payload = { apikey: hubApiKey, task: taskName, answer: { command } }
  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  const durationMs = Date.now() - startedAt
  const flag = extractFlag(raw)
  const json = flag ? null : parseStrictJson(raw)
  log.info('Verify response', { command, status: response.status, durationMs, preview: raw.slice(0, 500) })
  if (!response.ok && json && typeof json === 'object' && !Array.isArray(json) && json.crashed === true) {
    const record = json as Record<string, unknown>
    throw new NonRetryableError(`Rocket crashed: ${String(record.crashReason ?? record.message ?? response.status)}`)
  }
  if (!response.ok && !flag) throw new Error(`Verify request failed (${response.status})`)
  return { ok: response.ok, status: response.status, raw, json, durationMs, flag }
}

export async function startGame(): Promise<StartGameResult> {
  return retry('startGame', async (attempt) => {
    log.tool('Starting goingthere game', { attempt })
    const result = await singleVerify('start')
    const state = parseStartGameJson(result.json)
    log.saveText('start-response.json', `${result.raw}\n`)
    return { state, raw: result.raw }
  })
}

export async function moveRocket(command: MoveCommand): Promise<MoveRocketResult> {
  return retry('moveRocket', async (attempt) => {
    log.tool('Moving rocket', { attempt, command })
    const result = await singleVerify(command)
    if (!result.flag && result.json && typeof result.json === 'object' && !Array.isArray(result.json)) {
      const record = result.json as Record<string, unknown>
      if (record.currentColumn) parseCurrentColumn(record.currentColumn)
    }
    return { raw: result.raw, json: result.json, flag: result.flag }
  })
}

export async function getRadioHint(): Promise<RadioHintResult> {
  return retry('getRadioHint', async (attempt) => {
    log.tool('Requesting radio hint', { attempt })
    const startedAt = Date.now()
    const response = await fetch(`${hubApiBaseUrl}/getmessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: hubApiKey }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    const { raw, json } = await readResponse(response)
    const durationMs = Date.now() - startedAt
    log.info('Radio hint response', { status: response.status, durationMs, preview: raw.slice(0, 500) })
    if (!response.ok) throw new Error(`getmessage failed (${response.status})`)
    return { hint: parseRadioHintJson(json), raw }
  })
}

export async function scanFrequency(): Promise<ScannerResult> {
  return retry('scanFrequency', async (attempt) => {
    log.tool('Scanning frequency', { attempt })
    const startedAt = Date.now()
    const url = `${hubApiBaseUrl}/frequencyScanner?key=${encodeURIComponent(hubApiKey)}`
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    const raw = await response.text()
    const durationMs = Date.now() - startedAt
    log.info('Frequency scanner response', { status: response.status, durationMs, preview: raw.slice(0, 500) })
    if (!response.ok) throw new Error(`frequencyScanner GET failed (${response.status})`)
    let parsed: ReturnType<typeof parseScannerResponse>
    try {
      parsed = parseScannerResponse(raw)
    } catch (error: unknown) {
      log.warn('Local scanner parser failed, asking LLM to interpret response', { error: String(error) })
      parsed = await askScannerParser(raw)
    }
    return parsed.status === 'clear'
      ? { status: 'clear', raw }
      : { status: 'tracked', raw, frequency: parsed.frequency, detectionCode: parsed.detectionCode }
  })
}

export async function disarmRadar(frequency: number, detectionCode: string): Promise<void> {
  await retry('disarmRadar', async (attempt) => {
    const hash = disarmHash(detectionCode)
    log.tool('Disarming radar', { attempt, frequency })
    const startedAt = Date.now()
    const response = await fetch(`${hubApiBaseUrl}/frequencyScanner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: hubApiKey, frequency, disarmHash: hash }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    const raw = await response.text()
    const durationMs = Date.now() - startedAt
    log.info('Radar disarm response', { status: response.status, durationMs, preview: raw.slice(0, 500) })
    if (!response.ok) throw new Error(`frequencyScanner POST failed (${response.status})`)
  })
}
