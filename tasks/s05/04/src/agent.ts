import { disarmRadar, getRadioHint, moveRocket, scanFrequency, startGame } from './api/client.js'
import { maxSteps } from './config.js'
import log from './logger.js'
import type { AgentRunSummary, GameState, MoveCommand, MoveRecord } from './types.js'
import { fallbackMove, mergeMoveState, nextPosition, validateMove } from './utils.js'
import { askMoveAgent } from './llm.js'

function appendMove(state: GameState, record: MoveRecord): GameState {
  return { ...state, moves: [...state.moves, record] }
}

function hasReachedBase(state: GameState): boolean {
  return state.player.row === state.base.row && state.player.col === state.base.col
}

async function ensureRadarSafe(step: number): Promise<void> {
  const scan = await scanFrequency()
  log.saveText(`steps/${String(step).padStart(2, '0')}-scanner.txt`, `${scan.raw}\n`)
  if (scan.status === 'clear') {
    log.info('Scanner clear', { step })
    return
  }

  log.warn('Scanner detected tracking, disarming before movement', { step, frequency: scan.frequency })
  await disarmRadar(scan.frequency, scan.detectionCode)
  log.info('Radar disarmed', { step, frequency: scan.frequency })
}

function validateCommandForState(command: MoveCommand, state: GameState): MoveCommand {
  const validated = validateMove(command, state.player.row)
  const target = nextPosition(state.player, validated)
  if (state.currentColumn && !state.currentColumn.freeRows.includes(target.row)) {
    throw new Error(`Movement ${validated} targets row ${target.row}, but known free rows are ${state.currentColumn.freeRows.join(', ')}`)
  }
  return validated
}

export async function runAgent(): Promise<AgentRunSummary> {
  const started = await startGame()
  let state = started.state
  let finalRaw = started.raw
  log.info('Game started', { player: state.player, base: state.base, currentColumn: state.currentColumn })

  for (let step = 1; step <= maxSteps; step += 1) {
    if (hasReachedBase(state)) {
      return { flag: null, finalRaw, steps: step - 1, finalState: state }
    }

    await ensureRadarSafe(step)

    const radio = await getRadioHint()
    log.saveText(`steps/${String(step).padStart(2, '0')}-hint.json`, `${radio.raw}\n`)
    log.info('Radio hint received', { step, hint: radio.hint })

    let decision = await askMoveAgent(state, radio.hint)
    let command: MoveCommand
    try {
      command = validateCommandForState(decision.command, state)
    } catch (error: unknown) {
      const fallback = fallbackMove(state, decision.rockPosition)
      log.warn('LLM movement conflicts with known column state, using fallback', { error: String(error), decision, fallback })
      decision = fallback
      command = validateCommandForState(decision.command, state)
    }
    const from = state.player
    const expectedTo = nextPosition(from, command)

    log.info('Submitting movement', { step, command, from, expectedTo, decision })
    const movement = await moveRocket(command)
    finalRaw = movement.raw
    log.saveText(`steps/${String(step).padStart(2, '0')}-move-response.json`, `${movement.raw}\n`)

    const movedState = mergeMoveState(state, movement.json, command)
    state = appendMove(movedState, {
      step,
      from,
      to: movedState.player,
      command,
      hint: radio.hint,
      decision,
    })

    log.info('Movement completed', { step, player: state.player, base: state.base })

    if (movement.flag) {
      return { flag: movement.flag, finalRaw, steps: step, finalState: state }
    }
  }

  throw new Error(`Maximum step count exceeded (${maxSteps}). Last position: ${JSON.stringify(state.player)}`)
}
