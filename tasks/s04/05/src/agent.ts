import OpenAI from 'openai'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import { aiApiKey, chatApiBaseUrl, chatModel, maxIterations, maxResets, maxToolRounds } from './config.js'
import log from './logger.js'
import * as api from './api/client.js'
import { normalizeOrders } from './core/validate.js'
import { findToolHandler, getToolDefinitions, getToolSpecs, type WarehouseApi } from './tools.js'
import type { AgentRunResult, AgentState, CompletionResponse, ToolContext, ToolSpec } from './types.js'

const SYSTEM_PROMPT = `You are a warehouse recovery operator working inside a CTF-style infrastructure task.

<task>
- You interact with a remote warehouse system through the tools.
- The goal is to prepare the correct set of orders so every city from the local demand dataset receives exactly the goods it needs.
- The local demand dataset is the source of truth for participating cities and required quantities.
- The remote system provides warehouse orders, a read-only SQLite database, a signature generator, and a final verification step.
- You must discover valid destination codes and valid creator identity data from the database before creating orders.
- The signature generator requires login, birthday, and destination.
- Creating an order requires title, creatorID, destination, and signature.
- The final goal is to receive a flag in the format {FLG:...}.
</task>

<tools>
- load_city_demands: load the canonical local city demand dataset
- warehouse_help: read the live API contract and tool behavior
- query_database: run read-only SQLite discovery queries
- resolve_destinations: resolve all required city destination IDs deterministically
- generate_signature: generate the required signature for login + birthday + destination
- get_orders: inspect current remote orders
- create_order: create a remote order
- append_items: append a batch of items to an order
- delete_order: remove a bad order so it can be rebuilt
- reset_orders: reset all remote orders back to the initial state
- finalize: run validation and then remote done verification
</tools>

<workflow>
1. Start with load_city_demands and warehouse_help
2. Inspect database schema before assuming table names or columns
3. Discover all destination codes for all required cities
4. Discover enough valid creator data: creatorID, login, birthday
5. Build a complete internal plan covering all cities before creating any new order
6. Only after the plan is complete, create exactly one order per city using title "Dostawa dla <city>"
7. After each order is created, append exactly that city's items and nothing else
8. When all city orders are ready, inspect orders and run finalize
9. If finalize fails, inspect current state, repair the orders, and try again
</workflow>

<rules>
- Work in a loop until you get the flag or run out of budget.
- Create one order per city from the demand dataset.
- Use the exact title format: "Dostawa dla <city>".
- Finish discovery before execution:
  - first map all required cities to destination codes
  - then select creators/signature inputs
  - then create and fill orders
- Avoid repeating the same discovery query if you already have the answer in the conversation.
- Prefer resolve_destinations over repeated manual destination SQL queries once the destinations table is known.
- Do not generate signatures for a city until you are ready to create that city's order.
- When calling create_order, pass the exact full hash returned by generate_signature. Never use placeholders like "...".
- Do not call get_orders unless you need current remote state for recovery, validation, or checking progress after writes.
- If finalize returns affected_order_ids or says system-generated orders are irregular, do not delete those flagged orders one by one.
- In that case, prefer reset_orders and then rebuild your own required city orders from a clean baseline.
- Prefer minimal repair:
  - append only missing items
  - delete and recreate only your own incorrect city orders when needed
  - use reset_orders only if the state is too messy to repair safely
- Avoid unnecessary resets. You may use reset_orders at most ${maxResets} times.
- After any finalize failure, call get_orders before deciding how to repair.
- Do not stop after a finalize failure. Treat it as feedback.
- Treat finalize as the source of truth for validation.
- Be concise in text responses.
</rules>`

const openai = new OpenAI({
  apiKey: aiApiKey,
  baseURL: chatApiBaseUrl,
})

export interface CompletionClient {
  complete(messages: ChatCompletionMessageParam[], tools: ReturnType<typeof getToolDefinitions>): Promise<CompletionResponse>
}

class OpenAICompletionClient implements CompletionClient {
  async complete(messages: ChatCompletionMessageParam[], tools: ReturnType<typeof getToolDefinitions>): Promise<CompletionResponse> {
    const completion = await openai.chat.completions.create({
      model: chatModel,
      messages,
      tools,
      tool_choice: 'auto',
    })

    const message = completion.choices[0]?.message
    return {
      content: typeof message?.content === 'string' ? message.content : '',
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    }
  }
}

