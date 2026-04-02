export type TurbineMode = 'production' | 'idle'

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

export interface QueueItemBase {
  sourceFunction?: string
  code?: number
  message?: string
  [key: string]: unknown
}

export interface WeatherPoint {
  key: string
  date: string
  hour: string
  timestamp: string
  windMs: number
}

export interface TurbineCapabilities {
  stormWindMs: number
  majorStormWindMs: number
  productionPitchAngle: number
  protectionPitchAngle: number
  powerCoeffKwPerWindMs: number
}

export interface ParsedInputs {
  weatherPoints: WeatherPoint[]
  powerDeficitKw: number
  docsText: string
  capabilities: TurbineCapabilities
}

export interface ConfigPoint {
  key: string
  date: string
  hour: string
  timestamp: string
  pitchAngle: number
  turbineMode: TurbineMode
  windMs: number
  unlockCode?: string
}

export interface UnlockResult {
  unlockCode: string
  date?: string
  hour?: string
  windMs?: number
  pitchAngle?: number
}

export interface PlanResult {
  configPoints: ConfigPoint[]
  rationale: string[]
}
