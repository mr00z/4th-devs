import type { Direction, KnowledgeModel, KnowledgeUpdate, Point, TerrainRule, ToolEvidence, VehicleRule } from './types.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeMapRows(rows: string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row.length > 0)
}

function extractMapRowsFromText(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd())
  const accepted = lines.filter((line) => /^[A-Za-z0-9#~^*._\-]{8,}$/.test(line.replace(/\s+/g, '')))
  if (accepted.length < 8) {
    return []
  }

  const compact = accepted.map((line) => line.replace(/\s+/g, ''))
  const len = compact[0]?.length ?? 0
  if (len < 8) {
    return []
  }

  const sameLen = compact.every((line) => line.length === len)
  if (!sameLen) {
    return []
  }

  return compact.slice(0, 10)
}

function extractCoordinate(text: string, label: string): Point | undefined {
  const regex = new RegExp(`${label}[^\\d]{0,20}(\\d{1,2})[^\\d]{1,8}(\\d{1,2})`, 'i')
  const match = text.match(regex)
  if (!match) {
    return undefined
  }

  const x = Number.parseInt(match[1], 10)
  const y = Number.parseInt(match[2], 10)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined
  }

  return { x, y }
}

function findMarkerInGrid(rows: string[], marker: string): Point | undefined {
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]
    if (!row) continue
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === marker) {
        return { x, y }
      }
    }
  }
  return undefined
}

function collectStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function extractVehiclesFromJson(value: unknown): VehicleRule[] {
  const out: VehicleRule[] = []

  function walk(node: unknown): void {
    if (!node) {
      return
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry)
      }
      return
    }

    const obj = asRecord(node)
    if (!obj) {
      return
    }

    const nameRaw = obj.name ?? obj.vehicle ?? obj.type

    // Check for nested consumption object
    const consumption = asRecord(obj.consumption)
    const fuelRaw = obj.fuelPerMove ?? obj.fuel ?? obj.fuel_cost ?? obj.fuelCost ?? consumption?.fuel
    const foodRaw = obj.foodPerMove ?? obj.food ?? obj.food_cost ?? obj.foodCost ?? consumption?.food

    if (typeof nameRaw === 'string' && Number.isFinite(Number(fuelRaw)) && Number.isFinite(Number(foodRaw))) {
      const vehicle: VehicleRule = {
        name: nameRaw.trim().toLowerCase(),
        fuelPerMove: Number(fuelRaw),
        foodPerMove: Number(foodRaw),
      }

      const allowed = collectStringArray(obj.allowedTerrains ?? obj.allowed_terrains ?? obj.allowed)
      if (allowed.length > 0) {
        vehicle.allowedTerrains = allowed.map((item) => item.toLowerCase())
      }

      const blocked = collectStringArray(obj.blockedTerrains ?? obj.blocked_terrains ?? obj.blocked)
      if (blocked.length > 0) {
        vehicle.blockedTerrains = blocked.map((item) => item.toLowerCase())
      }

      out.push(vehicle)
    }

    for (const nested of Object.values(obj)) {
      walk(nested)
    }
  }

  walk(value)
  return out
}

function extractVehicleRulesFromText(text: string): VehicleRule[] {
  const lines = text.split(/\r?\n/)
  const out: VehicleRule[] = []
  
  // Known vehicle names to filter false positives
  const knownVehicles = new Set(['walk', 'horse', 'car', 'rocket', 'boat', 'bike', 'truck', 'plane'])

  for (const line of lines) {
    const match = line.match(/(\b[a-z][a-z0-9_\-]{2,}\b).*?fuel[^\d]*(\d+(?:\.\d+)?).*?food[^\d]*(\d+(?:\.\d+)?)/i)
    if (!match) {
      continue
    }

    const name = match[1].toLowerCase()
    
    // Skip JSON keys or common words that aren't vehicle names
    if (!knownVehicles.has(name)) {
      continue
    }

    out.push({
      name,
      fuelPerMove: Number.parseFloat(match[2]),
      foodPerMove: Number.parseFloat(match[3]),
    })
  }

  return out
}

