export interface VerifyApiResponse {
  ok: boolean
  status: number
  raw: string
  json: unknown | null
  flag: string | null
}

export interface BrowserRecord {
  id: string | null
  text: string
}

export interface DiscoveryResult {
  skolwinReport: BrowserRecord | null
  skolwinTask: BrowserRecord | null
  komarowoIncident: BrowserRecord | null
  scanText: string
}

export interface TaskState {
  skolwinReportId: string | null
  skolwinTaskId: string | null
  komarowoIncidentId: string | null
  reportUpdated: boolean
  taskUpdated: boolean
  incidentCreated: boolean
  finalVerificationPassed: boolean
}

export interface VerificationStatus {
  reportOk: boolean
  taskOk: boolean
  komarowoOk: boolean
}

export interface LlmDiscoveryPayload {
  skolwinReport: BrowserRecord | null
  skolwinTask: BrowserRecord | null
  komarowoIncident: BrowserRecord | null
}

export interface VerifyActionHelp {
  action: 'help'
}

export interface VerifyActionDone {
  action: 'done'
}

export interface VerifyActionUpdate {
  action: 'update'
  page: 'incydenty' | 'notatki' | 'zadania'
  id: string
  content?: string
  title?: string
  done?: 'YES' | 'NO'
}

export type VerifyAction = VerifyActionHelp | VerifyActionDone | VerifyActionUpdate
