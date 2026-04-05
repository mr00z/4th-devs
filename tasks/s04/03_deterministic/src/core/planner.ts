import type { GameMap, CandidateTile, Tile, Unit } from '../types.js'
import { findNearestRoad, getConnectedBuildingCoords, getTile, manhattanDistance, shortestBuildingDistance } from './map.js'
import { estimateScoutWalkCost, estimateTransporterCost, estimateTransporterDriveCost } from './missionState.js'

interface CandidateScore {
  tile: Tile
  score: number
  reasons: string[]
}

function scoreTiles(map: GameMap, tiles: Tile[]): CandidateScore[] {
  const scored: CandidateScore[] = []

  for (const tile of tiles) {
    const score: CandidateScore = {
      tile,
      score: 0,
      reasons: [],
    }
    
    if (tile.height) {
      score.score += tile.height * 10
      score.reasons.push(`height ${tile.height}`)
    }
    
    const nearestRoad = findNearestRoad(map, tile.x, tile.y)
    if (nearestRoad) {
      const distToRoad = manhattanDistance(tile.x, tile.y, nearestRoad.x, nearestRoad.y)
      if (distToRoad === 0) {
        score.score += 15
        score.reasons.push('adjacent to road')
      } else if (distToRoad === 1) {
        score.score += 10
        score.reasons.push('1 step from road')
      } else if (distToRoad <= 2) {
        score.score += 5
        score.reasons.push('2 steps from road')
      } else {
        score.score -= distToRoad * 2
        score.reasons.push(`${distToRoad} steps from road`)
      }
    } else {
      score.score -= 20
      score.reasons.push('no road access')
    }
    
    const centerX = Math.floor(map.width / 2)
    const centerY = Math.floor(map.height / 2)
    const distFromCenter = manhattanDistance(tile.x, tile.y, centerX, centerY)
    if (distFromCenter <= 3) {
      score.score += 8
      score.reasons.push('near city center')
    }
    
    let nearbyCandidates = 0
    for (const other of tiles) {
      if (other === tile) continue
      const dist = manhattanDistance(tile.x, tile.y, other.x, other.y)
      if (dist <= 2) nearbyCandidates++
    }
    if (nearbyCandidates >= 2) {
      score.score += 5
      score.reasons.push('building cluster')
    }
    
    scored.push(score)
  }

  scored.sort((a, b) => b.score - a.score)
  return scored
}

export interface RoadClusterPlan {
  roadCoord: string | null
  roadX: number | null
  roadY: number | null
  candidateCoords: string[]
  maxRoadDistance: number | null
  totalScore: number
  candidateCount: number
}

export interface ClusterDeploymentPlan extends RoadClusterPlan {
  assignedCandidates: string[]
  newCoverageCount: number
}

export interface BuildingInsertionPlan {
  roadCoord: string
  spawnCoords: string[]
  coveredCandidates: string[]
  directCoverageCount: number
  reachableCoverageCount: number
  estimatedWalkCost: number
}

export interface InspectionStagingPlan {
  mode: 'reuse_free_scout' | 'dismount_transporter_scout'
  stagingCoord: string
  distance: number
  estimatedCost: number
  scoutId?: string
}

function getPredictedDismountSpawnTiles(map: GameMap, road: Tile): Tile[] {
  return [
    getTile(map, road.x, road.y - 1),
    getTile(map, road.x + 1, road.y),
    getTile(map, road.x, road.y + 1),
    getTile(map, road.x - 1, road.y),
  ].filter((tile): tile is Tile => !!tile && !tile.isBlocked)
}

export function rankCandidates(map: GameMap, clue: string): CandidateTile[] {
  void clue
  return scoreTiles(map, map.candidates).map((c) => ({
    tile: c.tile,
    score: c.score,
    reasons: c.reasons,
    inspected: false,
  }))
}

export function rankAllBuildings(map: GameMap): CandidateTile[] {
  return scoreTiles(map, map.buildings).map((entry) => ({
    tile: entry.tile,
    score: entry.score,
    reasons: entry.reasons,
    inspected: false,
  }))
}

