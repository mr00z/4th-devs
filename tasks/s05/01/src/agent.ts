import { reviewEvidenceProgress, synthesizeFinalReport } from './llm.js'
import log from './logger.js'
import { routeCapture } from './router.js'
import { deriveCatalogClues } from './candidates.js'
import type { CaptureRecord, Clue, EvidenceReview, EvidenceSnapshot, FieldSelection, FinalReport, SessionSummary, TargetField } from './types.js'
import { extractFlag, listen, startSession, transmit } from './api/client.js'
import { maxListenIterations, reviewEvery, reviewStartAt, reviewStopThreshold } from './config.js'

function canonicalize(field: TargetField, value: string | number): string {
  if (field === 'phoneNumber') {
    const digits = String(value).replace(/\D/g, '')
    if (digits.length !== 9) {
      throw new Error(`Invalid phoneNumber value: ${String(value)}`)
    }
    return digits
  }
  if (field === 'warehousesCount') return String(Number(value))
  if (field === 'cityArea') return formatArea(value)
  return String(value).trim()
}

export function formatArea(value: string | number): string {
  const parsed = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid cityArea value: ${String(value)}`)
  }
  return parsed.toFixed(2)
}

function groupByField(clues: Clue[]): Record<TargetField, Map<string, Clue[]>> {
  const grouped = {
    cityName: new Map<string, Clue[]>(),
    cityArea: new Map<string, Clue[]>(),
    warehousesCount: new Map<string, Clue[]>(),
    phoneNumber: new Map<string, Clue[]>(),
  }
  for (const clue of clues) {
    let key: string
    try {
      key = canonicalize(clue.field, clue.value)
    } catch {
      log.warn('Discarding invalid clue value', {
        field: clue.field,
        value: clue.value,
        sourceId: clue.sourceId,
        reason: clue.reason,
      })
      continue
    }
    const bucket = grouped[clue.field].get(key) ?? []
    bucket.push(clue)
    grouped[clue.field].set(key, bucket)
  }
  return grouped
}

export function selectBestFields(clues: Clue[]): Partial<Record<TargetField, FieldSelection>> {
  const grouped = groupByField(clues)
  const result: Partial<Record<TargetField, FieldSelection>> = {}
  for (const field of Object.keys(grouped) as TargetField[]) {
    let best: FieldSelection | null = null
    for (const [key, bucket] of grouped[field].entries()) {
      let score = 0
      let llmCityNameScore = 0
      let directCityNameSupport = 0
      for (const clue of bucket) {
        if (field === 'cityName' && clue.reason === 'LLM extracted cityName') {
          llmCityNameScore += clue.confidence * 0.12
          continue
        }
        score += clue.confidence
        if (field === 'cityName') directCityNameSupport += 1
      }
      score += Math.min(1.6, llmCityNameScore)
      score += Math.min(0.3, (bucket.length - 1) * 0.08)
      if (field === 'cityName' && directCityNameSupport > 0) {
        // Prefer direct or derived city evidence over many repeated weak LLM guesses.
        score += 1 + Math.min(0.4, (directCityNameSupport - 1) * 0.1)
      }
      if (!best || score > best.confidence) {
        best = { value: field === 'warehousesCount' ? Number(key) : key, confidence: score, clues: bucket }
      }
    }
    if (best) result[field] = best
  }
  return result
}

function collectAllClues(captures: CaptureRecord[]): Clue[] {
  return [...captures.flatMap((capture) => capture.clues), ...deriveCatalogClues(captures)]
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function captureBody(capture: CaptureRecord): string {
  return [capture.message, capture.transcription, capture.decodedText, capture.summary].filter(Boolean).join('\n')
}

function captureMentions(capture: CaptureRecord, term: string): boolean {
  return normalizeForMatch(captureBody(capture)).includes(normalizeForMatch(term))
}

export function scopeCluesToTarget(captures: CaptureRecord[], clues: Clue[], targetCityName: string): Clue[] {
  const normalizedTarget = normalizeForMatch(targetCityName)
  if (!normalizedTarget) {
    return clues.filter((clue) => clue.field === 'cityName' || clue.sourceId.startsWith('llm:'))
  }
  const sourceIdsWithTargetCityClue = new Set(
    clues
      .filter((clue) => clue.field === 'cityName' && normalizeForMatch(String(clue.value)) === normalizedTarget)
      .map((clue) => clue.sourceId),
  )
  const relevantSourceIds = new Set(
    captures
      .filter((capture) => captureMentions(capture, targetCityName))
      .map((capture) => capture.id),
  )
  return clues.filter((clue) => {
    if (clue.sourceId.startsWith('llm:') || clue.sourceId.startsWith('derived:')) return true
    if (clue.field === 'cityName') return normalizeForMatch(String(clue.value)) === normalizedTarget
    return relevantSourceIds.has(clue.sourceId) || sourceIdsWithTargetCityClue.has(clue.sourceId)
  })
}

function hasCompleteReport(selections: Partial<Record<TargetField, FieldSelection>>): selections is Record<TargetField, FieldSelection> {
  return Boolean(selections.cityName && selections.cityArea && selections.warehousesCount && selections.phoneNumber)
}

function buildEvidenceSummary(captures: CaptureRecord[], clues: Clue[]): string {
  const interestingCaptures = captures
    .filter((capture) => capture.kind !== 'terminal')
    .map((capture) => {
      const source = capture.attachment?.relativePath ?? capture.id
      const body = capture.decodedText || capture.summary || capture.transcription || ''
      return `# ${source}\n${body.slice(0, 2000)}`
    })
  const clueLines = clues.map((clue) => `${clue.field}=${clue.value} confidence=${clue.confidence.toFixed(2)} source=${clue.sourceId} reason=${clue.reason}`)
  return [...interestingCaptures, '# clues', ...clueLines].join('\n\n')
}

