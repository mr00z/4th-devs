import { AI_API_KEY, EXTRA_API_HEADERS, resolveModelForProvider, responsesApiEndpoint } from './config.js'

interface ResponsesApiResult {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  error?: { message?: string }
}

function extractResponseText(data: ResponsesApiResult): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text
  }

  const messages = Array.isArray(data.output)
    ? data.output.filter((item) => item?.type === 'message')
    : []

  const textPart = messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .find((part) => part?.type === 'output_text' && typeof part?.text === 'string')

  return textPart?.text ?? ''
}

export async function vision(question: string, imageUrl: string): Promise<string> {
  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify({
      model: resolveModelForProvider('gpt-5.4'),
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: question },
            { type: 'input_image', image_url: imageUrl },
          ],
        },
      ],
    }),
  })

  const data = (await response.json()) as ResponsesApiResult

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Vision request failed (${response.status})`)
  }

  return extractResponseText(data) || 'No response'
}
