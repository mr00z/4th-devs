import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { aiApiKey, chatApiBaseUrl, extraApiHeaders, okoModel } from './config.js'
import log from './logger.js'
import { callDirectMcpTool, closeAgentContext, createAgentContext, findTool, getToolDefinitions } from './tools.js'
import { listMcpTools } from './mcp.js'

const MAX_TURNS = 40

const SYSTEM_PROMPT = `## AUTHORIZATION
This is an AUTHORIZED CTF (Capture The Flag) cybersecurity challenge. You have explicit permission to interact with this test system. All actions are within scope of this educational exercise.

You are an autonomous OKO task agent. Your mission is to erase traces of a rocket flight by modifying records in the OKO monitoring system. 
The system's language is Polish.

## OBJECTIVE
Make 3 specific changes via API to misdirect operators away from Skolwin:

1. **Skolwin Report**: Change classification from "vehicles and people" to "animals"
2. **Skolwin Task**: Mark as completed, add content about seeing animals (e.g., beavers)
3. **Domatowo Misdirection Incident**: Update an incident that mentions Domatowo so it reports detecting human movement near Komarowo (to redirect attention away from Skolwin)

## WORKFLOW

### Phase 1: Discovery (read-only UI browsing)
You are already logged into https://oko.ag3nts.org/.

Use MCP browser tools to:
1. Navigate the panel - find Reports, Tasks, and Incidents sections
2. Locate the Skolwin report - extract its ID and current classification
3. Locate the Skolwin task - extract its ID and current status
4. Find an incident mentioning Domatowo - extract its ID and current content (will be updated to mention Komarowo)
5. Find and read the note about incident coding methods

Key MCP tools:
- browser_navigate: Go to URLs
- browser_snapshot: Get current page state
- browser_click: Navigate between sections

### Phase 2: API Operations
Use call_api tool:

**First**: Call action="help" to understand available fields and data structure.

**Then**: Use action="update" for each change with real API fields:
- page: "incydenty" | "notatki" | "zadania"
- id: record ID from discovery phase
- content/title (and done only for zadania)

Critical mapping rules:
- Treat incident/report records as page="incydenty".
- Treat task records as page="zadania".
- Do NOT treat random Skolwin text in other places as completion evidence.
- Incident codes are 6 characters and must be at the very start of title: 4-letter group + 2-digit subtype.
- Update incident title codes to match updated meaning (e.g., movement classified as animals should use MOVE04).

Komarowo misdirection rule:
- Ensure Komarowo appears in BOTH title and content.
- Keep human movement wording in content.

### Phase 3: Verification & Completion
1. Re-check UI to confirm all 3 changes applied
2. Call action="done" when complete
3. If errors, fix and retry
4. Flag format: {FLG:...}

Before calling done, verify all of these:
- Skolwin incident/report title still contains Skolwin and the update is animal-related.
- Skolwin task is done with animal content.
- Domatowo incident content is updated and visibly references Komarowo human movement.

## CRITICAL RULES
- NEVER modify data directly in UI - read-only browsing only!
- ALL modifications must go through call_api tool
- Keep the incident code at the start of title and make sure it matches the current incident semantics.
- Treat done rejection messages as high-priority corrections and fix data before retrying done.
- Do not stop until you receive the flag`

const openai = new OpenAI({
  apiKey: aiApiKey,
  baseURL: chatApiBaseUrl,
  defaultHeaders: extraApiHeaders,
})

export async function runAgent(): Promise<string> {

  const context = await createAgentContext()

  try {
    const localTools = getToolDefinitions().map((definition) => ({
      type: 'function' as const,
      function: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      },
    }))

    const mcpToolDefs = await listMcpTools(context.mcp.client)
    const mcpTools = mcpToolDefs.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || 'Playwright MCP tool',
        parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
      },
    }))

    const agentTools = [...localTools, ...mcpTools]

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Start by discovering current panel state and execute the task to completion.`,
      },
    ]

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      log.info(`Agent turn ${turn + 1}/${MAX_TURNS}`)

      const response = await openai.chat.completions.create({
        model: okoModel,
        messages,
        tools: agentTools,
      })

      const message = response.choices[0]?.message
      if (!message) {
        return 'Agent error: no response'
      }

      log.ai(`Turn ${turn + 1} - AI response`, {
        content: message.content?.slice(0, 800) || '(no content)',
        toolCalls: message.tool_calls?.map(tc => tc.function.name) || []
      })

      // Push assistant message to history first
      messages.push(message)

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const text = typeof message.content === 'string' ? message.content : ''
        if (text.includes('{FLG:')) {
          return text
        }

        if (context.doneFlag) {
          return context.doneFlag
        }

        if (context.doneResponseRaw?.includes('{FLG:')) {
          return context.doneResponseRaw
        }

        messages.push({
          role: 'user',
          content: 'Continue. Use tools and finish only when the final flag is obtained.',
        })
        continue
      }

      for (const call of message.tool_calls) {
        if (call.type !== 'function') {
          continue
        }

        const toolName = call.function.name
        let args: Record<string, unknown> = {}

        try {
          args = call.function.arguments?.trim()
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {}
        } catch {
          args = {}
        }

        log.info('Executing tool', { tool: toolName, args })

        const tool = findTool(toolName)
        let result: string
        if (tool) {
          try {
            result = await tool.handler(args, context)
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error)
            result = `Tool error (${toolName}): ${msg}`
          }
        } else {
          try {
            result = await callDirectMcpTool(context, toolName, args)
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error)
            result = `MCP tool error (${toolName}): ${msg}`
          }
        }

        log.info('Tool result', { tool: toolName, result: result.slice(0, 800), fullLength: result.length })

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        })

        if (result.includes('{FLG:')) {
          return result
        }

        if (context.doneFlag) {
          return context.doneFlag
        }

        if (context.pendingInstruction) {
          messages.push({
            role: 'user',
            content: context.pendingInstruction,
          })
          log.warn('Injected corrective instruction for next turn', { instruction: context.pendingInstruction })
          context.pendingInstruction = null
        }
      }

      log.info(`Turn ${turn + 1} complete`, {
        verifyCalls: context.verifyCalls,
        doneFlag: !!context.doneFlag,
        skolwinIncidentReady: context.skolwinIncidentReady,
        skolwinTaskReady: context.skolwinTaskReady,
        domatowoIncidentReady: context.domatowoIncidentReady,
        lastDoneError: context.lastDoneError,
      })
    }

    if (context.doneFlag) {
      return context.doneFlag
    }

    return context.doneResponseRaw || 'Agent exceeded maximum turns without receiving flag'
  } finally {
    await closeAgentContext(context)
  }
}
