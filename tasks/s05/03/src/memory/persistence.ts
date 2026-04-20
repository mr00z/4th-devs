import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../config.js'
import log from '../logger.js'

const pad = (value: number): string => String(value).padStart(3, '0')

async function persistMemoryLog(prefix: string, sequence: number, body: string, metadata: Record<string, string | number>): Promise<void> {
  const fileName = `${prefix}-${pad(sequence)}.md`
  const target = path.join(paths.memoryDir, fileName)
  const frontmatter = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  const content = `---\n${frontmatter}\ncreated: ${new Date().toISOString()}\n---\n\n${body.trim()}\n`

  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  log.info('Memory persisted', { fileName })
}

export async function persistObserverLog(input: {
  sequence: number
  sessionId: string
  generation: number
  messagesObserved: number
  observations: string
}): Promise<void> {
  await persistMemoryLog('observer', input.sequence, input.observations, {
    type: 'observation',
    session: input.sessionId,
    sequence: input.sequence,
    generation: input.generation,
    messages_observed: input.messagesObserved,
  })
}

export async function persistReflectorLog(input: {
  sequence: number
  sessionId: string
  generation: number
  compressionChars: number
  observations: string
}): Promise<void> {
  await persistMemoryLog('reflector', input.sequence, input.observations, {
    type: 'reflection',
    session: input.sessionId,
    sequence: input.sequence,
    generation: input.generation,
    chars: input.compressionChars,
  })
}
