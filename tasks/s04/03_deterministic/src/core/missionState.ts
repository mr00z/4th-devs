import type { CandidateTile, MissionState, Unit, UnitType } from '../types.js'

const COSTS = {
  createScout: 5,
  createTransporter: 5,
  transporterPassenger: 5,
  scoutMove: 7,
  transporterMove: 1,
  inspect: 1,
}

const LIMITS = {
  maxTransporters: 4,
  maxScouts: 8,
  maxAP: 300,
}

const GUARDRAILS = {
  maxScoutMoveDistanceWithTransporter: 2,
}

export function createInitialState(): MissionState {
  return {
    actionPointsUsed: 0,
    actionPointsRemaining: LIMITS.maxAP,
    units: new Map(),
    inspectedTiles: new Set(),
    candidateTiles: new Map(),
    confirmedSurvivorTile: null,
    logsConsumed: 0,
    seenLogCounts: new Map(),
    maxAP: LIMITS.maxAP,
    scoutMoveCount: 0,
    scoutMoveApSpent: 0,
    scoutMoveDistance: 0,
  }
}

export function getCosts(): typeof COSTS {
  return { ...COSTS }
}

export function getLimits(): typeof LIMITS {
  return { ...LIMITS }
}

export function getGuardrails(): typeof GUARDRAILS {
  return { ...GUARDRAILS }
}

export function canAfford(state: MissionState, cost: number): boolean {
  return state.actionPointsRemaining >= cost
}

export function spendAP(state: MissionState, cost: number): boolean {
  if (!canAfford(state, cost)) {
    return false
  }
  state.actionPointsUsed += cost
  state.actionPointsRemaining -= cost
  return true
}

export function getAPStatus(state: MissionState): { used: number; remaining: number; max: number } {
  return {
    used: state.actionPointsUsed,
    remaining: state.actionPointsRemaining,
    max: state.maxAP,
  }
}

export function addUnit(state: MissionState, unit: Unit): boolean {
  const currentScouts = Array.from(state.units.values()).filter((u) => u.type === 'scout').length
  const currentTransporters = Array.from(state.units.values()).filter((u) => u.type === 'transporter').length
  
  if (unit.type === 'scout' && currentScouts >= LIMITS.maxScouts) {
    return false
  }
  if (unit.type === 'transporter' && currentTransporters >= LIMITS.maxTransporters) {
    return false
  }
  
  state.units.set(unit.id, unit)
  return true
}

export function getUnit(state: MissionState, id: string): Unit | undefined {
  return state.units.get(id)
}

export function getUnitsByType(state: MissionState, type: UnitType): Unit[] {
  return Array.from(state.units.values()).filter((u) => u.type === type)
}

export function updateUnitPosition(state: MissionState, id: string, x: number, y: number): boolean {
  const unit = state.units.get(id)
  if (!unit) return false
  
  unit.x = x
  unit.y = y
  return true
}

export function markTileInspected(state: MissionState, coord: string): void {
  state.inspectedTiles.add(coord)
  const candidate = state.candidateTiles.get(coord)
  if (candidate) {
    candidate.inspected = true
  }
}

export function isTileInspected(state: MissionState, coord: string): boolean {
  return state.inspectedTiles.has(coord)
}

export function addCandidateTile(state: MissionState, candidate: CandidateTile): void {
  const coord = candidate.tile.coord
  const existing = state.candidateTiles.get(coord)
  const alreadyInspected = state.inspectedTiles.has(coord) || !!existing?.inspected

  state.candidateTiles.set(coord, {
    ...candidate,
    inspected: alreadyInspected || candidate.inspected,
  })
}

export function getCandidateTiles(state: MissionState): CandidateTile[] {
  return Array.from(state.candidateTiles.values())
}

export function getUninspectedCandidates(state: MissionState): CandidateTile[] {
  return getCandidateTiles(state).filter((c) => !c.inspected)
}

export function confirmSurvivor(state: MissionState, coord: string): void {
  state.confirmedSurvivorTile = coord
}

export function isSurvivorConfirmed(state: MissionState): boolean {
  return state.confirmedSurvivorTile !== null
}

export function incrementLogsConsumed(state: MissionState, count: number): void {
  state.logsConsumed += count
}

export function setLogsConsumed(state: MissionState, count: number): void {
  state.logsConsumed = Math.max(0, count)
}

export function replaceSeenLogCounts(state: MissionState, counts: Map<string, number>): void {
  state.seenLogCounts = new Map(counts)
}

export function estimateTransporterCost(passengers: number): number {
  return COSTS.createTransporter + passengers * COSTS.transporterPassenger
}

export function estimateScoutWalkCost(distance: number): number {
  return distance * COSTS.scoutMove
}

export function estimateTransporterDriveCost(distance: number): number {
  return distance * COSTS.transporterMove
}

export function registerScoutMove(state: MissionState, distance: number, cost: number): void {
  state.scoutMoveCount += 1
  state.scoutMoveDistance += Math.max(0, distance)
  state.scoutMoveApSpent += Math.max(0, cost)
}

export function getStateSummary(state: MissionState): string {
  const scouts = getUnitsByType(state, 'scout')
  const transporters = getUnitsByType(state, 'transporter')
  const candidates = getCandidateTiles(state)
  const uninspected = getUninspectedCandidates(state)
  
  return [
    `AP: ${state.actionPointsUsed}/${state.maxAP} (${state.actionPointsRemaining} remaining)`,
    `Units: ${scouts.length} scouts, ${transporters.length} transporters`,
    `Scout walking: ${state.scoutMoveCount} moves, ${state.scoutMoveDistance} tiles, ${state.scoutMoveApSpent} AP`,
    `Inspected: ${state.inspectedTiles.size} tiles`,
    `Candidates: ${uninspected.length}/${candidates.length} uninspected`,
    `Survivor: ${state.confirmedSurvivorTile || 'not found'}`,
  ].join('\n')
}
