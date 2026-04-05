import * as api from './api/client.js'
import * as logAnalysis from './core/logAnalysis.js'
import * as mapCore from './core/map.js'
import * as planner from './core/planner.js'
import * as stateCore from './core/missionState.js'
import type { AgentContext, EnrichedMapPayload, GameMap, Tool, ToolDefinition, Unit } from './types.js'

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseCoordFromValue(value: unknown): { x: number; y: number } | null {
  if (typeof value !== 'string') {
    return null
  }
  try {
    return mapCore.parseCoord(value.trim().toUpperCase())
  } catch {
    return null
  }
}

function normalizeReadMapSymbols(rawSymbols: unknown): string[] | undefined {
  if (!Array.isArray(rawSymbols)) {
    return undefined
  }

  const normalized = rawSymbols
    .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
    .filter(Boolean)

  return normalized.length > 0 ? [...new Set(normalized)] : undefined
}

function listEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw
  }

  const record = toRecord(raw)
  if (!record) {
    return []
  }

  for (const key of ['objects', 'units', 'items', 'data']) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[]
    }
  }

  const out: unknown[] = []
  if (Array.isArray(record.transporters)) {
    for (const entry of record.transporters) {
      const object = toRecord(entry)
      if (object) out.push({ ...object, type: 'transporter' })
    }
  }
  if (Array.isArray(record.scouts)) {
    for (const entry of record.scouts) {
      const object = toRecord(entry)
      if (object) out.push({ ...object, type: 'scout' })
    }
  }
  return out
}

function normalizeUnit(entry: unknown, previousUnits: Map<string, Unit>): Unit | null {
  const object = toRecord(entry)
  if (!object) {
    return null
  }

  const idValue = object.id ?? object.object ?? object.hash ?? object.unitId
  const id = typeof idValue === 'string' ? idValue.trim() : ''
  if (!id) {
    return null
  }

  const typeValue = typeof object.type === 'string' ? object.type.trim().toLowerCase() : ''
  const type = typeValue === 'scout' || typeValue === 'transporter'
    ? typeValue
    : Array.isArray(object.passengers) || typeof object.passengers === 'number'
      ? 'transporter'
      : 'scout'

  const coord =
    parseCoordFromValue(object.coord)
    || parseCoordFromValue(object.where)
    || parseCoordFromValue(object.position)
    || parseCoordFromValue(object.field)
  if (!coord) {
    return null
  }

  const previous = previousUnits.get(id)
  const unit: Unit = { id, type, x: coord.x, y: coord.y }

  if (type === 'transporter') {
    unit.passengers = Array.isArray(object.passengers)
      ? object.passengers.filter((value): value is string => typeof value === 'string')
      : previous?.passengers || []
  } else {
    const parentTransporter = object.parentTransporter ?? object.onboardTransporterId
    if (typeof parentTransporter === 'string' && parentTransporter.trim()) {
      unit.parentTransporter = parentTransporter.trim()
    } else if (previous?.parentTransporter) {
      unit.parentTransporter = previous.parentTransporter
    }
  }

  return unit
}

export function normalizeObjectsPayload(raw: unknown, previousUnits: Map<string, Unit> = new Map()): Unit[] {
  return listEntries(raw)
    .map((entry) => normalizeUnit(entry, previousUnits))
    .filter((unit): unit is Unit => !!unit)
}

function syncUnits(ctx: AgentContext, raw: unknown): Unit[] {
  const units = normalizeObjectsPayload(raw, new Map(ctx.state.units))
  if (units.length > 0) {
    stateCore.replaceUnits(ctx.state, units)
  }
  return Array.from(ctx.state.units.values())
}

function unitSummary(ctx: AgentContext): {
  transporters: Array<{ id: string; coord: string; x: number; y: number; passengersOnboard: number }>
  scouts: Array<{ id: string; coord: string; x: number; y: number; onboardTransporterId: string | null }>
} {
  return {
    transporters: stateCore.getUnitsByType(ctx.state, 'transporter').map((unit) => ({
      id: unit.id,
      coord: mapCore.toCoord(unit.x, unit.y),
      x: unit.x,
      y: unit.y,
      passengersOnboard: unit.passengers?.length || 0,
    })),
    scouts: stateCore.getUnitsByType(ctx.state, 'scout').map((unit) => ({
      id: unit.id,
      coord: mapCore.toCoord(unit.x, unit.y),
      x: unit.x,
      y: unit.y,
      onboardTransporterId: unit.parentTransporter || null,
    })),
  }
}

