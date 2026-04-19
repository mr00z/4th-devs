import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(projectRoot, '..', '..', '..')
const rootEnvPath = path.join(repoRoot, '.env')

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

export const taskName = 'phonecall'
export const hubApiKey = process.env.HUB_API_KEY?.trim() ?? ''
export const verifyUrl = process.env.VERIFY_URL?.trim() || process.env.VERIFY_ENDPOINT?.trim() || 'https://hub.ag3nts.org/verify'
export const aiApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
export const responsesApiEndpoint = 'https://api.openai.com/v1/responses'
export const transcriptionsApiEndpoint = 'https://api.openai.com/v1/audio/transcriptions'
export const speechApiEndpoint = 'https://api.openai.com/v1/audio/speech'
export const sttModel = process.env.PHONECALL_STT_MODEL?.trim() || 'gpt-4o-mini-transcribe'
export const ttsModel = process.env.PHONECALL_TTS_MODEL?.trim() || 'gpt-4o-mini-tts'
export const llmModel = process.env.PHONECALL_LLM_MODEL?.trim() || 'gpt-5-mini'
export const ttsVoice = process.env.PHONECALL_TTS_VOICE?.trim() || 'alloy'
export const requestTimeoutMs = Number(process.env.PHONECALL_TIMEOUT_MS || 30_000)
export const retryCount = Number(process.env.PHONECALL_RETRY_COUNT || 2)
export const maxRestarts = Number(process.env.PHONECALL_MAX_RESTARTS || 3)
export const maxTurnsPerSession = Number(process.env.PHONECALL_MAX_TURNS || 12)
export const heartbeatIntervalMs = Number(process.env.PHONECALL_HEARTBEAT_MS || 5_000)

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
