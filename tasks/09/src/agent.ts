import type OpenAI from 'openai'
import { openai, resolveModelForProvider } from './config.js'
import { findTool, tools } from './tools.js'
import log from './logger.js'

const MAX_TURNS = 30


const SYSTEM_PROMPT = `You are a mailbox analysis agent. Your task is to search through emails and extract three specific pieces of information:

1. **date** - When the security department plans to attack the power plant (format: YYYY-MM-DD)
2. **password** - The password to the employee system that is still in this mailbox
3. **confirmation_code** - The confirmation code from the ticket sent by the security department (format: SEC- followed by 32 characters, total 36 characters)

IMPORTANT DETAILS:
- The emails we're interested in were sent from the "proton.me" domain
- The mailbox is active and new messages may arrive during your search - re-check if needed
- Use the search_mailbox tool with "from:proton.me" to find relevant emails
- Use get_thread and get_messages to read full email content
- Once you have all three values, use submit_answer to verify them
- If verification fails, use the feedback to adjust your approach and retry
- Be persistent - the data might be in recent messages or require careful reading

Available tools:
- search_mailbox: Search emails with queries
- get_inbox: List inbox threads
- get_thread: Get thread details
- get_messages: Read full message content
- submit_answer: Submit your findings for verification

Start by searching for emails from proton.me domain.`

export async function runAgent(): Promise<string> {
  try {
    log.agent('mailbox', 'Starting mailbox analysis agent')
    
    const model = resolveModelForProvider('gpt-5-mini') as string

    const agentTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }))

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Please search the mailbox and find the required information.' },
    ]

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      log.agentTurn(turn + 1, MAX_TURNS)

      const response = await openai.chat.completions.create({
        model,
        messages,
        tools: agentTools,
      })

      const message = response.choices[0]?.message
      if (!message) {
        return 'Agent error: No response from model'
      }

      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      })

      if (!message.tool_calls || message.tool_calls.length === 0) {
        log.agent('mailbox', 'Completed successfully')
        const text = message.content
        return typeof text === 'string' ? text : ''
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue

        const name = toolCall.function.name
        let args: Record<string, unknown> = {}
        try {
          const raw = toolCall.function.arguments
          args = typeof raw === 'string' && raw.trim()
            ? (JSON.parse(raw) as Record<string, unknown>)
            : {}
        } catch {
          args = {}
        }

        log.tool(name, args)

        const tool = findTool(name)
        if (tool) {
          const result = await tool.handler(args)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          })
        } else {
          const errorResult = `Unknown tool: ${name}`
          log.error('Tool error', errorResult)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: errorResult,
          })
        }
      }
    }

    return 'Agent exceeded maximum turns'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('Agent error', msg)
    return `Agent error: ${msg}`
  }
}
