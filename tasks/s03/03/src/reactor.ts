import { hubApiKey, verifyUrl } from './config.js'
import log from './logger.js'

export type ReactorCommand = 'start' | 'reset' | 'left' | 'wait' | 'right'

interface Block {
  col: number
  top_row: number
  bottom_row: number
  direction: 'up' | 'down'
}

interface Point {
  col: number
  row: number
}

interface ReactorResponse {
  code?: number
  message?: string
  board?: string[][]
  player?: Point
  goal?: Point
  blocks?: Block[]
  reached_goal?: boolean
}

interface OptionAssessment {
  command: Extract<ReactorCommand, 'left' | 'wait' | 'right'>
  legal_now: boolean
  safe_next_turn: boolean
  reason: string
}

interface StateSummary {
  message: string
  reached_goal: boolean
  position: Point | null
  goal: Point | null
  distance_to_goal: number | null
  options: OptionAssessment[]
  allowed_moves: Array<'left' | 'wait' | 'right'>
  recommended_move: 'left' | 'wait' | 'right' | 'reset'
  anomaly: string | null
  step: number
}

interface InternalState {
  step: number
  started: boolean
  lastResponse: ReactorResponse | null
  lastRawResponse: string
  history: ReactorCommand[]
}

const BOARD_COLS = 7
const BOARD_ROWS = 5
const ROBOT_ROW = 5

const state: InternalState = {
  step: 0,
  started: false,
  lastResponse: null,
  lastRawResponse: '',
  history: [],
}

function normalizeResponse(parsed: ReactorResponse): ReactorResponse {
  return {
    ...parsed,
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    reached_goal: parsed.reached_goal === true,
  }
}

function isValidPoint(point: Point | undefined): point is Point {
  return Boolean(point && Number.isInteger(point.col) && Number.isInteger(point.row))
}

function isInsideBoard(col: number, row: number): boolean {
  return col >= 1 && col <= BOARD_COLS && row >= 1 && row <= BOARD_ROWS
}

function cellBlocked(blocks: Block[], col: number, row: number): boolean {
  return blocks.some((block) => block.col === col && row >= block.top_row && row <= block.bottom_row)
}

function nextBlockPosition(block: Block): Block {
  const atTop = block.top_row === 1
  const atBottom = block.bottom_row === BOARD_ROWS

  if (block.direction === 'up') {
    if (atTop) {
      return {
        ...block,
        top_row: block.top_row + 1,
        bottom_row: block.bottom_row + 1,
        direction: 'down',
      }
    }

    return {
      ...block,
      top_row: block.top_row - 1,
      bottom_row: block.bottom_row - 1,
      direction: 'up',
    }
  }

  if (atBottom) {
    return {
      ...block,
      top_row: block.top_row - 1,
      bottom_row: block.bottom_row - 1,
      direction: 'up',
    }
  }

  return {
    ...block,
    top_row: block.top_row + 1,
    bottom_row: block.bottom_row + 1,
    direction: 'down',
  }
}

function simulateNextBlocks(blocks: Block[]): Block[] {
  return blocks.map(nextBlockPosition)
}

function evaluateMove(
  command: Extract<ReactorCommand, 'left' | 'wait' | 'right'>,
  player: Point,
  blocks: Block[],
): OptionAssessment {
  const delta = command === 'left' ? -1 : command === 'right' ? 1 : 0
  const targetCol = player.col + delta

  if (!isInsideBoard(targetCol, ROBOT_ROW)) {
    return {
      command,
      legal_now: false,
      safe_next_turn: false,
      reason: 'outside board range',
    }
  }

  if (cellBlocked(blocks, targetCol, ROBOT_ROW)) {
    return {
      command,
      legal_now: false,
      safe_next_turn: false,
      reason: 'target cell currently blocked',
    }
  }

  const nextBlocks = simulateNextBlocks(blocks)
  const blockedNextTurn = cellBlocked(nextBlocks, targetCol, ROBOT_ROW)

  if (blockedNextTurn) {
    return {
      command,
      legal_now: true,
      safe_next_turn: false,
      reason: 'block enters target cell next turn',
    }
  }

  return {
    command,
    legal_now: true,
    safe_next_turn: true,
    reason: 'safe now and after next block movement',
  }
}

function computeSummary(response: ReactorResponse): StateSummary {
  const player = isValidPoint(response.player) ? response.player : null
  const goal = isValidPoint(response.goal) ? response.goal : null
  const blocks = response.blocks ?? []

  const message = typeof response.message === 'string' ? response.message : ''

  if (!player || !goal) {
    return {
      message,
      reached_goal: response.reached_goal === true,
      position: player,
      goal,
      distance_to_goal: null,
      options: [],
      allowed_moves: [],
      recommended_move: 'reset',
      anomaly: 'missing player or goal in response',
      step: state.step,
    }
  }

  const options: OptionAssessment[] = [
    evaluateMove('left', player, blocks),
    evaluateMove('wait', player, blocks),
    evaluateMove('right', player, blocks),
  ]

  const allowedMoves = options
    .filter((option) => option.legal_now && option.safe_next_turn)
    .map((option) => option.command)

  let recommendedMove: StateSummary['recommended_move'] = 'reset'
  if (allowedMoves.includes('right')) recommendedMove = 'right'
  else if (allowedMoves.includes('wait')) recommendedMove = 'wait'
  else if (allowedMoves.includes('left')) recommendedMove = 'left'

  let anomaly: string | null = null
  if (allowedMoves.length === 0 && response.reached_goal !== true) {
    anomaly = 'no safe move available from simulation'
  }

  return {
    message,
    reached_goal: response.reached_goal === true,
    position: player,
    goal,
    distance_to_goal: Math.max(0, goal.col - player.col),
    options,
    allowed_moves: allowedMoves,
    recommended_move: recommendedMove,
    anomaly,
    step: state.step,
  }
}

async function postCommand(command: ReactorCommand): Promise<{ parsed: ReactorResponse; raw: string }> {
  const body = {
    apikey: hubApiKey,
    task: 'reactor',
    answer: {
      command,
    },
  }

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const raw = await response.text()
  log.api('POST /verify', body, raw)

  if (!response.ok) {
    throw new Error(`verify failed ${response.status} ${response.statusText}: ${raw}`)
  }

  let parsed: ReactorResponse
  try {
    parsed = normalizeResponse(JSON.parse(raw) as ReactorResponse)
  } catch {
    parsed = normalizeResponse({ message: raw })
  }

  return { parsed, raw }
}

function compactToolResult(summary: StateSummary): string {
  return JSON.stringify(summary)
}

export async function executeCommand(command: ReactorCommand): Promise<string> {
  const { parsed, raw } = await postCommand(command)

  state.step += 1
  state.started = state.started || command === 'start'
  state.lastResponse = parsed
  state.lastRawResponse = raw
  state.history.push(command)

  if (raw.includes('{FLG:')) {
    return raw
  }

  return compactToolResult(computeSummary(parsed))
}

export function assessOptions(): string {
  if (!state.lastResponse) {
    return JSON.stringify({
      anomaly: 'reactor not initialized',
      hint: 'call reactor_step with command=start',
      step: state.step,
    })
  }

  return compactToolResult(computeSummary(state.lastResponse))
}

export function getStateForRecovery(): string {
  const summary = state.lastResponse ? computeSummary(state.lastResponse) : null
  return JSON.stringify({
    started: state.started,
    step: state.step,
    history_tail: state.history.slice(-12),
    summary,
    raw_response_preview: state.lastRawResponse.slice(0, 1000),
  })
}
