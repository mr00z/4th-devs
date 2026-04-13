export interface VerifyCallResult {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  durationMs: number
}

export interface ListenTextPayload {
  code?: number
  message?: string
  transcription?: string
}

export interface ListenAttachmentPayload {
  code?: number
  message?: string
  meta?: string
  attachment?: string
  filesize?: number
}

export type ListenPayload = ListenTextPayload & ListenAttachmentPayload

export type TargetField = 'cityName' | 'cityArea' | 'warehousesCount' | 'phoneNumber'

export interface Clue {
  field: TargetField
  value: string | number
  confidence: number
  sourceId: string
  reason: string
}

export interface SavedAttachment {
  path: string
  relativePath: string
  hash: string
  mimeType: string
  size: number
  extension: string
}

export interface CaptureRecord {
  id: string
  index: number
  kind: 'text' | 'attachment' | 'terminal' | 'unknown'
  raw: ListenPayload | null
  message: string
  transcription?: string
  attachment?: SavedAttachment
  decodedText?: string
  summary?: string
  clues: Clue[]
  discardedReason?: string
}

export interface FieldSelection {
  value: string | number
  confidence: number
  clues: Clue[]
}

export interface FinalReport {
  cityName: string
  cityArea: string
  warehousesCount: number
  phoneNumber: string
}

export interface EvidenceReview {
  captureCount: number
  decision: 'continue' | 'stop'
  confidence: number
  reason: string
  missingFields: TargetField[]
  candidateReport?: Partial<FinalReport>
  createdAt: string
}

export interface SessionSummary {
  captures: CaptureRecord[]
  report: FinalReport
  transmittedRaw: string
  flag: string | null
}

export interface EvidenceSnapshot {
  captureCount: number
  lastUpdatedAt: string
  bestSelections: Partial<Record<TargetField, FieldSelection>>
  clues: Clue[]
  reviews: EvidenceReview[]
  captures: Array<{
    id: string
    index: number
    kind: CaptureRecord['kind']
    message: string
    summary?: string
    decodedText?: string
    attachment?: SavedAttachment
    clueCount: number
    discardedReason?: string
  }>
}

export interface ResponsesApiResult {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  error?: { message?: string }
  usage?: unknown
}
