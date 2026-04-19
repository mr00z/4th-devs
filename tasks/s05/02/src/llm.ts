import { aiApiKey, llmModel, responsesApiEndpoint } from './config.js'
import type { OperatorInterpretation, RouteCode, RouteStatus, SessionState } from './types.js'
import log from './logger.js'

let testInterpreterOverride: ((text: string, history: string, stage: string, hint?: string) => Promise<OperatorInterpretation>) | null = null
let testCallerPlannerOverride: ((state: SessionState) => Promise<string>) | null = null

interface ResponsesApiResult {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  error?: { message?: string }
}

function extractResponseText(data: ResponsesApiResult): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const messages = Array.isArray(data.output) ? data.output.filter((item) => item?.type === 'message') : []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

const interpretationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operatorIntent: { type: 'string', enum: ['provide_statuses', 'request_password', 'ask_why', 'confirm_disable', 'burned', 'other'] },
    rd224: { type: 'string', enum: ['passable', 'blocked', 'unknown'] },
    rd472: { type: 'string', enum: ['passable', 'blocked', 'unknown'] },
    rd820: { type: 'string', enum: ['passable', 'blocked', 'unknown'] },
    requestedPassword: { type: 'boolean' },
    askedWhy: { type: 'boolean' },
    burned: { type: 'boolean' },
    successLikely: { type: 'boolean' },
    confidence: { type: 'number' },
    recommendedNextText: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['operatorIntent', 'rd224', 'rd472', 'rd820', 'requestedPassword', 'askedWhy', 'burned', 'successLikely', 'confidence', 'recommendedNextText', 'notes'],
} as const

const callerReplySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    intent: {
      type: 'string',
      enum: ['answer_question', 'ask_statuses', 'provide_password', 'request_disable', 'confirm', 'recover'],
    },
    confidence: { type: 'number' },
  },
  required: ['text', 'intent', 'confidence'],
} as const

function fallbackInterpretation(text: string): OperatorInterpretation {
  const normalized = text.toLowerCase()
  const statuses: Partial<Record<RouteCode, RouteStatus>> = {
    RD224: /rd-?224/.test(normalized)
      ? (/przejezd|bezpiecz|wolna/.test(normalized) ? 'passable' : /zamkni|nieprzejezd|skaż|zagroż/.test(normalized) ? 'blocked' : 'unknown')
      : 'unknown',
    RD472: /rd-?472/.test(normalized)
      ? (/przejezd|bezpiecz|wolna/.test(normalized) ? 'passable' : /zamkni|nieprzejezd|skaż|zagroż/.test(normalized) ? 'blocked' : 'unknown')
      : 'unknown',
    RD820: /rd-?820/.test(normalized)
      ? (/przejezd|bezpiecz|wolna/.test(normalized) ? 'passable' : /zamkni|nieprzejezd|skaż|zagroż/.test(normalized) ? 'blocked' : 'unknown')
      : 'unknown',
  }
  const passableRoutes = (Object.entries(statuses).filter(([, status]) => status === 'passable').map(([code]) => code)) as RouteCode[]
  const blockedRoutes = (Object.entries(statuses).filter(([, status]) => status === 'blocked').map(([code]) => code)) as RouteCode[]
  return {
    operatorIntent: /hasło|tożsamo|autoryzac/.test(normalized)
      ? 'request_password'
      : /dlaczego|po co|uzasadni/.test(normalized)
        ? 'ask_why'
        : /wyłącz|wyłączę|odłącz|monitoring.*(wyłącz|wyłączę)|zrobione/.test(normalized)
          ? 'confirm_disable'
          : passableRoutes.length > 0 || blockedRoutes.length > 0
            ? 'provide_statuses'
            : /rozłącz|koniec|podejr|alarm|nie rozmawiam/.test(normalized)
              ? 'burned'
              : 'other',
    routeStatuses: statuses,
    passableRoutes,
    blockedRoutes,
    requestedPassword: /hasło|barbakan/.test(normalized),
    askedWhy: /dlaczego|po co|uzasadni/.test(normalized),
    burned: /rozłącz|podejr|alarm|koniec rozmowy|odmawiam/.test(normalized),
    successLikely: /zrobione|wyłączę|wyłączyłem|monitoring.*wyłącz/.test(normalized),
    confidence: 0.45,
    recommendedNextText: '',
    notes: 'fallback',
  }
}

function parseInterpretation(text: string): OperatorInterpretation {
  const parsed = JSON.parse(text) as {
    operatorIntent: OperatorInterpretation['operatorIntent']
    rd224: RouteStatus
    rd472: RouteStatus
    rd820: RouteStatus
    requestedPassword: boolean
    askedWhy: boolean
    burned: boolean
    successLikely: boolean
    confidence: number
    recommendedNextText: string
    notes: string
  }
  const routeStatuses: Partial<Record<RouteCode, RouteStatus>> = {
    RD224: parsed.rd224,
    RD472: parsed.rd472,
    RD820: parsed.rd820,
  }
  return {
    operatorIntent: parsed.operatorIntent,
    routeStatuses,
    passableRoutes: (Object.entries(routeStatuses).filter(([, status]) => status === 'passable').map(([code]) => code)) as RouteCode[],
    blockedRoutes: (Object.entries(routeStatuses).filter(([, status]) => status === 'blocked').map(([code]) => code)) as RouteCode[],
    requestedPassword: parsed.requestedPassword,
    askedWhy: parsed.askedWhy,
    burned: parsed.burned,
    successLikely: parsed.successLikely,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    recommendedNextText: parsed.recommendedNextText.trim(),
    notes: parsed.notes.trim(),
  }
}

