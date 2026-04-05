import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyDismountSpawnUpdates,
  createInitialContext,
  findTool,
  pickBestInspectionUnitId,
  renderMapPreview,
  summarizeInspectionFeedback,
} from './tools.js'
import * as mapCore from './core/map.js'
import * as planner from './core/planner.js'
import * as stateCore from './core/missionState.js'
import {
  extractNewEvents,
  interpretEventsDeterministically,
  normalizeForMatching,
  parseLogs,
} from './core/logAnalysis.js'

function buildMap() {
  return mapCore.parseMap({
    size: 4,
    grid: [
      ['road', 'road', 'road', 'road'],
      ['empty', 'block1', 'empty', 'empty'],
      ['empty', 'empty', 'block2', 'empty'],
      ['road', 'road', 'road', 'road'],
    ],
  })
}

function buildSameRoadClusterMap() {
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

test('get_state_summary exposes nearest road guidance for candidates', async () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }

  const summaryTool = findTool('get_state_summary')
  assert.ok(summaryTool)

  const result = JSON.parse(await summaryTool.handler({}, ctx))
  assert.ok(Array.isArray(result.uninspectedCandidates))
  assert.ok(result.uninspectedCandidates.length > 0)
  assert.equal(typeof result.uninspectedCandidates[0].nearestRoadCoord, 'string')
  assert.equal(typeof result.uninspectedCandidates[0].roadDistance, 'number')

  const nearestRoadTile = mapCore.getTileByCoord(ctx.map, result.uninspectedCandidates[0].nearestRoadCoord)
  assert.ok(nearestRoadTile?.isRoad)
})

test('get_state_summary exposes cluster sweep hints for same-road candidates', async () => {
  const ctx = createInitialContext()
  ctx.map = buildSameRoadClusterMap()

  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  })

  const summaryTool = findTool('get_state_summary')
  assert.ok(summaryTool)

  const result = JSON.parse(await summaryTool.handler({}, ctx))
  assert.ok(Array.isArray(result.transporters))
  assert.equal(result.transporters[0].canReposition, true)
  assert.ok(Array.isArray(result.clusterHints))
  assert.equal(result.clusterHints[0].roadCoord, 'B1')
  assert.deepEqual(result.clusterHints[0].candidateCoords, ['B2', 'C2'])
  assert.equal(result.clusterHints[0].sameTransporterSweep, true)
  assert.match(result.clusterHints[0].recommendedAction, /move_scout/i)
  assert.match(result.recommendedNextAction, /reuse transporter/i)
})

test('move_transporter suggests a valid road tile when asked to move onto a building', async () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  })

  const moveTool = findTool('move_transporter')
  assert.ok(moveTool)

  const result = JSON.parse(
    await moveTool.handler(
      { unitId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', where: 'B2' },
      ctx
    )
  )

  assert.match(result.error, /destination must be a road tile/i)
  assert.equal(result.suggestedRoadCoord, 'B1')
  assert.match(result.suggestedAction, /move_scout|inspect_tile/i)
})

test('inspect_tile blocks remote inspection until scout stands on the target tile', async () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'scout',
    x: 0,
    y: 0,
  })

  const inspectTool = findTool('inspect_tile')
  assert.ok(inspectTool)

  const result = JSON.parse(
    await inspectTool.handler(
      { coord: 'C3', unitId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      ctx
    )
  )

  assert.equal(result.guardrail, true)
  assert.equal(result.unitCoord, 'A1')
  assert.equal(result.targetCoord, 'C3')
  assert.match(result.error, /must stand on/i)
  assert.match(result.suggestedAction, /move_scout|transporter/i)
})

test('create_transporter blocks redundant spawn when staffed transporter can be reused', async () => {
  const ctx = createInitialContext()
  ctx.map = buildSameRoadClusterMap()

  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  })
  stateCore.addUnit(ctx.state, {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })

  const createTool = findTool('create_transporter')
  assert.ok(createTool)

  const result = JSON.parse(await createTool.handler({ passengers: 2 }, ctx))
  assert.equal(result.guardrail, true)
  assert.match(result.error, /staffed transporter/i)
  assert.ok(Array.isArray(result.reusableTransporters))
  assert.equal(result.reusableTransporters[0].unitId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
})

test('summarizeRoadClusters groups nearby candidates by staging road', () => {
  const map = buildSameRoadClusterMap()
  const candidates = planner.rankCandidates(map, 'highest blocks')
  const clusters = planner.summarizeRoadClusters(candidates, map, 2)

  assert.equal(clusters[0]?.roadCoord, 'B1')
  assert.equal(clusters[0]?.candidateCount, 2)
  assert.deepEqual(clusters[0]?.candidateCoords, ['B2', 'C2'])
  assert.equal(clusters[0]?.maxRoadDistance, 2)
})

