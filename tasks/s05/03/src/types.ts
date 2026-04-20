export type TextMessage = {
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string
}

export type FunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type FunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type ConversationItem = TextMessage | FunctionCallItem | FunctionCallOutputItem

export interface ShellCommandResult {
  ok: boolean
  status: number
  cmd: string
  raw: string
  json: unknown | null
  outputText: string
  durationMs: number
  flag: string | null
}

export interface MemoryState {
  activeObservations: string
  lastObservedIndex: number
  observerSeq: number
  reflectorSeq: number
  generation: number
  lastReflectionLength: number
}

export interface Session {
  id: string
  messages: ConversationItem[]
  memory: MemoryState
}

export interface AgentRunSummary {
  flag: string | null
  finalRaw: string
  commandCount: number
  finalAnswer?: {
    date: string
    city: string
    longitude: number
    latitude: number
  }
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

export type ResponseFunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type ResponseOutputItem = ResponseMessageItem | ResponseFunctionCallItem

export type ToolDefinition = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict?: boolean
}
