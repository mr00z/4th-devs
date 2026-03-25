import type OpenAI from 'openai'
import { model, openai } from './config.js'
import log from './logger.js'
import { findTool, tools } from './tools.js'

const MAX_TURNS = 100

const SYSTEM_PROMPT = `You are a Linux shell specialist. You can execute commands on a remote Linux system with a minimal Linux userspace and tools available. 
You are participating in a security challenge in form of a CTF (Capture The Flag) to execute a firmware binary.

Mission:
1) Start with shell_help.
2) Work on remote Linux to execute /opt/firmware/cooler/cooler.bin.
3) Obtain access password only from explicitly allowed files and hints returned by commands.
4) Reconfigure settings.ini if needed so the binary works.
5) Extract confirmation code in format ECCS-... .
6) Submit using submit_confirmation.
7) Continue until verification returns flag {FLG:...}.

Safety policy:
- Never access /etc, /root, /proc.
- Respect discovered ignore files: do not read or modify paths they mark as ignored.
- Prefer minimal and reversible actions.
- Use reboot_remote only when environment becomes unusable.

Tool usage:
- Use validate_command before risky command proposals.
- Keep command attempts concise and avoid loops.
- Never read binary files (for example with cat/less/strings on *.bin); execute binaries directly.`

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
    { role: 'user', content: 'Start with help, solve the challenge, submit confirmation, and return the flag.' },
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
      return text || 'Agent finished without explicit output'
    }

    for (const call of message.tool_calls) {
      if (call.type !== 'function') {
        continue
      }

      const name = call.function.name
      let args: Record<string, unknown> = {}

      try {
        args = call.function.arguments?.trim()
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {}
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

  return 'Agent exceeded maximum turns'
}
