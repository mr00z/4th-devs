import { agentModel, maxTurns } from './config.js'
import log from './logger.js'
import { callResponses, extractResponseText } from './llm.js'
import type { AgentRunSummary, ResponseFunctionCallItem, ResponseOutputItem, Session, ShellCommandResult, ToolDefinition } from './types.js'
import { runRemoteCommand } from './api/client.js'
import { validateShellCommand } from './shell-safety.js'
import { parseFinalAnswerFromText, truncate } from './utils.js'
import type { McpHandle } from './mcp.js'
import { buildInstructions, maybeProcessMemory } from './memory/index.js'

const shellTool: ToolDefinition = {
  type: 'function',
  name: 'shell_exec',
  description: 'Execute a safe read-only Linux shell command on the remote shellaccess server. Use this for /data exploration and final echo JSON submission.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cmd: {
        type: 'string',
        description: 'Linux shell command to execute remotely.',
      },
      purpose: {
        type: 'string',
        description: 'Brief reason this command is useful.',
      },
    },
    required: ['cmd', 'purpose'],
  },
}

const SYSTEM_PROMPT = `You are an autonomous forensic investigation agent in a capture-the-flag challenge.

Mission context:
A remote Linux server contains a large plain-text "time archive" under /data. Somewhere in that archive there is information about a person named Rafal. The original Polish name may include the letter l with stroke, but command-line searches should not depend on the accent being preserved correctly. The story says the team must travel to the place where Rafal was found, but must arrive one day before the archive says he was found.

Your task:
Use remote shell commands to inspect the archive and discover:
1. the date when Rafal was found,
2. the city where it happened,
3. the longitude of that place,
4. the latitude of that place.

Then subtract exactly one calendar day from the found date and submit compact JSON with the earlier date, city, longitude, and latitude. The verification service will return a flag only if the remote command prints the correct JSON.

Tools:
- Use shell_exec only for the remote Linux server.
- Use Files MCP tools only for local workspace notes, evidence files, command drafts, and final artifacts.

Rules:
- Start remote exploration with shell_exec commands inspecting /data.
- Prefer standard Linux tools: find, ls, grep, awk, sed, jq, head, tail, wc, sort, uniq, file.
- Search for "Rafal" and broad case-insensitive fragments like "Rafa"; if the remote files use UTF-8, also try the accented Polish spelling.
- Be systematic with large data: inspect names, file types, counts, then targeted grep/jq commands.
- Preserve promising evidence locally with Files MCP when it helps continuity.
- Before final submission, verify all four fields: found date, city, longitude, latitude.
- The final date must be exactly one calendar day before the date Rafal was found.
- The final successful submission must be a shell_exec call that prints compact JSON, for example:
  echo '{"date":"2020-01-01","city":"nazwa miasta","longitude":10.000001,"latitude":12.345678}'
- Do not stop after merely saying the JSON locally. Keep using tools until the hub returns a flag or max turns is reached.`

function getMessageText(item: Extract<ResponseOutputItem, { type: 'message' }>): string {
  return (item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('')
}

function readUsage(result: { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }): Record<string, number | undefined> {
  return {
    inputTokens: result.usage?.input_tokens,
    outputTokens: result.usage?.output_tokens,
    totalTokens: result.usage?.total_tokens,
  }
}

function safeJsonParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function formatShellToolOutput(result: ShellCommandResult): string {
  return JSON.stringify({
    ok: result.ok,
    status: result.status,
    cmd: result.cmd,
    output: result.outputText,
    raw: result.raw,
    flag: result.flag,
  })
}

async function runShellTool(args: Record<string, unknown>): Promise<{ output: string; result?: ShellCommandResult }> {
  const cmd = typeof args.cmd === 'string' ? args.cmd : ''
  const validation = validateShellCommand(cmd)
  if (!validation.ok) {
    return { output: `Blocked by local shell safety guard: ${validation.reason}` }
  }
  const result = await runRemoteCommand(cmd)
  return { output: formatShellToolOutput(result), result }
}

async function runTool(call: ResponseFunctionCallItem, mcp: McpHandle): Promise<{ output: string; shellResult?: ShellCommandResult }> {
  const args = safeJsonParse(call.arguments)
  log.tool('Tool call', { name: call.name, args })

  if (call.name === shellTool.name) {
    return runShellTool(args)
  }

  try {
    const output = await mcp.callTool(call.name, args)
    return { output }
  } catch (error: unknown) {
    return { output: `Error from MCP tool ${call.name}: ${String(error)}` }
  }
}

function allTools(mcp: McpHandle): ToolDefinition[] {
  return [shellTool, ...mcp.tools]
}

export async function runAgent(session: Session, mcp: McpHandle): Promise<AgentRunSummary> {
  session.messages.push({
    role: 'user',
    content: [
      'Solve the remote forensic archive challenge.',
      'Use the remote shell to inspect /data and submit the final JSON through shell_exec.',
      'Use Files MCP for local workspace notes and artifacts when useful.',
    ].join(' '),
  })

  let commandCount = 0
  let finalRaw = ''
  let finalAnswer: AgentRunSummary['finalAnswer']

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    await maybeProcessMemory(session)
    log.info('Agent turn', {
      turn,
      messages: session.messages.length,
      memoryChars: session.memory.activeObservations.length,
    })

    const response = await callResponses({
      model: agentModel,
      instructions: buildInstructions(SYSTEM_PROMPT, session),
      input: session.messages,
      tools: allTools(mcp),
      parallel_tool_calls: false,
      reasoning: { effort: 'medium' },
      store: false,
    })

    log.info('Model response', readUsage(response))
    const assistantTexts: string[] = []
    const toolCalls: ResponseFunctionCallItem[] = []

    for (const item of response.output ?? []) {
      if (item.type === 'message') {
        const text = getMessageText(item)
        if (text.trim()) {
          assistantTexts.push(text)
          session.messages.push({ role: 'assistant', content: text })
          log.info('Assistant message', truncate(text, 500))
        }
      } else if (item.type === 'function_call') {
        toolCalls.push(item)
        session.messages.push({
          type: 'function_call',
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        })
      }
    }

    if (toolCalls.length === 0) {
      const text = assistantTexts.join('\n\n') || extractResponseText(response)
      finalAnswer = parseFinalAnswerFromText(text) ?? finalAnswer
      finalRaw = text
      log.warn('Model stopped without tool call', { turn, text: truncate(text, 500) })
      break
    }

    for (const call of toolCalls) {
      const { output, shellResult } = await runTool(call, mcp)
      session.messages.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output,
      })
      log.info('Tool result', { name: call.name, preview: truncate(output, 600) })

      if (call.name === shellTool.name) {
        commandCount += 1
      }
      if (shellResult) {
        finalRaw = shellResult.raw
        const answerFromCommand = parseFinalAnswerFromText(shellResult.cmd)
        finalAnswer = answerFromCommand ?? parseFinalAnswerFromText(shellResult.outputText) ?? finalAnswer
        if (shellResult.flag) {
          return {
            flag: shellResult.flag,
            finalRaw: shellResult.raw,
            commandCount,
            finalAnswer,
          }
        }
      }
    }
  }

  return {
    flag: null,
    finalRaw,
    commandCount,
    finalAnswer,
  }
}
