import { aiApiKey, responsesApiEndpoint } from './config.js'
import type { ResponsesApiResult } from './types.js'

export function extractResponseText(data: ResponsesApiResult): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const messages = Array.isArray(data.output) ? data.output.filter((item) => item.type === 'message') : []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

export async function callResponses(body: Record<string, unknown>): Promise<ResponsesApiResult> {
  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  const parsed = raw ? JSON.parse(raw) as ResponsesApiResult : {}
  if (!response.ok || parsed.error) {
    throw new Error(parsed.error?.message || `Responses API request failed (${response.status})`)
  }
  return parsed
}