test('getConnectedBuildingCoords returns all tiles in the same contiguous block', () => {
  const map = mapCore.parseMap({
    size: 5,
    grid: [
      ['road', 'road', 'road', 'road', 'road'],
      ['empty', 'block1', 'block1', 'empty', 'empty'],
      ['empty', 'block1', 'block1', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'block1', 'block1'],
      ['road', 'road', 'road', 'road', 'road'],
    ],
  })

  assert.deepEqual(mapCore.getConnectedBuildingCoords(map, 'B2'), ['B2', 'B3', 'C2', 'C3'])
  assert.deepEqual(mapCore.getConnectedBuildingCoords(map, 'D4'), ['D4', 'E4'])
})

test('parseMap treats houses, schools, and churches as searchable buildings but not high-rise candidates', () => {
  const map = mapCore.parseMap({
    size: 4,
    grid: [
      ['house', 'school', 'church', 'road'],
      ['empty', 'block1', 'empty', 'road'],
      ['empty', 'empty', 'empty', 'road'],
      ['road', 'road', 'road', 'road'],
    ],
  })

  assert.ok(map.buildings.some((tile) => tile.coord === 'A1'))
  assert.ok(map.buildings.some((tile) => tile.coord === 'B1'))
  assert.ok(map.buildings.some((tile) => tile.coord === 'C1'))
  assert.ok(map.candidates.some((tile) => tile.coord === 'B2'))
  assert.ok(!map.candidates.some((tile) => tile.coord === 'A1'))
  assert.ok(!map.candidates.some((tile) => tile.coord === 'B1'))
  assert.ok(!map.candidates.some((tile) => tile.coord === 'C1'))
})

test('rankAllBuildings includes fallback structures beyond initial candidate blocks', () => {
  const map = mapCore.parseMap({
    size: 5,
    grid: [
      ['house', 'school', 'church', 'road', 'road'],
      ['empty', 'block1', 'empty', 'road', 'road'],
      ['empty', 'empty', 'empty', 'road', 'road'],
      ['road', 'road', 'road', 'road', 'road'],
      ['empty', 'empty', 'empty', 'empty', 'empty'],
    ],
  })

  const ranked = planner.rankAllBuildings(map)

  assert.ok(ranked.some((entry) => entry.tile.coord === 'A1'))
  assert.ok(ranked.some((entry) => entry.tile.coord === 'B1'))
  assert.ok(ranked.some((entry) => entry.tile.coord === 'C1'))
  assert.ok(ranked.some((entry) => entry.tile.coord === 'B2'))
})

test('selectClusterDeployments picks distinct clusters with new coverage', () => {
  const map = mapCore.parseMap({
    size: 7,
    grid: [
      ['road', 'road', 'road', 'road', 'road', 'road', 'road'],
      ['block1', 'block1', 'empty', 'empty', 'empty', 'block1', 'block1'],
      ['empty', 'empty', 'empty', 'road', 'empty', 'empty', 'empty'],
      ['road', 'road', 'road', 'road', 'road', 'road', 'road'],
      ['empty', 'empty', 'empty', 'road', 'empty', 'empty', 'empty'],
      ['block1', 'block1', 'empty', 'empty', 'empty', 'block1', 'block1'],
      ['road', 'road', 'road', 'road', 'road', 'road', 'road'],
    ],
  })

  const candidates = planner.rankCandidates(map, 'highest blocks')
  const clusters = planner.summarizeRoadClusters(candidates, map, 2)
  const deployments = planner.selectClusterDeployments(clusters, 4)

  assert.ok(deployments.length >= 2)
  assert.ok(deployments.every((deployment) => deployment.newCoverageCount > 0))
  assert.equal(new Set(deployments.map((deployment) => deployment.roadCoord)).size, deployments.length)
})

