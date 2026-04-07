import { heartbeatIntervalMs } from './config.js'
import log from './logger.js'
import { runAgent } from './agent.js'
import { resetOrders } from './api/client.js'

async function main(): Promise<void> {
  log.info('S04E05 Foodwarehouse agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', {
      elapsedMs: Date.now() - startedAt,
      logFile: log.filePath,
    })
  }, Math.max(3000, heartbeatIntervalMs))
  ticker.unref()

  try {
    log.info('Resetting remote orders on startup')
    const resetResult = await resetOrders()
    log.info('Startup reset finished', {
      status: resetResult.status,
      ok: resetResult.ok,
    })

    const result = await runAgent()
    if (result.success && result.flag) {
      log.success('FLAG FOUND', { flag: result.flag, iterations: result.iterations })
      console.log(result.flag)
    } else {
      log.warn('Agent finished without flag', result)
      console.log(result.message)
      process.exitCode = 1
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Foodwarehouse agent failed', { message })
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
