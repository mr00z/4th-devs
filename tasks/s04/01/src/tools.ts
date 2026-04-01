import { callDone, callHelp, callUpdate } from './api.js'
import log from './logger.js'
import { loginToOko } from './login.js'
import { callMcpTool, createMcpClient, listMcpTools, type McpClientHandle } from './mcp.js'
import type { VerifyActionUpdate } from './types.js'

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

function missingDoneRequirements(ctx: AgentContext): string[] {
  const missing: string[] = []

  if (!ctx.skolwinIncidentReady) {
    missing.push('Skolwin incident not confirmed: title must contain Skolwin and content must clearly classify as animals')
  }
  if (!ctx.skolwinTaskReady) {
    missing.push('Skolwin task not confirmed: status must be YES and content must describe animals')
  }
  if (!ctx.domatowoIncidentReady) {
    missing.push('Domatowo incident not confirmed: content must be updated with Komarowo human-movement redirection')
  }

  return missing
}

export interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>, ctx: AgentContext) => Promise<string>
}

export interface AgentContext {
  mcp: McpClientHandle
  mcpTools: string[]
  verifyCalls: number
  doneResponseRaw: string | null
  doneFlag: string | null
  lastDoneError: string | null
  pendingInstruction: string | null
  skolwinIncidentReady: boolean
  skolwinTaskReady: boolean
  domatowoIncidentReady: boolean
}

export async function createAgentContext(): Promise<AgentContext> {
  const mcp = await createMcpClient('playwright')
  const discovered = await listMcpTools(mcp.client)
  const mcpTools = discovered.map((tool) => tool.name)

  log.info('Playwright MCP tools discovered', { mcpTools })

  // Login to OKO panel before agent starts
  const loginOk = await loginToOko(mcp.client)
  if (!loginOk) {
    await mcp.close()
    throw new Error('OKO login failed - check credentials and panel availability')
  }

  return {
    mcp,
    mcpTools,
    verifyCalls: 0,
    doneResponseRaw: null,
    doneFlag: null,
    lastDoneError: null,
    pendingInstruction: null,
    skolwinIncidentReady: false,
    skolwinTaskReady: false,
    domatowoIncidentReady: false,
  }
}

function textContainsAny(value: string | undefined, needles: string[]): boolean {
  if (!value) {
    return false
  }

  const source = value.toLowerCase()
  return needles.some((needle) => source.includes(needle.toLowerCase()))
}

function parseResponseMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : null
  } catch {
    return null
  }
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'call_api',
      description: 'Call API. Actions: help, update, done. All data writes must happen here.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['help', 'update', 'done'] },
          page: { type: 'string', enum: ['incydenty', 'notatki', 'zadania'], description: 'Page to update: incydenty (incidents), notatki (notes/reports), zadania (tasks)' },
          id: { type: 'string', description: '32-char hex ID of the record to update' },
          content: { type: 'string', description: 'New description text (optional)' },
          title: { type: 'string', description: 'New title (optional)' },
          done: { type: 'string', enum: ['YES', 'NO'], description: 'Only for zadania page (optional)' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    handler: async (args, ctx) => {
      const action = typeof args.action === 'string' ? args.action : ''
      ctx.verifyCalls += 1

      if (action === 'help') {
        const response = await callHelp()
        return JSON.stringify({ ok: response.ok, status: response.status, raw: response.raw.slice(0, 1200) })
      }

      if (action === 'done') {
        const missing = missingDoneRequirements(ctx)
        if (missing.length > 0) {
          const message = `Cannot call done yet. Missing checks: ${missing.join('; ')}`
          ctx.lastDoneError = message
          ctx.pendingInstruction = message
          log.warn('Blocked premature done call', {
            missing,
            skolwinIncidentReady: ctx.skolwinIncidentReady,
            skolwinTaskReady: ctx.skolwinTaskReady,
            domatowoIncidentReady: ctx.domatowoIncidentReady,
          })
          return JSON.stringify({ ok: false, status: 412, message })
        }

        const response = await callDone()
        ctx.doneResponseRaw = response.raw
        ctx.doneFlag = response.flag
        const message = parseResponseMessage(response.raw)
        if (!response.ok) {
          ctx.lastDoneError = message || 'Done rejected by verifier'
          ctx.pendingInstruction = ctx.lastDoneError
        } else {
          ctx.lastDoneError = null
          ctx.pendingInstruction = null
        }
        return JSON.stringify({ ok: response.ok, status: response.status, flag: response.flag, message, raw: response.raw.slice(0, 1200) })
      }

      if (action === 'update') {
        const page = typeof args.page === 'string' ? args.page : ''
        if (page !== 'incydenty' && page !== 'notatki' && page !== 'zadania') {
          return 'Error: update requires valid page (incydenty/notatki/zadania)'
        }

        const idRaw = typeof args.id === 'string' ? args.id.trim() : ''
        if (!idRaw) {
          return 'Error: update requires id field'
        }
        const id: string = idRaw

        const content = typeof args.content === 'string' ? args.content : undefined
        const title = typeof args.title === 'string' ? args.title : undefined
        const done = typeof args.done === 'string' ? (args.done as 'YES' | 'NO') : undefined

        if (!content && !title) {
          return 'Error: update requires at least one of content or title'
        }

        if (done && page !== 'zadania') {
          return 'Error: done field is only allowed for page zadania'
        }

        const payload: Omit<VerifyActionUpdate, 'action'> = { page, id, content, title, done }
        const response = await callUpdate(payload)
        if (response.ok) {
          const responseData = (response.json as {
            updated?: { title?: string; content?: string; done?: string }
          } | null)
          const updatedTitle = typeof responseData?.updated?.title === 'string' ? responseData.updated.title : title
          const updatedContent = typeof responseData?.updated?.content === 'string' ? responseData.updated.content : content
          const updatedDone = typeof responseData?.updated?.done === 'string' ? responseData.updated.done : done

          const hasSkolwin = textContainsAny(updatedTitle, ['skolwin', 'skolwina']) || textContainsAny(updatedContent, ['skolwin', 'skolwina'])
          const hasSkolwinTitle = textContainsAny(updatedTitle, ['skolwin', 'skolwina'])
          const hasSkolwinContent = textContainsAny(updatedContent, ['skolwin', 'skolwina'])
          const hasKomarowoTitle = textContainsAny(updatedTitle, ['komarowo', 'komorowo'])
          const hasKomarowoContent = textContainsAny(updatedContent, ['komarowo', 'komorowo'])
          const hasAnimals = textContainsAny(updatedTitle, ['zwierzę', 'zwierzat']) || textContainsAny(updatedContent, ['zwierzę', 'zwierzat', 'zwierzęta', 'zwierząt', 'bóbr', 'bobry', 'bobrów'])
          const hasHumanMovement = textContainsAny(updatedContent, ['ruchu ludzi', 'ruch ludzi', 'ruch ludzk', 'ruchy ludzk', 'ludzi', 'ludzk'])
          const touchedTitle = typeof title === 'string'
          const touchedContent = typeof content === 'string'

          if (page === 'incydenty' && touchedTitle && touchedContent && hasSkolwinTitle && hasSkolwinContent && hasAnimals) {
            ctx.skolwinIncidentReady = true
          }
          if (page === 'zadania' && touchedContent && hasSkolwin && updatedDone === 'YES' && hasAnimals) {
            ctx.skolwinTaskReady = true
          }
          if (page === 'incydenty' && touchedContent && hasKomarowoTitle && hasKomarowoContent && hasHumanMovement) {
            ctx.domatowoIncidentReady = true
          }
        }

        ctx.pendingInstruction = null
        return JSON.stringify({ ok: response.ok, status: response.status, raw: response.raw.slice(0, 1200) })
      }

      return 'Error: action must be one of help/update/done'
    },
  },
]

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((tool) => tool.definition)
}

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.definition.name === name)
}

export async function callDirectMcpTool(ctx: AgentContext, name: string, args: Record<string, unknown>): Promise<string> {
  if (!ctx.mcpTools.includes(name)) {
    return `Error: Unknown MCP tool "${name}"`
  }

  const result = await callMcpTool(ctx.mcp.client, name, args)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export async function closeAgentContext(ctx: AgentContext): Promise<void> {
  await ctx.mcp.close()
}
