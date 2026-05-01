export type MoveCommand = 'go' | 'left' | 'right'
export type RockPosition = 'front' | 'left' | 'right' | 'unknown'

export interface Position {
  row: number
  col: number
}

export interface CurrentColumn {
  column: number
  yourRow: number
  stoneRow: number
  freeRows: number[]
}

export interface GameState {
  player: Position
  base: Position
  currentColumn: CurrentColumn | null
  moves: MoveRecord[]
}

export interface MoveRecord {
  step: number
  from: Position
  to: Position
  command: MoveCommand
  hint: string
  decision: MoveDecision
}

export interface MoveDecision {
  command: MoveCommand
  rockPosition: RockPosition
  reason: string
}

export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown
  durationMs: number
  flag: string | null
}

export interface StartGameResult {
  state: GameState
  raw: string
}

export type ScannerResult =
  | { status: 'clear'; raw: string }
  | { status: 'tracked'; raw: string; frequency: number; detectionCode: string }

export type ParsedScannerResponse =
  | { status: 'clear' }
  | { status: 'tracked'; frequency: number; detectionCode: string }

export interface RadioHintResult {
  hint: string
  raw: string
}

export interface MoveRocketResult {
  raw: string
  json: unknown
  flag: string | null
}

export interface AgentRunSummary {
  flag: string | null
  finalRaw: string
  steps: number
  finalState: GameState
}

export interface ResponsesApiResult {
  output?: Array<ResponseOutputItem>
  output_text?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
  }
}

export type ResponseMessageItem = {
  type: 'message'
  content?: Array<{ type: string; text?: string }>
}

export type ResponseOutputItem = ResponseMessageItem
