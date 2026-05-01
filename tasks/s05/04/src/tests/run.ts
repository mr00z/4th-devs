import assert from 'node:assert/strict'
import {
  disarmHash,
  extractFlag,
  fallbackMove,
  mergeMoveState,
  nextPosition,
  parseMoveDecisionForRow,
  parseRadioHintJson,
  parseScannerResponse,
  parseStartGameJson,
  parseStrictJson,
  validateMove,
} from '../utils.js'
import type { GameState } from '../types.js'

function assertThrowsMessage(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (error: unknown) => error instanceof Error && pattern.test(error.message))
}

const startResponse = {
  code: 110,
  message: 'New game started. Map is 3 by 12 cells. You are at column 1, middle row. Reach the base at the last column.',
  player: { row: 2, col: 1 },
  base: { row: 3, col: 12 },
  currentColumn: {
    column: 1,
    yourRow: 2,
    stoneRow: 1,
    freeRows: [2, 3],
  },
}

const state = parseStartGameJson(startResponse)
assert.deepEqual(state.player, { row: 2, col: 1 })
assert.deepEqual(state.base, { row: 3, col: 12 })
assert.equal(state.currentColumn?.stoneRow, 1)
assert.deepEqual(state.currentColumn?.freeRows, [2, 3])

assertThrowsMessage(() => parseStartGameJson({ ...startResponse, code: 100 }), /Expected start code 110/)
assertThrowsMessage(() => parseStartGameJson({ ...startResponse, player: { row: 2 } }), /Missing numeric field: col/)

assert.equal(parseRadioHintJson({ hint: 'The sides give you options, but the route through the middle ends at a rock.' }), 'The sides give you options, but the route through the middle ends at a rock.')
assertThrowsMessage(() => parseRadioHintJson({ message: 'missing hint' }), /Missing string field: hint/)

assert.deepEqual(parseScannerResponse(JSON.stringify("It's   cleeeeear!")), { status: 'clear' })
assert.deepEqual(parseScannerResponse(JSON.stringify({ frequency: 123, detectionCode: 'abc123' })), {
  status: 'tracked',
  frequency: 123,
  detectionCode: 'abc123',
})
assertThrowsMessage(() => parseScannerResponse("It's clear!"), /Unexpected token|JSON/)
assertThrowsMessage(() => parseScannerResponse(`{
    "frepUenCY": 925,
    "BEInGTracKEb": true
    "bAtA": {
        "BEteCTi0Nc0Be": "wo9xFo",
        "weAp0nType": "surface-to-air missile"
    }
}`), /Expected ',' or '}'|JSON/)
assertThrowsMessage(() => parseScannerResponse('{ frequency: 123, detectionCode: abc123 }'), /Expected property name|JSON/)
assertThrowsMessage(() => parseScannerResponse(JSON.stringify({ frequency: '123', detectionCode: 'abc123' })), /Missing numeric field: frequency/)

assertThrowsMessage(() => parseStrictJson('{ "hint": "ok", }'), /JSON/)
assert.equal(disarmHash('abc123'), '222b227432347f3195b2de7a885a9b5e452ec14e')
assert.equal(extractFlag('mission complete {FLG:test-value}'), '{FLG:test-value}')
assert.equal(extractFlag('no flag'), null)

assert.equal(validateMove('go', 2), 'go')
assert.equal(validateMove('left', 2), 'left')
assert.equal(validateMove('right', 2), 'right')
assertThrowsMessage(() => validateMove('left', 1), /leave the map/)
assertThrowsMessage(() => validateMove('right', 3), /leave the map/)
assertThrowsMessage(() => validateMove('up', 2), /Invalid movement command/)
assert.deepEqual(nextPosition({ row: 2, col: 5 }, 'left'), { row: 1, col: 6 })
assert.deepEqual(nextPosition({ row: 2, col: 5 }, 'right'), { row: 3, col: 6 })
assert.deepEqual(nextPosition({ row: 2, col: 5 }, 'go'), { row: 2, col: 6 })

assert.deepEqual(parseMoveDecisionForRow({
  command: 'right',
  rockPosition: 'front',
  reason: 'middle has the rock, move down',
}, 2), {
  command: 'right',
  rockPosition: 'front',
  reason: 'middle has the rock, move down',
})
assertThrowsMessage(() => parseMoveDecisionForRow({ command: 'left', rockPosition: 'unknown' }, 1), /leave the map/)
assertThrowsMessage(() => parseMoveDecisionForRow({ command: 'go', rockPosition: 'behind' }, 2), /Invalid rockPosition/)
assertThrowsMessage(() => parseMoveDecisionForRow({ command: 'go', rockPosition: 'front' }, 1), /reported front rock/)
assertThrowsMessage(() => parseMoveDecisionForRow({ command: 'right', rockPosition: 'right' }, 1), /reported right rock/)

const fallbackState: GameState = {
  player: { row: 2, col: 4 },
  base: { row: 3, col: 12 },
  currentColumn: null,
  moves: [],
}
assert.equal(fallbackMove(fallbackState).command, 'right')
assert.equal(fallbackMove({ ...fallbackState, player: { row: 3, col: 4 } }).command, 'go')
assert.equal(fallbackMove({ ...fallbackState, player: { row: 1, col: 4 }, base: { row: 1, col: 12 } }, 'front').command, 'right')
assert.equal(fallbackMove({
  ...fallbackState,
  currentColumn: { column: 4, yourRow: 2, stoneRow: 3, freeRows: [1, 2] },
}).command, 'go')
assert.equal(fallbackMove({
  ...fallbackState,
  currentColumn: { column: 4, yourRow: 2, stoneRow: 3, freeRows: [1, 2] },
}, 'front').command, 'left')

const merged = mergeMoveState(fallbackState, {
  player: { row: 3, col: 5 },
  base: { row: 3, col: 12 },
  currentColumn: { column: 5, yourRow: 3, stoneRow: 1, freeRows: [2, 3] },
}, 'right')
assert.deepEqual(merged.player, { row: 3, col: 5 })
assert.equal(merged.currentColumn?.column, 5)

const mergedFallback = mergeMoveState(fallbackState, null, 'go')
assert.deepEqual(mergedFallback.player, { row: 2, col: 5 })

console.log('All checks passed.')
