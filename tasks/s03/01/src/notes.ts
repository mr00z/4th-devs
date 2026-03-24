import { notesFallbackModel, notesPrimaryModel, openai } from './config.js'
import { MAX_RATE_LIMIT_RETRIES, isRateLimitError, readRetryAfterMs, computeBackoffMs, sleep } from './rateLimit.js'

export type NoteAssessment = 'ok' | 'issues' | 'inconclusive'
export interface BatchNoteInput {
  id: string
  note: string
}

interface ParsedNoteAssessment {
  assessment: NoteAssessment
}

interface ModelClassificationResult {
  assessment: NoteAssessment
  parsedOk: boolean
}

interface ParsedBatchAssessment {
  id: string
  assessment: NoteAssessment
}

interface ParsedBatchAssessmentPayload {
  items: ParsedBatchAssessment[]
}

interface BatchModelClassificationResult {
  assessmentsById: Map<string, NoteAssessment>
  parsedOk: boolean
}

const DEFAULT_BATCH_SIZE = 40

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}


interface NoteClassifierOptions {
  logRequests?: boolean
}

export class NoteClassifier {
  private readonly exactCache = new Map<string, NoteAssessment>()
  private readonly similarityCache = new Map<string, NoteAssessment>()
  private readonly logRequests: boolean

  constructor(options: NoteClassifierOptions = {}) {
    this.logRequests = options.logRequests ?? true
  }

  getCacheStats(): { exact: number; similarity: number } {
    return {
      exact: this.exactCache.size,
      similarity: this.similarityCache.size,
    }
  }

  async classify(note: string): Promise<NoteAssessment> {
    const result = await this.classifyBatch([{ id: '__single__', note }], 1)
    return result.get('__single__') ?? 'inconclusive'
  }

  async classifyBatch(inputs: BatchNoteInput[], batchSize = DEFAULT_BATCH_SIZE): Promise<Map<string, NoteAssessment>> {
    const results = new Map<string, NoteAssessment>()
    const unresolved: BatchNoteInput[] = []

    for (const input of inputs) {
      const exactHit = this.exactCache.get(input.note)
      if (exactHit) {
        results.set(input.id, exactHit)
        continue
      }

      const similarityKey = this.buildSimilarityKey(input.note)
      const similarityHit = this.similarityCache.get(similarityKey)
      if (similarityHit) {
        this.exactCache.set(input.note, similarityHit)
        results.set(input.id, similarityHit)
        if (this.logRequests) {
          console.log(`[LLM CACHE] Similarity hit: ${JSON.stringify(similarityKey)}`)
        }
        continue
      }

      unresolved.push(input)
    }

    const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE
    const chunks = chunkArray(unresolved, safeBatchSize)

    for (const chunk of chunks) {
      const primary = await this.classifyBatchWithModel(notesPrimaryModel, chunk)

      const fallbackCandidates: BatchNoteInput[] = []

      if (!primary.parsedOk) {
        fallbackCandidates.push(...chunk)
      } else {
        for (const input of chunk) {
          const primaryAssessment = primary.assessmentsById.get(input.id) ?? 'inconclusive'
          if (primaryAssessment === 'inconclusive') {
            fallbackCandidates.push(input)
            continue
          }
          results.set(input.id, primaryAssessment)
        }
      }

      if (fallbackCandidates.length > 0) {
        if (this.logRequests) {
          console.log(`[LLM FALLBACK] Triggered fallback model: ${notesFallbackModel} for ${fallbackCandidates.length} notes`)
        }

        const fallback = await this.classifyBatchWithModel(notesFallbackModel, fallbackCandidates)

        for (const input of fallbackCandidates) {
          const fallbackAssessment = fallback.assessmentsById.get(input.id) ?? 'inconclusive'
          results.set(input.id, fallbackAssessment)
        }
      }
    }

    for (const input of inputs) {
      const assessment = results.get(input.id) ?? 'inconclusive'
      const similarityKey = this.buildSimilarityKey(input.note)
      this.exactCache.set(input.note, assessment)
      this.similarityCache.set(similarityKey, assessment)
      results.set(input.id, assessment)
    }

    return results
  }

