export type RouteCode = 'RD224' | 'RD472' | 'RD820'

export type RouteStatus = 'passable' | 'blocked' | 'unknown'

export type ConversationStage =
  | 'awaiting_statuses'
  | 'awaiting_disable_confirmation'
  | 'awaiting_reason_followup'
  | 'completed'
  | 'burned'

export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  durationMs: number
}

export interface ParsedHubPayload {
  code: number | null
  message: string
  text: string
  callerTranscript: string
  audioBase64: string | null
  mimeType: string | null
  hint: string
}

export interface OperatorInterpretation {
  operatorIntent: 'provide_statuses' | 'request_password' | 'ask_why' | 'confirm_disable' | 'burned' | 'other'
  routeStatuses: Partial<Record<RouteCode, RouteStatus>>
  passableRoutes: RouteCode[]
  blockedRoutes: RouteCode[]
  requestedPassword: boolean
  askedWhy: boolean
  burned: boolean
  successLikely: boolean
  confidence: number
  recommendedNextText: string
  notes: string
}

export interface InboundTurn {
  sessionIndex: number
  turnIndex: number
  payload: ParsedHubPayload
  transcript: string
  interpretation: OperatorInterpretation
}

export interface OutboundTurn {
  sessionIndex: number
  turnIndex: number
  stageBefore: ConversationStage
  text: string
  audioPath?: string
}

export interface SessionState {
  sessionIndex: number
  stage: ConversationStage
  turnCount: number
  usedPassword: boolean
  askedStatuses: boolean
  requestedDisable: boolean
  answeredWhy: boolean
  clarifiedPurpose: boolean
  routeStatuses: Record<RouteCode, RouteStatus>
  selectedRoutesToDisable: RouteCode[]
  lastHint: string
  recoveryNotes: string[]
  lastInterpretation: OperatorInterpretation | null
  history: Array<{
    role: 'assistant' | 'operator'
    text: string
  }>
}

export interface RunSummary {
  flag: string | null
  transcript: string
  restarts: number
  finalRaw: string
}