export function clusterCandidates(candidates: CandidateTile[], maxClusterDistance: number = 3): CandidateTile[][] {
  const clusters: CandidateTile[][] = []
  const assigned = new Set<string>()
  
  for (const candidate of candidates) {
    if (assigned.has(candidate.tile.coord)) continue
    
    const cluster: CandidateTile[] = [candidate]
    assigned.add(candidate.tile.coord)
    
    for (const other of candidates) {
      if (assigned.has(other.tile.coord)) continue
      
      const dist = manhattanDistance(
        candidate.tile.x,
        candidate.tile.y,
        other.tile.x,
        other.tile.y
      )
      
      if (dist <= maxClusterDistance) {
        cluster.push(other)
        assigned.add(other.tile.coord)
      }
    }
    
    clusters.push(cluster)
  }
  
  return clusters
}

export function calculateSearchPlan(
  candidates: CandidateTile[],
  map: GameMap,
  startX: number,
  startY: number
): {
  transporterCost: number
  scoutWalkCost: number
  totalInspectCost: number
  estimatedTotal: number
} {
  let transporterCost = 0
  let scoutWalkCost = 0
  let totalInspectCost = 0
  
  // Assume 1 transporter with 2 scouts
  transporterCost = estimateTransporterCost(2)
  
  const clusters = clusterCandidates(candidates)
  let currentX = startX
  let currentY = startY
  
  for (const cluster of clusters.slice(0, 3)) {
    // Find nearest road to cluster center
    const centerTile = cluster[0].tile
    const nearestRoad = findNearestRoad(map, centerTile.x, centerTile.y)
    
    if (nearestRoad) {
      const driveDist = manhattanDistance(currentX, currentY, nearestRoad.x, nearestRoad.y)
      transporterCost += estimateTransporterDriveCost(driveDist)
      
      for (const c of cluster) {
        const walkDist = manhattanDistance(nearestRoad.x, nearestRoad.y, c.tile.x, c.tile.y)
        scoutWalkCost = Math.max(scoutWalkCost, estimateScoutWalkCost(walkDist))
        totalInspectCost += 1 // inspect cost
      }
      
      currentX = nearestRoad.x
      currentY = nearestRoad.y
    }
  }
  
  return {
    transporterCost,
    scoutWalkCost,
    totalInspectCost,
    estimatedTotal: transporterCost + scoutWalkCost + totalInspectCost + 20, // buffer
  }
}

export function recommendUnitComposition(
  candidates: CandidateTile[],
  map: GameMap,
  availableAP: number
): {
  transporters: number
  scouts: number
  passengers: number
  estimatedCost: number
  rationale: string
} {
  const clusters = clusterCandidates(candidates)
  const topClusterSize = clusters[0]?.length || 0
  
  // Conservative: 1 transporter + 2 scouts
  let transporters = 1
  let scouts = Math.min(2, topClusterSize)
  
  // If we have many candidates in different areas, consider 2 transporters
  if (clusters.length >= 2 && clusters[1].length >= 2) {
    const costWith2 = estimateTransporterCost(2) * 2
    if (costWith2 < availableAP * 0.3) {
      transporters = 2
      scouts = 4
    }
  }
  
  const estimatedCost = estimateTransporterCost(scouts / transporters) * transporters
  
  return {
    transporters,
    scouts,
    passengers: scouts / transporters,
    estimatedCost,
    rationale: `${transporters} transporter(s) with ${scouts} total scouts to cover ${clusters.length} cluster(s)`,
  }
}