function buildReviewEvidenceSummary(captures: CaptureRecord[], clues: Clue[]): string {
  const selections = selectBestFields(clues)
  const fieldLines = (['cityName', 'cityArea', 'warehousesCount', 'phoneNumber'] as TargetField[]).map((field) => {
    const selection = selections[field]
    if (!selection) return `${field}: missing`
    return `${field}: value=${selection.value} confidence=${selection.confidence.toFixed(2)} support=${selection.clues.length}`
  })
  const recentCaptures = captures
    .filter((capture) => capture.kind !== 'terminal')
    .slice(-8)
    .map((capture) => {
      const source = capture.attachment?.relativePath ?? capture.id
      const body = capture.decodedText || capture.summary || capture.transcription || capture.message || ''
      return `# ${source}\n${body.slice(0, 1200)}`
    })
  return [
    `captureCount=${captures.length}`,
    '# best-selections',
    ...fieldLines,
    '# recent-captures',
    ...recentCaptures,
    '# clue-summary',
    ...clues.map((clue) => `${clue.field}=${clue.value} confidence=${clue.confidence.toFixed(2)} source=${clue.sourceId}`),
  ].join('\n\n')
}

export function buildInterpretationContext(captures: CaptureRecord[], reviews: EvidenceReview[]): string {
  const clues = collectAllClues(captures)
  const selections = selectBestFields(clues)
  const fieldLines = (['cityName', 'cityArea', 'warehousesCount', 'phoneNumber'] as TargetField[]).map((field) => {
    const selection = selections[field]
    if (!selection) return `${field}: missing`
    return `${field}: value=${selection.value} confidence=${selection.confidence.toFixed(2)} support=${selection.clues.length}`
  })
  const recentCaptures = captures
    .filter((capture) => capture.kind !== 'terminal')
    .slice(-6)
    .map((capture) => {
      const source = capture.attachment?.relativePath ?? capture.id
      const body = capture.decodedText || capture.summary || capture.transcription || capture.message || ''
      return `# ${source}\n${body.slice(0, 500)}`
    })
  const lastReview = reviews.at(-1)
  return [
    `previousCaptureCount=${captures.length}`,
    '# current-best-selections',
    ...fieldLines,
    ...(lastReview ? [
      '# last-review',
      `decision=${lastReview.decision} confidence=${lastReview.confidence.toFixed(2)} missing=${lastReview.missingFields.join(',') || 'none'}`,
      `reason=${lastReview.reason}`,
    ] : []),
    '# recent-captures',
    ...recentCaptures,
  ].join('\n\n')
}

