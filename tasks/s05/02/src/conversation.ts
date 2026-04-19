import { maxTurnsPerSession } from './config.js'
import { planCallerReply } from './llm.js'
import log from './logger.js'
import type { ConversationStage, InboundTurn, OperatorInterpretation, OutboundTurn, RouteCode, RouteStatus, SessionState } from './types.js'

const ALL_ROUTES: RouteCode[] = ['RD224', 'RD472', 'RD820']

export function createInitialSessionState(sessionIndex: number, recoveryNotes: string[] = []): SessionState {
  return {
    sessionIndex,
    stage: 'awaiting_statuses',
    turnCount: 0,
    usedPassword: false,
    askedStatuses: false,
    requestedDisable: false,
    answeredWhy: false,
    clarifiedPurpose: false,
    routeStatuses: {
      RD224: 'unknown',
      RD472: 'unknown',
      RD820: 'unknown',
    },
    selectedRoutesToDisable: [],
    lastHint: '',
    recoveryNotes,
    lastInterpretation: null,
    history: [],
  }
}

function mergeRouteStatuses(current: SessionState['routeStatuses'], update: Partial<Record<RouteCode, RouteStatus>>): SessionState['routeStatuses'] {
  return {
    RD224: update.RD224 && update.RD224 !== 'unknown' ? update.RD224 : current.RD224,
    RD472: update.RD472 && update.RD472 !== 'unknown' ? update.RD472 : current.RD472,
    RD820: update.RD820 && update.RD820 !== 'unknown' ? update.RD820 : current.RD820,
  }
}

function conciseHistory(state: SessionState): string {
  return state.history.map((item) => `${item.role === 'assistant' ? 'ME' : 'OPERATOR'}: ${item.text}`).join('\n')
}

function passableRoutes(state: SessionState): RouteCode[] {
  return ALL_ROUTES.filter((route) => state.routeStatuses[route] === 'passable')
}

function buildIntroductionMessage(): string {
  return 'Dzień dobry, mówi Tymon Gajewski.'
}

function buildPasswordMessage(): string {
  return 'Hasło weryfikacyjne: BARBAKAN.'
}

function buildDisableRequest(routes: RouteCode[]): string {
  const noun = routes.length === 1 ? 'drodze' : 'drogach'
  return `Potrzebuję wyłączyć monitoring na ${noun} ${routes.join(', ')}, ponieważ to tajna operacja zlecona przez Zygfryda i właśnie ta trasa jest przejezdna dla transportu.`
}

function buildPurposeClarificationMessage(): string {
  return 'Chodzi o tajny transport dla jednej z baz Zygfryda. Muszę ustalić, która z dróg RD224, RD472 i RD820 jest przejezdna i nieskażona.'
}

function buildStatusFollowupMessage(): string {
  return 'Dziękuję. Prowadzę tajny transport dla jednej z baz Zygfryda i muszę znaleźć przejezdną drogę. Proszę podać aktualny status dróg RD224, RD472 i RD820.'
}

function buildWhyMessage(): string {
  return 'Dzwonię w sprawie tajnego transportu dla jednej z baz Zygfryda. Muszę ustalić, która droga jest przejezdna, żeby bezpiecznie przeprowadzić transport.'
}

function buildCompletionFallback(): string {
  return 'Proszę o potwierdzenie, że monitoring na wskazanej drodze został wyłączony.'
}

export function applyInboundTurn(state: SessionState, inbound: InboundTurn): SessionState {
  const interpretation = inbound.interpretation
  const routeStatuses = mergeRouteStatuses(state.routeStatuses, interpretation.routeStatuses)
  const selectedRoutesToDisable = passableRoutes({ ...state, routeStatuses })

  let stage: ConversationStage = state.stage
  if (interpretation.burned) {
    stage = 'burned'
  } else if (interpretation.requestedPassword) {
    stage = 'awaiting_disable_confirmation'
  } else if (interpretation.askedWhy && !state.answeredWhy) {
    stage = 'awaiting_reason_followup'
  } else if (selectedRoutesToDisable.length > 0 && !state.requestedDisable) {
    stage = 'awaiting_disable_confirmation'
  } else if (Object.values(routeStatuses).some((status) => status === 'unknown')) {
    stage = 'awaiting_statuses'
  }

  return {
    ...state,
    stage,
    routeStatuses,
    selectedRoutesToDisable,
    lastHint: inbound.payload.hint || state.lastHint,
    lastInterpretation: interpretation,
    history: [...state.history, { role: 'operator', text: inbound.transcript || inbound.payload.text || inbound.payload.message || '[empty]' }],
  }
}

function sanitizeSuggestedText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.length > 260) return ''
  if (/syjon/i.test(trimmed)) return ''
  if (/\[[^\]]+\]/.test(trimmed)) return ''
  if (!/[a-ząćęłńóśźż]/i.test(trimmed)) return ''
  return trimmed
}

function hasConcreteJustification(text: string): boolean {
  const normalized = text.toLowerCase()
  const mentionsTransport = /(tajny transport|transportu żywności|transport żywności)/i.test(normalized)
  const mentionsWhoOrNeed = /(zygfryd|baza|muszę|potrzebuję|dlatego)/i.test(normalized)
  return mentionsTransport && mentionsWhoOrNeed
}

