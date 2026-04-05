import OpenAI from 'openai'
import { aiApiKey, chatApiBaseUrl, chatModel, extraApiHeaders, heartbeatIntervalMs, maxRuntimeMs } from './config.js'
import log from './logger.js'
import { createInitialContext, findTool } from './tools.js'
import type { AgentContext, LogEvent, Unit } from './types.js'
import * as stateCore from './core/missionState.js'
import * as mapCore from './core/map.js'
import * as planner from './core/planner.js'
import * as logAnalysis from './core/logAnalysis.js'

const openai = aiApiKey
  ? new OpenAI({
    apiKey: aiApiKey,
    baseURL: chatApiBaseUrl,
    defaultHeaders: extraApiHeaders,
  })
  : null

type ToolJson = Record<string, unknown>

interface LogInterpretation {
  confirmed: boolean
  coord: string | null
  confidence: 'low' | 'medium' | 'high'
  rationale: string
}

interface ActiveTransporterPlan {
  transporterId: string
  roadCoord: string
  candidateCoords: string[]
  scoutIds: string[]
}

interface CandidateInspectionScore {
  coord: string
  estimatedCost: number
  estimatedDistance: number
  scoutId: string
  needsMove: boolean
}

function isSpawnLaneCoord(coord: string): boolean {
  return /^[A-D]6$/i.test(coord)
}

async function parkTransporterFromSpawnLane(
  ctx: AgentContext,
  transporterId: string,
  destinationCoord: string
): Promise<void> {
  const transporter = stateCore.getUnit(ctx.state, transporterId)
  if (!transporter || transporter.type !== 'transporter') {
    return
  }

  const fromCoord = mapCore.toCoord(transporter.x, transporter.y)
  if (!isSpawnLaneCoord(fromCoord)) {
    return
  }

  const moveResult = await callTool(ctx, 'move_transporter', {
    unitId: transporterId,
    where: destinationCoord,
  })

  if (moveResult.ok === true || moveResult.info !== undefined) {
    log.info('Parked last deployment transporter away from spawn lane', {
      transporterId,
      from: fromCoord,
      to: destinationCoord,
    })
    return
  }

  log.warn('Could not park last deployment transporter away from spawn lane', {
    transporterId,
    from: fromCoord,
    to: destinationCoord,
    moveResult,
  })
}

function addFallbackBuildingTargets(ctx: AgentContext): number {
  if (!ctx.map) {
    return 0
  }

  const existing = new Set(stateCore.getCandidateTiles(ctx.state).map((candidate) => candidate.tile.coord))
  let added = 0

  for (const building of planner.rankAllBuildings(ctx.map)) {
    if (existing.has(building.tile.coord)) {
      continue
    }

    stateCore.addCandidateTile(ctx.state, building)
    existing.add(building.tile.coord)
    added += 1
  }

  if (added > 0) {
    log.info('Expanded search to all mapped buildings', {
      added,
      searchableBuildings: ctx.map.buildings.length,
      totalSearchTargets: stateCore.getCandidateTiles(ctx.state).length,
    })
  }

  return added
}

async function callHelicopterForConfirmedSurvivor(ctx: AgentContext, coord: string): Promise<string> {
  stateCore.confirmSurvivor(ctx.state, coord)
  const helicopterResult = await callTool(ctx, 'call_helicopter', { coord })
  if (typeof helicopterResult.flag === 'string' && helicopterResult.flag.includes('{FLG:')) {
    return helicopterResult.flag
  }

  if (ctx.doneFlag) {
    return ctx.doneFlag
  }

  throw new Error(`Helicopter call did not return a flag: ${JSON.stringify(helicopterResult)}`)
}

async function callTool(ctx: AgentContext, name: string, args: Record<string, unknown> = {}): Promise<ToolJson> {
  const tool = findTool(name)
  if (!tool) {
    throw new Error(`Tool not found: ${name}`)
  }

  const raw = await tool.handler(args, ctx)
  try {
    return JSON.parse(raw) as ToolJson
  } catch {
    return { raw }
  }
}

