import { aiApiKey, audioModel, maxAttachmentBytesForInlineLlm, responsesApiEndpoint, reviewerModel, textModel, transcriptionsApiEndpoint, visionModel } from './config.js'
import log from './logger.js'
import { extractCluesFromText } from './parsers/text.js'
import type { Clue, EvidenceReview, FieldSelection, ResponsesApiResult, SavedAttachment, TargetField } from './types.js'

let testAudioTranscriptionOverride: ((bytes: Uint8Array, attachment: SavedAttachment, sourceId: string) => Promise<{ text: string; clues: Clue[] }>) | null = null

function buildInterpretationContextBlock(contextSummary?: string): string {
  if (!contextSummary?.trim()) {
    return ''
  }
  return `\n\nExisting evidence snapshot from earlier captures:\n${contextSummary.slice(0, 5000)}`
}

function parseNumericString(value: string | number): number | null {
  const parsed = Number(String(value).replace(',', '.').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePhoneNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return digits.length === 9 ? digits : null
}

function extractResponseText(data: ResponsesApiResult): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text
  }
  const messages = Array.isArray(data.output) ? data.output.filter((item) => item?.type === 'message') : []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        return part.text
      }
    }
  }
  return ''
}

async function callResponses(body: unknown, purpose: string): Promise<string> {
  log.info('LLM request', { purpose, preview: JSON.stringify(body).slice(0, 500) })
  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  const parsed = raw ? JSON.parse(raw) as ResponsesApiResult : {}
  if (!response.ok || parsed.error) {
    throw new Error(parsed.error?.message || `LLM request failed (${response.status})`)
  }
  return extractResponseText(parsed)
}

function extractTranscriptionText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const directText = 'text' in data && typeof data.text === 'string' ? data.text : ''
  if (directText.trim()) return directText.trim()
  const verboseText = 'transcript' in data && typeof data.transcript === 'string' ? data.transcript : ''
  return verboseText.trim()
}

function inferAudioUploadName(attachment: SavedAttachment): string {
  const existingName = attachment.relativePath.split(/[\\/]/).at(-1) ?? `capture${attachment.extension || '.bin'}`
  if (attachment.extension !== '.bin') {
    return existingName
  }
  const mimeType = attachment.mimeType.toLowerCase()
  const audioExtensions: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
  }
  const fallbackExtension = audioExtensions[mimeType]
  if (!fallbackExtension) {
    return existingName
  }
  return existingName.replace(/\.bin$/i, fallbackExtension)
}

async function callAudioTranscription(bytes: Uint8Array, attachment: SavedAttachment, purpose: string): Promise<string> {
  log.info('Audio transcription request', {
    purpose,
    attachment: attachment.relativePath,
    mimeType: attachment.mimeType,
    size: bytes.byteLength,
    model: audioModel,
  })

  const form = new FormData()
  const blob = new Blob([Buffer.from(bytes)], { type: attachment.mimeType || 'application/octet-stream' })
  form.append('file', blob, inferAudioUploadName(attachment))
  form.append('model', audioModel)

  const response = await fetch(transcriptionsApiEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: form,
  })

  const raw = await response.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  if (!response.ok || (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error)) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed.error as { message?: string })?.message
      : undefined
    throw new Error(message || `Audio transcription failed (${response.status})`)
  }
  return extractTranscriptionText(parsed)
}

const clueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cityName: { type: ['string', 'null'] },
    cityArea: { type: ['string', 'number', 'null'] },
    warehousesCount: { type: ['string', 'number', 'null'] },
    phoneNumber: { type: ['string', 'null'] },
  },
  required: ['cityName', 'cityArea', 'warehousesCount', 'phoneNumber'],
} as const

function buildStructuredOutput(): { format: { type: 'json_schema'; name: string; strict: true; schema: typeof clueSchema } } {
  return {
    format: {
      type: 'json_schema',
      name: 'syjon_clues',
      strict: true,
      schema: clueSchema,
    },
  }
}

function parseClueObject(parsed: Partial<Record<'cityName' | 'cityArea' | 'warehousesCount' | 'phoneNumber', string | number | null>>, sourceId: string): Clue[] {
  const clues: Clue[] = []
  if (typeof parsed.cityName === 'string' && parsed.cityName.trim()) clues.push({ field: 'cityName', value: parsed.cityName.trim(), confidence: 0.72, sourceId, reason: 'LLM extracted cityName' })
  if (typeof parsed.cityArea === 'string' || typeof parsed.cityArea === 'number') {
    const cityArea = parseNumericString(parsed.cityArea)
    if (cityArea !== null) {
      clues.push({ field: 'cityArea', value: String(parsed.cityArea).trim(), confidence: 0.7, sourceId, reason: 'LLM extracted cityArea' })
    }
  }
  if (typeof parsed.warehousesCount === 'string' || typeof parsed.warehousesCount === 'number') {
    const warehousesCount = parseNumericString(parsed.warehousesCount)
    if (warehousesCount !== null) {
      clues.push({ field: 'warehousesCount', value: warehousesCount, confidence: 0.72, sourceId, reason: 'LLM extracted warehousesCount' })
    }
  }
  if (typeof parsed.phoneNumber === 'string' && parsed.phoneNumber.trim()) {
    const phoneNumber = normalizePhoneNumber(parsed.phoneNumber)
    if (phoneNumber) clues.push({ field: 'phoneNumber', value: phoneNumber, confidence: 0.74, sourceId, reason: 'LLM extracted phoneNumber' })
  }
  return clues.filter((clue) => !(typeof clue.value === 'number' && Number.isNaN(clue.value)))
}