export function summarizeRoadClusters(
  candidates: CandidateTile[],
  map: GameMap,
  maxScoutMoveDistance: number
): RoadClusterPlan[] {
  const grouped = new Map<string, RoadClusterPlan>()

  for (const road of map.roads) {
    const covered = candidates
      .map((candidate) => ({
        candidate,
        distance: manhattanDistance(candidate.tile.x, candidate.tile.y, road.x, road.y),
      }))
      .filter(({ distance }) => distance <= maxScoutMoveDistance)

    if (covered.length === 0) {
      continue
    }

    const candidateCoords = covered
      .map(({ candidate }) => candidate.tile.coord)
      .sort((a, b) => a.localeCompare(b))
    const key = candidateCoords.join('|')
    const cluster: RoadClusterPlan = {
      roadCoord: road.coord,
      roadX: road.x,
      roadY: road.y,
      candidateCoords,
      maxRoadDistance: covered.reduce((max, entry) => Math.max(max, entry.distance), 0),
      totalScore: covered.reduce((sum, entry) => sum + entry.candidate.score, 0),
      candidateCount: covered.length,
    }

    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, cluster)
      continue
    }

    const existingMax = existing.maxRoadDistance ?? Number.POSITIVE_INFINITY
    const clusterMax = cluster.maxRoadDistance ?? Number.POSITIVE_INFINITY
    if (cluster.candidateCount > existing.candidateCount
      || (cluster.candidateCount === existing.candidateCount && clusterMax < existingMax)
      || (cluster.candidateCount === existing.candidateCount && clusterMax === existingMax && cluster.totalScore > existing.totalScore)
    ) {
      grouped.set(key, cluster)
    }
  }

  const clusters = Array.from(grouped.values())
    .sort((a, b) => {
      const aMoveFriendly = a.maxRoadDistance !== null && a.maxRoadDistance <= maxScoutMoveDistance ? 1 : 0
      const bMoveFriendly = b.maxRoadDistance !== null && b.maxRoadDistance <= maxScoutMoveDistance ? 1 : 0
      if (aMoveFriendly !== bMoveFriendly) {
        return bMoveFriendly - aMoveFriendly
      }
      if (a.candidateCount !== b.candidateCount) {
        return b.candidateCount - a.candidateCount
      }
      if (a.totalScore !== b.totalScore) {
        return b.totalScore - a.totalScore
      }
      return (a.roadCoord || '').localeCompare(b.roadCoord || '')
    })

  return clusters
}

export function chooseInspectionStagingPlan(args: {
  map: GameMap
  targetCoord: string
  freeScouts: Unit[]
  transporter?: Unit
  maxScoutMoveDistance?: number
}): InspectionStagingPlan | null {
  const targetTile = args.map ? args.map.tiles.flat().find((tile) => tile.coord === args.targetCoord) : null
  if (!targetTile) {
    return null
  }

  const adjacentInspectionCoords = [
    { x: targetTile.x, y: targetTile.y },
    { x: targetTile.x + 1, y: targetTile.y },
    { x: targetTile.x - 1, y: targetTile.y },
    { x: targetTile.x, y: targetTile.y + 1 },
    { x: targetTile.x, y: targetTile.y - 1 },
  ]
    .map((position) => args.map.tiles[position.y]?.[position.x] || null)
    .filter((tile): tile is Tile => !!tile)
    .filter((tile) => !tile.isBlocked)

  if (adjacentInspectionCoords.length === 0) {
    return null
  }

  const options: InspectionStagingPlan[] = []

  for (const scout of args.freeScouts) {
    for (const tile of adjacentInspectionCoords) {
      const distance = manhattanDistance(scout.x, scout.y, tile.x, tile.y)
      options.push({
        mode: 'reuse_free_scout',
        scoutId: scout.id,
        stagingCoord: tile.coord,
        distance,
        estimatedCost: estimateScoutWalkCost(distance),
      })
    }
  }

  const transporter = args.transporter
  if (transporter && (transporter.passengers?.length || 0) > 1) {
    for (const tile of adjacentInspectionCoords) {
      const distance = manhattanDistance(transporter.x, transporter.y, tile.x, tile.y)
      options.push({
        mode: 'dismount_transporter_scout',
        stagingCoord: tile.coord,
        distance,
        estimatedCost: estimateScoutWalkCost(distance),
      })
    }
  }

  if (options.length === 0) {
    return null
  }

  const preferredLimit = args.maxScoutMoveDistance ?? Number.POSITIVE_INFINITY
  const withinPreferredLimit = options.filter((option) => option.distance <= preferredLimit)
  if (args.transporter && withinPreferredLimit.length > 0) {
    options.splice(0, options.length, ...withinPreferredLimit)
  } else if (args.transporter && Number.isFinite(preferredLimit) && withinPreferredLimit.length === 0) {
    return null
  }

  options.sort((a, b) => {
    const aWithinLimit = a.distance <= preferredLimit ? 1 : 0
    const bWithinLimit = b.distance <= preferredLimit ? 1 : 0
    if (aWithinLimit !== bWithinLimit) {
      return bWithinLimit - aWithinLimit
    }
    if (a.estimatedCost !== b.estimatedCost) {
      return a.estimatedCost - b.estimatedCost
    }
    if (a.distance !== b.distance) {
      return a.distance - b.distance
    }
    const aDirectDismount = a.mode === 'dismount_transporter_scout' && a.stagingCoord === args.targetCoord ? 1 : 0
    const bDirectDismount = b.mode === 'dismount_transporter_scout' && b.stagingCoord === args.targetCoord ? 1 : 0
    if (aDirectDismount !== bDirectDismount) {
      return bDirectDismount - aDirectDismount
    }
    if (a.mode !== b.mode) {
      return a.mode === 'reuse_free_scout' ? -1 : 1
    }
    return a.stagingCoord.localeCompare(b.stagingCoord)
  })

  return options[0] || null
}

