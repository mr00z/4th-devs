import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentRole } from './types.js'

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

export const taskName = 'filesystem'
export const verifyUrl = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
export const hubApiKey = process.env.HUB_API_KEY?.trim() || ''
export const aiApiKey = process.env.OPENAI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || ''
export const chatApiBaseUrl = process.env.CHAT_BASE_URL?.trim() || process.env.OPENROUTER_BASE_URL?.trim() || undefined
export const chatModel = 'gpt-5-mini'
export const roleChatModels: Record<AgentRole, string> = {
  orchestrator: chatModel,
  notes_extractor: chatModel,
  filesystem_architect: chatModel,
}
export const requestTimeoutMs = Number(process.env.FILESYSTEM_TIMEOUT_MS || 12000)
export const retryCount = Number(process.env.FILESYSTEM_RETRY_COUNT || 2)
export const maxTurns = Number(process.env.FILESYSTEM_MAX_TURNS || 8)
export const maxRuntimeMs = Number(process.env.FILESYSTEM_MAX_RUNTIME_MS || 120000)
export const heartbeatIntervalMs = Number(process.env.FILESYSTEM_HEARTBEAT_MS || 5000)
export const extraApiHeaders = process.env.OPENROUTER_API_KEY
  ? {
    'HTTP-Referer': 'https://github.com/mrozm/4th-devs',
    'X-Title': 'S04E04 Filesystem Agent',
  }
  : undefined

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
  mcpConfigPath: path.join(projectRoot, 'mcp.json'),
  logsDir: path.join(projectRoot, 'logs'),
  workspaceDir: path.join(projectRoot, 'workspace'),
}