function parseClueJson(text: string, sourceId: string): Clue[] {
  try {
    return parseClueObject(JSON.parse(text) as Partial<Record<'cityName' | 'cityArea' | 'warehousesCount' | 'phoneNumber', string | number | null>>, sourceId)
  } catch { }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return []
  }
  try {
    return parseClueObject(JSON.parse(text.slice(start, end + 1)) as Partial<Record<'cityName' | 'cityArea' | 'warehousesCount' | 'phoneNumber', string | number | null>>, sourceId)
  } catch {
    return []
  }
}

const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['continue', 'stop'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    missingFields: {
      type: 'array',
      items: { type: 'string', enum: ['cityName', 'cityArea', 'warehousesCount', 'phoneNumber'] },
    },
    cityName: { type: ['string', 'null'] },
    cityArea: { type: ['string', 'number', 'null'] },
    warehousesCount: { type: ['string', 'number', 'null'] },
    phoneNumber: { type: ['string', 'null'] },
  },
  required: ['decision', 'confidence', 'reason', 'missingFields', 'cityName', 'cityArea', 'warehousesCount', 'phoneNumber'],
} as const

function buildReviewStructuredOutput(): { format: { type: 'json_schema'; name: string; strict: true; schema: typeof reviewSchema } } {
  return {
    format: {
      type: 'json_schema',
      name: 'syjon_review',
      strict: true,
      schema: reviewSchema,
    },
  }
}

function normalizeCandidateReport(parsed: Partial<Record<TargetField, string | number | null>>): Partial<Record<TargetField, string | number>> {
  const result: Partial<Record<TargetField, string | number>> = {}
  if (typeof parsed.cityName === 'string' && parsed.cityName.trim()) result.cityName = parsed.cityName.trim()
  if (typeof parsed.cityArea === 'string' || typeof parsed.cityArea === 'number') {
    const cityArea = parseNumericString(parsed.cityArea)
    if (cityArea !== null) result.cityArea = String(parsed.cityArea).trim()
  }
  if (typeof parsed.warehousesCount === 'string' || typeof parsed.warehousesCount === 'number') {
    const warehousesCount = parseNumericString(parsed.warehousesCount)
    if (warehousesCount !== null) result.warehousesCount = warehousesCount
  }
  if (typeof parsed.phoneNumber === 'string' && parsed.phoneNumber.trim()) {
    const phoneNumber = normalizePhoneNumber(parsed.phoneNumber)
    if (phoneNumber) result.phoneNumber = phoneNumber
  }
  return result
}

export function parseEvidenceReviewJson(text: string, createdAt = new Date().toISOString()): EvidenceReview | null {
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        parsed = null
      }
    }
  }
  if (!parsed) return null
  if (parsed.decision !== 'continue' && parsed.decision !== 'stop') return null
  if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)) return null
  if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) return null
  if (!Array.isArray(parsed.missingFields)) return null
  const allowedFields = new Set<TargetField>(['cityName', 'cityArea', 'warehousesCount', 'phoneNumber'])
  const missingFields = parsed.missingFields.filter((field): field is TargetField => typeof field === 'string' && allowedFields.has(field as TargetField))
  const candidateReport = normalizeCandidateReport(parsed as Partial<Record<TargetField, string | number | null>>)
  return {
    captureCount: 0,
    decision: parsed.decision,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    reason: parsed.reason.trim(),
    missingFields,
    candidateReport: Object.keys(candidateReport).length > 0 ? candidateReport as EvidenceReview['candidateReport'] : undefined,
    createdAt,
  }
}

const extractionInstruction = `Identify the real city hidden under the codename "Syjon", 
then extract candidate values for that real city only. Treat "Syjon" as an alias, not the final city name. 
Ignore data about other towns, regions, sectors, or generic place descriptions. 
phoneNumber must contain exactly 9 digits. 
warehousesCount means the current number of existing warehouses now, not a future planned count after construction.
Do not guess unsupported values.`

