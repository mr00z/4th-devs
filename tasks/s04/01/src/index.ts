import { runAgent } from './agent.js'
import log from './logger.js'

async function main(): Promise<void> {
  log.info('S04E01 okoeditor agent started')
  const result = await runAgent()
  if (result.includes('{FLG:')) {
    log.success('FLAG FOUND', { flag: result.match(/\{FLG:[^}]+\}/)?.[0] ?? result })
  }
  console.log(result)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  log.error('Agent failed', { message })
  process.exitCode = 1
})
