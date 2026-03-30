import { hubApiKey, requestTimeoutMs, taskName, verifyUrl } from './config.js'
import log from './logger.js'
import type { VerifyResponse } from './types.js'

function extractFlag(text: string): string | null {
  const match = text.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}

export async function verifyAnswer(answer: string[]): Promise<VerifyResponse> {
  log.verify(answer)

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: hubApiKey,
      task: taskName,
      answer,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  const raw = await response.text()
  const flag = extractFlag(raw)

  return {
    ok: response.ok,
    status: response.status,
    raw,
    flag,
  }
}