export function chooseBuildingInsertionPlan(args: {
  map: GameMap
  roadCoord?: string
  candidateCoords: string[]
  requiredScouts: number
}): BuildingInsertionPlan | null {
  const roads = args.roadCoord
    ? args.map.roads.filter((road) => road.coord === args.roadCoord)
    : args.map.roads

  const candidateSet = new Set(args.candidateCoords)
  const plans: BuildingInsertionPlan[] = []

  for (const road of roads) {
    const spawnTiles = getPredictedDismountSpawnTiles(args.map, road).filter((tile) => tile.isBuilding)

    if (spawnTiles.length < args.requiredScouts) {
      continue
    }

    const connectedCoverage = new Set<string>()
    let estimatedWalkCost = 0

    for (const spawnTile of spawnTiles) {
      const connected = getConnectedBuildingCoords(args.map, spawnTile.coord)
      for (const coord of connected) {
        if (candidateSet.has(coord)) {
          connectedCoverage.add(coord)
        }
      }
    }

    for (const coord of connectedCoverage) {
      const bestDistance = spawnTiles
        .map((spawnTile) => shortestBuildingDistance(args.map, spawnTile.coord, coord))
        .filter((distance): distance is number => distance !== null)
        .sort((a, b) => a - b)[0]

      if (typeof bestDistance === 'number') {
        estimatedWalkCost += estimateScoutWalkCost(bestDistance)
      }
    }

    const directCoverageCount = spawnTiles.filter((tile) => candidateSet.has(tile.coord)).length
    if (connectedCoverage.size === 0) {
      continue
    }

    plans.push({
      roadCoord: road.coord,
      spawnCoords: spawnTiles.map((tile) => tile.coord),
      coveredCandidates: Array.from(connectedCoverage).sort((a, b) => a.localeCompare(b)),
      directCoverageCount,
      reachableCoverageCount: connectedCoverage.size,
      estimatedWalkCost,
    })
  }

  plans.sort((a, b) => {
    if (a.reachableCoverageCount !== b.reachableCoverageCount) {
      return b.reachableCoverageCount - a.reachableCoverageCount
    }
    if (a.directCoverageCount !== b.directCoverageCount) {
      return b.directCoverageCount - a.directCoverageCount
    }
    if (a.estimatedWalkCost !== b.estimatedWalkCost) {
      return a.estimatedWalkCost - b.estimatedWalkCost
    }
    return a.roadCoord.localeCompare(b.roadCoord)
  })

  return plans[0] || null
}

export function selectClusterDeployments(
  clusters: RoadClusterPlan[],
  maxTransporters: number
): ClusterDeploymentPlan[] {
  const selected: ClusterDeploymentPlan[] = []
  const coveredCandidates = new Set<string>()
  const usedRoadCoords = new Set<string>()

  while (selected.length < maxTransporters) {
    let best: ClusterDeploymentPlan | null = null

    for (const cluster of clusters) {
      if (!cluster.roadCoord || usedRoadCoords.has(cluster.roadCoord)) {
        continue
      }

      const assignedCandidates = cluster.candidateCoords.filter((coord) => !coveredCandidates.has(coord))
      const candidate: ClusterDeploymentPlan = {
        ...cluster,
        assignedCandidates,
        newCoverageCount: assignedCandidates.length,
      }

      if (candidate.newCoverageCount === 0) {
        continue
      }

      if (!best
        || candidate.newCoverageCount > best.newCoverageCount
        || (candidate.newCoverageCount === best.newCoverageCount && candidate.totalScore > best.totalScore)
        || (candidate.newCoverageCount === best.newCoverageCount && candidate.totalScore === best.totalScore && candidate.candidateCount > best.candidateCount)
      ) {
        best = candidate
      }
    }

    if (!best) {
      break
    }

    selected.push(best)
    usedRoadCoords.add(best.roadCoord!)
    for (const coord of best.assignedCandidates) {
      coveredCandidates.add(coord)
    }
  }

  return selected
}
