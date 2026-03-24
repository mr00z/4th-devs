import { runAgent } from './agent.js'
import log from './logger.js'

const today = new Date().toISOString().split('T')[0]

async function main() {
  console.log(`\n========================================`)
  console.log(`  Mailbox Search Agent — ${today}`)
  console.log(`========================================\n`)

  log.box('Mailbox Analysis Agent\nSearching for: date, password, confirmation_code\nTarget: emails from proton.me domain')

  const result = await runAgent()

  console.log(`\n========================================`)
  console.log(`  Result`)
  console.log(`========================================\n`)
  
  if (result.includes('{FLG:')) {
    log.success('Flag found!')
    console.log(result)
  } else if (result.includes('Error:') || result.includes('Agent error:')) {
    log.error('Agent failed', result)
    console.log(result)
  } else {
    log.info('Agent response:')
    console.log(result)
  }
}

main().catch((err) => {
  log.error('Fatal error', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