function getClusterCandidates(ctx: AgentContext, candidateCoords: string[]): Array<{ coord: string; score: number }> {
  return candidateCoords
    .map((coord) => stateCore.getCandidateTiles(ctx.state).find((candidate) => candidate.tile.coord === coord))
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => ({ coord: candidate.tile.coord, score: candidate.score }))
}

function getFreeScouts(ctx: AgentContext): Unit[] {
  return stateCore
    .getUnitsByType(ctx.state, 'scout')
    .filter((unit) => !unit.parentTransporter)
}

async function dismountScoutsIntoDeployment(
  ctx: AgentContext,
  transporterId: string,
  insertionPlan: planner.BuildingInsertionPlan,
  requiredScouts: number
): Promise<{ scoutIds: string[]; roadCoord: string }> {
  if (!ctx.map) {
    throw new Error('Map not loaded')
  }

  const transporter = stateCore.getUnit(ctx.state, transporterId)
  if (!transporter || transporter.type !== 'transporter') {
    throw new Error(`Transporter ${transporterId} not available`)
  }

  const onboard = transporter.passengers?.length || 0
  if (onboard < requiredScouts) {
    throw new Error(`Transporter ${transporterId} does not have ${requiredScouts} scouts available to dismount`)
  }

  const currentCoord = mapCore.toCoord(transporter.x, transporter.y)
  if (currentCoord !== insertionPlan.roadCoord) {
    const moveResult = await callTool(ctx, 'move_transporter', {
      unitId: transporterId,
      where: insertionPlan.roadCoord,
    })
    if (moveResult.ok !== true && moveResult.info === undefined) {
      throw new Error(`Failed to move transporter ${transporterId} to ${insertionPlan.roadCoord}: ${JSON.stringify(moveResult)}`)
    }
  }

  const freeScoutIdsBefore = new Set(getFreeScouts(ctx).map((scout) => scout.id))
  const result = await callTool(ctx, 'dismount', { object: transporterId, passengers: requiredScouts })
  if (result.ok !== true) {
    throw new Error(`Failed to dismount scouts: ${JSON.stringify(result)}`)
  }
  const dismountedScouts = getFreeScouts(ctx)
    .filter((scout) => !freeScoutIdsBefore.has(scout.id))
    .map((scout) => scout.id)
    .sort((a, b) => a.localeCompare(b))

  if (dismountedScouts.length === 0) {
    log.warn('Dismount produced no free scouts; treating deployment as unusable', {
      transporterId,
      requestedScouts: requiredScouts,
      result,
    })
    return {
      scoutIds: [],
      roadCoord: insertionPlan.roadCoord,
    }
  }
  if (dismountedScouts.length < requiredScouts) {
    log.warn('Partial deployment after dismount', {
      transporterId,
      requestedScouts: requiredScouts,
      deployedScouts: dismountedScouts.length,
      result,
    })
  }

  log.info('Scouts deployed', {
    transporterId,
    roadCoord: insertionPlan.roadCoord,
    scoutIds: dismountedScouts,
    spawnCoords: dismountedScouts.map((scoutId) => {
      const scout = stateCore.getUnit(ctx.state, scoutId)
      return scout ? mapCore.toCoord(scout.x, scout.y) : null
    }),
    candidateCoords: insertionPlan.coveredCandidates,
  })

  return {
    scoutIds: dismountedScouts,
    roadCoord: insertionPlan.roadCoord,
  }
}

function resolveDeploymentInsertionPlan(
  ctx: AgentContext,
  candidateCoords: string[],
  maxScouts: number,
  preferredRoadCoord?: string
): { insertionPlan: planner.BuildingInsertionPlan; scoutCount: number } | null {
  if (!ctx.map) {
    return null
  }

  for (let scoutCount = maxScouts; scoutCount >= 1; scoutCount--) {
    if (preferredRoadCoord) {
      const preferredPlan = planner.chooseBuildingInsertionPlan({
        map: ctx.map,
        roadCoord: preferredRoadCoord,
        candidateCoords,
        requiredScouts: scoutCount,
      })
      if (preferredPlan) {
        return { insertionPlan: preferredPlan, scoutCount }
      }
    }

    const fallbackPlan = planner.chooseBuildingInsertionPlan({
      map: ctx.map,
      candidateCoords,
      requiredScouts: scoutCount,
    })
    if (fallbackPlan) {
      return { insertionPlan: fallbackPlan, scoutCount }
    }
  }

  return null
}

