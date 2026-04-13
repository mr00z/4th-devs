import { heartbeatIntervalMs } from './config.js'
import log from './logger.js'
import { runAgent } from './agent.js'

async function main(): Promise<void> {
  log.info('S05E01 radiomonitoring agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', { elapsedMs: Date.now() - startedAt, logFile: log.filePath })
  }, Math.max(5000, heartbeatIntervalMs))
  ticker.unref()

  try {
    const result = await runAgent()
    if (result.flag) {
      log.success('FLAG FOUND', { flag: result.flag, report: result.report })
      console.log(result.flag)
    } else {
      log.warn('Agent finished without flag', { report: result.report, raw: result.transmittedRaw })
      console.log(result.transmittedRaw)
      process.exitCode = 1
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Radiomonitoring agent failed', { message })
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