  private async classifyWithModel(
    model: string,
    promptPayload: Record<string, unknown>,
  ): Promise<ModelClassificationResult> {
    if (this.logRequests) {
      console.log(`[LLM REQUEST MODEL] ${model}`)
    }

    const request = {
      model,
      stream: false as const,
      temperature: 0,
      messages: [
        {
          role: 'system' as const,
          content:
            'You classify operator notes for industrial telemetry QA. Respond with strict JSON only and no extra keys.',
        },
        {
          role: 'user' as const,
          content: JSON.stringify(promptPayload),
        },
      ],
      response_format: {
        type: 'json_schema' as const,
        json_schema: {
          name: 'operator_note_assessment',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              assessment: {
                type: 'string',
                enum: ['ok', 'issues', 'inconclusive'],
              },
            },
            required: ['assessment'],
          },
        },
      },
    }

    let response: Awaited<ReturnType<typeof openai.chat.completions.create>>
    let lastError: unknown = null

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        response = await openai.chat.completions.create(request)
        break
      } catch (err) {
        lastError = err
        if (!isRateLimitError(err) || attempt === MAX_RATE_LIMIT_RETRIES) {
          throw err
        }

        const retryAfterMs = readRetryAfterMs(err)
        const delayMs = retryAfterMs ?? computeBackoffMs(attempt)

        if (this.logRequests) {
          console.log(`[LLM RATE LIMIT] model=${model} attempt=${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1} delayMs=${delayMs}`)
        }

        await sleep(delayMs)
      }
    }

    if (!response!) {
      throw (lastError instanceof Error ? lastError : new Error('Unknown LLM request failure'))
    }

    if (!('choices' in response)) {
      throw new Error('Unexpected streamed response when non-stream response was requested')
    }

    const rawContent = response.choices[0]?.message?.content ?? ''

    if (this.logRequests) {
      console.log(`[LLM RESPONSE RAW][${model}]`)
      console.log(rawContent)
    }

    let parsed: ParsedNoteAssessment
    let parsedOk = true
    try {
      parsed = JSON.parse(rawContent) as ParsedNoteAssessment
    } catch {
      parsed = { assessment: 'inconclusive' }
      parsedOk = false
    }

    const assessment: NoteAssessment =
      parsed.assessment === 'ok' || parsed.assessment === 'issues' || parsed.assessment === 'inconclusive'
        ? parsed.assessment
        : 'inconclusive'

    if (this.logRequests) {
      console.log(`[LLM RESPONSE PARSED][${model}]`)
      console.log(JSON.stringify({ assessment, parsedOk }))
    }

    return { assessment, parsedOk }
  }

  private async classifyBatchWithModel(
    model: string,
    batch: BatchNoteInput[],
  ): Promise<BatchModelClassificationResult> {
    const promptPayload = {
      instruction:
        'Classify each operator note by id. Return only JSON matching schema with items[].',
      labels: {
        ok: 'Operator claims everything is normal / stable / no issues.',
        issues: 'Operator claims errors/issues/anomalies/warnings were found.',
        inconclusive: 'Anything else, unclear, mixed, or unrelated.',
      },
      notes: batch.map((item) => ({ id: item.id, operator_note_verbatim: item.note })),
    }

    if (this.logRequests) {
      console.log('[LLM REQUEST PAYLOAD]')
      console.log(JSON.stringify(promptPayload, null, 2))
      console.log(`[LLM REQUEST MODEL] ${model}`)
    }

    const request = {
      model,
      stream: false as const,
      temperature: 0,
      messages: [
        {
          role: 'system' as const,
          content:
            'You classify operator notes for industrial telemetry QA. Respond with strict JSON only and no extra keys.',
        },
        {
          role: 'user' as const,
          content: JSON.stringify(promptPayload),
        },
      ],
      response_format: {
        type: 'json_schema' as const,
        json_schema: {
          name: 'operator_note_assessment_batch',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    assessment: {
                      type: 'string',
                      enum: ['ok', 'issues', 'inconclusive'],
                    },
                  },
                  required: ['id', 'assessment'],
                },
              },
            },
            required: ['items'],
          },
        },
      },
    }

    let response: Awaited<ReturnType<typeof openai.chat.completions.create>>
    let lastError: unknown = null

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        response = await openai.chat.completions.create(request)
        break
      } catch (err) {
        lastError = err
        if (!isRateLimitError(err) || attempt === MAX_RATE_LIMIT_RETRIES) {
          throw err
        }

        const retryAfterMs = readRetryAfterMs(err)
        const delayMs = retryAfterMs ?? computeBackoffMs(attempt)

        if (this.logRequests) {
          console.log(`[LLM RATE LIMIT] model=${model} attempt=${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1} delayMs=${delayMs}`)
        }

        await sleep(delayMs)
      }
    }

    if (!response!) {
      throw (lastError instanceof Error ? lastError : new Error('Unknown LLM request failure'))
    }

    if (!('choices' in response)) {
      throw new Error('Unexpected streamed response when non-stream response was requested')
    }

    const rawContent = response.choices[0]?.message?.content ?? ''
    if (this.logRequests) {
      console.log(`[LLM RESPONSE RAW][${model}]`)
      console.log(rawContent)
    }

    let parsed: ParsedBatchAssessmentPayload
    let parsedOk = true

    try {
      parsed = JSON.parse(rawContent) as ParsedBatchAssessmentPayload
    } catch {
      parsedOk = false
      parsed = { items: [] }
    }

    const expectedIds = new Set(batch.map((item) => item.id))
    const assessmentsById = new Map<string, NoteAssessment>()

    for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
      if (typeof item?.id !== 'string' || !expectedIds.has(item.id)) {
        continue
      }

      const assessment: NoteAssessment =
        item.assessment === 'ok' || item.assessment === 'issues' || item.assessment === 'inconclusive'
          ? item.assessment
          : 'inconclusive'

      assessmentsById.set(item.id, assessment)
    }

    if (this.logRequests) {
      console.log(`[LLM RESPONSE PARSED][${model}]`)
      console.log(JSON.stringify({ parsedOk, returned: assessmentsById.size, requested: batch.length }))
    }

    return { assessmentsById, parsedOk }
  }

  private buildSimilarityKey(note: string): string {
    return note
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
  }
}