function summarizeState(state: AgentState, ordersRaw: unknown): string {
  const orders = normalizeOrders(ordersRaw)
  return JSON.stringify({
    iteration: state.iteration,
    resetCount: state.resetCount,
    lastFinalize: state.lastFinalize,
    currentOrders: orders.map((order) => ({
      id: order.id,
      title: order.title,
      destination: order.destination,
      items: order.items,
    })),
  }, null, 2)
}

async function executeRound(args: {
  messages: ChatCompletionMessageParam[]
  specs: ToolSpec[]
  ctx: ToolContext
  client: CompletionClient
}): Promise<boolean> {
  const tools = getToolDefinitions(args.specs)
  const response = await args.client.complete(args.messages, tools)
  const assistantMessage: ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: response.content || '',
    ...(response.toolCalls.length > 0
      ? {
        tool_calls: response.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        })),
      }
      : {}),
  }
  args.messages.push(assistantMessage)

  if (response.content) {
    log.agent('Assistant message', {
      round: args.ctx.state.iteration,
      content: response.content.slice(0, 500),
    })
  }

  if (response.toolCalls.length === 0) {
    return false
  }

  for (const call of response.toolCalls) {
    const handler = findToolHandler(args.specs, call.name)
    if (!handler) {
      throw new Error(`Unknown tool requested by model: ${call.name}`)
    }

    let parsedArgs: Record<string, unknown> = {}
    try {
      parsedArgs = call.arguments ? JSON.parse(call.arguments) as Record<string, unknown> : {}
    } catch (error) {
      log.warn('Failed to parse tool arguments; using empty object', {
        tool: call.name,
        error: String(error),
        rawArguments: call.arguments,
      })
    }

    log.tool('Executing tool', { tool: call.name, args: parsedArgs })
    const result = await handler(parsedArgs, args.ctx)
    const toolMessage: ChatCompletionToolMessageParam = {
      role: 'tool',
      tool_call_id: call.id,
      content: result,
    }
    args.messages.push(toolMessage)
    log.tool('Tool result', { tool: call.name, preview: result.slice(0, 500) })
  }

  return true
}

export async function runAgent(
  client: CompletionClient = new OpenAICompletionClient(),
  apiModule: WarehouseApi = api,
): Promise<AgentRunResult> {
  const state: AgentState = {
    lastFinalize: null,
    resetCount: 0,
    iteration: 0,
  }
  const ctx: ToolContext = { state }
  const specs = getToolSpecs(apiModule)
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: 'Solve the foodwarehouse task. Investigate safely, create the required city orders, and recover from finalize errors until you get the flag.',
    },
  ]
  let recoveryCount = 0

  for (let round = 1; round <= maxToolRounds; round += 1) {
    state.iteration = round
    log.info('Starting agent tool round', { round, recoveryCount, resetCount: state.resetCount })
    const usedTools = await executeRound({ messages, specs, ctx, client })

    if (state.lastFinalize?.success && state.lastFinalize.flag) {
      return {
        success: true,
        message: state.lastFinalize.message,
        flag: state.lastFinalize.flag,
        iterations: recoveryCount,
      }
    }

    const failedFinalize = state.lastFinalize && !state.lastFinalize.success
      ? state.lastFinalize
      : null

    if (failedFinalize) {
      recoveryCount += 1
      if (recoveryCount > maxIterations) {
        return {
          success: false,
          message: `Recovery budget exhausted after ${maxIterations} failed finalize attempts.`,
          iterations: recoveryCount,
        }
      }

      const orderSnapshot = await apiModule.getOrders()
      const feedback = summarizeState(state, orderSnapshot.json)
      log.saveWorkspaceText(`recovery-${recoveryCount}-state.json`, feedback)
      const affectedOrderLine = failedFinalize.affectedOrderIds?.length
        ? `\n\nFinalize flagged these order IDs as irregular system-generated orders: ${failedFinalize.affectedOrderIds.join(', ')}`
        : ''
      messages.push({
        role: 'user',
        content: `Finalize failed. Here is the latest state snapshot and feedback:\n\n${feedback}${affectedOrderLine}\n\nUse this to repair the current orders. Inspect the current orders, validate them, and continue until finalize succeeds. If finalize flagged system-generated orders, do not delete them individually. Prefer reset_orders and a clean rebuild in that case.`,
      })
      state.lastFinalize = null
      continue
    }

    if (!usedTools) {
      messages.push({
        role: 'user',
        content: 'Continue working on the task. If you have not finalized successfully yet, inspect the current state and keep going.',
      })
    }
  }

  log.warn('Max tool rounds reached before success', { maxToolRounds, recoveryCount })
  return {
    success: false,
    message: 'Tool round budget exhausted without receiving a flag.',
    iterations: recoveryCount,
  }
}
