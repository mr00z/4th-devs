import log from './logger.js'
import { hasMinimumKnowledge } from './normalize.js'
import { planRoute } from './planner.js'
import { performResearch } from './research.js'
import { verifyAnswer } from './verify.js'

async function main(): Promise<void> {
  log.info('S03E05 savethem agent started')

  const researched = await performResearch()
  const { knowledge, tools, evidence } = researched

  log.info('Research completed', {
    discoveredTools: tools.length,
    evidenceCount: evidence.length,
    hasMinimumKnowledge: hasMinimumKnowledge(knowledge),
    mapSize: `${knowledge.width}x${knowledge.height}`,
    start: knowledge.start,
    target: knowledge.target,
    vehicles: knowledge.vehicles,
    terrainRules: knowledge.terrainRules,
  })

  const plan = planRoute(knowledge)
  if (!plan) {
    log.error('Planner failed to produce a route', {
      knowledgeSummary: {
        mapRows: knowledge.mapRows.length,
        start: knowledge.start,
        target: knowledge.target,
        vehicles: knowledge.vehicles,
        terrainRules: knowledge.terrainRules,
        mapPreview: knowledge.mapRows.slice(0, 5),
      },
    })

    process.exitCode = 1
    return
  }

  const answer = [plan.vehicle, ...plan.moves]
  log.success('Deterministic plan produced', {
    vehicle: plan.vehicle,
    moveCount: plan.moves.length,
    cost: plan.cost,
    answerPreview: answer.slice(0, 25),
  })

  const verify = await verifyAnswer(answer)
  log.info('Verify response', {
    status: verify.status,
    ok: verify.ok,
    rawPreview: verify.raw.slice(0, 1000),
  })

  if (verify.flag) {
    log.success('FLAG FOUND', { flag: verify.flag })
    console.log(verify.flag)
    return
  }

  console.log(verify.raw)
  process.exitCode = verify.ok ? 0 : 1
}

main().catch((error) => {
  log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