export async function analyzeTextWithLlm(text: string, sourceId: string, contextSummary?: string): Promise<Clue[]> {
  const result = await callResponses({
    model: textModel,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${extractionInstruction}${buildInterpretationContextBlock(contextSummary)}\n\nText:\n${text.slice(0, 6000)}` }] }],
    text: buildStructuredOutput(),
  }, `analyze-text:${sourceId}`)
  return parseClueJson(result, sourceId)
}

export async function analyzeSavedTextFileWithLlm(text: string, attachment: SavedAttachment, sourceId: string, contextSummary?: string): Promise<Clue[]> {
  if (Buffer.byteLength(text, 'utf8') > maxAttachmentBytesForInlineLlm) {
    return []
  }
  const result = await callResponses({
    model: textModel,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${extractionInstruction}${buildInterpretationContextBlock(contextSummary)}\n\nSaved file path: ${attachment.relativePath}\nMIME: ${attachment.mimeType}\n\nFile content:\n${text.slice(0, 8000)}` }] }],
    text: buildStructuredOutput(),
  }, `analyze-file:${attachment.relativePath}`)
  return parseClueJson(result, sourceId)
}

export async function analyzeImageWithVision(bytes: Uint8Array, attachment: SavedAttachment, sourceId: string, contextSummary?: string): Promise<Clue[]> {
  const base64 = Buffer.from(bytes).toString('base64')
  const result = await callResponses({
    model: visionModel,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: `${extractionInstruction}${buildInterpretationContextBlock(contextSummary)}\n\nSaved file path: ${attachment.relativePath}\nRead signs, maps, labels, tables, or contact details visible in the image. Return JSON only.` },
        { type: 'input_image', image_url: `data:${attachment.mimeType};base64,${base64}`, detail: 'high' },
      ],
    }],
    text: buildStructuredOutput(),
  }, `analyze-image:${attachment.relativePath}`)
  return parseClueJson(result, sourceId)
}

export async function transcribeAudioAttachment(bytes: Uint8Array, attachment: SavedAttachment, sourceId: string, contextSummary?: string): Promise<{ text: string; clues: Clue[] }> {
  if (testAudioTranscriptionOverride) {
    return testAudioTranscriptionOverride(bytes, attachment, sourceId)
  }
  const text = await callAudioTranscription(bytes, attachment, `transcribe-audio:${attachment.relativePath}`)
  if (!text) {
    return { text: '', clues: [] }
  }
  const normalizedText = text.trim()
  const clues = extractCluesFromText(normalizedText, sourceId)
  const llmClues = clues.length === 0 || /Syjon|magazyn|telefon|powierzch/i.test(normalizedText)
    ? await analyzeTextWithLlm(normalizedText, sourceId, contextSummary)
    : []
  return {
    text: normalizedText,
    clues: [...clues, ...llmClues],
  }
}

export function setTestAudioTranscriptionOverride(
  override: ((bytes: Uint8Array, attachment: SavedAttachment, sourceId: string) => Promise<{ text: string; clues: Clue[] }>) | null,
): void {
  testAudioTranscriptionOverride = override
}

export async function synthesizeFinalReport(summary: string): Promise<Clue[]> {
  const result = await callResponses({
    model: textModel,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${extractionInstruction}\n\nEvidence summary:\n${summary.slice(0, 12000)}` }] }],
    text: buildStructuredOutput(),
  }, 'synthesize-final-report')
  return parseClueJson(result, 'llm:final-summary')
}

function formatSelectionsForReview(selections: Partial<Record<TargetField, FieldSelection>>): string {
  const fields: TargetField[] = ['cityName', 'cityArea', 'warehousesCount', 'phoneNumber']
  return fields
    .map((field) => {
      const selection = selections[field]
      if (!selection) return `${field}: missing`
      return `${field}: value=${selection.value} confidence=${selection.confidence.toFixed(2)} support=${selection.clues.length}`
    })
    .join('\n')
}

const reviewInstruction = [
  'Review the accumulated evidence about the real city hidden under the codename "Syjon".',
  'Decide whether the agent should continue listening or stop and proceed with the final report.',
  'Use "stop" only when all 4 required fields are supported well enough to submit confidently: cityName, cityArea, warehousesCount, phoneNumber.',
  'If any field is weak or unsupported, return "continue" and list the missingFields.',
  'Based on the collected materials, prepare the final report fields as follows: cityName is the real name of the city called "Syjon"; cityArea is the city area rounded to exactly two decimal places; warehousesCount is the current existing number of warehouses in Syjon now, not a future planned number after construction; phoneNumber is the contact phone number for the person from the city of Syjon.',
  'Important note for phoneNumber: it must contain exactly 9 digits.',
  'Important note for cityArea: the result must have exactly two digits after the decimal point, it must use true mathematical rounding rather than truncation, and the final format must look like 12.34.',
  'Return compact JSON only and do not invent unsupported values.',
].join(' ')

export async function reviewEvidenceProgress(summary: string, selections: Partial<Record<TargetField, FieldSelection>>): Promise<EvidenceReview | null> {
  const result = await callResponses({
    model: reviewerModel,
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: `${reviewInstruction}\n\nCurrent best selections:\n${formatSelectionsForReview(selections)}\n\nEvidence summary:\n${summary.slice(0, 12000)}`,
      }],
    }],
    text: buildReviewStructuredOutput(),
  }, 'review-evidence-progress')
  return parseEvidenceReviewJson(result)
}
