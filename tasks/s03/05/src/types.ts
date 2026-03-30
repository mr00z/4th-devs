export type Direction = 'up' | 'down' | 'left' | 'right'
export type RouteToken = Direction | 'dismount'

export interface Point {
  x: number
  y: number
}

export interface DiscoveredTool {
  url: string
  description: string
  name: string
}

export interface ToolEvidence {
  url: string
  query: string
  status: number
  ok: boolean
  bodyText: string
  turn: number
}

export interface TerrainRule {
  symbol: string
  blockedFor?: string[]
  allowedFor?: string[]
  foodMultiplier?: number
  fuelMultiplier?: number
}

export interface VehicleRule {
  name: string
  fuelPerMove: number
  foodPerMove: number
  allowedTerrains?: string[]
  blockedTerrains?: string[]
}

export interface KnowledgeModel {
  mapRows: string[]
  width: number
  height: number
  start?: Point
  target?: Point
  targetLabel?: string
  terrainRules: TerrainRule[]
  vehicles: VehicleRule[]
  notes: string[]
}

export interface ToolCallResult {
  url: string
  status: number
  ok: boolean
  bodyText: string
  bodyJson: unknown | null
}

export interface ResearchAction {
  mode: 'toolsearch' | 'ask_tool' | 'finish_research'
  endpoint?: string
  query?: string
  reason?: string
}

export interface ResearchDecision {
  done: boolean
  actions: ResearchAction[]
  summary: string
}

export interface KnowledgeUpdate {
  mapRows?: string[]
  start?: Point
  target?: Point
  targetLabel?: string
  terrainRules?: TerrainRule[]
  vehicles?: VehicleRule[]
  notes?: string[]
}

export interface PlanResult {
  vehicle: string
  moves: RouteToken[]
  cost: number
}

export interface VerifyResponse {
  ok: boolean
  status: number
  raw: string
  flag: string | null
}
