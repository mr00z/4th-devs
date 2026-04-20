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

export const taskName = 'shellaccess'
export const hubApiKey = process.env.HUB_API_KEY?.trim() ?? ''
export const verifyUrl = process.env.VERIFY_URL?.trim() || process.env.VERIFY_ENDPOINT?.trim() || 'https://hub.ag3nts.org/verify'
export const aiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
export const responsesApiEndpoint = process.env.OPENAI_RESPONSES_ENDPOINT?.trim() || 'https://api.openai.com/v1/responses'
export const agentModel = process.env.SHELLACCESS_MODEL?.trim() || 'gpt-5.2'
export const memoryModel = process.env.SHELLACCESS_MEMORY_MODEL?.trim() || 'gpt-5-mini'
export const requestTimeoutMs = Number(process.env.SHELLACCESS_TIMEOUT_MS || 30_000)
export const retryCount = Number(process.env.SHELLACCESS_RETRY_COUNT || 2)
export const maxTurns = Number(process.env.SHELLACCESS_MAX_TURNS || 40)
export const heartbeatIntervalMs = Number(process.env.SHELLACCESS_HEARTBEAT_MS || 5_000)
export const observationThresholdMessages = Number(process.env.SHELLACCESS_OBSERVE_MESSAGES || 8)
export const observationThresholdChars = Number(process.env.SHELLACCESS_OBSERVE_CHARS || 12_000)
export const reflectionThresholdChars = Number(process.env.SHELLACCESS_REFLECT_CHARS || 14_000)
export const reflectionTargetChars = Number(process.env.SHELLACCESS_REFLECT_TARGET_CHARS || 7_000)

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
  memoryDir: path.join(projectRoot, 'memory'),
  mcpConfigPath: path.join(projectRoot, 'mcp.json'),
}
