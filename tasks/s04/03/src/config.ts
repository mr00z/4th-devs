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
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DOMATOWO_TIMEOUT_MS?.trim() || '8000', 10)
const RETRY_COUNT = Number.parseInt(process.env.DOMATOWO_RETRY_COUNT?.trim() || '2', 10)
const MAX_TURNS = Number.parseInt(process.env.DOMATOWO_MAX_TURNS?.trim() || '120', 10)
const MAX_RUNTIME_MS = Number.parseInt(process.env.DOMATOWO_MAX_RUNTIME_MS?.trim() || '120000', 10)
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.DOMATOWO_HEARTBEAT_INTERVAL_MS?.trim() || '15000', 10)

const AI_API_KEY = process.env.OPENAI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || ''
const CHAT_BASE_URL = process.env.CHAT_BASE_URL?.trim() || 'https://api.openai.com/v1'
const CHAT_MODEL = process.env.CHAT_MODEL?.trim() || 'gpt-4o'

export const hubApiKey = HUB_API_KEY
export const verifyUrl = VERIFY_URL
export const requestTimeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 500 ? REQUEST_TIMEOUT_MS : 8000
export const retryCount = Number.isFinite(RETRY_COUNT) && RETRY_COUNT >= 0 ? RETRY_COUNT : 2
export const maxTurns = Number.isFinite(MAX_TURNS) && MAX_TURNS > 0 ? MAX_TURNS : 30
export const maxRuntimeMs = Number.isFinite(MAX_RUNTIME_MS) && MAX_RUNTIME_MS > 1000 ? MAX_RUNTIME_MS : 120000
export const heartbeatIntervalMs = Number.isFinite(HEARTBEAT_INTERVAL_MS) && HEARTBEAT_INTERVAL_MS > 1000 ? HEARTBEAT_INTERVAL_MS : 15000

export const aiApiKey = AI_API_KEY
export const chatApiBaseUrl = CHAT_BASE_URL
export const chatModel = CHAT_MODEL
export const extraApiHeaders: Record<string, string> = {}

if (!hubApiKey) {
  console.error('Error: HUB_API_KEY is not set. Add it in root .env file.')
  process.exit(1)
}