export function chooseNextUtterance(state: SessionState, interpretation?: OperatorInterpretation, hint?: string): string {
  const effectiveInterpretation = interpretation ?? state.lastInterpretation ?? undefined
  const effectiveHint = hint ?? state.lastHint

  if (!state.askedStatuses) return buildIntroductionMessage()
  if (effectiveInterpretation?.requestedPassword && !state.usedPassword) return buildPasswordMessage()
  if (state.stage === 'awaiting_reason_followup' && !state.answeredWhy) {
    const safeSuggestion = sanitizeSuggestedText(effectiveInterpretation?.recommendedNextText ?? '')
    return hasConcreteJustification(safeSuggestion) ? safeSuggestion : buildWhyMessage()
  }
  if (!state.requestedDisable && state.selectedRoutesToDisable.length > 0) return buildDisableRequest(state.selectedRoutesToDisable)
  if (state.stage === 'awaiting_statuses' && !state.clarifiedPurpose) return buildPurposeClarificationMessage()
  if (state.stage === 'awaiting_statuses' && /purpose of the call|secret transport|passable road|who this transport is for/i.test(effectiveHint)) {
    return buildPurposeClarificationMessage()
  }
  if (state.stage === 'awaiting_statuses') return sanitizeSuggestedText(effectiveInterpretation?.recommendedNextText ?? '') || buildStatusFollowupMessage()

  const safeSuggestion = sanitizeSuggestedText(effectiveInterpretation?.recommendedNextText ?? '')
  if (safeSuggestion) return safeSuggestion
  return buildCompletionFallback()
}

export async function chooseNextUtteranceWithModel(state: SessionState): Promise<string> {
  if (!state.askedStatuses) return buildIntroductionMessage()
  if (state.lastInterpretation?.requestedPassword && !state.usedPassword) return buildPasswordMessage()

  const plannedText = sanitizeSuggestedText(await planCallerReply(state))
  if (plannedText) return plannedText

  log.warn('Falling back to rule-based next utterance', { state: summarizeState(state) })
  return chooseNextUtterance(state)
}

export function applyHubFeedback(state: SessionState, feedback: string, hint = ''): SessionState {
  const feedbackText = [feedback.trim(), hint ? `Hint: ${hint.trim()}` : ''].filter(Boolean).join(' ')
  if (!feedbackText) return state

  return {
    ...state,
    stage: /spalona|podejrzana|bezpieczeństwa|bezpieczenstwa|zadzwonić ponownie|zadzwonic ponownie/i.test(feedbackText)
      ? 'burned'
      : state.stage,
    lastHint: hint || state.lastHint,
    recoveryNotes: [...state.recoveryNotes, feedbackText].slice(-8),
  }
}

export function registerOutboundTurn(state: SessionState, outboundText: string): SessionState {
  let askedStatuses = state.askedStatuses
  let usedPassword = state.usedPassword
  let requestedDisable = state.requestedDisable
  let answeredWhy = state.answeredWhy
  let clarifiedPurpose = state.clarifiedPurpose

  if (!askedStatuses) {
    askedStatuses = true
  } else if (/BARBAKAN/i.test(outboundText)) {
    usedPassword = true
  } else if (/monitoring/i.test(outboundText) && /wyłączyć|wyłączenie|wylaczyc|wylaczenie/i.test(outboundText)) {
    requestedDisable = true
  } else if (/tajny transport|transportu żywności|baz[ay]? Zygfryda/i.test(outboundText)) {
    answeredWhy = true
  }
  if (/tajny transport/i.test(outboundText) && /przejezdna|nieskażona/i.test(outboundText)) {
    clarifiedPurpose = true
  }

  return {
    ...state,
    turnCount: state.turnCount + 1,
    usedPassword,
    askedStatuses,
    requestedDisable,
    answeredWhy,
    clarifiedPurpose,
    history: [...state.history, { role: 'assistant', text: outboundText }],
  }
}

export function assertTurnLimit(state: SessionState): void {
  if (state.turnCount >= maxTurnsPerSession) {
    throw new Error(`Conversation exceeded ${maxTurnsPerSession} turns in a single session.`)
  }
}

export function createOutboundTurn(state: SessionState, text: string): OutboundTurn {
  return {
    sessionIndex: state.sessionIndex,
    turnIndex: state.turnCount + 1,
    stageBefore: state.stage,
    text,
  }
}

export function summarizeState(state: SessionState): unknown {
  return {
    sessionIndex: state.sessionIndex,
    stage: state.stage,
    turnCount: state.turnCount,
    askedStatuses: state.askedStatuses,
    usedPassword: state.usedPassword,
    requestedDisable: state.requestedDisable,
    answeredWhy: state.answeredWhy,
    clarifiedPurpose: state.clarifiedPurpose,
    routeStatuses: state.routeStatuses,
    selectedRoutesToDisable: state.selectedRoutesToDisable,
    lastHint: state.lastHint,
    recoveryNotes: state.recoveryNotes,
    history: conciseHistory(state).slice(-1500),
  }
}

export function maybeMarkCompletedFromRaw(state: SessionState, raw: string): SessionState {
  if (/\{FLG:[^}]+\}/.test(raw)) {
    return { ...state, stage: 'completed' }
  }
  return state
}

export function logInterpretation(turn: InboundTurn): void {
  log.info('Inbound interpretation', {
    sessionIndex: turn.sessionIndex,
    turnIndex: turn.turnIndex,
    transcript: turn.transcript,
    interpretation: turn.interpretation,
  })
}
