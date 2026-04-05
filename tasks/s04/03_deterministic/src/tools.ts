import * as api from './api/client.js'
import * as mapCore from './core/map.js'
import * as stateCore from './core/missionState.js'
import * as planner from './core/planner.js'
import * as logAnalysis from './core/logAnalysis.js'
import type { AgentContext, Tool, ToolDefinition, Unit, LogEvent, CandidateTile } from './types.js'
import log from './logger.js'

function isMd5(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value)
}

export function renderMapPreview(ctx: AgentContext): string {
  if (!ctx.map) return '(map unavailable)'
  return mapCore.renderMapPreview(ctx.map, Array.from(ctx.state.units.values()))
}

function normalizeReadMapSymbols(rawSymbols: unknown): string[] | undefined {
  if (!Array.isArray(rawSymbols)) return undefined

  const normalized = rawSymbols
    .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
    .filter((value) => value.length > 0)
    .filter((value) => !/^([A-Z]\d{1,2}|=|\||-|#|\*)$/.test(value))

  const mapped = normalized.map((value) => {
    if (value === 'H ' || value === 'HIGH' || value === 'HIGH-RISE') return 'H'
    if (value === 'B ' || value === 'BLOCK' || value === 'BUILDING') return 'B'
    if (value === 'ROAD' || value === 'UL') return 'R'
    return value
  })

  const unique = [...new Set(mapped)]
  return unique.length > 0 ? unique : undefined
}

function getCandidateGuidance(ctx: AgentContext, candidate: CandidateTile): {
  coord: string
  score: number
  reasons: string[]
  nearestRoadCoord: string | null
  roadDistance: number | null
} {
  const nearestRoad = ctx.map ? mapCore.findNearestRoad(ctx.map, candidate.tile.x, candidate.tile.y) : null
  const roadDistance = nearestRoad
    ? mapCore.manhattanDistance(candidate.tile.x, candidate.tile.y, nearestRoad.x, nearestRoad.y)
    : null

  return {
    coord: candidate.tile.coord,
    score: candidate.score,
    reasons: candidate.reasons,
    nearestRoadCoord: nearestRoad?.coord || null,
    roadDistance,
  }
}

export function summarizeInspectionFeedback(
  coord: string,
  unitId: string | undefined,
  newEvents: LogEvent[]
): Promise<{
  summary: string
  matchedEvents: LogEvent[]
  matchedBy: 'coord' | 'scout' | 'latest' | 'none'
}> {
  const coordEvents = newEvents.filter((event) => event.coordinates === coord)
  const scoutEvents = unitId ? newEvents.filter((event) => event.scoutId === unitId) : []

  let matchedEvents: LogEvent[] = []
  let matchedBy: 'coord' | 'scout' | 'latest' | 'none' = 'none'

  if (coordEvents.length > 0) {
    matchedEvents = coordEvents
    matchedBy = 'coord'
  } else if (scoutEvents.length > 0) {
    matchedEvents = scoutEvents
    matchedBy = 'scout'
  } else if (newEvents.length > 0) {
    matchedEvents = [newEvents[newEvents.length - 1]]
    matchedBy = 'latest'
  }

  if (matchedEvents.length === 0) {
    return Promise.resolve({
      summary: `No new coordinate-specific log entry found for ${coord}.`,
      matchedEvents: [],
      matchedBy,
    })
  }

  const summary = logAnalysis.summarizeLogsForAgent(matchedEvents, 5)
  return Promise.resolve({
    summary:
      matchedBy === 'coord'
        ? summary
        : `No new coordinate-specific log entry found for ${coord}; showing newest related event.\n${summary}`,
    matchedEvents,
    matchedBy,
  })
}

export function pickBestInspectionUnitId(ctx: AgentContext, tile: { x: number; y: number }): string | undefined {
  const freeScouts = stateCore
    .getUnitsByType(ctx.state, 'scout')
    .filter((unit) => !unit.parentTransporter)
    .sort((a, b) => {
      const aDistance = mapCore.manhattanDistance(a.x, a.y, tile.x, tile.y)
      const bDistance = mapCore.manhattanDistance(b.x, b.y, tile.x, tile.y)
      return aDistance - bDistance
    })

  const nearestScout = freeScouts[0]
  if (nearestScout && isMd5(nearestScout.id)) {
    return nearestScout.id
  }

  const transporter = stateCore.getUnitsByType(ctx.state, 'transporter')[0]
  if (transporter && isMd5(transporter.id)) {
    return transporter.id
  }

  return undefined
}

function buildInspectionReachabilityHint(
  ctx: AgentContext,
  tile: { x: number; y: number; coord: string },
  unitId: string | undefined
): Record<string, unknown> {
  const unit = unitId ? stateCore.getUnit(ctx.state, unitId) : undefined
  const nearestRoad = ctx.map ? mapCore.findNearestRoad(ctx.map, tile.x, tile.y) : null
  const distance = unit ? mapCore.manhattanDistance(unit.x, unit.y, tile.x, tile.y) : null

  if (!unit) {
    return {
      error: `No available unit can inspect ${tile.coord} yet.`,
      suggestedAction: nearestRoad
        ? `Move a transporter to ${nearestRoad.coord}, dismount a scout, then use move_scout if needed before inspecting ${tile.coord}.`
        : `Position a scout adjacent to ${tile.coord} before inspecting.`,
    }
  }

  const unitCoord = mapCore.toCoord(unit.x, unit.y)
  if (unit.parentTransporter) {
    return {
      error: `Unit ${unit.id} is still onboard transporter ${unit.parentTransporter} and cannot inspect ${tile.coord} directly.`,
      guardrail: true,
      unitId: unit.id,
      unitCoord,
      targetCoord: tile.coord,
      suggestedAction: 'dismount',
    }
  }

  return {
    error: `Unit ${unit.id} must stand on ${tile.coord} before inspecting it.`,
    guardrail: true,
    unitId: unit.id,
    unitCoord,
    targetCoord: tile.coord,
    distance,
    nearestRoadCoord: nearestRoad?.coord || null,
    suggestedAction: nearestRoad
      ? `Move transporter to ${nearestRoad.coord}, then use move_scout to place scout on ${tile.coord} before inspecting.`
      : `Use move_scout to move ${unit.id} onto ${tile.coord} before inspecting.`,
  }
}

export function applyDismountSpawnUpdates(
  ctx: AgentContext,
  scoutsToDismount: string[],
  spawned: unknown[]
): void {
  for (const [index, scoutId] of scoutsToDismount.entries()) {
    const passenger = stateCore.getUnit(ctx.state, scoutId)
    if (!passenger) {
      continue
    }

    passenger.parentTransporter = undefined

    const spawnEntry = spawned[index]
    if (!spawnEntry || typeof spawnEntry !== 'object') {
      continue
    }

    const where = (spawnEntry as Record<string, unknown>).where
    if (typeof where !== 'string') {
      continue
    }

    try {
      const parsed = mapCore.parseCoord(where)
      passenger.x = parsed.x
      passenger.y = parsed.y
    } catch {
      // Ignore malformed spawn coordinate and keep transporter position fallback
    }
  }
}

function getTransporterStatus(ctx: AgentContext): Array<{
  unitId: string
  coord: string
  passengersOnboard: number
  canReposition: boolean
}> {
  return stateCore.getUnitsByType(ctx.state, 'transporter').map((unit) => ({
    unitId: unit.id,
    coord: mapCore.toCoord(unit.x, unit.y),
    passengersOnboard: unit.passengers?.length || 0,
    canReposition: (unit.passengers?.length || 0) > 0,
  }))
}

function getReusableTransporters(ctx: AgentContext): Array<{
  unitId: string
  coord: string
  passengersOnboard: number
  canReposition: boolean
}> {
  return getTransporterStatus(ctx).filter((unit) => unit.canReposition)
}

function getBuildingDismountHint(
  ctx: AgentContext,
  transporterId: string,
  passengers: number
): { adjacentBuildingCoords: string[]; suggestedRoadCoord: string | null } {
  const transporter = stateCore.getUnit(ctx.state, transporterId)
  if (!ctx.map || !transporter || transporter.type !== 'transporter') {
    return {
      adjacentBuildingCoords: [],
      suggestedRoadCoord: null,
    }
  }

  const adjacentBuildingCoords = mapCore
    .getAdjacentBuildingTiles(ctx.map, transporter.x, transporter.y)
    .map((tile) => tile.coord)
    .sort((a, b) => a.localeCompare(b))

  const uninspectedCandidateCoords = stateCore.getUninspectedCandidates(ctx.state).map((candidate) => candidate.tile.coord)
  const insertionPlan = planner.chooseBuildingInsertionPlan({
    map: ctx.map,
    candidateCoords: uninspectedCandidateCoords,
    requiredScouts: passengers,
  })

  return {
    adjacentBuildingCoords,
    suggestedRoadCoord: insertionPlan?.roadCoord || null,
  }
}

function getClusterActionHints(ctx: AgentContext): Array<{
  roadCoord: string | null
  candidateCoords: string[]
  candidateCount: number
  maxRoadDistance: number | null
  sameTransporterSweep: boolean
  nearbyTransporters: string[]
  recommendedAction: string
}> {
  if (!ctx.map) {
    return []
  }

  const guardrails = stateCore.getGuardrails()
  const transporters = stateCore.getUnitsByType(ctx.state, 'transporter')
  const clusters = planner.summarizeRoadClusters(
    stateCore.getUninspectedCandidates(ctx.state),
    ctx.map,
    guardrails.maxScoutMoveDistanceWithTransporter
  )

  return clusters.slice(0, 5).map((cluster) => {
    const nearbyTransporters = transporters
      .filter((unit) => cluster.roadX !== null && cluster.roadY !== null)
      .filter((unit) => mapCore.manhattanDistance(unit.x, unit.y, cluster.roadX!, cluster.roadY!) <= 4)
      .map((unit) => unit.id)

    const sameTransporterSweep = cluster.maxRoadDistance !== null
      && cluster.maxRoadDistance <= guardrails.maxScoutMoveDistanceWithTransporter
      && cluster.candidateCount >= 2

    let recommendedAction = 'Create or reposition a transporter to the nearest road before inspecting.'
    if (sameTransporterSweep && cluster.roadCoord) {
      recommendedAction = `Stage one transporter at ${cluster.roadCoord}, keep one driver onboard if more repositioning may be needed, and use move_scout for the short sweep across ${cluster.candidateCoords.join(', ')}.`
    } else if (cluster.roadCoord) {
      recommendedAction = `Move transporter to ${cluster.roadCoord} and inspect the nearby tile(s) from there.`
    }

    return {
      roadCoord: cluster.roadCoord,
      candidateCoords: cluster.candidateCoords,
      candidateCount: cluster.candidateCount,
      maxRoadDistance: cluster.maxRoadDistance,
      sameTransporterSweep,
      nearbyTransporters,
      recommendedAction,
    }
  })
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'read_help',
      description: 'Get help about available actions and API schema',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args, ctx) => {
      const response = await api.callHelp()
      ctx.helpSchema = response.json
      return JSON.stringify({
        ok: response.ok,
        help: response.json,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_map',
      description: 'Get the city map. Optionally filter by symbols.',
      parameters: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' }, description: 'Optional symbol filter' },
        },
        required: [],
      },
    },
    handler: async (args, ctx) => {
      const symbols = normalizeReadMapSymbols(args.symbols)
      const response = await api.getMap(symbols)

      if (response.json) {
        try {
          const parsedMap = mapCore.parseMap(response.json)
          ctx.map = parsedMap
          const candidates = planner.rankCandidates(parsedMap, 'highest blocks')
          for (const c of candidates) {
            stateCore.addCandidateTile(ctx.state, c)
          }
          log.info(`Map preview\n${renderMapPreview(ctx)}`)
        } catch (e) {
          log.warn('Failed to parse map', { error: String(e) })
        }
      }

      return JSON.stringify({
        ok: response.ok,
        map: ctx.map ? {
          width: ctx.map.width,
          height: ctx.map.height,
          roads: ctx.map.roads.length,
          buildings: ctx.map.buildings.length,
          candidates: ctx.map.candidates.length,
          preview: renderMapPreview(ctx),
        } : null,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'get_state_summary',
      description: 'Get current mission state summary including AP, units, candidates',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args, ctx) => {
      const summary = stateCore.getStateSummary(ctx.state)
      const ap = stateCore.getAPStatus(ctx.state)
      const candidates = stateCore.getUninspectedCandidates(ctx.state)
      const transporters = getTransporterStatus(ctx)
      const clusterHints = getClusterActionHints(ctx)
      const reusableTransporters = getReusableTransporters(ctx)

      let recommendedNextAction = 'Read map and stage a transporter near the best road cluster.'
      if (stateCore.isSurvivorConfirmed(ctx.state) && ctx.state.confirmedSurvivorTile) {
        recommendedNextAction = `Call helicopter at ${ctx.state.confirmedSurvivorTile}.`
      } else if (clusterHints[0]?.roadCoord && reusableTransporters[0]) {
        recommendedNextAction = `Reuse transporter ${reusableTransporters[0].unitId} and move it to ${clusterHints[0].roadCoord} before creating any new unit.`
      } else if (transporters.length > 0 && reusableTransporters.length === 0) {
        recommendedNextAction = 'All existing transporters are stranded. Keep one scout onboard next time; only then consider creating a replacement transporter.'
      }

      return JSON.stringify({
        summary,
        ap,
        uninspectedCandidates: candidates.slice(0, 5).map((c) => getCandidateGuidance(ctx, c)),
        transporters,
        reusableTransporters,
        clusterHints,
        recommendedNextAction,
        survivorConfirmed: stateCore.isSurvivorConfirmed(ctx.state),
        survivorCoord: ctx.state.confirmedSurvivorTile,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'create_transporter',
      description: 'Create a transporter unit with scouts as passengers.',
      parameters: {
        type: 'object',
        properties: {
          passengers: { type: 'number', description: 'Number of scouts to load (0-8)' },
          allowExistingTransporters: {
            type: 'boolean',
            description: 'Allow planned bootstrap creation even if other staffed transporters already exist.',
          },
        },
        required: ['passengers'],
      },
    },
    handler: async (args, ctx) => {
      const passengers = Math.max(0, Math.min(8, Number(args.passengers) || 0))
      const allowExistingTransporters = args.allowExistingTransporters === true
      const cost = stateCore.estimateTransporterCost(passengers)
      const reusableTransporters = getReusableTransporters(ctx)
      const clusterHints = getClusterActionHints(ctx)

      // Check AP budget and warn if creating too many units
      const currentUnits = ctx.state.units.size
      const apRemaining = ctx.state.actionPointsRemaining

      void currentUnits

      if (!allowExistingTransporters && !stateCore.isSurvivorConfirmed(ctx.state) && reusableTransporters.length > 0) {
        const bestCluster = clusterHints.find((hint) =>
          hint.nearbyTransporters.some((unitId) => reusableTransporters.some((transporter) => transporter.unitId === unitId))
        ) || clusterHints[0]
        const preferredTransporter = reusableTransporters[0]

        return JSON.stringify({
          error: 'Guardrail: a staffed transporter is already available. Reuse it before creating another transporter.',
          guardrail: true,
          reusableTransporters,
          suggestedAction: bestCluster?.roadCoord
            ? `Move transporter ${preferredTransporter.unitId} to ${bestCluster.roadCoord} and sweep that cluster first.`
            : `Reuse transporter ${preferredTransporter.unitId} from ${preferredTransporter.coord} instead of spawning another.`,
        })
      }

      if (!stateCore.canAfford(ctx.state, cost)) {
        return JSON.stringify({ error: `Cannot afford ${cost} AP. Remaining: ${apRemaining}` })
      }

      const response = await api.createTransporter(passengers)

      if (response.ok && response.json) {
        const json = response.json as Record<string, unknown>
        const unitId = typeof json.object === 'string'
          ? json.object
          : (typeof json.unitId === 'string' ? json.unitId : `transporter-${Date.now()}`)

        let x = typeof json.x === 'number' ? json.x : 0
        let y = typeof json.y === 'number' ? json.y : 0
        if (typeof json.spawn === 'string') {
          try {
            const parsed = mapCore.parseCoord(json.spawn)
            x = parsed.x
            y = parsed.y
          } catch {
            // keep fallback coords
          }
        }

        const unit: Unit = {
          id: unitId,
          type: 'transporter',
          x,
          y,
          passengers: [],
        }

        // Create passenger scout units
        const crewIds = Array.isArray(json.crew)
          ? json.crew
              .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).id : undefined))
              .filter((id): id is string => typeof id === 'string')
          : []

        for (let i = 0; i < passengers; i++) {
          const scoutId = crewIds[i] || `${unitId}-scout-${i}`
          const scout: Unit = {
            id: scoutId,
            type: 'scout',
            x,
            y,
            parentTransporter: unitId,
          }
          stateCore.addUnit(ctx.state, scout)
          unit.passengers!.push(scoutId)
        }

        stateCore.addUnit(ctx.state, unit)
        stateCore.spendAP(ctx.state, cost)

        return JSON.stringify({
          ok: true,
          unitId,
          passengers,
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'create_scout',
      description: 'Create a single scout unit (not recommended - use transporter)',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args, ctx) => {
      const cost = 5

      if (!stateCore.canAfford(ctx.state, cost)) {
        return JSON.stringify({ error: `Cannot afford ${cost} AP` })
      }

      const response = await api.createScout()

      if (response.ok && response.json) {
        const json = response.json as Record<string, unknown>
        const unitId = typeof json.unitId === 'string' ? json.unitId : `scout-${Date.now()}`
        const x = typeof json.x === 'number' ? json.x : 0
        const y = typeof json.y === 'number' ? json.y : 0

        const unit: Unit = {
          id: unitId,
          type: 'scout',
          x,
          y,
        }

        stateCore.addUnit(ctx.state, unit)
        stateCore.spendAP(ctx.state, cost)

        return JSON.stringify({
          ok: true,
          unitId,
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'move_transporter',
      description: 'Move transporter on roads to a target coordinate.',
      parameters: {
        type: 'object',
        properties: {
          unitId: { type: 'string', description: 'Transporter unit ID' },
          where: { type: 'string', description: 'Destination coordinate (e.g., "F6")' },
        },
        required: ['unitId', 'where'],
      },
    },
    handler: async (args, ctx) => {
      const unitId = String(args.unitId || '')
      const where = typeof args.where === 'string' ? args.where.trim().toUpperCase() : ''
      if (!where) {
        return JSON.stringify({ error: 'Destination coordinate "where" is required.' })
      }

      const unit = stateCore.getUnit(ctx.state, unitId)
      if (!unit || unit.type !== 'transporter') {
        return JSON.stringify({ error: `Transporter ${unitId} not found` })
      }
      if (!unit.passengers || unit.passengers.length === 0) {
        const reusableTransporters = getReusableTransporters(ctx).filter((transporter) => transporter.unitId !== unitId)
        return JSON.stringify({
          error: 'Guardrail: transporter has no driver onboard and cannot move. Keep at least one scout inside before moving.',
          guardrail: true,
          reusableTransporters,
          suggestedAction: reusableTransporters[0]
            ? `Reuse staffed transporter ${reusableTransporters[0].unitId} at ${reusableTransporters[0].coord}, or create a new transporter only if no staffed unit can reach the next cluster.`
            : 'create_transporter',
        })
      }

      if (!ctx.map) {
        return JSON.stringify({ error: 'Map not loaded' })
      }

      const targetTile = mapCore.getTileByCoord(ctx.map, where)

      if (!targetTile || !targetTile.isRoad) {
        const nearestRoad = targetTile ? mapCore.findNearestRoad(ctx.map, targetTile.x, targetTile.y) : null
        return JSON.stringify({
          error: `Cannot move transporter to ${where} - destination must be a road tile`,
          suggestedRoadCoord: nearestRoad?.coord || null,
          suggestedAction: nearestRoad
            ? `Drive to ${nearestRoad.coord}, then use move_scout or inspect_tile for ${where}.`
            : 'Choose a road tile first, then approach the target with a scout.',
        })
      }

      const distance = mapCore.shortestRoadDistance(ctx.map, unit.x, unit.y, targetTile.x, targetTile.y)
      if (distance === null) {
        return JSON.stringify({ error: `No valid road path from ${mapCore.toCoord(unit.x, unit.y)} to ${targetTile.coord}` })
      }
      if (distance === 0) {
        return JSON.stringify({ ok: true, info: `Transporter already at ${targetTile.coord}`, cost: 0 })
      }

      const cost = stateCore.estimateTransporterDriveCost(distance)
      if (!stateCore.canAfford(ctx.state, cost)) {
        return JSON.stringify({ error: `Cannot afford ${cost} AP` })
      }

      const response = await api.moveUnit(unitId, targetTile.coord)

      if (response.ok) {
        stateCore.updateUnitPosition(ctx.state, unitId, targetTile.x, targetTile.y)

        // Update passenger positions too
        if (unit.passengers) {
          for (const passengerId of unit.passengers) {
            stateCore.updateUnitPosition(ctx.state, passengerId, targetTile.x, targetTile.y)
          }
        }

        stateCore.spendAP(ctx.state, cost)

        return JSON.stringify({
          ok: true,
          newPosition: { x: targetTile.x, y: targetTile.y, coord: targetTile.coord },
          distance,
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'move_scout',
      description: 'Move scout between connected building tiles only (expensive: 7 AP per tile).',
      parameters: {
        type: 'object',
        properties: {
          unitId: { type: 'string', description: 'Scout unit ID' },
          where: { type: 'string', description: 'Destination coordinate (e.g., "F6")' },
        },
        required: ['unitId', 'where'],
      },
    },
    handler: async (args, ctx) => {
      const unitId = String(args.unitId || '')
      const where = typeof args.where === 'string' ? args.where.trim().toUpperCase() : ''
      if (!where) {
        return JSON.stringify({ error: 'Destination coordinate "where" is required.' })
      }

      const unit = stateCore.getUnit(ctx.state, unitId)
      if (!unit || unit.type !== 'scout') {
        return JSON.stringify({ error: `Scout ${unitId} not found` })
      }
      if (unit.parentTransporter) {
        return JSON.stringify({
          error: `Scout ${unitId} is still onboard transporter ${unit.parentTransporter}. Dismount directly into a building first.`,
          guardrail: true,
          suggestedAction: 'dismount',
        })
      }

      if (!ctx.map) {
        return JSON.stringify({ error: 'Map not loaded' })
      }

      const targetTile = mapCore.getTileByCoord(ctx.map, where)
      const currentTile = mapCore.getTile(ctx.map, unit.x, unit.y)

      if (!targetTile) {
        return JSON.stringify({ error: `Cannot move scout to ${where} - out of bounds` })
      }
      if (!currentTile?.isBuilding || !targetTile.isBuilding) {
        return JSON.stringify({
          error: `Guardrail: scouts may move only within buildings. Current tile ${mapCore.toCoord(unit.x, unit.y)} and destination ${where} must both be building tiles.`,
          guardrail: true,
        })
      }

      const buildingDistance = mapCore.shortestBuildingDistance(ctx.map, currentTile.coord, targetTile.coord)
      if (buildingDistance === null) {
        return JSON.stringify({
          error: `Guardrail: ${currentTile.coord} and ${targetTile.coord} are not connected through building tiles.`,
          guardrail: true,
        })
      }

      const distance = buildingDistance
      if (distance === 0) {
        return JSON.stringify({ ok: true, info: `Scout already at ${targetTile.coord}`, cost: 0 })
      }

      const cost = stateCore.estimateScoutWalkCost(distance)
      const hasTransporter = stateCore.getUnitsByType(ctx.state, 'transporter').length > 0
      const guardrails = stateCore.getGuardrails()

      if (!stateCore.isSurvivorConfirmed(ctx.state) && hasTransporter && distance > guardrails.maxScoutMoveDistanceWithTransporter) {
        return JSON.stringify({
          error: `Guardrail: scout move distance ${distance} is too high while transporter is available. Use move_transporter first and keep scout moves <= ${guardrails.maxScoutMoveDistanceWithTransporter} tiles.`,
          guardrail: true,
          suggestedAction: 'move_transporter',
        })
      }

      if (!stateCore.canAfford(ctx.state, cost)) {
        return JSON.stringify({ error: `Cannot afford ${cost} AP` })
      }

      const response = await api.moveUnit(unitId, targetTile.coord)

      if (response.ok) {
        stateCore.updateUnitPosition(ctx.state, unitId, targetTile.x, targetTile.y)
        stateCore.spendAP(ctx.state, cost)
        stateCore.registerScoutMove(ctx.state, distance, cost)

        return JSON.stringify({
          ok: true,
          newPosition: { x: targetTile.x, y: targetTile.y, coord: targetTile.coord },
          distance,
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'dismount',
      description: 'Removes selected number of scouts from transporter and spawns them on free tiles around vehicle.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string', description: 'Transporter unit hash/ID' },
          passengers: { type: 'number', description: 'Number of scouts to dismount (1-4)' },
        },
        required: ['object', 'passengers'],
      },
    },
    handler: async (args, ctx) => {
      const object = String(args.object || '')
      const passengers = Math.max(1, Math.min(4, Number(args.passengers) || 1))

      const unit = stateCore.getUnit(ctx.state, object)
      if (!unit || unit.type !== 'transporter') {
        return JSON.stringify({ error: `Transporter ${object} not found` })
      }

      const onboard = unit.passengers?.length || 0
      const { adjacentBuildingCoords, suggestedRoadCoord } = getBuildingDismountHint(ctx, object, passengers)
      const wouldRemoveDriver = passengers >= onboard
      const otherReusableTransporterExists = getReusableTransporters(ctx).some((transporter) => transporter.unitId !== object)
      const remainingCandidates = stateCore.getUninspectedCandidates(ctx.state).length

      if (
        onboard > 0
        && wouldRemoveDriver
        && !stateCore.isSurvivorConfirmed(ctx.state)
        && !otherReusableTransporterExists
        && remainingCandidates > 1
        && adjacentBuildingCoords.length < passengers
      ) {
        return JSON.stringify({
          error: 'Guardrail: do not dismount every passenger from the only staffed transporter while multiple candidate tiles remain.',
          guardrail: true,
          suggestedPassengers: Math.max(1, onboard - 1),
          suggestedAction: `Dismount ${Math.max(1, onboard - 1)} passenger(s) and keep one scout onboard so this transporter can be reused.`,
        })
      }

      if (ctx.map && adjacentBuildingCoords.length < passengers) {
        return JSON.stringify({
          error: `Guardrail: dismount ${passengers} scout(s) only when the transporter is adjacent to at least ${passengers} building tiles.`,
          guardrail: true,
          adjacentBuildingCoords,
          suggestedAction: suggestedRoadCoord
            ? `Move transporter ${object} to ${suggestedRoadCoord} and dismount there so scouts spawn directly into buildings.`
            : 'Reposition the transporter to a road tile bordering enough buildings before dismounting.',
        })
      }

      const response = await api.dismount(object, passengers)

      if (response.ok) {
        const json = response.json as Record<string, unknown> | null
        const spawned = json && Array.isArray(json.spawned) ? json.spawned : []

        // Update passenger positions - mark dismounted scouts as no longer in transporter
        if (unit.passengers) {
          const scoutsToDismount = unit.passengers.slice(0, passengers)
          applyDismountSpawnUpdates(ctx, scoutsToDismount, spawned)
          unit.passengers = unit.passengers.slice(passengers)
        }

        return JSON.stringify({
          ok: true,
          cost: 0,
          apRemaining: ctx.state.actionPointsRemaining,
          spawned,
          allBuildingSpawns: ctx.map
            ? spawned.every((entry) => {
              const where = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).where : null
              if (typeof where !== 'string') return false
              return !!mapCore.getTileByCoord(ctx.map!, where)?.isBuilding
            })
            : undefined,
        })
      }

      return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'inspect_tile',
      description: 'Inspect a specific tile for survivor presence (1 AP)',
      parameters: {
        type: 'object',
        properties: {
          coord: { type: 'string', description: 'Tile coordinate (e.g., "F6")' },
          unitId: { type: 'string', description: 'Optional unit ID performing inspection' },
        },
        required: ['coord'],
      },
    },
    handler: async (args, ctx) => {
      const coord = String(args.coord || '')
      let unitId = args.unitId ? String(args.unitId) : undefined

      if (!coord) {
        return JSON.stringify({ error: 'Coordinate required' })
      }

      if (stateCore.isTileInspected(ctx.state, coord)) {
        return JSON.stringify({ info: `Tile ${coord} already inspected` })
      }

      if (!ctx.map) {
        return JSON.stringify({ error: 'Map not loaded' })
      }

      const tile = mapCore.getTileByCoord(ctx.map, coord)
      if (!tile) {
        return JSON.stringify({ error: `Invalid coordinate: ${coord}` })
      }

      const cost = 1
      if (!stateCore.canAfford(ctx.state, cost)) {
        return JSON.stringify({ error: `Cannot afford ${cost} AP` })
      }

      if (!unitId || !isMd5(unitId)) {
        unitId = pickBestInspectionUnitId(ctx, tile)
      }

      const inspectionUnit = unitId ? stateCore.getUnit(ctx.state, unitId) : undefined
      const inspectionDistance = inspectionUnit
        ? mapCore.manhattanDistance(inspectionUnit.x, inspectionUnit.y, tile.x, tile.y)
        : null
      const canInspectFromCurrentPosition = inspectionUnit
        && !inspectionUnit.parentTransporter
        && inspectionDistance !== null
        && inspectionDistance === 0

      if (!canInspectFromCurrentPosition) {
        return JSON.stringify(buildInspectionReachabilityHint(ctx, tile, unitId))
      }

      const beforeLogsResponse = await api.getLogs()
      const beforeEvents = beforeLogsResponse.ok ? logAnalysis.parseLogs(beforeLogsResponse.json) : []
      const beforeSeenCounts = beforeLogsResponse.ok
        ? logAnalysis.extractNewEvents(beforeEvents, new Map()).nextSeenCounts
        : ctx.state.seenLogCounts

      const response = await api.inspectTile(tile.x, tile.y, unitId)

      let logSummary = ''
      let matchedEvents: LogEvent[] = []
      let matchedBy: 'coord' | 'scout' | 'latest' | 'none' = 'none'
      let inspectedCoord = coord

      if (response.ok) {
        stateCore.spendAP(ctx.state, cost)

        try {
          const logsResponse = await api.getLogs()
          if (logsResponse.ok) {
            const allEvents = logAnalysis.parseLogs(logsResponse.json)
            const { newEvents, nextSeenCounts } = logAnalysis.extractNewEvents(allEvents, beforeSeenCounts)
            stateCore.setLogsConsumed(ctx.state, allEvents.length)
            stateCore.replaceSeenLogCounts(ctx.state, nextSeenCounts)

            const feedback = await summarizeInspectionFeedback(coord, unitId, newEvents)
            logSummary = feedback.summary
            matchedEvents = feedback.matchedEvents
            matchedBy = feedback.matchedBy
            inspectedCoord = feedback.matchedEvents.find((event) => typeof event.coordinates === 'string')?.coordinates || coord
          }
        } catch (error) {
          log.warn('Failed auto-log fetch after inspect', { error: String(error) })
        }

        stateCore.markTileInspected(ctx.state, inspectedCoord)
      }

      return JSON.stringify({
        ok: response.ok,
        coord,
        inspectedCoord,
        result: response.json,
        cost,
        apRemaining: ctx.state.actionPointsRemaining,
        autoLogSummary: logSummary || undefined,
        autoLogMatchedBy: matchedBy,
        autoLogEvents: matchedEvents.length > 0 ? matchedEvents : undefined,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_logs',
      description: 'Fetch operation logs so the main model can analyze them directly',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (_args, ctx) => {
      const response = await api.getLogs()

      if (!response.ok) {
        return JSON.stringify({ ok: false, raw: response.raw.slice(0, 500) })
      }

      const allEvents = logAnalysis.parseLogs(response.json)
      const { newEvents, nextSeenCounts } = logAnalysis.extractNewEvents(allEvents, ctx.state.seenLogCounts)
      stateCore.setLogsConsumed(ctx.state, allEvents.length)
      stateCore.replaceSeenLogCounts(ctx.state, nextSeenCounts)

      const summary = logAnalysis.summarizeLogsForAgent(newEvents)

      return JSON.stringify({
        ok: true,
        newEvents: newEvents.length,
        totalEvents: allEvents.length,
        summary,
        events: newEvents,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'call_helicopter',
      description: 'Call rescue helicopter to confirmed survivor location',
      parameters: {
        type: 'object',
        properties: {
          coord: { type: 'string', description: 'Confirmed survivor coordinate' },
        },
        required: ['coord'],
      },
    },
    handler: async (args, ctx) => {
      const coord = String(args.coord || '')

      if (!stateCore.isSurvivorConfirmed(ctx.state)) {
        stateCore.confirmSurvivor(ctx.state, coord)
      }

      if (coord !== ctx.state.confirmedSurvivorTile) {
        return JSON.stringify({
          error: `Coordinate ${coord} does not match confirmed location ${ctx.state.confirmedSurvivorTile}`,
        })
      }

      const response = await api.callHelicopter(coord)

      const flag = api.extractFlag(response.raw)
      if (flag) {
        ctx.doneFlag = flag
        ctx.doneResponseRaw = response.raw
      }

      return JSON.stringify({
        ok: response.ok,
        flag,
        raw: response.raw.slice(0, 500),
      })
    },
  },
]

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((t) => t.definition)
}

export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.definition.name === name)
}

export function createInitialContext(): AgentContext {
  return {
    map: null,
    state: stateCore.createInitialState(),
    helpSchema: null,
    doneFlag: null,
    doneResponseRaw: null,
  }
}