function writeEvidenceSnapshot(captures: CaptureRecord[], reviews: EvidenceReview[]): void {
  const clues = collectAllClues(captures)
  const snapshot: EvidenceSnapshot = {
    captureCount: captures.length,
    lastUpdatedAt: new Date().toISOString(),
    bestSelections: selectBestFields(clues),
    clues,
    reviews,
    captures: captures.map((capture) => ({
      id: capture.id,
      index: capture.index,
      kind: capture.kind,
      message: capture.message,
      summary: capture.summary,
      decodedText: capture.decodedText,
      attachment: capture.attachment,
      clueCount: capture.clues.length,
      discardedReason: capture.discardedReason,
    })),
  }
  log.saveText('evidence.json', `${JSON.stringify(snapshot, null, 2)}\n`)
}

export function shouldReviewAtCapture(captureCount: number, startAt = reviewStartAt, every = reviewEvery): boolean {
  if (captureCount < startAt) return false
  if (every <= 0) return captureCount === startAt
  return (captureCount - startAt) % every === 0
}

export function shouldStopFromReview(review: EvidenceReview, threshold = reviewStopThreshold): boolean {
  return review.decision === 'stop' && review.confidence >= threshold && review.missingFields.length === 0
}

export function finalReportFromCandidateReport(candidateReport?: Partial<FinalReport>): FinalReport | null {
  if (!candidateReport) return null
  const { cityName, cityArea, warehousesCount, phoneNumber } = candidateReport
  if (typeof cityName !== 'string' || !cityName.trim()) return null
  if ((typeof cityArea !== 'string' && typeof cityArea !== 'number')
    || (typeof warehousesCount !== 'string' && typeof warehousesCount !== 'number')
    || typeof phoneNumber !== 'string') {
    return null
  }
  try {
    return {
      cityName: cityName.trim(),
      cityArea: canonicalize('cityArea', cityArea),
      warehousesCount: Number(canonicalize('warehousesCount', warehousesCount)),
      phoneNumber: canonicalize('phoneNumber', phoneNumber),
    }
  } catch {
    return null
  }
}

export function saveFinalAnswerArtifact(
  report: FinalReport,
  transmittedRaw: string,
  flag: string | null,
  captureCount: number,
): string {
  return log.saveText('final-answer.json', `${JSON.stringify({
    report,
    flag,
    transmittedRaw,
    captureCount,
    lastUpdatedAt: new Date().toISOString(),
  }, null, 2)}\n`)
}