test('chooseInspectionStagingPlan prefers a fresh transporter scout over a distant free scout', () => {
  const map = mapCore.parseMap({
    size: 11,
    grid: [
      ['tree', 'road', 'road', 'road', 'empty', 'block1', 'block1', 'tree', 'empty', 'parking', 'parking'],
      ['tree', 'tree', 'empty', 'road', 'road', 'block1', 'block1', 'tree', 'road', 'parking', 'parking'],
      ['empty', 'empty', 'empty', 'road', 'parking', 'empty', 'empty', 'tree', 'road', 'empty', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'block1', 'block1'],
      ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'block1', 'block1'],
      ['road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
      ['empty', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
      ['block1', 'block1', 'block1', 'empty', 'tree', 'empty', 'empty', 'block1', 'block1', 'tree', 'empty'],
      ['block1', 'block1', 'block1', 'empty', 'tree', 'empty', 'empty', 'block1', 'block1', 'tree', 'empty'],
    ],
  })

  const plan = planner.chooseInspectionStagingPlan({
    map,
    targetCoord: 'A5',
    freeScouts: [
      { id: 'free-scout', type: 'scout', x: 1, y: 9 },
    ],
    transporter: {
      id: 'transporter',
      type: 'transporter',
      x: 1,
      y: 5,
      passengers: ['driver', 'spare'],
    },
    maxScoutMoveDistance: 2,
  })

  assert.ok(plan)
  assert.equal(plan.mode, 'dismount_transporter_scout')
  assert.equal(plan.stagingCoord, 'A6')
  assert.equal(plan.estimatedCost, 7)
})

test('chooseInspectionStagingPlan prefers a fresh scout when reusing one would require more walking', () => {
  const map = mapCore.parseMap({
    size: 11,
    grid: [
      ['tree', 'road', 'road', 'road', 'empty', 'block1', 'block1', 'tree', 'empty', 'parking', 'parking'],
      ['tree', 'tree', 'empty', 'road', 'road', 'block1', 'block1', 'tree', 'road', 'parking', 'parking'],
      ['empty', 'empty', 'empty', 'road', 'parking', 'empty', 'empty', 'tree', 'road', 'empty', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'block1', 'block1'],
      ['block1', 'block1', 'empty', 'road', 'parking', 'school', 'school', 'school', 'road', 'block1', 'block1'],
      ['road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
      ['block1', 'block1', 'empty', 'road', 'empty', 'church', 'church', 'church', 'empty', 'tree', 'empty'],
      ['empty', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'road', 'empty'],
      ['block1', 'block1', 'block1', 'empty', 'tree', 'empty', 'empty', 'block1', 'block1', 'tree', 'empty'],
      ['block1', 'block1', 'block1', 'empty', 'tree', 'empty', 'empty', 'block1', 'block1', 'tree', 'empty'],
    ],
  })

  const plan = planner.chooseInspectionStagingPlan({
    map,
    targetCoord: 'C10',
    freeScouts: [
      { id: 'free-scout', type: 'scout', x: 1, y: 7 },
    ],
    transporter: {
      id: 'transporter',
      type: 'transporter',
      x: 1,
      y: 8,
      passengers: ['driver', 'spare'],
    },
    maxScoutMoveDistance: 2,
  })

  assert.ok(plan)
  assert.equal(plan.mode, 'dismount_transporter_scout')
  assert.equal(plan.stagingCoord, 'B10')
  assert.equal(plan.distance, 1)
})

test('chooseInspectionStagingPlan rejects long scout walks when transporter support exists but no <=2 tile staging is possible', () => {
  const map = mapCore.parseMap({
    size: 7,
    grid: [
      ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'road', 'road', 'road', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'block1', 'empty', 'empty'],
      ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
      ['road', 'road', 'road', 'road', 'road', 'road', 'road'],
    ],
  })

  const plan = planner.chooseInspectionStagingPlan({
    map,
    targetCoord: 'E5',
    freeScouts: [
      { id: 'free-scout', type: 'scout', x: 0, y: 6 },
    ],
    transporter: {
      id: 'transporter',
      type: 'transporter',
      x: 6,
      y: 6,
      passengers: ['driver'],
    },
    maxScoutMoveDistance: 2,
  })

  assert.equal(plan, null)
})

test('dismount blocks unloading every passenger from the only staffed transporter while search remains active', async () => {
  const ctx = createInitialContext()
  ctx.map = buildSameRoadClusterMap()

  for (const candidate of planner.rankCandidates(ctx.map, 'highest blocks')) {
    stateCore.addCandidateTile(ctx.state, candidate)
  }

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccc',
    ],
  })
  stateCore.addUnit(ctx.state, {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  stateCore.addUnit(ctx.state, {
    id: 'cccccccccccccccccccccccccccccccc',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })

  const dismountTool = findTool('dismount')
  assert.ok(dismountTool)

  const result = JSON.parse(
    await dismountTool.handler(
      { object: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', passengers: 2 },
      ctx
    )
  )

  assert.equal(result.guardrail, true)
  assert.match(result.error, /only staffed transporter/i)
  assert.equal(result.suggestedPassengers, 1)
})

test('extractNewEvents finds fresh inspection logs even if log order is newest-first', () => {
  const before = parseLogs([
    { scout: 'scout-1', msg: 'PokÄ‚Ĺ‚j pusty.', field: 'B5' },
    { scout: 'scout-2', msg: 'Brak Äąâ€şladÄ‚Ĺ‚w.', field: 'A1' },
  ])
  const beforeSeen = extractNewEvents(before, new Map()).nextSeenCounts

  const after = parseLogs([
    { scout: 'scout-1', msg: 'Znaleziono czÄąâ€šowiek z broniĂ„â€¦.', field: 'F1' },
    { scout: 'scout-1', msg: 'PokÄ‚Ĺ‚j pusty.', field: 'B5' },
    { scout: 'scout-2', msg: 'Brak Äąâ€şladÄ‚Ĺ‚w.', field: 'A1' },
  ])

  const { newEvents } = extractNewEvents(after, beforeSeen)
  assert.equal(newEvents.length, 1)
  assert.equal(newEvents[0]?.coordinates, 'F1')
})

test('summarizeInspectionFeedback prefers coordinate-specific events over stale scout history', async () => {
  const feedback = await summarizeInspectionFeedback('F1', 'scout-1', [
    { message: 'PokÄ‚Ĺ‚j pusty.', type: 'info', coordinates: 'B5', scoutId: 'scout-1' },
    { message: 'Znaleziono czÄąâ€šowiek z broniĂ„â€¦.', type: 'discovery', coordinates: 'F1', scoutId: 'scout-1' },
  ])

  assert.equal(feedback.matchedBy, 'coord')
  assert.match(feedback.summary, /F1/i)
  assert.equal(feedback.matchedEvents[0]?.coordinates, 'F1')
})

test('normalizeForMatching fixes mojibake fragments used in logs', () => {
  assert.match(normalizeForMatching('ostrzeĂ„Ä…Ă„Ëťenie'), /ostrzezenie/)
})

test('applyDismountSpawnUpdates records spawned scout coordinates from API output', () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 'cccccccccccccccccccccccccccccccc',
  })

  applyDismountSpawnUpdates(
    ctx,
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    [{ scout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', where: 'B2' }]
  )

  const scout = stateCore.getUnit(ctx.state, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(scout?.parentTransporter, undefined)
  assert.equal(mapCore.toCoord(scout!.x, scout!.y), 'B2')
})

test('pickBestInspectionUnitId prefers the closest free scout to the target tile', () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'scout',
    x: 0,
    y: 0,
  })
  stateCore.addUnit(ctx.state, {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    type: 'scout',
    x: 2,
    y: 1,
  })

  const tile = mapCore.getTileByCoord(ctx.map, 'C2')
  assert.ok(tile)
  assert.equal(pickBestInspectionUnitId(ctx, tile), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
})

