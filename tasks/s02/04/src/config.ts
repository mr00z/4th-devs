import OpenAI from 'openai'
// @ts-expect-error — root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS, resolveModelForProvider } from '../../../../config.js'

// HUB_API_KEY should be available from the root .env file loaded by config.js
const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? ''

if (!HUB_API_KEY) {
  console.error('\x1b[31mError: HUB_API_KEY is not set\x1b[0m')
  console.error('       Add HUB_API_KEY=your-key to the root .env file')
  process.exit(1)
}

export const hubApiKey = HUB_API_KEY

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
})

export { resolveModelForProvider }