function scoreCandidateForScouts(ctx: AgentContext, scoutIds: string[], coord: string): CandidateInspectionScore | null {
  if (!ctx.map) {
    return null
  }

  const targetTile = mapCore.getTileByCoord(ctx.map, coord)
  if (!targetTile?.isBuilding) {
    return null
  }

  const scored = scoutIds
    .map((scoutId) => {
      const scout = stateCore.getUnit(ctx.state, scoutId)
      if (!scout || scout.type !== 'scout' || scout.parentTransporter) {
        return null
      }

      const scoutCoord = mapCore.toCoord(scout.x, scout.y)
      const immediateInspection = mapCore.manhattanDistance(scout.x, scout.y, targetTile.x, targetTile.y) === 0
      if (immediateInspection) {
        return {
          coord,
          scoutId,
          estimatedCost: 0,
          estimatedDistance: 0,
          needsMove: false,
        }
      }

      const buildingDistance = mapCore.shortestBuildingDistance(ctx.map!, scoutCoord, coord)
      if (buildingDistance === null) {
        return null
      }

      return {
        coord,
        scoutId,
        estimatedCost: stateCore.estimateScoutWalkCost(buildingDistance),
        estimatedDistance: buildingDistance,
        needsMove: buildingDistance > 0,
      }
    })
    .filter((entry): entry is CandidateInspectionScore => !!entry)
    .sort((a, b) => {
      if (a.estimatedDistance !== b.estimatedDistance) {
        return a.estimatedDistance - b.estimatedDistance
      }
      if (a.estimatedCost !== b.estimatedCost) {
        return a.estimatedCost - b.estimatedCost
      }
      return a.scoutId.localeCompare(b.scoutId)
    })

  return scored[0] || null
}

function getNextCandidateForScouts(ctx: AgentContext, scoutIds: string[], candidateCoords: string[]): string | null {
  const scored = candidateCoords
    .filter((coord) => !stateCore.isTileInspected(ctx.state, coord))
    .map((coord) => scoreCandidateForScouts(ctx, scoutIds, coord))
    .filter((entry): entry is CandidateInspectionScore => !!entry)
    .sort((a, b) => {
      if (a.estimatedDistance !== b.estimatedDistance) {
        return a.estimatedDistance - b.estimatedDistance
      }
      if (a.estimatedCost !== b.estimatedCost) {
        return a.estimatedCost - b.estimatedCost
      }
      return a.coord.localeCompare(b.coord)
    })

  return scored[0]?.coord || null
}

function getUninspectedPlanCandidates(ctx: AgentContext, plan: ActiveTransporterPlan): string[] {
  return plan.candidateCoords.filter((coord) => !stateCore.isTileInspected(ctx.state, coord))
}

async function addScoutToPlanIfNeeded(ctx: AgentContext, plan: ActiveTransporterPlan): Promise<boolean> {
  if (!ctx.map) {
    return false
  }

  const remainingCandidates = getUninspectedPlanCandidates(ctx, plan)
  if (remainingCandidates.length === 0) {
    return false
  }

  const transporter = stateCore.getUnit(ctx.state, plan.transporterId)
  if (!transporter || transporter.type !== 'transporter' || (transporter.passengers?.length || 0) === 0) {
    return false
  }

  const insertionPlan = planner.chooseBuildingInsertionPlan({
    map: ctx.map,
    roadCoord: plan.roadCoord,
    candidateCoords: remainingCandidates,
    requiredScouts: 1,
  })
  if (!insertionPlan) {
    return false
  }

  const deployed = await dismountScoutsIntoDeployment(ctx, plan.transporterId, insertionPlan, 1)
  if (deployed.scoutIds.length === 0) {
    return false
  }

  for (const scoutId of deployed.scoutIds) {
    if (!plan.scoutIds.includes(scoutId)) {
      plan.scoutIds.push(scoutId)
    }
  }

  return true
}

