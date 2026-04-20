import { randomUUID } from 'node:crypto'
import log from './logger.js'
import { heartbeatIntervalMs } from './config.js'
import { connectMcp } from './mcp.js'
import { createSession } from './memory/index.js'
import { runAgent } from './agent.js'

async function main(): Promise<void> {
  log.info('S05E03 shellaccess agent started')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    log.info('App still running', { elapsedMs: Date.now() - startedAt, logFile: log.filePath })
  }, Math.max(5000, heartbeatIntervalMs))
  ticker.unref()

  const session = createSession(randomUUID())
  const mcp = await connectMcp('files')

  try {
    const result = await runAgent(session, mcp)
    log.saveText('final-summary.json', `${JSON.stringify({
      ...result,
      sessionId: session.id,
      memory: {
        observerSeq: session.memory.observerSeq,
        reflectorSeq: session.memory.reflectorSeq,
        generation: session.memory.generation,
        activeObservationChars: session.memory.activeObservations.length,
      },
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`)

    if (result.flag) {
      log.success('FLAG FOUND', result)
      console.log(result.flag)
    } else {
      log.warn('Run finished without flag', result)
      console.log(result.finalRaw || 'No final response.')
      process.exitCode = 1
    }
  } catch (error: unknown) {
    log.error('Shellaccess agent failed', { error: String(error) })
    process.exitCode = 1
  } finally {
    clearInterval(ticker)
    await mcp.close()
  }
}

main().catch((error: unknown) => {
  log.error('Unexpected failure', { error: String(error) })
  process.exitCode = 1
})
