import type { GameMap, Tile, Unit } from '../types.js'

export function parseCoord(coord: string): { x: number; y: number } {
  const match = coord.match(/^([A-Z]+)(\d+)$/)
  if (!match) {
    throw new Error(`Invalid coordinate format: ${coord}`)
  }
  
  const col = match[1]
  const row = parseInt(match[2], 10)
  
  let x = 0
  for (let i = 0; i < col.length; i++) {
    x = x * 26 + (col.charCodeAt(i) - 65 + 1)
  }
  x -= 1
  
  const y = row - 1
  
  return { x, y }
}

export function toCoord(x: number, y: number): string {
  let col = ''
  let n = x + 1
  while (n > 0) {
    n -= 1
    col = String.fromCharCode(65 + (n % 26)) + col
    n = Math.floor(n / 26)
  }
  return `${col}${y + 1}`
}

export function parseMap(rawMap: unknown): GameMap {
  let source: unknown = rawMap
  if (source && typeof source === 'object') {
    const wrapper = source as Record<string, unknown>
    if (wrapper.map && typeof wrapper.map === 'object') {
      source = wrapper.map
    }
  }

  const sourceObj = source && typeof source === 'object' ? (source as Record<string, unknown>) : null
  const size = typeof sourceObj?.size === 'number' && sourceObj.size > 0 ? sourceObj.size : 11

  const map: GameMap = {
    width: size,
    height: size,
    tiles: [],
    roads: [],
    buildings: [],
    candidates: [],
  }

  for (let y = 0; y < size; y++) {
    map.tiles[y] = []
    for (let x = 0; x < size; x++) {
      const coord = toCoord(x, y)
      const tile: Tile = {
        x,
        y,
        coord,
        symbol: '?',
        isRoad: false,
        isBuilding: false,
        isBlocked: false,
      }
      map.tiles[y][x] = tile
    }
  }

  const applyToken = (tile: Tile, tokenRaw: string): void => {
    const token = tokenRaw.trim().toLowerCase()
    if (!token) return

    const key = token.toLowerCase()

    const tileTypeMap: Record<string, { symbol: string; isRoad: boolean; isBuilding: boolean; height?: number }> = {
      road: { symbol: 'UL', isRoad: true, isBuilding: false },
      tree: { symbol: 'DR', isRoad: false, isBuilding: false },
      house: { symbol: 'DM', isRoad: false, isBuilding: true, height: 1 },
      empty: { symbol: '  ', isRoad: false, isBuilding: false },
      block1: { symbol: 'B1', isRoad: false, isBuilding: true, height: 2 },
      block2: { symbol: 'B2', isRoad: false, isBuilding: true, height: 2 },
      block3: { symbol: 'B3', isRoad: false, isBuilding: true, height: 2 },
      church: { symbol: 'KS', isRoad: false, isBuilding: true, height: 1 },
      school: { symbol: 'SZ', isRoad: false, isBuilding: true, height: 1 },
      parking: { symbol: 'PK', isRoad: false, isBuilding: false },
      field: { symbol: 'BS', isRoad: false, isBuilding: false },
    }

    const typeInfo = tileTypeMap[key]
    if (typeInfo) {
      tile.symbol = typeInfo.symbol
      tile.isRoad = typeInfo.isRoad
      tile.isBuilding = typeInfo.isBuilding
      if (typeInfo.height) tile.height = typeInfo.height

      if (tile.isRoad && !map.roads.includes(tile)) map.roads.push(tile)
      if (tile.isBuilding && !map.buildings.includes(tile)) map.buildings.push(tile)
      if (tile.isBuilding && (tile.height || 0) >= 2 && !map.candidates.includes(tile)) {
        map.candidates.push(tile)
      }
      return
    }

    tile.symbol = tokenRaw.trim()

    const upper = token.toUpperCase()
    if (upper === '=' || upper === '-' || upper === '|' || upper === 'UL' || upper === 'ROAD' || upper === 'R') {
      tile.isRoad = true
      if (!map.roads.includes(tile)) map.roads.push(tile)
      return
    }

    if (upper === 'H' || upper === '#' || upper === 'BH' || upper === 'HIGH' || upper === 'HIGH-RISE') {
      tile.isBuilding = true
      tile.height = 3
      if (!map.buildings.includes(tile)) map.buildings.push(tile)
      if (!map.candidates.includes(tile)) map.candidates.push(tile)
      return
    }

    if (upper === 'B' || upper === 'BL' || upper === 'BD' || upper === 'BLOCK' || upper === 'BUILDING') {
      tile.isBuilding = true
      tile.height = 2
      if (!map.buildings.includes(tile)) map.buildings.push(tile)
      if (!map.candidates.includes(tile)) map.candidates.push(tile)
      return
    }

    if (upper === 'X' || upper === '*') {
      tile.isBlocked = true
      return
    }

    if (/^[A-Z]\d?$/.test(upper)) {
      tile.isBuilding = true
      tile.height = 2
      if (!map.buildings.includes(tile)) map.buildings.push(tile)
      if (!map.candidates.includes(tile)) map.candidates.push(tile)
    }
  }

  if (typeof source === 'string') {
    const lines = source.split('\n').filter((l) => l.trim())
    for (let y = 0; y < Math.min(lines.length, size); y++) {
      const line = lines[y]
      const tokens = line.includes(' ') ? line.trim().split(/\s+/) : line.split('')
      for (let x = 0; x < Math.min(tokens.length, size); x++) {
        const symbol = tokens[x]
        const tile = map.tiles[y][x]
        applyToken(tile, symbol)
      }
    }
  } else if (source && typeof source === 'object') {
    const obj = source as Record<string, unknown>

    if (Array.isArray(obj.map)) {
      for (let y = 0; y < Math.min(obj.map.length, size); y++) {
        const row = obj.map[y]
        if (typeof row === 'string') {
          const tokens = row.includes(' ') ? row.trim().split(/\s+/) : row.split('')
          for (let x = 0; x < Math.min(tokens.length, size); x++) {
            applyToken(map.tiles[y][x], tokens[x])
          }
        } else if (Array.isArray(row)) {
          for (let x = 0; x < Math.min(row.length, size); x++) {
            const cell = row[x]
            if (typeof cell === 'string') {
              applyToken(map.tiles[y][x], cell)
            }
          }
        }
      }
    }
    
    if (Array.isArray(obj.grid)) {
      for (let y = 0; y < Math.min(obj.grid.length, 11); y++) {
        const row = obj.grid[y]
        if (Array.isArray(row)) {
          for (let x = 0; x < Math.min(row.length, 11); x++) {
            const cell = row[x]
            const tile = map.tiles[y][x]
            
            if (typeof cell === 'string') {
              applyToken(tile, cell)
            } else if (cell && typeof cell === 'object') {
              const cellObj = cell as Record<string, unknown>
              tile.symbol = typeof cellObj.symbol === 'string' ? cellObj.symbol : '?'
              tile.isRoad = !!cellObj.isRoad
              tile.isBuilding = !!cellObj.isBuilding
              tile.isBlocked = !!cellObj.isBlocked
              if (typeof cellObj.height === 'number') {
                tile.height = cellObj.height
              }
            }
            
            if (tile.isRoad && !map.roads.includes(tile)) map.roads.push(tile)
            if (tile.isBuilding && !map.buildings.includes(tile)) map.buildings.push(tile)
            if (tile.isBuilding && (tile.height || 0) >= 2 && !map.candidates.includes(tile)) {
              map.candidates.push(tile)
            }
          }
        }
      }
    }
    
    if (Array.isArray(obj.roads)) {
      for (const road of obj.roads) {
        if (typeof road === 'string') {
          try {
            const { x, y } = parseCoord(road)
            const tile = map.tiles[y]?.[x]
            if (tile) {
              tile.isRoad = true
              if (!map.roads.includes(tile)) {
                map.roads.push(tile)
              }
            }
          } catch {
            // ignore invalid coord
          }
        }
      }
    }
    
    if (Array.isArray(obj.buildings)) {
      for (const b of obj.buildings) {
        if (typeof b === 'string') {
          try {
            const { x, y } = parseCoord(b)
            const tile = map.tiles[y]?.[x]
            if (tile) {
              tile.isBuilding = true
              if (!map.buildings.includes(tile)) {
                map.buildings.push(tile)
              }
            }
          } catch {
            // ignore
          }
        } else if (b && typeof b === 'object') {
          const bobj = b as Record<string, unknown>
          const coord = typeof bobj.coord === 'string' ? bobj.coord : ''
          if (coord) {
            try {
              const { x, y } = parseCoord(coord)
              const tile = map.tiles[y]?.[x]
              if (tile) {
                tile.isBuilding = true
                tile.height = typeof bobj.height === 'number' ? bobj.height : undefined
                if (!map.buildings.includes(tile)) {
                  map.buildings.push(tile)
                }
                if ((tile.height || 0) >= 2 && !map.candidates.includes(tile)) {
                  map.candidates.push(tile)
                }
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  }

  return map
}

export function getTile(map: GameMap, x: number, y: number): Tile | null {
  if (y >= 0 && y < map.height && x >= 0 && x < map.width) {
    return map.tiles[y][x]
  }
  return null
}

export function getTileByCoord(map: GameMap, coord: string): Tile | null {
  try {
    const { x, y } = parseCoord(coord)
    return getTile(map, x, y)
  } catch {
    return null
  }
}

export function getOrthogonalNeighbors(map: GameMap, x: number, y: number): Tile[] {
  return [
    getTile(map, x + 1, y),
    getTile(map, x - 1, y),
    getTile(map, x, y + 1),
    getTile(map, x, y - 1),
  ].filter((tile): tile is Tile => !!tile)
}

export function getAdjacentBuildingTiles(map: GameMap, x: number, y: number): Tile[] {
  return getOrthogonalNeighbors(map, x, y).filter((tile) => tile.isBuilding && !tile.isBlocked)
}

export function findNearestRoad(map: GameMap, x: number, y: number): Tile | null {
  if (map.roads.length === 0) return null
  
  let nearest: Tile | null = null
  let minDist = Infinity
  
  for (const road of map.roads) {
    const dist = Math.abs(road.x - x) + Math.abs(road.y - y)
    if (dist < minDist) {
      minDist = dist
      nearest = road
    }
  }
  
  return nearest
}

export function isValidRoadPath(map: GameMap, fromX: number, fromY: number, toX: number, toY: number): boolean {
  return shortestRoadDistance(map, fromX, fromY, toX, toY) !== null
}

export function shortestRoadDistance(map: GameMap, fromX: number, fromY: number, toX: number, toY: number): number | null {
  const start = getTile(map, fromX, fromY)
  const end = getTile(map, toX, toY)
  
  if (!start || !end) return null
  if (!start.isRoad || !end.isRoad) return null
  if (fromX === toX && fromY === toY) return 0
  
  const visited = new Set<string>()
  const queue: Array<{ x: number; y: number; distance: number }> = [{ x: fromX, y: fromY, distance: 0 }]
  
  while (queue.length > 0) {
    const current = queue.shift()!
    const key = `${current.x},${current.y}`
    
    if (visited.has(key)) continue
    visited.add(key)
    
    if (current.x === toX && current.y === toY) {
      return current.distance
    }
    
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ]
    
    for (const n of neighbors) {
      const tile = getTile(map, n.x, n.y)
      if (tile && tile.isRoad) {
        queue.push({ x: n.x, y: n.y, distance: current.distance + 1 })
      }
    }
  }
  
  return null
}

export function manhattanDistance(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.abs(toX - fromX) + Math.abs(toY - fromY)
}

export function shortestBuildingDistance(map: GameMap, fromCoord: string, toCoord: string): number | null {
  const start = getTileByCoord(map, fromCoord)
  const end = getTileByCoord(map, toCoord)

  if (!start || !end || !start.isBuilding || !end.isBuilding || start.isBlocked || end.isBlocked) {
    return null
  }
  if (start.coord === end.coord) {
    return 0
  }

  const visited = new Set<string>()
  const queue: Array<{ tile: Tile; distance: number }> = [{ tile: start, distance: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.tile.coord)) {
      continue
    }

    visited.add(current.tile.coord)
    if (current.tile.coord === end.coord) {
      return current.distance
    }

    for (const neighbor of getOrthogonalNeighbors(map, current.tile.x, current.tile.y)) {
      if (!neighbor.isBuilding || neighbor.isBlocked || visited.has(neighbor.coord)) {
        continue
      }
      queue.push({ tile: neighbor, distance: current.distance + 1 })
    }
  }

  return null
}

export function getConnectedBuildingCoords(map: GameMap, coord: string): string[] {
  const start = getTileByCoord(map, coord)
  if (!start || !start.isBuilding) {
    return []
  }

  const visited = new Set<string>()
  const queue: Tile[] = [start]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.coord)) {
      continue
    }

    visited.add(current.coord)

    for (const neighbor of getOrthogonalNeighbors(map, current.x, current.y)) {
      if (neighbor && neighbor.isBuilding && !visited.has(neighbor.coord)) {
        queue.push(neighbor)
      }
    }
  }

  return Array.from(visited).sort((a, b) => a.localeCompare(b))
}

function tilePreviewSymbol(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase()
  if (trimmed === 'UL' || trimmed === '=' || trimmed === '-' || trimmed === '|') return ' ='
  if (trimmed === 'H' || trimmed === 'BH' || trimmed === 'HIGH') return ' H'
  if (trimmed.startsWith('B')) return ' B'
  if (trimmed === 'DR' || trimmed === 'TREE' || trimmed === 'T') return ' T'
  if (trimmed === 'DM' || trimmed === 'HOUSE') return ' D'
  if (trimmed === 'SZ' || trimmed === 'SCHOOL') return ' S'
  if (trimmed === 'KS' || trimmed === 'CHURCH') return ' K'
  if (trimmed === 'PK' || trimmed === 'PARKING') return ' P'
  if (trimmed === 'BS' || trimmed === 'FIELD') return ' F'
  if (trimmed === 'X' || trimmed === '*') return ' X'
  if (!trimmed) return ' .'
  return ` ${trimmed[0]}`
}

function unitPreviewSymbol(units: Unit[]): string | null {
  if (units.length === 0) {
    return null
  }

  const transporters = units.filter((unit) => unit.type === 'transporter').length
  const scouts = units.filter((unit) => unit.type === 'scout').length

  if (transporters > 0 && scouts > 0) {
    return 'TS'
  }

  if (transporters > 0) {
    return 'TR'
  }

  if (scouts > 0) {
    return 'SC'
  }

  return null
}

export function renderMapPreview(map: GameMap, units: Unit[] = []): string {
  const width = map.width
  const header = `    ${Array.from({ length: width }, (_, i) => String.fromCharCode(65 + i)).join('  ')}`
  const lines: string[] = [header]

  for (let y = 0; y < map.height; y++) {
    const rowLabel = String(y + 1).padStart(2, ' ')
    const row = map.tiles[y]
      .map((tile) => {
        const tileUnits = units.filter((unit) => unit.x === tile.x && unit.y === tile.y)
        return unitPreviewSymbol(tileUnits) || tilePreviewSymbol(tile.symbol || '?')
      })
      .join(' ')
    lines.push(`${rowLabel}  ${row}`)
  }

  lines.push('Legend: TR transporter, SC scout, TS transporter + scout, = road, H high-rise, B block (B1/B2/B3), T tree, D house, S school, K church, P parking, F field, . empty, X blocked')
  return lines.join('\n')
}