async function redeployReusableTransporter(
  ctx: AgentContext,
  activePlans: ActiveTransporterPlan[],
  candidateCoords: string[],
  preferredRoadCoord: string
): Promise<ActiveTransporterPlan | null> {
  const reusablePlan = activePlans.find((plan) => {
    const transporter = stateCore.getUnit(ctx.state, plan.transporterId)
    return (
      transporter?.type === 'transporter'
      && (transporter.passengers?.length || 0) > 0
      && getUninspectedPlanCandidates(ctx, plan).length === 0
    )
  })
  if (!reusablePlan) {
    return null
  }

  const deploymentPlan = resolveDeploymentInsertionPlan(ctx, candidateCoords, 1, preferredRoadCoord)
  if (!deploymentPlan) {
    return null
  }

  const moveResult = await callTool(ctx, 'move_transporter', {
    unitId: reusablePlan.transporterId,
    where: deploymentPlan.insertionPlan.roadCoord,
  })
  if (moveResult.ok !== true && moveResult.info === undefined) {
    return null
  }

  const deployed = await dismountScoutsIntoDeployment(
    ctx,
    reusablePlan.transporterId,
    deploymentPlan.insertionPlan,
    1
  )
  if (deployed.scoutIds.length === 0) {
    return null
  }

  reusablePlan.roadCoord = deployed.roadCoord
  reusablePlan.candidateCoords = candidateCoords
  for (const scoutId of deployed.scoutIds) {
    if (!reusablePlan.scoutIds.includes(scoutId)) {
      reusablePlan.scoutIds.push(scoutId)
    }
  }

  log.info('Reused staffed transporter for a new cluster', {
    transporterId: reusablePlan.transporterId,
    roadCoord: reusablePlan.roadCoord,
    scoutIds: deployed.scoutIds,
    candidateCoords,
  })

  return reusablePlan
}

async function inspectCandidate(ctx: AgentContext, scoutIds: string[], coord: string): Promise<LogInterpretation> {
  const assignment = scoreCandidateForScouts(ctx, scoutIds, coord)
  if (!assignment) {
    throw new Error(`No building-connected scout can inspect ${coord}`)
  }

  if (assignment.needsMove) {
    const moveResult = await callTool(ctx, 'move_scout', { unitId: assignment.scoutId, where: coord })
    if (moveResult.ok !== true && moveResult.info === undefined) {
      throw new Error(`Failed to move scout ${assignment.scoutId} to ${coord}: ${JSON.stringify(moveResult)}`)
    }
  }

  const result = await callTool(ctx, 'inspect_tile', { coord, unitId: assignment.scoutId })
  if (result.ok !== true && result.info === undefined) {
    throw new Error(`Inspection failed for ${coord}: ${JSON.stringify(result)}`)
  }

  const interpretation = await confirmFromInspection(result, coord)
  log.info('Inspection result', {
    coord,
    scoutId: assignment.scoutId,
    confirmed: interpretation.confirmed,
    confidence: interpretation.confidence,
    rationale: interpretation.rationale,
  })

  return interpretation
}

function extractInspectionEvents(result: ToolJson): LogEvent[] {
  const events = result.autoLogEvents
  return Array.isArray(events) ? (events as LogEvent[]) : []
}

