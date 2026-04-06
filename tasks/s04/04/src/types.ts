export type SourceNoteId = 'readme' | 'ogloszenia' | 'rozmowy' | 'transakcje'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface McpToolMeta {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpClientHandle {
  client: import('@modelcontextprotocol/sdk/client/index.js').Client
  close: () => Promise<void>
}

export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  durationMs: number
}

export interface CityDemandFact {
  city: string
  rawGood: string
  quantity: number
  evidence: string
}

export interface CityContactFact {
  city: string
  fullName: string
  evidence: string
}

export interface TransactionFact {
  sellerCity: string
  rawGood: string
  buyerCity: string
  evidence: string
}

export interface ExtractedKnowledge {
  cityDemands: CityDemandFact[]
  cityContacts: CityContactFact[]
  transactions: TransactionFact[]
  ambiguities: string[]
}

export interface ValidatedKnowledge {
  cityDemands: Record<string, Record<string, number>>
  cityContacts: Array<{ city: string; fullName: string; fileName: string }>
  goodsToCities: Record<string, string[]>
}

export interface ManifestFile {
  path: string
  content: string
}

export interface FilesystemManifest {
  directories: ['/miasta', '/osoby', '/towary']
  files: ManifestFile[]
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

export type AgentRole = 'orchestrator' | 'notes_extractor' | 'filesystem_architect'

export interface ToolContext {
  role: AgentRole
  mcp: McpClientHandle
  validatedKnowledge?: ValidatedKnowledge
}

export interface ToolSpec {
  definition: ToolDefinition
  roles: AgentRole[]
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}
