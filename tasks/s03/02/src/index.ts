import log from './logger.js'
import { runAgent } from './agent.js'

async function main(): Promise<void> {
  console.log('========================================')
  console.log(' Task 12 — Firmware Agent')
  console.log('========================================')

  log.info('Starting firmware agent')

  const result = await runAgent()

  console.log('\n========================================')
  console.log(' Result')
  console.log('========================================\n')

  if (result.includes('{FLG:')) {
    log.info('Flag found')
    console.log(result)
    return
  }

  if (result.includes('ECCS-')) {
    log.info('Confirmation code returned')
    console.log(result)
    return
  }

  if (result.startsWith('Agent error:') || result.includes('Error:')) {
    log.error(result)
    console.log(result)
    return
  }

  log.info('Agent finished')
  console.log(result)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  log.error(`Fatal error: ${msg}`)
  process.exit(1)
})
