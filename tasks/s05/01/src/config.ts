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
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed
    const equalsIndex = normalized.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }
    const key = normalized.slice(0, equalsIndex).trim()
    let value = normalized.slice(equalsIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadRootEnv()

const openAiKey = process.env.OPENAI_API_KEY?.trim() ?? ''

export const taskName = 'radiomonitoring'
export const verifyUrl = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
export const hubApiKey = process.env.HUB_API_KEY?.trim() || ''
export const aiApiKey = openAiKey
export const responsesApiEndpoint = 'https://api.openai.com/v1/responses'
export const transcriptionsApiEndpoint = 'https://api.openai.com/v1/audio/transcriptions'
export const textModel = process.env.RADIOMONITORING_TEXT_MODEL?.trim() || 'gpt-5-mini'
export const reviewerModel = process.env.RADIOMONITORING_REVIEWER_MODEL?.trim() || 'gpt-5.4-mini'
export const visionModel = process.env.RADIOMONITORING_VISION_MODEL?.trim() || 'gpt-5.4'
export const audioModel = process.env.RADIOMONITORING_AUDIO_MODEL?.trim() || 'gpt-4o-mini-transcribe'
export const requestTimeoutMs = Number(process.env.RADIOMONITORING_TIMEOUT_MS || 25000)
export const retryCount = Number(process.env.RADIOMONITORING_RETRY_COUNT || 2)
export const maxListenIterations = Number(process.env.RADIOMONITORING_MAX_LISTENS || 150)
export const heartbeatIntervalMs = Number(process.env.RADIOMONITORING_HEARTBEAT_MS || 5000)
export const maxAttachmentBytesForInlineLlm = Number(process.env.RADIOMONITORING_MAX_INLINE_BYTES || 100_000)
export const reviewStartAt = Number(process.env.RADIOMONITORING_REVIEW_START_AT || 10)
export const reviewEvery = Number(process.env.RADIOMONITORING_REVIEW_EVERY || 5)
export const reviewStopThreshold = Number(process.env.RADIOMONITORING_REVIEW_STOP_THRESHOLD || 0.7)

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