export function renderMapPreview(ctx: AgentContext): string {
  if (!ctx.map) {
    return '(map unavailable)'
  }
  return mapCore.renderMapPreview(ctx.map, Array.from(ctx.state.units.values()))
}

function refreshCandidateRanking(ctx: AgentContext): void {
  if (!ctx.map) {
    return
  }
  stateCore.replaceCandidateTiles(ctx.state, planner.rankCandidates(ctx.map, 'highest blocks from the clue'))
}

export function buildEnrichedMapPayload(map: GameMap, units: Map<string, Unit>): EnrichedMapPayload {
  return {
    width: map.width,
    height: map.height,
    tiles: map.tiles.map((row) => row.map((tile) => tile.symbol)),
    roads: map.roads.map((tile) => tile.coord),
    searchableBuildings: map.buildings.map((tile) => tile.coord),
    highRiseCandidates: map.candidates.map((tile) => tile.coord),
    units: {
      transporters: Array.from(units.values())
        .filter((unit) => unit.type === 'transporter')
        .map((unit) => ({
          id: unit.id,
          coord: mapCore.toCoord(unit.x, unit.y),
          x: unit.x,
          y: unit.y,
          passengersOnboard: unit.passengers?.length || 0,
        })),
      scouts: Array.from(units.values())
        .filter((unit) => unit.type === 'scout')
        .map((unit) => ({
          id: unit.id,
          coord: mapCore.toCoord(unit.x, unit.y),
          x: unit.x,
          y: unit.y,
          onboardTransporterId: unit.parentTransporter || null,
        })),
    },
  }
}

function actionSuccess(ctx: AgentContext, tool: string, summary: string): void {
  stateCore.recordAction(ctx.state, { tool, summary })
}

function actionGuardrail(ctx: AgentContext, tool: string, summary: string): void {
  stateCore.recordAction(ctx.state, { tool, summary })
  stateCore.recordBlockedPattern(ctx.state, `${tool}: ${summary}`)
}

function roadClusters(ctx: AgentContext): Array<{ roadCoord: string | null; candidateCoords: string[]; candidateCount: number; maxRoadDistance: number | null }> {
  if (!ctx.map) {
    return []
  }
  return planner
    .summarizeRoadClusters(
      stateCore.getUninspectedCandidates(ctx.state),
      ctx.map,
      stateCore.getGuardrails().maxScoutMoveDistanceWithTransporter,
    )
    .slice(0, 6)
    .map((cluster) => ({
      roadCoord: cluster.roadCoord,
      candidateCoords: cluster.candidateCoords,
      candidateCount: cluster.candidateCount,
      maxRoadDistance: cluster.maxRoadDistance,
    }))
}

