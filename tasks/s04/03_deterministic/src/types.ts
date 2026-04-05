export interface VerifyEnvelopeAnswer {
  action: string
  [key: string]: unknown
}

export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  durationMs: number
}

export interface Tile {
  x: number
  y: number
  symbol: string
  isRoad: boolean
  isBuilding: boolean
  isBlocked: boolean
  height?: number
  coord: string
}

export interface GameMap {
  width: number
  height: number
  tiles: Tile[][]
  roads: Tile[]
  buildings: Tile[]
  candidates: Tile[]
}

export type UnitType = 'scout' | 'transporter'

export interface Unit {
  id: string
  type: UnitType
  x: number
  y: number
  passengers?: string[]
  parentTransporter?: string
}

export interface CandidateTile {
  tile: Tile
  score: number
  reasons: string[]
  inspected: boolean
}

export interface MissionState {
  actionPointsUsed: number
  actionPointsRemaining: number
  units: Map<string, Unit>
  inspectedTiles: Set<string>
  candidateTiles: Map<string, CandidateTile>
  confirmedSurvivorTile: string | null
  logsConsumed: number
  seenLogCounts: Map<string, number>
  maxAP: number
  scoutMoveCount: number
  scoutMoveApSpent: number
  scoutMoveDistance: number
}

export interface LogEvent {
  timestamp?: string
  message: string
  type: 'info' | 'discovery' | 'warning' | 'error'
  coordinates?: string
  scoutId?: string
}

export interface LogAnalysis {
  confidence: number
  suggestedTiles: string[]
  notes: string[]
  positiveEvidence: string[]
  negativeEvidence: string[]
}

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>, ctx: AgentContext) => Promise<string>
}

export interface AgentContext {
  map: GameMap | null
  state: MissionState
  helpSchema: unknown
  doneFlag: string | null
  doneResponseRaw: string | null
}

export interface HelpResponse {
  actions?: Array<{
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }>
  costs?: Record<string, number>
  [key: string]: unknown
}
