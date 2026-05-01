import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const projectRoot = path.resolve(import.meta.dirname, '..')
export const repoRoot = path.resolve(projectRoot, '..', '..', '..')
export const rootEnvPath = path.join(repoRoot, '.env')

function loadRootEnv(): void {
  if (!existsSync(rootEnvPath)) return

  const raw = readFileSync(rootEnvPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed
    const eq = normalized.indexOf('=')
    if (eq <= 0) continue

    const key = normalized.slice(0, eq).trim()
    let value = normalized.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadRootEnv()

export const taskName = 'goingthere'
export const hubApiKey = process.env.HUB_API_KEY?.trim() ?? ''
export const verifyUrl = process.env.VERIFY_URL?.trim() || process.env.VERIFY_ENDPOINT?.trim() || 'https://hub.ag3nts.org/verify'
export const hubApiBaseUrl = process.env.HUB_API_BASE_URL?.trim() || new URL('/api', verifyUrl).toString().replace(/\/$/, '')
export const aiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
export const responsesApiEndpoint = process.env.OPENAI_RESPONSES_ENDPOINT?.trim() || 'https://api.openai.com/v1/responses'
export const llmModel = process.env.GOINGTHERE_MODEL?.trim() || 'gpt-5-mini'
export const requestTimeoutMs = Number(process.env.GOINGTHERE_TIMEOUT_MS || 30_000)
export const retryCount = Number(process.env.GOINGTHERE_RETRY_COUNT || 5)
export const maxSteps = Number(process.env.GOINGTHERE_MAX_STEPS || 30)
export const heartbeatIntervalMs = Number(process.env.GOINGTHERE_HEARTBEAT_MS || 5_000)

if (!hubApiKey) {
  throw new Error('HUB_API_KEY is required in the repository root .env file.')
}

if (!aiApiKey) {
  throw new Error('OPENAI_API_KEY is required in the repository root .env file.')
}

export const paths = {
  projectRoot,
  repoRoot,
  rootEnvPath,
  logsDir: path.join(projectRoot, 'logs'),
  workspaceDir: path.join(projectRoot, 'workspace'),
}