async function callResponses(body: unknown, purpose: string): Promise<string> {
  log.info('LLM request', { purpose, preview: JSON.stringify(body).slice(0, 500) })
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
    throw new Error(parsed.error?.message || `LLM request failed (${response.status})`)
  }
  return extractResponseText(parsed)
}

export async function interpretOperatorReply(replyText: string, history: string, stage: string, hint = ''): Promise<OperatorInterpretation> {
  if (testInterpreterOverride) return testInterpreterOverride(replyText, history, stage, hint)

  const instruction = [
    'You are a classifier for a Polish-language phone call.',
    'Analyze only the system operator\'s utterance.',
    'Do not invent facts. If a road status is unclear, set it to unknown.',
    'Roads: RD224, RD472, RD820.',
    'passable means passable, safe, or uncontaminated.',
    'blocked means impassable, closed, contaminated, or dangerous.',
    'recommendedNextText must be a short suggested reply in Polish.',
    'If a hint is provided, use it as guidance for recommendedNextText, but do not change factual classification based on it.',
    'Return JSON only.',
  ].join(' ')

  try {
    const response = await callResponses({
      model: llmModel,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: `${instruction}\n\nConversation stage: ${stage}\n\nHistory:\n${history.slice(-4000)}\n\nSystem hint:\n${hint || '[none]'}\n\nOperator utterance:\n${replyText.slice(0, 3000)}`,
        }],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'phonecall_interpretation',
          strict: true,
          schema: interpretationSchema,
        },
      },
    }, 'interpret-operator-reply')
    return parseInterpretation(response)
  } catch (error: unknown) {
    log.warn('LLM interpretation failed, using fallback', { error: String(error) })
    return fallbackInterpretation(replyText)
  }
}

function compactHistory(state: SessionState): string {
  return state.history.map((item) => `${item.role === 'assistant' ? 'ME' : 'OPERATOR'}: ${item.text}`).join('\n')
}

function parseCallerReply(text: string): string {
  const parsed = JSON.parse(text) as { text: string; intent: string; confidence: number }
  return parsed.text.trim()
}

export async function planCallerReply(state: SessionState): Promise<string> {
  if (testCallerPlannerOverride) return testCallerPlannerOverride(state)

  const passableRoutes = Object.entries(state.routeStatuses)
    .filter(([, status]) => status === 'passable')
    .map(([route]) => route)
  const blockedRoutes = Object.entries(state.routeStatuses)
    .filter(([, status]) => status === 'blocked')
    .map(([route]) => route)

  const instruction = `
    You are Tymon Gajewski in a Polish phone call with a road operator. You are conducting a secret food transport to one of Zygfryd's secret bases.
    Your goal is to identify which of the roads RD224, RD472, and RD820 is passable and ask the operator to disable monitoring on the passable road or roads.
    Operator's password is "BARBAKAN".

    Rules:
    - Use exact road identifiers.
    - If the state contains recoveryNotes, treat them as hints for this conversation.
    - Speak naturally, briefly, in Polish, and without placeholders.
  `

  const stateSummary = {
    stage: state.stage,
    turnCount: state.turnCount,
    usedPassword: state.usedPassword,
    requestedDisable: state.requestedDisable,
    routeStatuses: state.routeStatuses,
    passableRoutes,
    blockedRoutes,
    selectedRoutesToDisable: state.selectedRoutesToDisable,
    lastHint: state.lastHint || '[none]',
    recoveryNotes: state.recoveryNotes,
    lastInterpretation: state.lastInterpretation,
  }

  try {
    const response = await callResponses({
      model: llmModel,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: `${instruction}\n\nConversation state:\n${JSON.stringify(stateSummary, null, 2)}\n\nHistory:\n${compactHistory(state).slice(-5000) || '[none]'}\n\nWrite Tymon's next utterance.`,
        }],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'phonecall_caller_reply',
          strict: true,
          schema: callerReplySchema,
        },
      },
    }, 'plan-caller-reply')
    return parseCallerReply(response)
  } catch (error: unknown) {
    log.warn('LLM caller planning failed', { error: String(error) })
    return ''
  }
}

export function setTestInterpreterOverride(
  override: ((text: string, history: string, stage: string, hint?: string) => Promise<OperatorInterpretation>) | null,
): void {
  testInterpreterOverride = override
}

export function setTestCallerPlannerOverride(
  override: ((state: SessionState) => Promise<string>) | null,
): void {
  testCallerPlannerOverride = override
}
