import OpenAI from 'openai'
// @ts-expect-error — root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../../../config.js'

const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? ''
const SHELL_API_URL = 'https://hub.ag3nts.org/api/shell'
const VERIFY_URL = 'https://hub.ag3nts.org/verify'
const AGENT_MODEL = process.env.FIRMWARE_AGENT_MODEL?.trim() || 'gpt-5.2'

if (!HUB_API_KEY) {
  console.error('\x1b[31mError: HUB_API_KEY is not set\x1b[0m')
  console.error('       Add HUB_API_KEY=your-key to the root .env file')
  process.exit(1)
}

export const hubApiKey = HUB_API_KEY
export const shellApiUrl = SHELL_API_URL
export const verifyUrl = VERIFY_URL
export const model = resolveModelForProvider(AGENT_MODEL) as string

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
})
