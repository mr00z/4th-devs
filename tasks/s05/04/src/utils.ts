import { createHash } from 'node:crypto'
import type { CurrentColumn, GameState, MoveCommand, MoveDecision, ParsedScannerResponse, Position } from './types.js'

export function parseStrictJson(raw: string): unknown {
  return JSON.parse(raw) as unknown
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}

export function sha1Hex(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

export function disarmHash(detectionCode: string): string {
  return sha1Hex(`${detectionCode}disarm`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing numeric field: ${key}`)
  return value
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing string field: ${key}`)
  return value
}

export function parsePosition(value: unknown, name: string): Position {
  if (!isRecord(value)) throw new Error(`Missing object field: ${name}`)
  return {
    row: numberField(value, 'row'),
    col: numberField(value, 'col'),
  }
}

export function parseCurrentColumn(value: unknown): CurrentColumn {
  if (!isRecord(value)) throw new Error('Missing object field: currentColumn')
  const freeRows = value.freeRows
  if (!Array.isArray(freeRows) || !freeRows.every((item) => typeof item === 'number')) {
    throw new Error('Missing numeric array field: currentColumn.freeRows')
  }
  return {
    column: numberField(value, 'column'),
    yourRow: numberField(value, 'yourRow'),
    stoneRow: numberField(value, 'stoneRow'),
    freeRows,
  }
}

export function parseStartGameJson(json: unknown): GameState {
  if (!isRecord(json)) throw new Error('Start response must be a JSON object')
  if (json.code !== 110) throw new Error(`Expected start code 110, got ${String(json.code)}`)
  return {
    player: parsePosition(json.player, 'player'),
    base: parsePosition(json.base, 'base'),
    currentColumn: parseCurrentColumn(json.currentColumn),
    moves: [],
  }
}

export function parseRadioHintJson(json: unknown): string {
  if (!isRecord(json)) throw new Error('getmessage response must be a JSON object')
  return stringField(json, 'hint')
}

function isClearScannerMessage(json: unknown): boolean {
  if (typeof json !== 'string') return false
  const text = json
  return /\bit'?s\s+cle+ar!?\b/i.test(text)
}

export function parseScannerResponse(raw: string): ParsedScannerResponse {
  const json = parseStrictJson(raw)
  if (isClearScannerMessage(json)) return { status: 'clear' }
  if (!isRecord(json)) throw new Error('Scanner tracking response must be a JSON object')
  return {
    status: 'tracked',
    frequency: numberField(json, 'frequency'),
    detectionCode: stringField(json, 'detectionCode'),
  }
}

export function parseScannerInterpretationJson(json: unknown): ParsedScannerResponse {
  if (!isRecord(json)) throw new Error('Scanner interpretation must be a JSON object')
  if (json.status === 'clear') return { status: 'clear' }
  if (json.status !== 'tracked') throw new Error(`Invalid scanner status: ${String(json.status)}`)
  return {
    status: 'tracked',
    frequency: numberField(json, 'frequency'),
    detectionCode: stringField(json, 'detectionCode'),
  }
}

export function isMoveCommand(value: unknown): value is MoveCommand {
  return value === 'go' || value === 'left' || value === 'right'
}

export function nextPosition(from: Position, command: MoveCommand): Position {
  const rowDelta = command === 'left' ? -1 : command === 'right' ? 1 : 0
  return { row: from.row + rowDelta, col: from.col + 1 }
}

export function validateMove(command: unknown, row: number): MoveCommand {
  if (!isMoveCommand(command)) throw new Error(`Invalid movement command: ${String(command)}`)
  const nextRow = nextPosition({ row, col: 1 }, command).row
  if (nextRow < 1 || nextRow > 3) throw new Error(`Movement ${command} would leave the map from row ${row}`)
  return command
}

function commandHitsReportedRock(command: MoveCommand, rockPosition: MoveDecision['rockPosition']): boolean {
  return (command === 'go' && rockPosition === 'front')
    || (command === 'left' && rockPosition === 'left')
    || (command === 'right' && rockPosition === 'right')
}

export function parseMoveDecisionJson(json: unknown): MoveDecision {
  if (!isRecord(json)) throw new Error('Move decision must be a JSON object')
  const command = validateMove(json.command, 2)
  const rockPosition = json.rockPosition
  if (rockPosition !== 'front' && rockPosition !== 'left' && rockPosition !== 'right' && rockPosition !== 'unknown') {
    throw new Error(`Invalid rockPosition: ${String(rockPosition)}`)
  }
  return {
    command,
    rockPosition,
    reason: typeof json.reason === 'string' ? json.reason : '',
  }
}

export function parseMoveDecisionForRow(json: unknown, row: number): MoveDecision {
  const decision = parseMoveDecisionJson(json)
  validateMove(decision.command, row)
  if (commandHitsReportedRock(decision.command, decision.rockPosition)) {
    throw new Error(`Movement ${decision.command} would hit the reported ${decision.rockPosition} rock`)
  }
  return decision
}

export function fallbackMove(state: GameState, rockPosition: MoveDecision['rockPosition'] = 'unknown'): MoveDecision {
  const commands: MoveCommand[] = ['go', 'left', 'right']
  const safe = commands
    .map((command) => ({ command, to: nextPosition(state.player, command) }))
    .filter((candidate) => candidate.to.row >= 1 && candidate.to.row <= 3)
    .filter((candidate) => !commandHitsReportedRock(candidate.command, rockPosition))
    .filter((candidate) => !state.currentColumn || state.currentColumn.freeRows.includes(candidate.to.row))
    .sort((a, b) => Math.abs(a.to.row - state.base.row) - Math.abs(b.to.row - state.base.row))
  const command = safe[0]?.command ?? 'go'
  return {
    command,
    rockPosition,
    reason: `Bounds-safe deterministic fallback avoiding reported ${rockPosition} rock.`,
  }
}

export function mergeMoveState(state: GameState, json: unknown, command: MoveCommand): GameState {
  const fallbackPlayer = nextPosition(state.player, command)
  if (!isRecord(json)) {
    return { ...state, player: fallbackPlayer, currentColumn: null }
  }
  const player = isRecord(json.player) ? parsePosition(json.player, 'player') : fallbackPlayer
  const base = isRecord(json.base) ? parsePosition(json.base, 'base') : state.base
  const currentColumn = isRecord(json.currentColumn) ? parseCurrentColumn(json.currentColumn) : state.currentColumn
  return { ...state, player, base, currentColumn }
}
