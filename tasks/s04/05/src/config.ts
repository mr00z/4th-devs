import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(projectRoot, '..', '..', '..')
const rootEnvPath = path.join(repoRoot, '.env')

function loadRootEnv(): void {
  if (!existsSync(rootEnvPath)) {
    return
  }

  const raw = readFileSync(rootEnvPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }
    const key = trimmed.slice(0, equalsIndex).trim()
    let value = trimmed.slice(equalsIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadRootEnv()

export const taskName = 'foodwarehouse'
export const verifyUrl = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
export const hubApiKey = process.env.HUB_API_KEY?.trim() || ''
export const aiApiKey = process.env.OPENAI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || ''
export const chatApiBaseUrl = process.env.CHAT_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || undefined
export const chatModel = process.env.CHAT_MODEL?.trim() || 'gpt-5.4-mini'
export const requestTimeoutMs = Number(process.env.FOODWAREHOUSE_TIMEOUT_MS || 15000)
export const retryCount = Number(process.env.FOODWAREHOUSE_RETRY_COUNT || 2)
export const maxIterations = Number(process.env.FOODWAREHOUSE_MAX_ITERATIONS || 6)
export const maxToolRounds = Number(process.env.FOODWAREHOUSE_MAX_TOOL_ROUNDS || 60)
export const maxRuntimeMs = Number(process.env.FOODWAREHOUSE_MAX_RUNTIME_MS || 180000)
export const heartbeatIntervalMs = Number(process.env.FOODWAREHOUSE_HEARTBEAT_MS || 5000)
export const maxResets = Number(process.env.FOODWAREHOUSE_MAX_RESETS || 2)

if (!hubApiKey) {
  throw new Error('HUB_API_KEY is required in the repository root .env file.')
}

if (!aiApiKey) {
  throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is required in the repository root .env file.')
}

export const paths = {
  projectRoot,
  repoRoot,
  rootEnvPath,
  logsDir: path.join(projectRoot, 'logs'),
  workspaceDir: path.join(projectRoot, 'workspace'),
}