test('renderMapPreview overlays transporters and scouts on the map', () => {
  const ctx = createInitialContext()
  ctx.map = buildMap()

  stateCore.addUnit(ctx.state, {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'transporter',
    x: 0,
    y: 0,
    passengers: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  })
  stateCore.addUnit(ctx.state, {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    type: 'scout',
    x: 0,
    y: 0,
    parentTransporter: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  stateCore.addUnit(ctx.state, {
    id: 'cccccccccccccccccccccccccccccccc',
    type: 'scout',
    x: 2,
    y: 2,
  })

  const preview = renderMapPreview(ctx)

  assert.match(preview, /1\s+TS/)
  assert.match(preview, /3\s+ \.  \. SC/)
  assert.match(preview, /Legend: TR transporter, SC scout, TS transporter \+ scout/)
})

test('interpretEventsDeterministically confirms survivor when logs mention a wounded armed person', () => {
  const interpretation = interpretEventsDeterministically([
    {
      message: 'Znaleziono czlowiek z bronia. Jest ranny, ale zywy.',
      type: 'discovery',
      coordinates: 'F6',
    },
  ], 'F6')

  assert.equal(interpretation.confirmed, true)
  assert.equal(interpretation.coord, 'F6')
  assert.match(interpretation.confidence, /medium|high/)
})

test('interpretEventsDeterministically rejects empty-room logs', () => {
  const interpretation = interpretEventsDeterministically([
    {
      message: 'Pokoj pusty. Brak sladow obecnosci.',
      type: 'info',
      coordinates: 'B2',
    },
  ], 'B2')

  assert.equal(interpretation.confirmed, false)
  assert.equal(interpretation.coord, 'B2')
})

test('interpretEventsDeterministically rejects negative partisan logs', () => {
  const interpretation = interpretEventsDeterministically([
    {
      message: 'Nie ma tu partyzanta. Tylko konserwy, kabel i kurz.',
      type: 'info',
      coordinates: 'A11',
    },
  ], 'B11')

  assert.equal(interpretation.confirmed, false)
  assert.equal(interpretation.coord, 'A11')
  assert.ok(interpretation.negativeSignals.length > 0)
})
