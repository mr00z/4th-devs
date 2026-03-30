import './env.js'

// @ts-expect-error - root config is untyped JS
import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT, resolveModelForProvider } from '../../../../config.js'

const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? ''
const VERIFY_URL = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify'
const TOOLSEARCH_URL = process.env.HUB_TOOLSEARCH_URL?.trim() || 'https://hub.ag3nts.org/api/toolsearch'

const SAVETHEM_MODEL = process.env.SAVETHEM_MODEL?.trim() || 'gpt-5-mini'
const RESEARCH_TURNS = Number.parseInt(process.env.SAVETHEM_RESEARCH_TURNS?.trim() || '20', 10)
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SAVETHEM_TIMEOUT_MS?.trim() || '30000', 10)
const ANALYZER_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.SAVETHEM_ANALYZER_MAX_OUTPUT_TOKENS?.trim() || '2000', 10)
const INITIAL_FOOD = Number.parseInt(process.env.SAVETHEM_INITIAL_FOOD?.trim() || '10', 10)
const INITIAL_FUEL = Number.parseInt(process.env.SAVETHEM_INITIAL_FUEL?.trim() || '10', 10)
const TASK_NAME = process.env.SAVETHEM_TASK_NAME?.trim() || 'savethem'

export const hubApiKey = HUB_API_KEY
export const verifyUrl = VERIFY_URL
export const toolsearchUrl = TOOLSEARCH_URL
export const taskName = TASK_NAME

export const aiApiKey = String(AI_API_KEY || '')
export const extraApiHeaders = (EXTRA_API_HEADERS as Record<string, string>) ?? {}
export const responsesApiEndpoint = String(RESPONSES_API_ENDPOINT)
export const savethemModel = resolveModelForProvider(SAVETHEM_MODEL) as string

export const researchTurns = Number.isFinite(RESEARCH_TURNS) && RESEARCH_TURNS > 0 ? RESEARCH_TURNS : 20
export const requestTimeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 0 ? REQUEST_TIMEOUT_MS : 30000
export const analyzerMaxOutputTokens = Number.isFinite(ANALYZER_MAX_OUTPUT_TOKENS) && ANALYZER_MAX_OUTPUT_TOKENS > 0
  ? ANALYZER_MAX_OUTPUT_TOKENS
  : 2000
export const initialFood = Number.isFinite(INITIAL_FOOD) && INITIAL_FOOD > 0 ? INITIAL_FOOD : 10
export const initialFuel = Number.isFinite(INITIAL_FUEL) && INITIAL_FUEL >= 0 ? INITIAL_FUEL : 10

if (!hubApiKey) {
  console.error('\x1b[31mError: HUB_API_KEY is not set\x1b[0m')
  console.error('       Add HUB_API_KEY=your-key to the root .env file')
  process.exit(1)
}

if (!aiApiKey) {
  console.error('\x1b[31mError: AI API key is not set\x1b[0m')
  console.error('       Configure OPENAI_API_KEY or OPENROUTER_API_KEY in root .env file')
  process.exit(1)
}
