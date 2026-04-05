import assert from 'node:assert/strict'
import test from 'node:test'

import * as mapCore from './core/map.js'
import * as planner from './core/planner.js'
import * as stateCore from './core/missionState.js'
import { buildEnrichedMapPayload, createInitialContext, findTool, normalizeObjectsPayload } from './tools.js'

function buildMap() {
  return mapCore.parseMap({
    size: 5,
    grid: [
      ['road', 'road', 'road', 'road', 'road'],
      ['empty', 'block1', 'block1', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'empty'],
      ['road', 'road', 'road', 'road', 'road'],
    ],
  })
}

test('normalizeObjectsPayload parses transporter and scout positions', () => {
  const units = normalizeObjectsPayload({
    transporters: [{ id: 't1', coord: 'A1', passengers: ['s1'] }],
    scouts: [{ id: 's1', coord: 'A1', onboardTransporterId: 't1' }],
  })

  assert.equal(units.length, 2)
  assert.equal(units[0]?.type, 'transporter')
  assert.equal(units[1]?.type, 'scout')
  assert.equal(units[1]?.parentTransporter, 't1')
})

test('coordinate conversion is 1-based for rows and columns', () => {
  assert.deepEqual(mapCore.parseCoord('A1'), { x: 0, y: 0 })
  assert.deepEqual(mapCore.parseCoord('K11'), { x: 10, y: 10 })
  assert.equal(mapCore.toCoord(0, 0), 'A1')
  assert.equal(mapCore.toCoord(10, 10), 'K11')
  assert.throws(() => mapCore.parseCoord('A0'), /start from 1/i)
})

test('buildEnrichedMapPayload includes unit positions in map.units', () => {
  const map = buildMap()
  const units = new Map<string, { id: string; type: 'scout' | 'transporter'; x: number; y: number; passengers?: string[]; parentTransporter?: string }>()
  units.set('t1', { id: 't1', type: 'transporter', x: 0, y: 0, passengers: ['s1'] })
  units.set('s1', { id: 's1', type: 'scout', x: 1, y: 1, parentTransporter: 't1' })

  const payload = buildEnrichedMapPayload(map, units as never)
  assert.equal(payload.units.transporters[0]?.coord, 'A1')
  assert.equal(payload.units.transporters[0]?.passengersOnboard, 1)
  assert.equal(payload.units.scouts[0]?.coord, 'B2')
  assert.equal(payload.units.scouts[0]?.onboardTransporterId, 't1')
})

test('parseMap handles wrapped API payload and keeps only highest blocks as candidates', () => {
  const map = mapCore.parseMap({
    code: 80,
    message: 'Map loaded.',
    map: {
      name: 'Domatowo',
      size: 11,
      tiles: {
        road: { label: 'Ulica', symbol: 'UL' },
        tree: { label: 'Drzewa', symbol: 'DR' },
        house: { label: 'Dom', symbol: 'DM' },
        empty: { label: 'Pusta przestrzen', symbol: '  ' },
        block1: { label: 'Blok 1p', symbol: 'B1' },
        block2: { label: 'Blok 2p', symbol: 'B2' },
        block3: { label: 'Blok 3p', symbol: 'B3' },
        church: { label: 'Kosciol', symbol: 'KS' },
        school: { label: 'Szkola', symbol: 'SZ' },
        parking: { label: 'Parking', symbol: 'PK' },
        field: { label: 'Boisko', symbol: 'BS' },
      },
      grid: [
        ['tree', 'road', 'road', 'road', 'empty', 'block3', 'block3', 'tree', 'empty', 'parking', 'parking'],
        ['tree', 'tree', 'empty', 'road', 'road', 'block3', 'block3', 'tree', 'road', 'parking', 'parking'],
        ['empty', 'empty', 'empty', 'road', 'parking', 'empty', 'empty', 'tree', 'road', 'empty', 'empty'],
        ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'field', 'field'],
        ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'field', 'field'],
        ['road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
        ['block2', 'block2', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
        ['block2', 'block2', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
        ['empty', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
        ['block3', 'block3', 'block3', 'empty', 'tree', 'empty', 'empty', 'block3', 'block3', 'tree', 'empty'],
        ['block3', 'block3', 'block3', 'empty', 'tree', 'empty', 'empty', 'block3', 'block3', 'tree', 'empty'],
      ],
    },
  })

  assert.equal(map.width, 11)
  assert.equal(map.height, 11)
  assert.equal(map.tiles[0]?.[0]?.coord, 'A1')
  assert.equal(map.tiles[10]?.[10]?.coord, 'K11')
  assert.equal(map.tiles[0]?.[1]?.symbol, 'UL')
  assert.equal(map.tiles[0]?.[5]?.symbol, 'B3')
  assert.equal(map.tiles[6]?.[0]?.height, 2)
  assert.equal(map.tiles[0]?.[5]?.height, 3)
  assert.equal(map.candidates.length, 14)
  assert.deepEqual(
    map.candidates.map((tile) => tile.coord).sort((a, b) => a.localeCompare(b)),
    ['F1', 'F2', 'G1', 'G2', 'A10', 'A11', 'B10', 'B11', 'C10', 'C11', 'H10', 'H11', 'I10', 'I11']
      .sort((a, b) => a.localeCompare(b))
  )
})

test('create_unit rejects scout creation with passengers', async () => {
  const ctx = createInitialContext()
  const tool = findTool('create_unit')
  assert.ok(tool)

  const result = JSON.parse(await tool.handler({ type: 'scout', passengers: 1 }, ctx))
  assert.equal(result.guardrail, true)
  assert.match(result.error, /does not accept passengers/i)
})

test('move_unit blocks transporter movement onto non-road tiles', async () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()
  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }
  stateCore.addUnit(ctx.state, {
    id: 't1',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: ['s1'],
  })

  const tool = findTool('move_unit')
  assert.ok(tool)

  const result = JSON.parse(await tool.handler({ object: 't1', where: 'B2' }, ctx))
  assert.equal(result.guardrail, true)
  assert.match(result.error, /roads/i)
})

test('inspect_position rejects onboard scouts', async () => {
  const ctx = createInitialContext()
  stateCore.addUnit(ctx.state, {
    id: 's1',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 't1',
  })

  const tool = findTool('inspect_position')
  assert.ok(tool)

  const result = JSON.parse(await tool.handler({ object: 's1' }, ctx))
  assert.equal(result.guardrail, true)
  assert.match(result.error, /onboard transporter/i)
})

test('call_helicopter requires confirmed survivor state', async () => {
  const ctx = createInitialContext()
  const tool = findTool('call_helicopter')
  assert.ok(tool)

  const result = JSON.parse(await tool.handler({ destination: 'B2' }, ctx))
  assert.equal(result.guardrail, true)
  assert.match(result.error, /only after a scout confirms a human/i)
})

test('get_state_summary exposes blocked patterns and candidate info', async () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()
  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }
  stateCore.recordBlockedPattern(ctx.state, 'move_unit: bad route')

  const tool = findTool('get_state_summary')
  assert.ok(tool)

  const result = JSON.parse(await tool.handler({}, ctx))
  assert.ok(Array.isArray(result.topCandidates))
  assert.ok(Array.isArray(result.blockedActionPatterns))
  assert.match(result.blockedActionPatterns[0], /move_unit/i)
})