async function interpretLogsWithModel(events: LogEvent[], inspectedCoord: string): Promise<LogInterpretation | null> {
  if (!openai || events.length === 0) {
    return null
  }

  const prompt = [
    'You only interpret reconnaissance logs for a CTF rescue task.',
    `The scout just inspected ${inspectedCoord}.`,
    'Return strict JSON with keys: confirmed (boolean), coord (string|null), confidence ("low"|"medium"|"high"), rationale (string).',
    'Set confirmed=true only if the logs clearly indicate the survivor was found at that inspected location.',
    'If the logs are negative, ambiguous, stale, or about another location, return confirmed=false.',
    'Logs:',
    ...events.map((event) => `- ${event.coordinates || inspectedCoord}: ${event.message}`),
  ].join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: chatModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'domatowo_log_interpretation',
          strict: true,
          schema: {
            type: 'object',
            description: 'Structured interpretation of whether the latest inspection logs confirm the survivor at the inspected coordinate.',
            additionalProperties: false,
            properties: {
              confirmed: {
                type: 'boolean',
                description: 'True only when the logs clearly confirm that the survivor was found at the inspected location.',
              },
              coord: {
                type: ['string', 'null'],
                description: 'The confirmed survivor coordinate from the logs, or null when the logs do not confirm a location.',
              },
              confidence: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'Confidence in the interpretation based only on the provided logs.',
              },
              rationale: {
                type: 'string',
                description: 'Short explanation pointing to the log evidence that drove the decision.',
              },
            },
            required: ['confirmed', 'coord', 'confidence', 'rationale'],
          },
        },
      },
    })

    const content = response.choices[0]?.message?.content as unknown
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
          .map((part: unknown) => {
            if (part && typeof part === 'object' && 'text' in part) {
              const maybeText = (part as { text?: unknown }).text
              return typeof maybeText === 'string' ? maybeText : ''
            }
            return ''
          })
          .join('')
        : ''
    if (!text) {
      return null
    }

    const parsed = JSON.parse(text) as Partial<LogInterpretation>
    if (
      typeof parsed.confirmed !== 'boolean'
      || (parsed.coord !== null && typeof parsed.coord !== 'string')
      || (parsed.confidence !== 'low' && parsed.confidence !== 'medium' && parsed.confidence !== 'high')
      || typeof parsed.rationale !== 'string'
    ) {
      return null
    }

    return {
      confirmed: parsed.confirmed,
      coord: parsed.coord ?? null,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
    }
  } catch (error: unknown) {
    log.warn('LLM log interpretation failed; falling back to deterministic matching', {
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function confirmFromInspection(result: ToolJson, inspectedCoord: string): Promise<LogInterpretation> {
  const events = extractInspectionEvents(result)
  const deterministic = logAnalysis.interpretEventsDeterministically(events, inspectedCoord)
  const deterministicPositiveRationale = deterministic.positiveSignals[0] || 'Deterministic parser found a possible positive signal.'

  const llm = await interpretLogsWithModel(events, inspectedCoord)
  if (llm) {
    if (deterministic.confirmed && llm.confirmed && llm.coord) {
      return {
        confirmed: true,
        coord: llm.coord,
        confidence: llm.confidence === 'low' ? 'medium' : llm.confidence,
        rationale: `LLM-verified positive: ${llm.rationale}`,
      }
    }

    if (deterministic.confirmed && !llm.confirmed) {
      return {
        confirmed: false,
        coord: llm.coord ?? deterministic.coord,
        confidence: llm.confidence,
        rationale: `Deterministic positive rejected by LLM: ${llm.rationale}`,
      }
    }

    return llm
  }

  if (deterministic.confirmed) {
    log.warn('Deterministic positive not trusted because LLM verification was unavailable', {
      inspectedCoord,
      rationale: deterministicPositiveRationale,
    })
    return {
      confirmed: false,
      coord: deterministic.coord,
      confidence: 'low',
      rationale: `Positive signal requires LLM verification: ${deterministicPositiveRationale}`,
    }
  }

  return {
    confirmed: false,
    coord: deterministic.coord,
    confidence: deterministic.confidence,
    rationale: deterministic.negativeSignals[0] || deterministic.positiveSignals[0] || 'No confirming signal found.',
  }
}

async function createDeployment(
  ctx: AgentContext,
  candidateCoords: string[],
  requiredScouts: number,
  preferredRoadCoord?: string
): Promise<ActiveTransporterPlan | null> {
  const deploymentPlan = resolveDeploymentInsertionPlan(ctx, candidateCoords, requiredScouts, preferredRoadCoord)
  if (!deploymentPlan) {
    log.warn('Skipping deployment because no insertion plan was found', {
      candidateCoords,
      preferredRoadCoord,
      requiredScouts,
    })
    return null
  }

  const limits = stateCore.getLimits()
  const currentTransporters = stateCore.getUnitsByType(ctx.state, 'transporter').length
  const currentScouts = stateCore.getUnitsByType(ctx.state, 'scout').length
  const passengersToLoad = Math.max(deploymentPlan.scoutCount, Math.min(2, limits.maxScouts - currentScouts))
  if (currentTransporters >= limits.maxTransporters) {
    log.warn('Skipping deployment because transporter limit is reached', {
      maxTransporters: limits.maxTransporters,
      currentTransporters,
      preferredRoadCoord,
      candidateCoords,
    })
    return null
  }
  if (currentScouts + passengersToLoad > limits.maxScouts) {
    log.warn('Skipping deployment because scout limit would be exceeded', {
      maxScouts: limits.maxScouts,
      currentScouts,
      requestedScouts: passengersToLoad,
      preferredRoadCoord,
      candidateCoords,
    })
    return null
  }

  const createResult = await callTool(ctx, 'create_transporter', {
    passengers: passengersToLoad,
    allowExistingTransporters: true,
  })
  if (createResult.ok !== true || typeof createResult.unitId !== 'string') {
    log.warn('Skipping deployment because transporter creation failed', {
      candidateCoords,
      preferredRoadCoord,
      scoutCount: deploymentPlan.scoutCount,
      passengersToLoad,
      createResult,
    })
    return null
  }

  const deployed = await dismountScoutsIntoDeployment(
    ctx,
    createResult.unitId,
    deploymentPlan.insertionPlan,
    deploymentPlan.scoutCount
  )
  if (deployed.scoutIds.length === 0) {
    log.warn('Skipping deployment because no free scout was produced', {
      transporterId: createResult.unitId,
      preferredRoadCoord,
      candidateCoords,
    })
    return null
  }

  return {
    transporterId: createResult.unitId,
    roadCoord: deployed.roadCoord,
    candidateCoords,
    scoutIds: deployed.scoutIds,
  }
}

export async function runAgent(): Promise<string> {
  const ctx = createInitialContext()
  const startedAt = Date.now()
  const deadline = startedAt + maxRuntimeMs
  let inspectionsAttempted = 0
  let lastHeartbeatAt = startedAt

  const maybeLogHeartbeat = (reason: string, force: boolean = false): void => {
    const now = Date.now()
    if (!force && now - lastHeartbeatAt < heartbeatIntervalMs) {
      return
    }

    lastHeartbeatAt = now
    log.info('Search heartbeat', {
      reason,
      elapsedMs: now - startedAt,
      remainingRuntimeMs: Math.max(0, deadline - now),
      inspectionsAttempted,
      inspectedTiles: ctx.state.inspectedTiles.size,
      remainingTargets: stateCore.getUninspectedCandidates(ctx.state).length,
      actionPointsRemaining: ctx.state.actionPointsRemaining,
      transporters: stateCore.getUnitsByType(ctx.state, 'transporter').length,
      freeScouts: getFreeScouts(ctx).length,
    })
  }

  const stopIfOutOfTime = (reason: string): string | null => {
    const now = Date.now()
    if (now <= deadline) {
      return null
    }

    const summary = `Search stopped after ${maxRuntimeMs}ms runtime budget without confirming the survivor. Inspections attempted: ${inspectionsAttempted}. Remaining targets: ${stateCore.getUninspectedCandidates(ctx.state).length}. AP left: ${ctx.state.actionPointsRemaining}.`
    log.warn('Stopping search after runtime budget exhausted', {
      reason,
      elapsedMs: now - startedAt,
      inspectionsAttempted,
      remainingTargets: stateCore.getUninspectedCandidates(ctx.state).length,
      actionPointsRemaining: ctx.state.actionPointsRemaining,
    })
    return summary
  }

  await callTool(ctx, 'read_help')
  const mapResult = await callTool(ctx, 'read_map')
  if (mapResult.ok !== true || !ctx.map) {
    throw new Error(`Failed to load map: ${JSON.stringify(mapResult)}`)
  }

  const guardrails = stateCore.getGuardrails()
  const clusters = planner.summarizeRoadClusters(
    stateCore.getUninspectedCandidates(ctx.state),
    ctx.map,
    guardrails.maxScoutMoveDistanceWithTransporter
  )

  if (clusters.length === 0) {
    addFallbackBuildingTargets(ctx)
  }

  const searchableClusters = planner.summarizeRoadClusters(
    stateCore.getUninspectedCandidates(ctx.state),
    ctx.map,
    guardrails.maxScoutMoveDistanceWithTransporter
  )

  if (searchableClusters.length === 0) {
    throw new Error('No searchable road clusters were derived from the map')
  }

  const deploymentCount = Math.min(
    3,
    Math.max(1, Math.floor(ctx.state.actionPointsRemaining / stateCore.estimateTransporterCost(2)))
  )
  const deployments = planner.selectClusterDeployments(searchableClusters, deploymentCount)

  if (deployments.length === 0) {
    throw new Error('No deployment plan could be derived from the road clusters')
  }

  const activePlans: ActiveTransporterPlan[] = []

  log.info('Deterministic mission plan ready', {
    deploymentCount: deployments.length,
    passengersPerTransporter: 2,
    deployments: deployments.map((cluster) => ({
      roadCoord: cluster.roadCoord,
      assignedCandidates: cluster.assignedCandidates,
      candidateCount: cluster.candidateCount,
      newCoverageCount: cluster.newCoverageCount,
    })),
    allClusters: clusters.map((cluster) => ({
      roadCoord: cluster.roadCoord,
      candidateCoords: cluster.candidateCoords,
      candidateCount: cluster.candidateCount,
      maxRoadDistance: cluster.maxRoadDistance,
    })),
  })
  maybeLogHeartbeat('initial_plan_ready', true)

  for (const [deploymentIndex, deployment] of deployments.entries()) {
    const timeoutSummary = stopIfOutOfTime('before_initial_deployment')
    if (timeoutSummary) {
      return timeoutSummary
    }
    const plan = await createDeployment(ctx, deployment.assignedCandidates, 1, deployment.roadCoord || undefined)
    if (plan) {
      activePlans.push(plan)
      const isLastInitialDeployment = deploymentIndex === deployments.length - 1
      if (isLastInitialDeployment) {
        await parkTransporterFromSpawnLane(ctx, plan.transporterId, 'B6')
      }
    }
  }

  for (const plan of activePlans) {
    const timeoutSummary = stopIfOutOfTime('before_initial_sweep')
    if (timeoutSummary) {
      return timeoutSummary
    }

    log.info('Sweeping deployment', {
      transporterId: plan.transporterId,
      roadCoord: plan.roadCoord,
      scoutIds: plan.scoutIds,
      candidates: plan.candidateCoords,
    })

    while (true) {
      const timedOut = stopIfOutOfTime('during_initial_sweep')
      if (timedOut) {
        return timedOut
      }

      const coord = getNextCandidateForScouts(ctx, plan.scoutIds, plan.candidateCoords)
      if (!coord) {
        const addedScout = await addScoutToPlanIfNeeded(ctx, plan)
        if (addedScout) {
          continue
        }
        break
      }

      const interpretation = await inspectCandidate(ctx, plan.scoutIds, coord)
      inspectionsAttempted += 1
      maybeLogHeartbeat(`initial_inspection_${coord}`)
      if (!interpretation.confirmed || !interpretation.coord) {
        continue
      }

      return callHelicopterForConfirmedSurvivor(ctx, interpretation.coord)
    }
  }

  let fallbackExpanded = false

  while (true) {
    const timedOut = stopIfOutOfTime('before_remaining_cluster_selection')
    if (timedOut) {
      return timedOut
    }
    let progressedThisPass = false

    let remainingClusters = planner.selectClusterDeployments(
      planner.summarizeRoadClusters(
        stateCore.getUninspectedCandidates(ctx.state),
        ctx.map,
        guardrails.maxScoutMoveDistanceWithTransporter
      ),
      activePlans.length
    )

    if (remainingClusters.length === 0 && !fallbackExpanded) {
      fallbackExpanded = addFallbackBuildingTargets(ctx) > 0
      if (fallbackExpanded) {
        remainingClusters = planner.selectClusterDeployments(
          planner.summarizeRoadClusters(
            stateCore.getUninspectedCandidates(ctx.state),
            ctx.map,
            guardrails.maxScoutMoveDistanceWithTransporter
          ),
          activePlans.length
        )
      }
    }

    if (remainingClusters.length === 0) {
      break
    }

    for (const cluster of remainingClusters) {
      const clusterTimeout = stopIfOutOfTime('before_remaining_cluster_sweep')
      if (clusterTimeout) {
        return clusterTimeout
      }

      if (!cluster.roadCoord || cluster.assignedCandidates.length === 0) {
        continue
      }

      const clusterCandidates = getClusterCandidates(ctx, cluster.candidateCoords)
      let plan: ActiveTransporterPlan | null | undefined = activePlans.find((entry) =>
        getNextCandidateForScouts(ctx, entry.scoutIds, clusterCandidates.map((candidate) => candidate.coord)) !== null
      )

      if (!plan) {
        plan = await redeployReusableTransporter(
          ctx,
          activePlans,
          cluster.assignedCandidates,
          cluster.roadCoord
        )
      }

      if (!plan) {
        const limits = stateCore.getLimits()
        const canCreateAnotherTransporter = stateCore.getUnitsByType(ctx.state, 'transporter').length < limits.maxTransporters
          && stateCore.canAfford(ctx.state, stateCore.estimateTransporterCost(2))

        if (!canCreateAnotherTransporter) {
          continue
        }

        const createdPlan = await createDeployment(ctx, cluster.assignedCandidates, 1, cluster.roadCoord)
        if (!createdPlan) {
          continue
        }
        plan = createdPlan
        activePlans.push(plan)
        progressedThisPass = true
      }

      log.info('Sweeping remaining cluster', {
        transporterId: plan.transporterId,
        roadCoord: plan.roadCoord,
        scoutIds: plan.scoutIds,
        candidates: clusterCandidates.map((candidate) => candidate.coord),
      })

      while (true) {
        const sweepTimeout = stopIfOutOfTime('during_remaining_cluster_sweep')
        if (sweepTimeout) {
          return sweepTimeout
        }

        const coord = getNextCandidateForScouts(ctx, plan.scoutIds, clusterCandidates.map((candidate) => candidate.coord))
        if (!coord) {
          const addedScout = await addScoutToPlanIfNeeded(ctx, plan)
          if (addedScout) {
            continue
          }
          break
        }

        const interpretation = await inspectCandidate(ctx, plan.scoutIds, coord)
        inspectionsAttempted += 1
        progressedThisPass = true
        maybeLogHeartbeat(`remaining_inspection_${coord}`)
        if (!interpretation.confirmed || !interpretation.coord) {
          continue
        }

        return callHelicopterForConfirmedSurvivor(ctx, interpretation.coord)
      }
    }

    if (stateCore.getUninspectedCandidates(ctx.state).length === 0) {
      if (!fallbackExpanded) {
        fallbackExpanded = addFallbackBuildingTargets(ctx) > 0
        continue
      }
      break
    }

    if (!progressedThisPass) {
      log.warn('Stopping remaining-cluster sweep because no feasible plan could be built', {
        remainingClusters: remainingClusters.length,
        activeTransporters: stateCore.getUnitsByType(ctx.state, 'transporter').length,
        remainingTargets: stateCore.getUninspectedCandidates(ctx.state).length,
        actionPointsRemaining: ctx.state.actionPointsRemaining,
      })
      break
    }
  }

  if (ctx.doneFlag) {
    return ctx.doneFlag
  }

  maybeLogHeartbeat('search_completed', true)
  return 'Deterministic search finished without confirming the survivor.'
}
