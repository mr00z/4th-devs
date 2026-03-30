import { initialFood, initialFuel } from './config.js'
import { directionFromDelta } from './normalize.js'
import type { KnowledgeModel, PlanResult, Point, RouteToken, TerrainRule, VehicleRule } from './types.js'

interface DijkstraState {
  x: number
  y: number
  startVehicle: string
  vehicle: string
  hasSwitchedToWalk: boolean
  food: number
  fuel: number
  moves: RouteToken[]
  cost: number
}

type PriorityQueue = DijkstraState[]

function pqPush(queue: PriorityQueue, state: DijkstraState, target: Point): void {
  const priority = state.cost + heuristic(state, target)
  let inserted = false
  for (let i = 0; i < queue.length; i++) {
    const existingPriority = queue[i].cost + heuristic(queue[i], target)
    if (priority < existingPriority) {
      queue.splice(i, 0, state)
      inserted = true
      break
    }
  }
  if (!inserted) {
    queue.push(state)
  }
}

function pqPop(queue: PriorityQueue): DijkstraState | undefined {
  return queue.shift()
}

function heuristic(state: DijkstraState, target: Point): number {
  return Math.abs(state.x - target.x) + Math.abs(state.y - target.y)
}

function clampResource(value: number): number {
  return Math.round(value * 1000) / 1000
}

function getTerrainAt(mapRows: string[], x: number, y: number): string | null {
  if (y < 0 || y >= mapRows.length) return null
  const row = mapRows[y]
  if (x < 0 || x >= row.length) return null
  return row[x]
}

function isTerrainBlockedForVehicle(terrain: string, vehicleName: string, terrainRules: TerrainRule[]): boolean {
  const rule = terrainRules.find(r => r.symbol === terrain)
  if (!rule) return false
  return rule.blockedFor?.includes(vehicleName) ?? false
}

function canMoveTo(
  x: number,
  y: number,
  knowledge: KnowledgeModel,
  vehicleName: string
): boolean {
  if (x < 0 || y < 0 || x >= knowledge.width || y >= knowledge.height) {
    return false
  }

  const terrain = getTerrainAt(knowledge.mapRows, x, y)
  if (!terrain) return false

  if (isTerrainBlockedForVehicle(terrain, vehicleName, knowledge.terrainRules)) {
    return false
  }

  return true
}

function getVehicleConsumption(vehicleName: string, vehicles: VehicleRule[]): VehicleRule | undefined {
  return vehicles.find(v => v.name === vehicleName)
}

function transition(
  state: DijkstraState,
  dx: number,
  dy: number,
  knowledge: KnowledgeModel
): DijkstraState | null {
  const nx = state.x + dx
  const ny = state.y + dy

  // Check if move is valid
  if (!canMoveTo(nx, ny, knowledge, state.vehicle)) {
    return null
  }

  const vehicle = getVehicleConsumption(state.vehicle, knowledge.vehicles)
  if (!vehicle) return null

  const terrain = getTerrainAt(knowledge.mapRows, nx, ny)
  const terrainRule = knowledge.terrainRules.find(r => r.symbol === terrain)
  const fuelMultiplier = terrainRule?.fuelMultiplier ?? 1
  const foodMultiplier = terrainRule?.foodMultiplier ?? 1

  const nextFuel = clampResource(state.fuel - vehicle.fuelPerMove * fuelMultiplier)
  const nextFood = clampResource(state.food - vehicle.foodPerMove * foodMultiplier)

  if (nextFuel < 0 || nextFood <= 0) {
    return null
  }

  return {
    x: nx,
    y: ny,
    startVehicle: state.startVehicle,
    vehicle: state.vehicle,
    hasSwitchedToWalk: state.hasSwitchedToWalk,
    fuel: nextFuel,
    food: nextFood,
    moves: [...state.moves, directionFromDelta(dx, dy)],
    cost: state.cost + vehicle.fuelPerMove * fuelMultiplier + vehicle.foodPerMove * foodMultiplier,
  }
}

function switchToWalk(state: DijkstraState): DijkstraState | null {
  if (state.vehicle === 'walk' || state.hasSwitchedToWalk) {
    return null
  }

  return {
    ...state,
    vehicle: 'walk',
    hasSwitchedToWalk: true,
    moves: [...state.moves, 'dismount'],
  }
}

function stateKey(state: DijkstraState): string {
  return `${state.x},${state.y},${state.startVehicle},${state.vehicle},${state.hasSwitchedToWalk ? 1 : 0},${state.food},${state.fuel}`
}

const DIRS = [
  { dx: 0, dy: -1 }, // up
  { dx: 0, dy: 1 },  // down
  { dx: -1, dy: 0 }, // left
  { dx: 1, dy: 0 },  // right
]

export function planRoute(knowledge: KnowledgeModel): PlanResult | null {
  if (!knowledge.start || !knowledge.target || knowledge.mapRows.length === 0 || knowledge.vehicles.length === 0) {
    return null
  }

  // Initialize priority queue with all vehicle options at start position
  const queue: PriorityQueue = knowledge.vehicles.map(vehicle => ({
    x: knowledge.start!.x,
    y: knowledge.start!.y,
    startVehicle: vehicle.name,
    vehicle: vehicle.name,
    hasSwitchedToWalk: false,
    food: initialFood,
    fuel: initialFuel,
    moves: [],
    cost: vehicle.name === 'walk' ? 0 : 0.1,
  }))

  // Track best cost to each state
  const bestCost = new Map<string, number>()
  let bestGoal: DijkstraState | null = null

  while (queue.length > 0) {
    const current = pqPop(queue)
    if (!current) break

    const key = stateKey(current)
    const existingCost = bestCost.get(key)

    // Skip if we've already found a better path to this state
    if (existingCost !== undefined && existingCost <= current.cost) {
      continue
    }
    bestCost.set(key, current.cost)

    // Check if we reached the goal
    if (current.x === knowledge.target.x && current.y === knowledge.target.y) {
      if (!bestGoal || current.cost < bestGoal.cost) {
        bestGoal = current
      }
      continue
    }

    // Explore all 4 directions
    for (const { dx, dy } of DIRS) {
      const next = transition(current, dx, dy, knowledge)
      if (next) {
        pqPush(queue, next, knowledge.target)
      }
    }

    const switched = switchToWalk(current)
    if (switched) {
      pqPush(queue, switched, knowledge.target)
    }
  }

  if (!bestGoal) {
    return null
  }

  return {
    vehicle: bestGoal.startVehicle,
    moves: bestGoal.moves,
    cost: bestGoal.cost,
  }
}
