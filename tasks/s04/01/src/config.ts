// @ts-expect-error root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT, resolveModelForProvider } from '../../../../config.js'

const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? ''
const VERIFY_URL = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
const TASK_NAME = process.env.OKO_TASK_NAME?.trim() || 'okoeditor'
const OKO_PANEL_URL = process.env.OKO_PANEL_URL?.trim() || 'https://oko.ag3nts.org/'
const OKO_LOGIN = process.env.OKO_LOGIN?.trim() || 'Zofia'
const OKO_PASSWORD = process.env.OKO_PASSWORD?.trim() || 'Zofia2026!'
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.OKO_TIMEOUT_MS?.trim() || '30000', 10)
const MAX_STEPS = Number.parseInt(process.env.OKO_MAX_STEPS?.trim() || '20', 10)
const MODEL = process.env.OKO_MODEL?.trim() || 'gpt-5-mini'

export const hubApiKey = HUB_API_KEY
export const verifyUrl = VERIFY_URL
export const taskName = TASK_NAME
export const okoPanelUrl = OKO_PANEL_URL
export const okoLogin = OKO_LOGIN
export const okoPassword = OKO_PASSWORD
export const requestTimeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 0 ? REQUEST_TIMEOUT_MS : 30000
export const maxSteps = Number.isFinite(MAX_STEPS) && MAX_STEPS > 0 ? MAX_STEPS : 20

export const aiApiKey = String(AI_API_KEY || '')
export const extraApiHeaders = (EXTRA_API_HEADERS as Record<string, string>) ?? {}
export const responsesApiEndpoint = String(RESPONSES_API_ENDPOINT)
export const chatApiBaseUrl = String(CHAT_API_BASE_URL)
export const okoModel = resolveModelForProvider(MODEL) as string

if (!hubApiKey) {
  console.error('\x1b[31mError: HUB_API_KEY is not set\x1b[0m')
  console.error('       Add HUB_API_KEY to the root .env file')
  process.exit(1)
}

if (!aiApiKey) {
  console.error('\x1b[31mError: AI API key is not set\x1b[0m')
  console.error('       Configure OPENAI_API_KEY or OPENROUTER_API_KEY in root .env file')
  process.exit(1)
}
