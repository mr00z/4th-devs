import type OpenAI from 'openai'
import { model, openai } from './config.js'
import log from './logger.js'
import { findTool, tools } from './tools.js'

const MAX_TURNS = 140

const SYSTEM_PROMPT = `You are solving the reactor navigation CTF.
Goal: move robot from (1,5) to (7,5) and get flag in format {FLG:...} from verify response.

Rules:
- Use tool reactor_step for each command.
- Use assess_options before deciding moves when needed.
- Prefer deterministic safety policy from tool summary:
  1) if right is safe -> right
  2) else if wait is safe -> wait
  3) else if left is safe -> left
  4) else -> reset or explain_recovery
- Keep responses concise.
- Continue until you obtain and return the flag.`

export async function runAgent(): Promise<string> {
  const agentTools = tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
    },
  }))

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Start now. First initialize board, then navigate safely, avoid block collisions, and return only the final flag when found.',
    },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    log.info(`Agent turn ${turn + 1}/${MAX_TURNS}`)

    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: agentTools,
    })

    const message = response.choices[0]?.message
    if (!message) {
      return 'Agent error: no response'
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    })

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const text = typeof message.content === 'string' ? message.content : ''
      if (text.includes('{FLG:')) {
        return text
      }

      messages.push({
        role: 'user',
        content:
          'Do not stop yet. Use the available tools (reactor_step / assess_options / explain_recovery) and continue until flag is found.',
      })
      continue
    }

    for (const call of message.tool_calls) {
      if (call.type !== 'function') {
        continue
      }

      const name = call.function.name
      let args: Record<string, unknown> = {}

      try {
        args = call.function.arguments?.trim() ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {}
      } catch {
        args = {}
      }

      log.toolCall(name, args)

      const tool = findTool(name)
      if (!tool) {
        const unknown = `Unknown tool: ${name}`
        messages.push({ role: 'tool', tool_call_id: call.id, content: unknown })
        continue
      }

      let result: string
      try {
        result = await tool.handler(args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result = `Tool error (${name}): ${msg}`
        log.error(result)
      }

      log.toolResult(name, result)

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      })

      if (result.includes('{FLG:')) {
        return result
      }
    }
  }

  return 'Agent exceeded maximum turns without finding flag'
}
