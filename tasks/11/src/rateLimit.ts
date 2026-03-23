export const MAX_RATE_LIMIT_RETRIES = 5
export const BASE_RETRY_DELAY_MS = 500
export const MAX_RETRY_DELAY_MS = 12_000

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function readRetryAfterMs(err: unknown): number | null {
  const maybeError = err as {
    headers?: Record<string, unknown> | Headers
    response?: { headers?: Record<string, unknown> | Headers }
  }

  const headersCandidate = maybeError?.headers ?? maybeError?.response?.headers
  if (!headersCandidate) {
    return null
  }

  const getHeader = (name: string): string | null => {
    if (headersCandidate instanceof Headers) {
      return headersCandidate.get(name)
    }

    const value = headersCandidate[name] ?? headersCandidate[name.toLowerCase()]
    return typeof value === 'string' ? value : null
  }

  const retryAfter = getHeader('retry-after')
  if (!retryAfter) {
    return null
  }

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.floor(seconds * 1000))
  }

  const retryAt = Date.parse(retryAfter)
  if (Number.isNaN(retryAt)) {
    return null
  }

  return Math.max(0, retryAt - Date.now())
}

export function isRateLimitError(err: unknown): boolean {
  const maybeError = err as {
    status?: number
    code?: string
    error?: { code?: string; type?: string }
    message?: string
  }

  if (maybeError?.status === 429) {
    return true
  }

  const code = (maybeError?.code ?? maybeError?.error?.code ?? maybeError?.error?.type ?? '').toLowerCase()
  if (code.includes('rate') || code.includes('429') || code.includes('throttle')) {
    return true
  }

  const message = (maybeError?.message ?? '').toLowerCase()
  return message.includes('rate limit') || message.includes('too many requests')
}

export function computeBackoffMs(attempt: number): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt)
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(MAX_RETRY_DELAY_MS, exponential + jitter)
}
