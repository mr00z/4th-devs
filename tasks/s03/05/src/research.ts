import { researchTurns } from './config.js'
import { analyzeResearchStep } from './ai-analyzer.js'
import { askTool, discoverTools } from './hub-client.js'
import log from './logger.js'
import { extractKnowledgeUpdate, hasMinimumKnowledge, mergeKnowledge } from './normalize.js'
import type { DiscoveredTool, KnowledgeModel, ToolEvidence } from './types.js'

const DISCOVERY_QUERIES = [
  'I need notes about movement rules and terrain',
  'I need map data including start and target city Skolwin',
  'I need vehicles and food/fuel consumption details',
]

function dedupeTools(current: DiscoveredTool[], incoming: DiscoveredTool[]): DiscoveredTool[] {
  const map = new Map(current.map((tool) => [tool.url, tool]))
  for (const tool of incoming) {
    if (!map.has(tool.url)) {
      map.set(tool.url, tool)
    }
  }
  return [...map.values()]
}

function initialKnowledge(): KnowledgeModel {
  return {
    mapRows: [],
    width: 0,
    height: 0,
    terrainRules: [],
    vehicles: [],
    notes: [],
  }
}

function recentEvidence(evidence: ToolEvidence[]): ToolEvidence[] {
  return evidence.slice(Math.max(0, evidence.length - 5))
}

function endpointKey(url: string): string {
  const trimmed = url.trim()
  try {
    return new URL(trimmed).pathname.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function endpointDefaultQuery(endpoint: string): string {
  const key = endpointKey(endpoint)
  if (key.includes('/api/maps')) {
    return 'Skolwin'
  }
  if (key.includes('/api/wehicles')) {
    return 'walk'
  }
  if (key.includes('/api/books')) {
    return 'movement'
  }
  return 'Skolwin'
}

function countRecentConsecutiveEndpointCalls(evidence: ToolEvidence[], endpoint: string, query?: string): number {
  let count = 0
  const target = endpointKey(endpoint)
  const queryLower = query?.toLowerCase().trim()
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const item = evidence[index]
    if (endpointKey(item.url).includes('/api/toolsearch')) {
      continue
    }
    if (endpointKey(item.url) === target) {
      // If query is provided and different from previous, don't count as consecutive
      const itemQueryLower = item.query?.toLowerCase().trim()
      if (queryLower && itemQueryLower && queryLower !== itemQueryLower) {
        break
      }
      count += 1
      continue
    }
    break
  }
  return count
}

function pickAlternativeEndpoint(tools: DiscoveredTool[], evidence: ToolEvidence[], blockedEndpoint: string): string | null {
  const blockedKey = endpointKey(blockedEndpoint)
  const callCountByEndpoint = new Map<string, number>()
  for (const item of evidence) {
    const key = endpointKey(item.url)
    if (key.includes('/api/toolsearch')) {
      continue
    }
    callCountByEndpoint.set(key, (callCountByEndpoint.get(key) ?? 0) + 1)
  }

  const candidates = tools
    .map((tool) => ({ tool, key: endpointKey(tool.url) }))
    .filter(({ key }) => key !== blockedKey)
    .sort((left, right) => {
      const leftCount = callCountByEndpoint.get(left.key) ?? 0
      const rightCount = callCountByEndpoint.get(right.key) ?? 0
      return leftCount - rightCount
    })

  return candidates[0]?.tool.url ?? null
}

export async function performResearch(): Promise<{
  knowledge: KnowledgeModel
  tools: DiscoveredTool[]
  evidence: ToolEvidence[]
}> {
  let knowledge = initialKnowledge()
  let tools: DiscoveredTool[] = []
  const evidence: ToolEvidence[] = []

  for (const query of DISCOVERY_QUERIES) {
    const discovered = await discoverTools(query)
    tools = dedupeTools(tools, discovered.tools)

    evidence.push({
      url: discovered.call.url,
      query,
      ok: discovered.call.ok,
      status: discovered.call.status,
      bodyText: discovered.call.bodyText,
      turn: 0,
    })

    knowledge = mergeKnowledge(knowledge, extractKnowledgeUpdate(evidence[evidence.length - 1]))
  }

  for (let turn = 1; turn <= researchTurns; turn += 1) {
    const decision = await analyzeResearchStep({
      turn,
      maxTurns: researchTurns,
      knownTools: tools,
      recentEvidence: recentEvidence(evidence),
      knowledge,
    })

    log.info('Research decision', {
      turn,
      done: decision.done,
      summary: decision.summary,
      actions: decision.actions,
    })

    const actions = decision.actions.length > 0
      ? decision.actions.slice(0, 3)
      : [{ mode: 'toolsearch' as const, query: 'Need map, rules, vehicles, Skolwin coordinates' }]

    for (const action of actions) {
      if (action.mode === 'finish_research') {
        continue
      }

      if (action.mode === 'toolsearch') {
        const query = action.query?.trim() || 'Need tools with map, movement, terrain and vehicles'
        const discovered = await discoverTools(query)
        tools = dedupeTools(tools, discovered.tools)

        const item: ToolEvidence = {
          url: discovered.call.url,
          query,
          ok: discovered.call.ok,
          status: discovered.call.status,
          bodyText: discovered.call.bodyText,
          turn,
        }

        evidence.push(item)
        knowledge = mergeKnowledge(knowledge, extractKnowledgeUpdate(item))
        continue
      }

      const endpoint = action.endpoint?.trim()
      if (!endpoint) {
        continue
      }

      let selectedEndpoint = endpoint
      let query = action.query?.trim() || endpointDefaultQuery(selectedEndpoint)

      const repeatedEndpointCalls = countRecentConsecutiveEndpointCalls(evidence, selectedEndpoint, query)
      if (repeatedEndpointCalls >= 2) {
        const alternative = pickAlternativeEndpoint(tools, evidence, selectedEndpoint)
        if (alternative) {
          log.warn('Replacing repeated endpoint with alternative', {
            repeatedEndpoint: selectedEndpoint,
            alternative,
            repeatedEndpointCalls,
          })
          selectedEndpoint = alternative
          query = endpointDefaultQuery(selectedEndpoint)
        }
      }

      const call = await askTool(selectedEndpoint, query)
      const item: ToolEvidence = {
        url: call.url,
        query,
        ok: call.ok,
        status: call.status,
        bodyText: call.bodyText,
        turn,
      }

      evidence.push(item)
      knowledge = mergeKnowledge(knowledge, extractKnowledgeUpdate(item))
    }

    if (decision.done) {
      const hasMin = hasMinimumKnowledge(knowledge)
      log.info('Research done check', {
        hasMinimumKnowledge: hasMin,
        mapRowsLength: knowledge.mapRows.length,
        width: knowledge.width,
        height: knowledge.height,
        start: knowledge.start,
        target: knowledge.target,
        vehiclesCount: knowledge.vehicles.length,
        terrainRulesCount: knowledge.terrainRules.length,
        terrainRules: knowledge.terrainRules,
      })
      if (hasMin) {
        break
      }
    }
  }

  return { knowledge, tools, evidence }
}
