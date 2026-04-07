export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  durationMs: number
}

export interface NormalizedOrder {
  id: string
  title: string
  creatorID?: number | null
  destination?: string | number | null
  items: Record<string, number>
  raw: unknown
}

export interface ValidationIssue {
  type:
    | 'missing_city'
    | 'duplicate_city'
    | 'unknown_order'
    | 'missing_item'
    | 'extra_item'
    | 'wrong_quantity'
  city?: string
  orderId?: string
  item?: string
  expected?: number
  actual?: number
  message: string
}

export interface ValidationResult {
  ok: boolean
  expectedCityCount: number
  actualOrderCount: number
  coveredCities: string[]
  issues: ValidationIssue[]
}

export interface FinalizeResult {
  success: boolean
  message: string
  flag?: string
  affectedOrderIds?: string[]
  validation?: ValidationResult
  raw?: string
}

export interface AgentState {
  lastFinalize: FinalizeResult | null
  resetCount: number
  iteration: number
}

export interface ToolContext {
  state: AgentState
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

export interface ToolSpec {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

export interface AgentRunResult {
  flag?: string
  success: boolean
  message: string
  iterations: number
}

export interface CompletionToolCall {
  id: string
  name: string
  arguments: string
}

export interface CompletionResponse {
  content: string
  toolCalls: CompletionToolCall[]
}
