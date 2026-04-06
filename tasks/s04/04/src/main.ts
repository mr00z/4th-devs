import { heartbeatIntervalMs, maxRuntimeMs } from './config.js'
import log from './logger.js'
import { createMcpClient } from './mcp.js'
import { extractFlag } from './api/client.js'
import { runWorkflow } from './agent.js'

async function main(): Promise<void> {
  log.info('S04E04 Filesystem agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', {
      elapsedMs: Date.now() - startedAt,
      runtimeBudgetMs: maxRuntimeMs,
      logFile: log.filePath,
    })
  }, Math.max(3000, heartbeatIntervalMs))
  ticker.unref()

  let mcp
  try {
    mcp = await createMcpClient('files')
    const result = await runWorkflow({
      role: 'orchestrator',
      mcp,
    })
    const flag = extractFlag(result) || result
    if (flag.includes('{FLG:')) {
      log.success('FLAG FOUND', { flag })
      console.log(flag)
    } else {
      log.warn('Workflow completed without flag', { result: flag.slice(0, 500) })
      console.log(flag)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Filesystem agent failed', { message })
    process.exitCode = 1
  } finally {
    clearInterval(ticker)
    await mcp?.close().catch(() => {})
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('Unexpected error', { message })
  process.exitCode = 1
})
