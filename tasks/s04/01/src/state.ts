import type { TaskState } from './types.js'

export function createInitialState(): TaskState {
  return {
    skolwinReportId: null,
    skolwinTaskId: null,
    komarowoIncidentId: null,
    reportUpdated: false,
    taskUpdated: false,
    incidentCreated: false,
    finalVerificationPassed: false,
  }
}