function extractTerrainRulesFromText(text: string): TerrainRule[] {
  const out: TerrainRule[] = []

  // Extract tree fuel penalty from natural language
  // Matches: "entering a tile marked with T increases fuel consumption...by an additional 0.2"
  const treeMatch = text.match(/(?:tree|marked with T)[^.]*?(?:increases?\s+fuel|additional)[^.]*?(\d+(?:\.\d+)?)/i)
  if (treeMatch) {
    out.push({ symbol: 'T', fuelMultiplier: Number.parseFloat(treeMatch[1]) })
  }

  // Extract rocks blocking rule - match various patterns
  if (/rocks?\s+(that\s+)?block/i.test(text) || /R marks rocks/i.test(text)) {
    out.push({ symbol: 'R', blockedFor: ['walk', 'horse', 'car', 'rocket'] })
  }

  // Extract water blocking/vehicle loss rules
  const waterMatch = /cannot\s+(?:drive|travel|fly)\s+(?:on|over)\s+water/i.test(text)
  const waterLossMatch = /entering\s+a\s+water\s+tile.*vehicle\s+is\s+lost/i.test(text)
  console.error('[TERRAIN] waterMatch:', waterMatch, 'waterLossMatch:', waterLossMatch, 'textPreview:', text.slice(0, 200))
  if (waterMatch || waterLossMatch) {
    out.push({ symbol: 'W', blockedFor: ['car', 'rocket'] })
  }

  // Also try structured line-by-line extraction
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const symbolMatch = line.match(/symbol\s*[:=]\s*([A-Za-z0-9#~^*._\-])/i) ?? line.match(/^\s*([A-Za-z0-9#~^*._\-])\s*[:-]/)
    if (!symbolMatch) {
      continue
    }

    const symbol = symbolMatch[1]
    const rule: TerrainRule = { symbol }

    const blocked = line.match(/blocked\s*[:=]\s*([a-z0-9_,\-\s]+)/i)
    if (blocked) {
      rule.blockedFor = blocked[1].split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
    }

    const allowed = line.match(/allowed\s*[:=]\s*([a-z0-9_,\-\s]+)/i)
    if (allowed) {
      rule.allowedFor = allowed[1].split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
    }

    const fuel = line.match(/fuel(?:\s*multiplier)?\s*[:=]\s*(\d+(?:\.\d+)?)/i)
    if (fuel) {
      rule.fuelMultiplier = Number.parseFloat(fuel[1])
    }

    const food = line.match(/food(?:\s*multiplier)?\s*[:=]\s*(\d+(?:\.\d+)?)/i)
    if (food) {
      rule.foodMultiplier = Number.parseFloat(food[1])
    }

    out.push(rule)
  }

  return out
}

export function extractKnowledgeUpdate(evidence: ToolEvidence): KnowledgeUpdate {
  const text = evidence.bodyText
  const json = parseJson(text)

  const update: KnowledgeUpdate = {
    notes: [text.slice(0, 800)],
  }

  const mapRowsFromText = extractMapRowsFromText(text)
  if (mapRowsFromText.length > 0) {
    update.mapRows = normalizeMapRows(mapRowsFromText)
  }

  // First try to find markers in extracted map rows
  if (update.mapRows && update.mapRows.length > 0) {
    const startMarker = findMarkerInGrid(update.mapRows, 'S')
    if (startMarker) {
      update.start = startMarker
    }
    const targetMarker = findMarkerInGrid(update.mapRows, 'G')
    if (targetMarker) {
      update.target = targetMarker
      update.targetLabel = 'Skolwin'
    }
  }

  // Fallback to text-based coordinate extraction
  if (!update.start) {
    const start = extractCoordinate(text, 'start')
    if (start) {
      update.start = start
    }
  }

  if (!update.target) {
    const target = extractCoordinate(text, 'skolwin|target|goal|finish')
    if (target) {
      update.target = target
      update.targetLabel = 'Skolwin'
    }
  }

  const vehiclesFromText = extractVehicleRulesFromText(text)
  if (vehiclesFromText.length > 0) {
    update.vehicles = vehiclesFromText
  }

  const terrainFromText = extractTerrainRulesFromText(text)
  console.error('[EXTRACT] terrainFromText:', JSON.stringify(terrainFromText))
  if (terrainFromText.length > 0) {
    update.terrainRules = terrainFromText
  }

  const jsonObj = asRecord(json)
  if (jsonObj) {
    if (!update.mapRows && Array.isArray(jsonObj.map) && jsonObj.map.length > 0) {
      // Check if it's a 2D array (array of arrays of chars)
      const firstItem = jsonObj.map[0]
      if (Array.isArray(firstItem)) {
        // 2D array: [[".",".",...], [".",".",...], ...]
        const rows = jsonObj.map.map((row) => {
          if (Array.isArray(row)) {
            return row.map((c) => (typeof c === 'string' ? c : '.')).join('')
          }
          return typeof row === 'string' ? row : ''
        }).filter((row) => row.length > 0)
        if (rows.length > 0) {
          update.mapRows = normalizeMapRows(rows)
        }
      } else {
        // 1D array of strings
        const rows = jsonObj.map.filter((item): item is string => typeof item === 'string')
        if (rows.length > 0) {
          update.mapRows = normalizeMapRows(rows)
        }
      }

      // Extract markers from newly extracted mapRows
      if (update.mapRows && update.mapRows.length > 0) {
        const startMarker = findMarkerInGrid(update.mapRows, 'S')
        if (startMarker) {
          update.start = startMarker
        }
        const targetMarker = findMarkerInGrid(update.mapRows, 'G')
        if (targetMarker) {
          update.target = targetMarker
          update.targetLabel = 'Skolwin'
        }
      }
    } else if (!update.mapRows && typeof jsonObj.map === 'string') {
      // Handle map as single string with \n separators
      const rows = jsonObj.map.split(/\\n|\n/).map((r: string) => r.trim()).filter(Boolean)
      if (rows.length > 0) {
        update.mapRows = normalizeMapRows(rows)
      }
    }

    if (!update.start) {
      const startObj = asRecord(jsonObj.start)
      if (startObj && Number.isFinite(Number(startObj.x)) && Number.isFinite(Number(startObj.y))) {
        update.start = { x: Number(startObj.x), y: Number(startObj.y) }
      }
    }

    if (!update.target) {
      const targetObj = asRecord(jsonObj.target ?? jsonObj.goal ?? jsonObj.skolwin)
      if (targetObj && Number.isFinite(Number(targetObj.x)) && Number.isFinite(Number(targetObj.y))) {
        update.target = { x: Number(targetObj.x), y: Number(targetObj.y) }
        update.targetLabel = 'Skolwin'
      }
    }

    const vehiclesFromJson = extractVehiclesFromJson(jsonObj)
    if (vehiclesFromJson.length > 0) {
      update.vehicles = [...(update.vehicles ?? []), ...vehiclesFromJson]
    }
  }

  return update
}

function mergeVehicles(current: VehicleRule[], incoming: VehicleRule[]): VehicleRule[] {
  const map = new Map<string, VehicleRule>()

  for (const vehicle of current) {
    map.set(vehicle.name.toLowerCase(), vehicle)
  }

  for (const vehicle of incoming) {
    const key = vehicle.name.toLowerCase()
    const previous = map.get(key)
    if (!previous) {
      map.set(key, vehicle)
      continue
    }

    map.set(key, {
      ...previous,
      ...vehicle,
      allowedTerrains: vehicle.allowedTerrains ?? previous.allowedTerrains,
      blockedTerrains: vehicle.blockedTerrains ?? previous.blockedTerrains,
    })
  }

  return [...map.values()]
}

function mergeTerrainRules(current: TerrainRule[], incoming: TerrainRule[]): TerrainRule[] {
  console.error('[MERGE] current:', JSON.stringify(current), 'incoming:', JSON.stringify(incoming))
  const map = new Map<string, TerrainRule>()

  for (const rule of current) {
    map.set(rule.symbol, rule)
  }

  for (const rule of incoming) {
    const previous = map.get(rule.symbol)
    map.set(rule.symbol, {
      ...previous,
      ...rule,
      blockedFor: rule.blockedFor ?? previous?.blockedFor,
      allowedFor: rule.allowedFor ?? previous?.allowedFor,
      fuelMultiplier: rule.fuelMultiplier ?? previous?.fuelMultiplier,
      foodMultiplier: rule.foodMultiplier ?? previous?.foodMultiplier,
    })
  }

  const result = [...map.values()]
  console.error('[MERGE] result:', JSON.stringify(result))
  return result
}

export function mergeKnowledge(base: KnowledgeModel, update: KnowledgeUpdate): KnowledgeModel {
  const next: KnowledgeModel = {
    ...base,
    mapRows: update.mapRows ?? base.mapRows,
    start: update.start ?? base.start,
    target: update.target ?? base.target,
    targetLabel: update.targetLabel ?? base.targetLabel,
    width: update.mapRows?.[0]?.length ?? base.width,
    height: update.mapRows?.length ?? base.height,
    vehicles: update.vehicles ? mergeVehicles(base.vehicles, update.vehicles) : base.vehicles,
    terrainRules: update.terrainRules ? mergeTerrainRules(base.terrainRules, update.terrainRules) : base.terrainRules,
    notes: update.notes ? [...base.notes, ...update.notes] : base.notes,
  }

  if (!next.vehicles.some((vehicle) => vehicle.name === 'walk')) {
    next.vehicles = [{ name: 'walk', fuelPerMove: 0, foodPerMove: 2.5 }, ...next.vehicles]
  }

  return next
}

export function hasMinimumKnowledge(knowledge: KnowledgeModel): boolean {
  return (
    knowledge.mapRows.length > 0
    && typeof knowledge.width === 'number'
    && typeof knowledge.height === 'number'
    && !!knowledge.start
    && !!knowledge.target
    && knowledge.vehicles.length > 0
  )
}

export function directionFromDelta(dx: number, dy: number): Direction {
  if (dx === 1 && dy === 0) return 'right'
  if (dx === -1 && dy === 0) return 'left'
  if (dx === 0 && dy === -1) return 'up'
  return 'down'
}
