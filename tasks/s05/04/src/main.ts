import { heartbeatIntervalMs } from './config.js'
import log from './logger.js'
import { runAgent } from './agent.js'

async function main(): Promise<void> {
  log.info('S05E04 goingthere hybrid agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', { elapsedMs: Date.now() - startedAt, logFile: log.filePath })
  }, Math.max(5000, heartbeatIntervalMs))
  ticker.unref()

  try {
    const result = await runAgent()
    log.saveText('final-summary.json', `${JSON.stringify({
      ...result,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`)

    if (result.flag) {
      log.success('FLAG FOUND', result)
      console.log(result.flag)
    } else {
      log.warn('Run finished without flag', result)
      console.log(result.finalRaw)
      process.exitCode = 1
    }
  } catch (error: unknown) {
    log.error('Goingthere agent failed', { error: String(error) })
    process.exitCode = 1
  } finally {
    clearInterval(ticker)
  }
}

main().catch((error: unknown) => {
  log.error('Unexpected failure', { error: String(error) })
  process.exitCode = 1
})