async function resolveFinalReport(captures: CaptureRecord[]): Promise<FinalReport> {
  const clues = collectAllClues(captures)
  let workingClues = clues
  let selections = selectBestFields(workingClues)

  if (hasCompleteReport(selections)) {
    return {
      cityName: String(selections.cityName.value),
      cityArea: formatArea(selections.cityArea.value),
      warehousesCount: Number(selections.warehousesCount.value),
      phoneNumber: canonicalize('phoneNumber', selections.phoneNumber.value),
    }
  }

  if (!selections.cityName) {
    const llmClues = await synthesizeFinalReport(buildEvidenceSummary(captures, workingClues))
    workingClues = [...workingClues, ...llmClues]
    selections = selectBestFields(workingClues)
  }

  if (selections.cityName) {
    workingClues = scopeCluesToTarget(captures, workingClues, String(selections.cityName.value))
    selections = selectBestFields(workingClues)
    if (hasCompleteReport(selections)) {
      return {
        cityName: String(selections.cityName.value),
        cityArea: formatArea(selections.cityArea.value),
        warehousesCount: Number(selections.warehousesCount.value),
        phoneNumber: canonicalize('phoneNumber', selections.phoneNumber.value),
      }
    }
  }

  if (!selections.cityName || !selections.cityArea || !selections.warehousesCount || !selections.phoneNumber) {
    const relevantCaptures = selections.cityName
      ? captures.filter((capture) => captureMentions(capture, String(selections.cityName?.value)))
      : captures
    const llmClues = await synthesizeFinalReport(buildEvidenceSummary(relevantCaptures, workingClues))
    workingClues = scopeCluesToTarget(captures, [...workingClues, ...llmClues], String(selections.cityName?.value ?? ''))
    selections = selectBestFields(workingClues)
  }
  if (!selections.cityName || !selections.cityArea || !selections.warehousesCount || !selections.phoneNumber) {
    throw new Error('Could not resolve all final report fields from collected evidence.')
  }
  return {
    cityName: String(selections.cityName.value),
    cityArea: formatArea(selections.cityArea.value),
    warehousesCount: Number(selections.warehousesCount.value),
    phoneNumber: canonicalize('phoneNumber', selections.phoneNumber.value),
  }
}

export async function runAgent(): Promise<SessionSummary> {
  log.info('Starting radiomonitoring session')
  const startResult = await startSession()
  log.info('Start response received', { status: startResult.status, preview: startResult.raw.slice(0, 200) })

  const captures: CaptureRecord[] = []
  const reviews: EvidenceReview[] = []
  let repeatedTerminalCount = 0
  for (let index = 1; index <= maxListenIterations; index += 1) {
    const result = await listen()
    const llmContext = buildInterpretationContext(captures, reviews)
    const capture = await routeCapture(index, result.json, llmContext)
    captures.push(capture)
    writeEvidenceSnapshot(captures, reviews)
    log.info('Capture processed', {
      index,
      kind: capture.kind,
      clueCount: capture.clues.length,
      attachment: capture.attachment?.relativePath,
      discardedReason: capture.discardedReason,
    })
    if (capture.kind === 'terminal') {
      repeatedTerminalCount += 1
      if (repeatedTerminalCount >= 1) {
        break
      }
    }
    if (shouldReviewAtCapture(captures.length)) {
      const clues = collectAllClues(captures)
      const selections = selectBestFields(clues)
      try {
        const review = await reviewEvidenceProgress(buildReviewEvidenceSummary(captures, clues), selections)
        if (!review) {
          log.warn('Evidence review returned unusable output', { captureCount: captures.length })
        } else {
          review.captureCount = captures.length
          reviews.push(review)
          writeEvidenceSnapshot(captures, reviews)
          log.info('Evidence review completed', {
            captureCount: review.captureCount,
            decision: review.decision,
            confidence: review.confidence,
            missingFields: review.missingFields,
            reason: review.reason,
            candidateReport: review.candidateReport,
          })
          if (shouldStopFromReview(review)) {
            log.info('Stopping early after evidence review', {
              captureCount: review.captureCount,
              confidence: review.confidence,
            })
            break
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn('Evidence review failed; continuing listening loop', { captureCount: captures.length, message })
      }
    }
  }

  const reviewBackedReport = [...reviews]
    .reverse()
    .find((review) => shouldStopFromReview(review) && finalReportFromCandidateReport(review.candidateReport))
  const report = reviewBackedReport
    ? finalReportFromCandidateReport(reviewBackedReport.candidateReport)!
    : await resolveFinalReport(captures)
  writeEvidenceSnapshot(captures, reviews)
  log.success('Final report resolved', report)

  const transmitResult = await transmit(report)
  const flag = extractFlag(transmitResult.raw)
  saveFinalAnswerArtifact(report, transmitResult.raw, flag, captures.length)
  if (!flag) {
    throw new Error(`Transmit succeeded without flag in response: ${transmitResult.raw.slice(0, 500)}`)
  }
  return {
    captures,
    report,
    transmittedRaw: transmitResult.raw,
    flag,
  }
}
