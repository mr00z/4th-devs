import { aiApiKey, llmModel, requestTimeoutMs, responsesApiEndpoint } from './config.js'
import log from './logger.js'
import type { GameState, MoveDecision, ParsedScannerResponse, ResponsesApiResult } from './types.js'
import { fallbackMove, parseMoveDecisionForRow, parseMoveDecisionJson, parseScannerInterpretationJson, parseStrictJson } from './utils.js'

const moveDecisionSchema = {
  type: 'json_schema',
  name: 'move_decision',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['go', 'left', 'right'],
        description: 'Movement command for the next step.',
      },
      rockPosition: {
        type: 'string',
        enum: ['front', 'left', 'right', 'unknown'],
        description: 'Direction of the obstacle inferred from the radio hint.',
      },
      reason: {
        type: 'string',
        description: 'Short explanation for the chosen command.',
      },
    },
    required: ['command', 'rockPosition', 'reason'],
    additionalProperties: false,
  },
} as const

const scannerResponseSchema = {
  type: 'json_schema',
  name: 'scanner_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['clear', 'tracked'],
        description: 'Whether the scanner says the rocket is clear or being tracked.',
      },
      frequency: {
        type: ['number', 'null'],
        description: 'Radar frequency when tracked, otherwise null.',
      },
      detectionCode: {
        type: ['string', 'null'],
        description: 'Detection code when tracked, otherwise null.',
      },
    },
    required: ['status', 'frequency', 'detectionCode'],
    additionalProperties: false,
  },
} as const

class RejectedMoveDecisionError extends Error {
  constructor(message: string, readonly decision: MoveDecision | null) {
    super(message)
    this.name = 'RejectedMoveDecisionError'
  }
}

export function extractResponseText(data: ResponsesApiResult): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const messages = Array.isArray(data.output) ? data.output.filter((item) => item.type === 'message') : []
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

async function callResponses(body: Record<string, unknown>): Promise<ResponsesApiResult> {
  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const raw = await response.text()
  const parsed = raw ? parseStrictJson(raw) as ResponsesApiResult : {}
  if (!response.ok || parsed.error) {
    throw new Error(parsed.error?.message || `Responses API request failed (${response.status})`)
  }
  return parsed
}

function compactState(state: GameState): Record<string, unknown> {
  return {
    player: state.player,
    base: state.base,
    currentColumn: state.currentColumn,
    previousMoves: state.moves.map((move) => ({
      step: move.step,
      command: move.command,
      from: move.from,
      to: move.to,
      hint: move.hint,
      rockPosition: move.decision.rockPosition,
    })),
  }
}

function buildPrompt(state: GameState, hint: string, correction?: string): string {
  return [
    'You are controlling a ground rocket on a 3-row by 12-column grid.',
    'The runtime has already handled radar scanning and disarming. Your only job is to interpret the radio hint and choose the next movement.',
    'Commands: go keeps the same row and advances one column; left moves one row up and advances one column; right moves one row down and advances one column.',
    'Rows are numbered 1 at the top, 2 in the middle, 3 at the bottom. Never choose a command that leaves the grid.',
    'Never choose the direction containing the rock.',
    'Interpret the hint yourself, including nautical language such as port/starboard/bow if present.',
    correction ? `Correction from runtime: ${correction}` : '',
    `State: ${JSON.stringify(compactState(state))}`,
    `Radio hint: ${JSON.stringify(hint)}`,
  ].filter(Boolean).join('\n')
}

async function askOnce(state: GameState, hint: string, correction?: string): Promise<MoveDecision> {
  const body = {
    model: llmModel,
    input: [
      {
        role: 'user',
        content: buildPrompt(state, hint, correction),
      },
    ],
    text: { format: moveDecisionSchema },
  }
  const data = await callResponses(body)
  const text = extractResponseText(data).trim()
  log.info('LLM movement decision raw', { text })
  const json = parseStrictJson(text)
  try {
    return parseMoveDecisionForRow(json, state.player.row)
  } catch (error: unknown) {
    let decision: MoveDecision | null = null
    try {
      decision = parseMoveDecisionJson(json)
    } catch {
      // The response may be too malformed to recover even the reported rock.
    }
    throw new RejectedMoveDecisionError(String(error), decision)
  }
}

export async function askMoveAgent(state: GameState, hint: string): Promise<MoveDecision> {
  let rejectedRockPosition: MoveDecision['rockPosition'] = 'unknown'
  try {
    const decision = await askOnce(state, hint)
    log.info('LLM movement decision accepted', decision)
    return decision
  } catch (error: unknown) {
    if (error instanceof RejectedMoveDecisionError && error.decision) {
      rejectedRockPosition = error.decision.rockPosition
    }
    log.warn('LLM movement decision rejected, retrying once', { error: String(error) })
  }

  try {
    const decision = await askOnce(state, hint, 'Your previous response was invalid JSON, out of bounds, or chose the direction containing the reported rock. Return one in-bounds command that avoids the rock.')
    log.info('LLM movement decision accepted after correction', decision)
    return decision
  } catch (error: unknown) {
    if (error instanceof RejectedMoveDecisionError && error.decision) {
      rejectedRockPosition = error.decision.rockPosition
    }
    const fallback = fallbackMove(state, rejectedRockPosition)
    log.warn('Using deterministic bounds-safe fallback movement', { error: String(error), fallback })
    return fallback
  }
}

function buildScannerPrompt(raw: string): string {
  return [
    'Interpret this radar frequency scanner response.',
    'The response may be malformed JSON, have corrupted quotes, odd capitalization, typo-like key names, leetspeak, or a plain human-readable message.',
    'Only mark clear when the response is clearly a clear/no-tracking message.',
    'For tracking, extract the numeric frequency and the detection code string. Ignore weapon type and other fields.',
    'Use null for frequency and detectionCode only when the status is clear.',
    'If a detection code value has a trailing backtick where a closing quote should be, treat the backtick as corrupted syntax, not as part of the code.',
    `Raw response: ${JSON.stringify(raw)}`,
  ].join('\n')
}

export async function askScannerParser(raw: string): Promise<ParsedScannerResponse> {
  const body = {
    model: llmModel,
    input: [
      {
        role: 'user',
        content: buildScannerPrompt(raw),
      },
    ],
    text: { format: scannerResponseSchema },
  }
  const data = await callResponses(body)
  const text = extractResponseText(data).trim()
  log.info('LLM scanner parse raw', { text })
  const json = parseStrictJson(text)
  return parseScannerInterpretationJson(json)
}
