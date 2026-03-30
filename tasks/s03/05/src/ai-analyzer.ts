import {
  aiApiKey,
  analyzerMaxOutputTokens,
  extraApiHeaders,
  requestTimeoutMs,
  responsesApiEndpoint,
  savethemModel,
} from './config.js'
import log from './logger.js'
import type { DiscoveredTool, KnowledgeModel, ResearchDecision, ToolEvidence } from './types.js'

interface AnalyzerInput {
  turn: number
  maxTurns: number
  knownTools: DiscoveredTool[]
  recentEvidence: ToolEvidence[]
  knowledge: KnowledgeModel
}

function outputPreview(value: unknown, maxLen: number = 1000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function endpointKey(url: string): string {
  const trimmed = url.trim()
  try {
    return new URL(trimmed).pathname.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function endpointDefaultQuery(endpoint: string): string {
  const key = endpointKey(endpoint)
  if (key.includes('/api/maps')) {
    return 'Skolwin'
  }
  if (key.includes('/api/wehicles')) {
    return 'walk'
  }
  if (key.includes('/api/books')) {
    return 'movement'
  }
  return 'Skolwin'
}

function fallbackDecision(input: AnalyzerInput): ResearchDecision {
  const tools = input.knownTools

  if (tools.length === 0) {
    return {
      done: false,
      summary: 'No tools discovered yet, retry toolsearch.',
      actions: [
        {
          mode: 'toolsearch',
          query: 'I need map, start position, target city Skolwin, terrain rules and vehicles',
          reason: 'bootstrap discovery',
        },
      ],
    }
  }

  const recentCountByEndpoint = new Map<string, number>()
  for (const item of input.recentEvidence) {
    const key = endpointKey(item.url)
    if (key.includes('/api/toolsearch')) {
      continue
    }
    recentCountByEndpoint.set(key, (recentCountByEndpoint.get(key) ?? 0) + 1)
  }

  const sortedTools = [...tools].sort((left, right) => {
    const leftKey = endpointKey(left.url)
    const rightKey = endpointKey(right.url)
    const leftCount = recentCountByEndpoint.get(leftKey) ?? 0
    const rightCount = recentCountByEndpoint.get(rightKey) ?? 0
    return leftCount - rightCount
  })

  const primary = sortedTools[0]
  return {
    done: false,
    summary: 'Fallback selected least-used endpoint for diversification.',
    actions: [
      {
        mode: 'ask_tool',
        endpoint: primary.url,
        query: endpointDefaultQuery(primary.url),
      },
    ],
  }
}

function normalizeDecision(value: unknown): ResearchDecision | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const obj = value as { done?: unknown; summary?: unknown; actions?: unknown }
  const done = obj.done === true
  const summary = typeof obj.summary === 'string' ? obj.summary : 'No summary'
  const rawActions = Array.isArray(obj.actions) ? obj.actions : []

  const actions: ResearchDecision['actions'] = []
  for (const raw of rawActions) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const action = raw as { mode?: unknown; endpoint?: unknown; query?: unknown; reason?: unknown }
    const mode = action.mode === 'toolsearch' || action.mode === 'ask_tool' || action.mode === 'finish_research'
      ? action.mode
      : null

    if (!mode) {
      continue
    }

    actions.push({
      mode,
      endpoint: typeof action.endpoint === 'string' ? action.endpoint : undefined,
      query: typeof action.query === 'string' ? action.query : undefined,
      reason: typeof action.reason === 'string' ? action.reason : undefined,
    })
  }

  return {
    done,
    summary,
    actions,
  }
}

function fallbackWithReason(input: AnalyzerInput, reason: string, details?: unknown): ResearchDecision {
  log.warn('Analyzer fallback decision used', {
    reason,
    details,
  })
  return fallbackDecision(input)
}

function extractOutputTextFromBody(body: Record<string, unknown>): string {
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return body.output_text.trim()
  }

  const output = Array.isArray(body.output) ? body.output : []
  const chunks: string[] = []

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const obj = item as { type?: unknown; content?: unknown }
    if (obj.type !== 'message' || !Array.isArray(obj.content)) {
      continue
    }

    for (const contentItem of obj.content) {
      if (!contentItem || typeof contentItem !== 'object') {
        continue
      }

      const content = contentItem as { type?: unknown; text?: unknown }
      if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') {
        const trimmed = content.text.trim()
        if (trimmed) {
          chunks.push(trimmed)
        }
      }
    }
  }

  return chunks.join('\n').trim()
}

export async function analyzeResearchStep(input: AnalyzerInput): Promise<ResearchDecision> {
  const instructions = [
    'You are a research controller for route planning to Skolwin.',
    'Decide only next API actions; do not produce final route.',
    'Use toolsearch when tools are missing or discovery is needed.',
    'Use ask_tool when endpoint exists and specify query as 1-3 keywords.',
    'For wehicles API, query with single vehicle name: walk, horse, car, or rocket.',
    'For maps API, query with city name only: Skolwin.',
    'For books API, query with 1-3 keywords like: movement, terrain, legend.',
    'Do not repeatedly call the same endpoint when recent evidence is redundant; switch endpoint or use toolsearch.',
    'Initial resources are fixed: 10 food and 10 fuel. Do not search for starting resources.',
    'Mark done=true when you have: map grid with S/G positions, vehicle consumption data, and terrain rules.',
    'Return JSON only.',
  ].join(' ')

  const schema = {
    type: 'object',
    properties: {
      done: { type: 'boolean' },
      summary: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['toolsearch', 'ask_tool', 'finish_research'] },
            endpoint: { type: ['string', 'null'] },
            query: { type: ['string', 'null'] },
          },
          required: ['mode', 'endpoint', 'query'],
          additionalProperties: false,
        },
      },
    },
    required: ['done', 'summary', 'actions'],
    additionalProperties: false,
  }

  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
      ...extraApiHeaders,
    },
    body: JSON.stringify({
      model: savethemModel,
      instructions,
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            turn: input.turn,
            maxTurns: input.maxTurns,
            knownTools: input.knownTools,
            recentEvidence: input.recentEvidence.map((item) => ({
              url: item.url,
              query: item.query,
              ok: item.ok,
              status: item.status,
              bodyPreview: outputPreview(item.bodyText, 1000),
            })),
            knowledge: input.knowledge,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'research_decision',
          strict: true,
          schema,
        },
      },
      max_output_tokens: analyzerMaxOutputTokens,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    return fallbackWithReason(input, 'responses_api_http_error', {
      status: response.status,
      bodyPreview: outputPreview(body, 1200),
    })
  }

  if (body.error) {
    return fallbackWithReason(input, 'responses_api_error_payload', {
      bodyPreview: outputPreview(body, 1200),
    })
  }

  const outputText = extractOutputTextFromBody(body)
  if (!outputText) {
    return fallbackWithReason(input, 'missing_output_text', {
      bodyPreview: outputPreview(body, 1200),
    })
  }

  try {
    const parsed = JSON.parse(outputText) as unknown
    const normalized = normalizeDecision(parsed)
    if (!normalized) {
      return fallbackWithReason(input, 'schema_normalization_failed', {
        outputTextPreview: outputPreview(outputText, 1200),
      })
    }
    return normalized
  } catch (error) {
    return fallbackWithReason(input, 'output_json_parse_failed', {
      error: outputPreview(String(error), 400),
      outputTextPreview: outputPreview(outputText, 1200),
    })
  }
}
