import fs from 'node:fs'
import path from 'node:path'

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function loadRootEnvFile(): void {
  const rootEnvPath = path.resolve(process.cwd(), '../../../.env')
  if (!fs.existsSync(rootEnvPath)) {
    return
  }

  const lines = fs.readFileSync(rootEnvPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const separator = normalized.indexOf('=')
    if (separator <= 0) {
      continue
    }

    const key = normalized.slice(0, separator).trim()
    if (!key || process.env[key] !== undefined) {
      continue
    }

    const value = normalized.slice(separator + 1)
    process.env[key] = stripQuotes(value)
  }
}

loadRootEnvFile()

const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? ''
const VERIFY_URL = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
const TASK_NAME = process.env.WINDPOWER_TASK_NAME?.trim() || 'windpower'
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WINDPOWER_TIMEOUT_MS?.trim() || '4000', 10)
const RETRY_COUNT = Number.parseInt(process.env.WINDPOWER_RETRY_COUNT?.trim() || '2', 10)
const POLL_INTERVAL_MS = Number.parseInt(process.env.WINDPOWER_POLL_INTERVAL_MS?.trim() || '250', 10)
const SERVICE_WINDOW_MS = Number.parseInt(process.env.WINDPOWER_SERVICE_WINDOW_MS?.trim() || '40000', 10)
const INTERNAL_BUFFER_MS = Number.parseInt(process.env.WINDPOWER_DEADLINE_BUFFER_MS?.trim() || '2000', 10)

export const hubApiKey = HUB_API_KEY
export const verifyUrl = VERIFY_URL
export const taskName = TASK_NAME
export const requestTimeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 250 ? REQUEST_TIMEOUT_MS : 4000
export const retryCount = Number.isFinite(RETRY_COUNT) && RETRY_COUNT >= 0 ? RETRY_COUNT : 2
export const pollIntervalMs = Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS >= 100 ? POLL_INTERVAL_MS : 250
export const serviceWindowMs = Number.isFinite(SERVICE_WINDOW_MS) && SERVICE_WINDOW_MS > 1000 ? SERVICE_WINDOW_MS : 40000
export const internalBufferMs = Number.isFinite(INTERNAL_BUFFER_MS) && INTERNAL_BUFFER_MS >= 500 ? INTERNAL_BUFFER_MS : 2000

if (!hubApiKey) {
  console.error('Error: HUB_API_KEY is not set. Add it in root .env file.')
  process.exit(1)
}
