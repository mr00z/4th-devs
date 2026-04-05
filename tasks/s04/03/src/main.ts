import { runAgent } from './agent.js'
import { extractFlag, reset } from './api/client.js'
import { heartbeatIntervalMs, maxRuntimeMs } from './config.js'
import log from './logger.js'

async function main(): Promise<void> {
  log.info('S04E03 Domatowo agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', {
      elapsedMs: Date.now() - startedAt,
      runtimeBudgetMs: maxRuntimeMs,
      logFile: log.filePath,
    })
  }, Math.max(3000, heartbeatIntervalMs))
  ticker.unref()

  try {
    const resetResult = await reset()
    log.info('Reset board state on startup', { ok: resetResult.ok })

    const result = await runAgent()
    const flag = extractFlag(result) || result

    if (flag.includes('{FLG:')) {
      log.success('FLAG FOUND', { flag })
      console.log(flag)
    } else {
      log.warn('Agent completed without flag', { result: String(result).slice(0, 500) })
      console.log(result)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Agent failed', { message })
    process.exitCode = 1
  } finally {
    clearInterval(ticker)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('Unexpected error', { message })
  process.exitCode = 1
})