function notableSymbols(map: GameMap): Array<{ symbol: string; count: number }> {
  const counts = new Map<string, number>()
  for (const row of map.tiles) {
    for (const tile of row) {
      counts.set(tile.symbol, (counts.get(tile.symbol) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}

function ensureUnit(ctx: AgentContext, id: string): Unit | undefined {
  return stateCore.getUnit(ctx.state, id)
}

async function syncObjectsFromServer(ctx: AgentContext): Promise<void> {
  const response = await api.getObjects()
  if (response.ok) {
    syncUnits(ctx, response.json)
  }
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'create_unit',
      description: 'Create a new scout or transporter. Transporters are efficient for long road movement and may start with 1-4 scouts onboard. Reuse existing units before spending AP on more.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['transporter', 'scout'], description: 'Unit type to create.' },
          passengers: { type: 'integer', minimum: 1, maximum: 4, description: 'Required only for transporter creation.' },
        },
        required: ['type'],
      },
    },
    handler: async (args, ctx) => {
      const type = typeof args.type === 'string' ? args.type.trim().toLowerCase() : ''
      const passengers = Number(args.passengers)

      if (type === 'transporter') {
        if (!Number.isInteger(passengers) || passengers < 1 || passengers > 4) {
          actionGuardrail(ctx, 'create_unit', 'invalid transporter passenger count')
          return JSON.stringify({ ok: false, guardrail: true, error: 'Transporter creation requires passengers between 1 and 4.' })
        }

        const reusable = unitSummary(ctx).transporters.find((unit) => unit.passengersOnboard > 0)
        if (reusable && !stateCore.isSurvivorConfirmed(ctx.state)) {
          actionGuardrail(ctx, 'create_unit', 'reusable staffed transporter already exists')
          return JSON.stringify({
            ok: false,
            guardrail: true,
            error: 'A viable staffed transporter already exists. Reuse it before creating another transporter.',
            suggestedNextActions: [`Move transporter ${reusable.id} from ${reusable.coord}.`],
          })
        }

        const cost = stateCore.estimateTransporterCost(passengers)
        if (!stateCore.canAfford(ctx.state, cost)) {
          actionGuardrail(ctx, 'create_unit', 'insufficient AP for transporter')
          return JSON.stringify({ ok: false, guardrail: true, error: `Cost ${cost} exceeds remaining AP ${ctx.state.actionPointsRemaining}.` })
        }

        const response = await api.createTransporter(passengers)
        if (!response.ok) {
          return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
        }
        stateCore.spendAP(ctx.state, cost)
        await syncObjectsFromServer(ctx)
        const createdId = typeof (toRecord(response.json)?.object) === 'string' ? String(toRecord(response.json)?.object) : null
        actionSuccess(ctx, 'create_unit', `created transporter with ${passengers} passengers`)
        return JSON.stringify({
          ok: true,
          unit: createdId,
          crew: unitSummary(ctx).scouts.filter((scout) => scout.onboardTransporterId === createdId).map((scout) => scout.id),
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      if (type === 'scout') {
        if (args.passengers !== undefined) {
          actionGuardrail(ctx, 'create_unit', 'passengers provided for scout')
          return JSON.stringify({ ok: false, guardrail: true, error: 'Scout creation does not accept passengers.' })
        }

        const cost = stateCore.getCosts().createScout
        if (!stateCore.canAfford(ctx.state, cost)) {
          actionGuardrail(ctx, 'create_unit', 'insufficient AP for scout')
          return JSON.stringify({ ok: false, guardrail: true, error: `Cost ${cost} exceeds remaining AP ${ctx.state.actionPointsRemaining}.` })
        }

        const response = await api.createScout()
        if (!response.ok) {
          return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
        }
        stateCore.spendAP(ctx.state, cost)
        await syncObjectsFromServer(ctx)
        actionSuccess(ctx, 'create_unit', 'created standalone scout')
        return JSON.stringify({
          ok: true,
          unit: unitSummary(ctx).scouts.at(-1)?.id || null,
          crew: [],
          cost,
          apRemaining: ctx.state.actionPointsRemaining,
        })
      }

      actionGuardrail(ctx, 'create_unit', 'invalid type')
      return JSON.stringify({ ok: false, guardrail: true, error: 'Type must be either "transporter" or "scout".' })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'move_unit',
      description: 'Move a scout or transporter to a destination coordinate. Transporters can move on roads only and are best for long travel. Scouts are expensive and should usually make short local moves.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string', description: 'Unit identifier.' },
          where: { type: 'string', pattern: '^[A-K](10|11|[1-9])$', description: 'Destination coordinate.' },
        },
        required: ['object', 'where'],
      },
    },
    handler: async (args, ctx) => {
      const object = typeof args.object === 'string' ? args.object.trim() : ''
      const where = typeof args.where === 'string' ? args.where.trim().toUpperCase() : ''
      const unit = ensureUnit(ctx, object)

      if (!ctx.map) {
        return JSON.stringify({ ok: false, error: 'Map not loaded yet.' })
      }
      if (!unit) {
        actionGuardrail(ctx, 'move_unit', `unknown unit ${object}`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Unknown unit ID: ${object}.` })
      }

      const targetTile = mapCore.getTileByCoord(ctx.map, where)
      if (!targetTile) {
        actionGuardrail(ctx, 'move_unit', `invalid destination ${where}`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Invalid destination coordinate: ${where}.` })
      }

      const from = mapCore.toCoord(unit.x, unit.y)
      let distance = 0
      let cost = 0

      if (unit.type === 'transporter') {
        if (!targetTile.isRoad) {
          const nearestRoad = mapCore.findNearestRoad(ctx.map, targetTile.x, targetTile.y)
          actionGuardrail(ctx, 'move_unit', `transporter target ${where} is not a road`)
          return JSON.stringify({
            ok: false,
            guardrail: true,
            error: `Transporters can move only on roads, and ${where} is not a road tile.`,
            suggestedNextActions: nearestRoad ? [`Move to ${nearestRoad.coord} instead.`] : [],
          })
        }
        const roadDistance = mapCore.shortestRoadDistance(ctx.map, unit.x, unit.y, targetTile.x, targetTile.y)
        if (roadDistance === null) {
          actionGuardrail(ctx, 'move_unit', `no road path from ${from} to ${where}`)
          return JSON.stringify({ ok: false, guardrail: true, error: `No road path from ${from} to ${where}.` })
        }
        distance = roadDistance
        cost = stateCore.estimateTransporterDriveCost(distance)
      } else {
        if (unit.parentTransporter) {
          actionGuardrail(ctx, 'move_unit', `scout ${object} still onboard`)
          return JSON.stringify({ ok: false, guardrail: true, error: `Scout ${object} is still onboard transporter ${unit.parentTransporter}.` })
        }
        distance = mapCore.manhattanDistance(unit.x, unit.y, targetTile.x, targetTile.y)
        cost = stateCore.estimateScoutWalkCost(distance)
        if (
          distance > stateCore.getGuardrails().maxScoutMoveDistanceWithTransporter &&
          stateCore.getUnitsByType(ctx.state, 'transporter').some((entry) => (entry.passengers?.length || 0) > 0)
        ) {
          actionGuardrail(ctx, 'move_unit', `scout route to ${where} is too long`)
          return JSON.stringify({
            ok: false,
            guardrail: true,
            error: `Scout movement to ${where} is too long (${distance} tiles). Prefer transporter-assisted movement first.`,
          })
        }
      }

      if (!stateCore.canAfford(ctx.state, cost)) {
        actionGuardrail(ctx, 'move_unit', `insufficient AP for move to ${where}`)
        return JSON.stringify({ ok: false, guardrail: true, error: `This move costs ${cost} AP, but only ${ctx.state.actionPointsRemaining} remain.` })
      }

      const response = await api.moveUnit(object, where)
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      stateCore.spendAP(ctx.state, cost)
      if (unit.type === 'scout') {
        stateCore.registerScoutMove(ctx.state, distance, cost)
      }
      await syncObjectsFromServer(ctx)
      actionSuccess(ctx, 'move_unit', `moved ${object} from ${from} to ${where}`)
      return JSON.stringify({
        ok: true,
        object,
        from,
        to: where,
        cost,
        apRemaining: ctx.state.actionPointsRemaining,
        pathSummary: { unitType: unit.type, distance },
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'inspect_position',
      description: 'Perform reconnaissance from a scout’s current tile. Move the scout first, then inspect. This tool inspects only the current scout position and does not accept coordinates.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string', description: 'Scout identifier only.' },
        },
        required: ['object'],
      },
    },
    handler: async (args, ctx) => {
      const object = typeof args.object === 'string' ? args.object.trim() : ''
      const unit = ensureUnit(ctx, object)
      if (!unit || unit.type !== 'scout') {
        actionGuardrail(ctx, 'inspect_position', `invalid scout ${object}`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Inspect requires a deployed scout ID, but received ${object}.` })
      }
      if (unit.parentTransporter) {
        actionGuardrail(ctx, 'inspect_position', `scout ${object} is onboard`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Scout ${object} is still onboard transporter ${unit.parentTransporter}.` })
      }

      const coord = mapCore.toCoord(unit.x, unit.y)
      if (stateCore.isTileInspected(ctx.state, coord)) {
        actionGuardrail(ctx, 'inspect_position', `tile ${coord} already inspected`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Tile ${coord} has already been inspected.` })
      }
      if (!stateCore.canAfford(ctx.state, stateCore.getCosts().inspect)) {
        actionGuardrail(ctx, 'inspect_position', `insufficient AP for ${coord}`)
        return JSON.stringify({ ok: false, guardrail: true, error: 'Inspect costs 1 AP, but no AP remain.' })
      }

      const response = await api.inspectPosition(object)
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      stateCore.spendAP(ctx.state, stateCore.getCosts().inspect)
      stateCore.markTileInspected(ctx.state, coord)
      actionSuccess(ctx, 'inspect_position', `inspected ${coord} with ${object}`)
      return JSON.stringify({
        ok: true,
        object,
        coord,
        cost: stateCore.getCosts().inspect,
        apRemaining: ctx.state.actionPointsRemaining,
        inspectionQueued: true,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'dismount_scouts',
      description: 'Deploy scouts from a transporter onto neighboring tiles. Use this after a transporter reaches a good staging road near buildings or other promising search positions.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string', description: 'Transporter identifier.' },
          passengers: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of scouts to dismount.' },
        },
        required: ['object', 'passengers'],
      },
    },
    handler: async (args, ctx) => {
      const object = typeof args.object === 'string' ? args.object.trim() : ''
      const passengers = Number(args.passengers)
      const unit = ensureUnit(ctx, object)

      if (!unit || unit.type !== 'transporter') {
        actionGuardrail(ctx, 'dismount_scouts', `invalid transporter ${object}`)
        return JSON.stringify({ ok: false, guardrail: true, error: `Dismount requires a transporter ID, but received ${object}.` })
      }
      if (!Number.isInteger(passengers) || passengers < 1 || passengers > 4) {
        actionGuardrail(ctx, 'dismount_scouts', 'invalid passengers')
        return JSON.stringify({ ok: false, guardrail: true, error: 'Passengers must be an integer between 1 and 4.' })
      }
      if (passengers > (unit.passengers?.length || 0)) {
        actionGuardrail(ctx, 'dismount_scouts', 'attempted to dismount too many scouts')
        return JSON.stringify({ ok: false, guardrail: true, error: `Transporter ${object} does not have ${passengers} scouts onboard.` })
      }

      const adjacentBuildings = ctx.map ? mapCore.getAdjacentBuildingTiles(ctx.map, unit.x, unit.y).map((tile) => tile.coord) : []
      if (adjacentBuildings.length === 0) {
        actionGuardrail(ctx, 'dismount_scouts', `poor staging at ${mapCore.toCoord(unit.x, unit.y)}`)
        return JSON.stringify({
          ok: false,
          guardrail: true,
          error: `Transporter ${object} is not adjacent to any building tiles. Reposition before dismounting.`,
          suggestedNextActions: ['Move the transporter to a road tile next to buildings first.'],
        })
      }

      const response = await api.dismount(object, passengers)
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      await syncObjectsFromServer(ctx)
      actionSuccess(ctx, 'dismount_scouts', `dismounted ${passengers} scout(s) from ${object}`)
      return JSON.stringify({
        ok: true,
        object,
        spawnedScouts: unitSummary(ctx).scouts.filter((scout) => scout.onboardTransporterId === null),
        remainingPassengers: stateCore.getUnit(ctx.state, object)?.passengers?.length || 0,
        freeAdjacentTiles: ctx.map ? mapCore.getOrthogonalNeighbors(ctx.map, unit.x, unit.y).map((tile) => tile.coord) : [],
        adjacentBuildings,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_objects',
      description: 'Return all currently known units with identifiers, types, and positions. Use this after creates, moves, or dismounts when you want the authoritative live board state.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, ctx) => {
      const response = await api.getObjects()
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      const units = syncUnits(ctx, response.json)
      const summary = unitSummary(ctx)
      actionSuccess(ctx, 'read_objects', `synced ${units.length} unit(s)`)
      return JSON.stringify({
        ok: true,
        objects: units.map((unit) => ({
          id: unit.id,
          type: unit.type,
          coord: mapCore.toCoord(unit.x, unit.y),
          parentTransporter: unit.parentTransporter || null,
          passengersOnboard: unit.passengers?.length || 0,
        })),
        transporters: summary.transporters,
        scouts: summary.scouts,
        syncApplied: true,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_map',
      description: 'Return the clean city map enriched with the current positions of transporters and scouts. Use this when you need terrain and live piece placement in one object.',
      parameters: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' }, description: 'Optional exact symbols or coordinates for a targeted refresh.' },
        },
        required: [],
      },
    },
    handler: async (args, ctx) => {
      const response = await api.getMap(normalizeReadMapSymbols(args.symbols))
      if (!response.ok || !response.json) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }

      try {
        ctx.map = mapCore.parseMap(response.json)
      } catch (error) {
        return JSON.stringify({ ok: false, error: `Failed to parse map: ${String(error)}` })
      }
      refreshCandidateRanking(ctx)
      await syncObjectsFromServer(ctx)
      const mapPayload = buildEnrichedMapPayload(ctx.map, ctx.state.units)
      actionSuccess(ctx, 'read_map', 'refreshed map and merged current unit positions')
      return JSON.stringify({
        ok: true,
        map: mapPayload,
        summary: {
          width: ctx.map.width,
          height: ctx.map.height,
          roads: ctx.map.roads.length,
          searchableBuildings: ctx.map.buildings.length,
          highRiseCandidates: ctx.map.candidates.length,
          transporters: mapPayload.units.transporters.length,
          scouts: mapPayload.units.scouts.length,
        },
        preview: renderMapPreview(ctx),
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'search_symbol',
      description: 'Find all map cells matching an exact 2-character symbol. Use this for targeted exploration without re-reading the whole map.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', pattern: '^[A-Za-z0-9]{2}$', description: 'Exact 2-character symbol to search for.' },
        },
        required: ['symbol'],
      },
    },
    handler: async (args, ctx) => {
      const symbol = typeof args.symbol === 'string' ? args.symbol.trim().toUpperCase() : ''
      const response = await api.searchSymbol(symbol)
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      const record = toRecord(response.json)
      const matches = Array.isArray(record?.matches) ? record.matches : Array.isArray(response.json) ? response.json : []
      actionSuccess(ctx, 'search_symbol', `searched for ${symbol}`)
      return JSON.stringify({ ok: true, symbol, matches, count: Array.isArray(matches) ? matches.length : 0 })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_logs',
      description: 'Read reconnaissance evidence from previous inspections. Use this after meaningful inspections to narrow the search and confirm the survivor location.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, ctx) => {
      const response = await api.getLogs()
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      const allEvents = logAnalysis.parseLogs(response.json)
      const { newEvents, nextSeenCounts } = logAnalysis.extractNewEvents(allEvents, ctx.state.seenLogCounts)
      const analysis = logAnalysis.interpretEventsDeterministically(newEvents)
      stateCore.setLogsConsumed(ctx.state, allEvents.length)
      stateCore.replaceSeenLogCounts(ctx.state, nextSeenCounts)
      if (analysis.confirmed && analysis.coord) {
        stateCore.confirmSurvivor(ctx.state, analysis.coord)
      }
      actionSuccess(ctx, 'read_logs', `read ${newEvents.length} new log event(s)`)
      return JSON.stringify({
        ok: true,
        events: allEvents,
        newEvents,
        analysis,
        candidateUpdates: newEvents.map((event) => event.coordinates).filter((value): value is string => typeof value === 'string'),
        survivorConfirmed: stateCore.isSurvivorConfirmed(ctx.state),
        survivorCoord: ctx.state.confirmedSurvivorTile,
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'read_expenses',
      description: 'Read action-point spending history. Use this only when your internal AP model seems uncertain or you need to audit recent costs.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, ctx) => {
      const response = await api.getExpenses()
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: response.raw.slice(0, 500) })
      }
      const record = toRecord(response.json)
      const expenses = Array.isArray(record?.expenses) ? record.expenses : Array.isArray(response.json) ? response.json : []
      actionSuccess(ctx, 'read_expenses', 'read AP spending history')
      return JSON.stringify({
        ok: true,
        expenses,
        totalSpent: ctx.state.actionPointsUsed,
        apRemaining: ctx.state.actionPointsRemaining,
        recentActions: stateCore.getRecentHistory(ctx.state),
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'call_helicopter',
      description: 'Call the evacuation helicopter to the confirmed survivor coordinate. Use this immediately after confirmation. Do not guess.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', pattern: '^[A-K](10|11|[1-9])$', description: 'Confirmed survivor coordinate.' },
        },
        required: ['destination'],
      },
    },
    handler: async (args, ctx) => {
      const destination = typeof args.destination === 'string' ? args.destination.trim().toUpperCase() : ''
      if (!stateCore.isSurvivorConfirmed(ctx.state) || !ctx.state.confirmedSurvivorTile) {
        actionGuardrail(ctx, 'call_helicopter', 'survivor not confirmed')
        return JSON.stringify({ ok: false, guardrail: true, error: 'You may call the helicopter only after a scout confirms a human.' })
      }
      if (destination !== ctx.state.confirmedSurvivorTile) {
        actionGuardrail(ctx, 'call_helicopter', `destination ${destination} does not match ${ctx.state.confirmedSurvivorTile}`)
        return JSON.stringify({
          ok: false,
          guardrail: true,
          error: `Destination ${destination} does not match confirmed survivor coordinate ${ctx.state.confirmedSurvivorTile}.`,
        })
      }

      const response = await api.callHelicopter(destination)
      const flag = api.extractFlag(response.raw)
      if (flag) {
        ctx.doneFlag = flag
        ctx.doneResponseRaw = response.raw
      }
      actionSuccess(ctx, 'call_helicopter', `called helicopter to ${destination}`)
      return JSON.stringify({ ok: response.ok, destination, flag, raw: response.raw.slice(0, 500) })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'get_state_summary',
      description: 'Return a compact mission snapshot with AP, units, likely targets, recent progress, and blocked patterns. Use this frequently between actions.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, ctx) => {
      actionSuccess(ctx, 'get_state_summary', 'read compact mission snapshot')
      return JSON.stringify({
        apRemaining: ctx.state.actionPointsRemaining,
        confirmedSurvivor: stateCore.isSurvivorConfirmed(ctx.state),
        survivorCoord: ctx.state.confirmedSurvivorTile,
        units: unitSummary(ctx),
        topCandidates: stateCore.getUninspectedCandidates(ctx.state).slice(0, 8).map((candidate) => ({
          coord: candidate.tile.coord,
          score: candidate.score,
          reasons: candidate.reasons,
        })),
        recentHistory: stateCore.getRecentHistory(ctx.state),
        uninspectedSearchAreas: roadClusters(ctx),
        blockedActionPatterns: stateCore.getBlockedPatterns(ctx.state),
      })
    },
  },
  {
    definition: {
      type: 'function',
      name: 'get_map_summary',
      description: 'Return a compact terrain summary with roads, searchable buildings, candidate zones, staging hints, and current unit distribution.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, ctx) => {
      if (!ctx.map) {
        return JSON.stringify({ ok: false, error: 'Map not loaded yet.' })
      }
      actionSuccess(ctx, 'get_map_summary', 'read compact terrain summary')
      return JSON.stringify({
        roads: ctx.map.roads.map((tile) => tile.coord),
        searchableBuildings: ctx.map.buildings.map((tile) => tile.coord),
        highRiseCandidates: ctx.map.candidates.map((tile) => tile.coord),
        spawnLane: ['A6', 'B6', 'C6', 'D6'],
        roadClusters: roadClusters(ctx),
        notableSymbols: notableSymbols(ctx.map),
        unitPositions: unitSummary(ctx),
      })
    },
  },
]

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((tool) => tool.definition)
}

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.definition.name === name)
}

export function createInitialContext(): AgentContext {
  return {
    map: null,
    state: stateCore.createInitialState(),
    doneFlag: null,
    doneResponseRaw: null,
  }
}
