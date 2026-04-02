import { callDone, enqueueGet, getDocumentation, startServiceWindow, submitBatchConfig } from './api/client.js'
import { internalBufferMs, serviceWindowMs } from './config.js'
import { parseInputs } from './core/parsers.js'
import { buildPlan } from './core/planner.js'
import { ResultQueue } from './core/resultQueue.js'
import { signAllConfigPoints } from './core/signing.js'
import log from './logger.js'
import type { QueueItemBase } from './types.js'

function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}

function remainingMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now())
}

function assertTime(deadlineMs: number, stage: string): void {
  if (remainingMs(deadlineMs) <= 0) {
    throw new Error(`Internal deadline reached before stage: ${stage}`)
  }
}

function toConfigMap(points: Array<{ timestamp: string; pitchAngle: number; turbineMode: 'production' | 'idle'; unlockCode?: string }>): Record<string, { pitchAngle: number; turbineMode: 'production' | 'idle'; unlockCode: string }> {
  const out: Record<string, { pitchAngle: number; turbineMode: 'production' | 'idle'; unlockCode: string }> = {}

  for (const point of points) {
    if (!point.unlockCode) {
      throw new Error(`Missing unlockCode for ${point.timestamp}`)
    }

    out[point.timestamp] = {
      pitchAngle: point.pitchAngle,
      turbineMode: point.turbineMode,
      unlockCode: point.unlockCode,
    }
  }

  return out
}

async function main(): Promise<void> {
  const startedAtMs = Date.now()
  const deadlineMs = startedAtMs + serviceWindowMs - internalBufferMs

  log.info('Windpower task started', {
    serviceWindowMs,
    internalBufferMs,
    deadlineIso: new Date(deadlineMs).toISOString(),
  })

  const queue = new ResultQueue()
  await queue.start()

  try {
    let latestTurbineCheck: QueueItemBase | null = null

    assertTime(deadlineMs, 'start')
    await startServiceWindow()

    assertTime(deadlineMs, 'initial-enqueue')
    const documentationPromise = getDocumentation()
    const initialTurbineCheckPromise = queue
      .waitFor(
        (item) => item.sourceFunction === 'turbinecheck',
        Math.max(3000, remainingMs(deadlineMs)),
        'initial turbinecheck result',
      )
      .then((item) => {
        latestTurbineCheck = item as QueueItemBase
      })
      .catch(() => {
        // Ignore initial turbinecheck timeout; post-config check is still attempted.
      })

    await Promise.all([
      enqueueGet('weather'),
      enqueueGet('powerplantcheck'),
      enqueueGet('turbinecheck'),
    ])

    const documentationResponse = await documentationPromise
    const documentationJson = documentationResponse.json

    assertTime(deadlineMs, 'wait-async-results')
    const weatherResult = await queue.waitFor(
      (item) => item.sourceFunction === 'weather',
      Math.max(1000, remainingMs(deadlineMs)),
      'weather result',
    )

    const powerplantResult = await queue.waitFor(
      (item) => item.sourceFunction === 'powerplantcheck',
      Math.max(1000, remainingMs(deadlineMs)),
      'powerplantcheck result',
    )

    const parsed = parseInputs({
      documentation: documentationJson,
      weatherResult: weatherResult as QueueItemBase,
      powerplantResult: powerplantResult as QueueItemBase,
      turbineResult: {},
    })

    const plan = buildPlan(parsed)
    log.info('Plan built', {
      points: plan.configPoints.length,
      rationale: plan.rationale,
    })

    assertTime(deadlineMs, 'unlock-signing')
    const signedPoints = await signAllConfigPoints({
      queue,
      points: plan.configPoints,
      timeoutMs: Math.max(1000, remainingMs(deadlineMs)),
    })

    const configs = toConfigMap(signedPoints)

    assertTime(deadlineMs, 'submit-config')
    await submitBatchConfig(configs)

    assertTime(deadlineMs, 'final-turbinecheck')
    await initialTurbineCheckPromise
    try {
      await enqueueGet('turbinecheck')
      const turbineResult = await queue.waitFor(
        (item) => item.sourceFunction === 'turbinecheck',
        Math.max(2000, Math.min(8000, remainingMs(deadlineMs))),
        'post-config turbinecheck result',
      )
      latestTurbineCheck = turbineResult as QueueItemBase
      log.info('Post-config turbine check received', turbineResult)
    } catch (error: unknown) {
      if (!latestTurbineCheck) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      log.warn('Post-config turbinecheck not available in time, using latest pre-check result', { message })
    }

    assertTime(deadlineMs, 'done')
    const doneResponse = await callDone()
    const doneRaw = doneResponse.raw
    const flag = extractFlag(doneRaw)

    if (flag) {
      log.success('FLAG FOUND', { flag })
      console.log(flag)
    } else {
      log.warn('Done returned without flag', { raw: doneRaw })
      console.log(doneRaw)
    }
  } finally {
    queue.stop()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('Windpower run failed', { message })
  process.exitCode = 1
})
