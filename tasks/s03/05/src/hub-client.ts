import { hubApiKey, requestTimeoutMs, toolsearchUrl } from './config.js'
import log from './logger.js'
import type { DiscoveredTool, ToolCallResult } from './types.js'

const HUB_API_BASE = 'https://hub.ag3nts.org/api'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toAbsoluteToolUrl(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return trimmed
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  if (trimmed.startsWith('/')) {
    return new URL(trimmed, `${HUB_API_BASE}/`).toString()
  }

  return new URL(`/${trimmed}`, `${HUB_API_BASE}/`).toString()
}

function createToolName(url: string, index: number): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '')
    const pathname = parsed.pathname.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '')
    return `${host}_${pathname}`.replace(/^_+|_+$/g, '') || `tool_${index + 1}`
  } catch {
    return `tool_${index + 1}`
  }
}

function collectToolCandidates(value: unknown, out: Array<{ url: string; description: string }>): void {
  if (!value) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectToolCandidates(item, out)
    }
    return
  }

  const obj = asRecord(value)
  if (!obj) {
    return
  }

  const urlKeys = ['url', 'URL', 'endpoint', 'tool_url', 'toolUrl']
  const descKeys = ['description', 'desc', 'name', 'title']

  let foundUrl = ''
  for (const key of urlKeys) {
    const raw = obj[key]
    if (typeof raw === 'string' && raw.trim()) {
      foundUrl = raw.trim()
      break
    }
  }

  if (foundUrl) {
    let description = 'No description'
    for (const key of descKeys) {
      const raw = obj[key]
      if (typeof raw === 'string' && raw.trim()) {
        description = raw.trim()
        break
      }
    }

    out.push({
      url: toAbsoluteToolUrl(foundUrl),
      description,
    })
  }

  for (const nested of Object.values(obj)) {
    collectToolCandidates(nested, out)
  }
}

async function postQuery(url: string, query: string): Promise<ToolCallResult> {
  log.toolCall(url, query)

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: hubApiKey, query }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  const bodyText = await response.text()
  log.toolResult(url, response.status, bodyText.slice(0, 900))

  return {
    url,
    status: response.status,
    ok: response.ok,
    bodyText,
    bodyJson: parseJson(bodyText),
  }
}

export async function discoverTools(query: string): Promise<{ call: ToolCallResult; tools: DiscoveredTool[] }> {
  const call = await postQuery(toolsearchUrl, query)
  const candidates: Array<{ url: string; description: string }> = []
  collectToolCandidates(call.bodyJson ?? call.bodyText, candidates)

  const dedupe = new Map<string, DiscoveredTool>()
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate.url.startsWith('https://')) {
      continue
    }

    if (!dedupe.has(candidate.url)) {
      dedupe.set(candidate.url, {
        url: candidate.url,
        description: candidate.description,
        name: createToolName(candidate.url, index),
      })
    }
  }

  return {
    call,
    tools: [...dedupe.values()],
  }
}

export async function askTool(url: string, query: string): Promise<ToolCallResult> {
  return postQuery(toAbsoluteToolUrl(url), query)
}
