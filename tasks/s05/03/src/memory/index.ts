import { memoryModel, observationThresholdChars, observationThresholdMessages, reflectionTargetChars, reflectionThresholdChars } from '../config.js'
import log from '../logger.js'
import { callResponses, extractResponseText } from '../llm.js'
import type { ConversationItem, MemoryState, Session } from '../types.js'
import { truncate } from '../utils.js'
import { buildMemoryAppendix, buildObserverInput, buildReflectorInput, OBSERVER_PROMPT, REFLECTOR_PROMPT } from './prompts.js'
import { persistObserverLog, persistReflectorLog } from './persistence.js'

export function freshMemory(): MemoryState {
  return {
    activeObservations: '',
    lastObservedIndex: 0,
    observerSeq: 0,
    reflectorSeq: 0,
    generation: 0,
    lastReflectionLength: 0,
  }
}

export function createSession(id: string): Session {
  return { id, messages: [], memory: freshMemory() }
}

export function serializeMessages(messages: ConversationItem[]): string {
  return messages.map((message, index) => {
    if ('role' in message) return `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`
    if (message.type === 'function_call') return `${index + 1}. TOOL CALL ${message.name}: ${message.arguments}`
    return `${index + 1}. TOOL RESULT ${message.call_id}: ${truncate(message.output, 3000)}`
  }).join('\n\n')
}

function pendingHistory(session: Session): ConversationItem[] {
  return session.messages.slice(session.memory.lastObservedIndex)
}

function shouldObserve(session: Session): boolean {
  const pending = pendingHistory(session)
  if (pending.length < observationThresholdMessages) {
    return serializeMessages(pending).length >= observationThresholdChars
  }
  return true
}

async function runObserver(session: Session, pending: ConversationItem[]): Promise<string> {
  const result = await callResponses({
    model: memoryModel,
    instructions: OBSERVER_PROMPT,
    input: buildObserverInput(session.memory.activeObservations, serializeMessages(pending)),
    store: false,
  })
  return extractResponseText(result).trim()
}

async function runReflector(session: Session): Promise<string> {
  const result = await callResponses({
    model: memoryModel,
    instructions: REFLECTOR_PROMPT,
    input: buildReflectorInput(session.memory.activeObservations),
    store: false,
  })
  return extractResponseText(result).trim()
}

export async function maybeProcessMemory(session: Session): Promise<void> {
  if (!shouldObserve(session)) return

  const pending = pendingHistory(session)
  try {
    log.info('Observer running', { messages: pending.length })
    const observations = await runObserver(session, pending)
    if (!observations) return

    session.memory.activeObservations = session.memory.activeObservations
      ? `${session.memory.activeObservations.trim()}\n\n${observations}`
      : observations
    session.memory.lastObservedIndex = session.messages.length
    session.memory.observerSeq += 1

    await persistObserverLog({
      sequence: session.memory.observerSeq,
      sessionId: session.id,
      generation: session.memory.generation,
      messagesObserved: pending.length,
      observations,
    })
  } catch (error: unknown) {
    log.warn('Observer failed; continuing without memory update', { error: String(error) })
    return
  }

  const grewSinceReflection = session.memory.activeObservations.length - session.memory.lastReflectionLength
  if (
    session.memory.activeObservations.length < reflectionThresholdChars
    || grewSinceReflection < reflectionTargetChars
  ) {
    return
  }

  try {
    log.info('Reflector running', {
      chars: session.memory.activeObservations.length,
      grewSinceReflection,
    })
    const reflected = await runReflector(session)
    if (!reflected) return

    session.memory.activeObservations = reflected
    session.memory.lastReflectionLength = reflected.length
    session.memory.generation += 1
    session.memory.reflectorSeq += 1

    await persistReflectorLog({
      sequence: session.memory.reflectorSeq,
      sessionId: session.id,
      generation: session.memory.generation,
      compressionChars: reflected.length,
      observations: reflected,
    })
  } catch (error: unknown) {
    log.warn('Reflector failed; keeping uncompressed observations', { error: String(error) })
  }
}

export function buildInstructions(basePrompt: string, session: Session): string {
  const memory = buildMemoryAppendix(session.memory.activeObservations)
  return memory ? `${basePrompt}\n\n${memory}` : basePrompt
}
