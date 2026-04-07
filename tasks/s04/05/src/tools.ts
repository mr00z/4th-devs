import { z } from 'zod'
import * as api from './api/client.js'
import { food4cities } from './food4cities.js'
import log from './logger.js'
import { isSafeDatabaseQuery } from './core/validate.js'
import type { ToolDefinition, ToolContext, ToolSpec } from './types.js'

const HELP_FALLBACK = {
  code: 140,
  message: 'Foodwarehouse API help.',
  usage: {
    endpoint: '/verify',
    method: 'POST',
    required_fields: ['apikey', 'task', 'answer'],
    task: 'foodwarehouse',
  },
  tools: [
    { tool: 'help' },
    { tool: 'orders' },
    { tool: 'signatureGenerator' },
    { tool: 'done' },
    { tool: 'reset' },
    { tool: 'database' },
  ],
}

const noArgsSchema = z.object({})
const querySchema = z.object({ query: z.string().min(1) })
const resolveDestinationsSchema = z.object({})
const sha1Regex = /^[a-f0-9]{40}$/i
const signatureSchema = z.object({
  login: z.string().min(1),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  destination: z.union([z.string().min(1), z.number()]),
})
const getOrdersSchema = z.object({ id: z.string().min(1).nullable() })
const createOrderSchema = z.object({
  title: z.string().min(1),
  creatorID: z.number().int(),
  destination: z.union([z.string().min(1), z.number()]),
  signature: z.string().min(1),
})
const appendItemsSchema = z.object({
  id: z.string().min(1),
  items: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
  })),
})
const deleteOrderSchema = z.object({ id: z.string().min(1) })

function schemaToParameters(schema: z.AnyZodObject): Record<string, unknown> {
  const toProperty = (value: z.ZodTypeAny): Record<string, unknown> => {
    if (value instanceof z.ZodOptional || value instanceof z.ZodNullable) {
      return {
        anyOf: [
          toProperty(value.unwrap()),
          { type: 'null' },
        ],
      }
    }
    if (value instanceof z.ZodUnion) {
      return {
        anyOf: value._def.options.map((option: z.ZodTypeAny) => toProperty(option)),
      }
    }
    if (value instanceof z.ZodArray) {
      return {
        type: 'array',
        items: toProperty(value.element),
      }
    }
    if (value instanceof z.ZodString) {
      return { type: 'string' }
    }
    if (value instanceof z.ZodNumber) {
      return { type: 'number' }
    }
    if (value instanceof z.ZodObject) {
      const shape = value.shape as Record<string, z.ZodTypeAny>
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(shape).map(([key, nestedValue]) => [key, toProperty(nestedValue)])),
        required: Object.keys(shape),
        additionalProperties: false,
      }
    }
    return { type: 'string' }
  }

  const shape = schema.shape as Record<string, z.ZodTypeAny>
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, toProperty(value)])),
    required: Object.keys(shape),
    additionalProperties: false,
  }
}

function stringify(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

function normalizeCityName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export type WarehouseApi = typeof api

function parseObjectJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  return raw as Record<string, unknown>
}

function normalizeApiResult(result: Awaited<ReturnType<typeof api.callVerify>>): string {
  const payload = parseObjectJson(result.json)
  const code = typeof payload?.code === 'number' ? payload.code : null
  if (code !== null && code < 0) {
    return stringify({
      isError: true,
      ...payload,
    })
  }
  return result.raw
}

export async function buildFinalizeResult(apiModule: WarehouseApi = api) {
  const result = await apiModule.done()
  const flag = apiModule.extractFlag(result.raw)
  const payload = parseObjectJson(result.json)
  const message = typeof payload?.message === 'string' ? payload.message : result.raw
  const affectedOrderIds = Array.isArray(payload?.affected_order_ids)
    ? payload.affected_order_ids.filter((value): value is string => typeof value === 'string')
    : undefined

  return {
    success: Boolean(flag),
    message,
    flag: flag ?? undefined,
    affectedOrderIds,
    raw: result.raw,
  }
}

export function getToolSpecs(apiModule: WarehouseApi = api): ToolSpec[] {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'load_city_demands',
          description: 'Load the local food4cities demand dataset. This is the canonical mission input for the required city orders.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        noArgsSchema.parse(args)
        return stringify({
          cities: Object.entries(food4cities).map(([city, items]) => ({ city, items })),
          cityCount: Object.keys(food4cities).length,
        })
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'warehouse_help',
          description: 'Read the live Foodwarehouse API help and tool availability.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        noArgsSchema.parse(args)
        const result = await apiModule.getWarehouseHelp()
        return stringify(result.json ?? HELP_FALLBACK)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'query_database',
          description: 'Run a read-only SQLite query. Allowed patterns: SELECT, SHOW TABLES, SHOW CREATE TABLE <name>, .tables, .schema, .schema <name>, PRAGMA table_info(<table>). Never use semicolons or write operations.',
          parameters: schemaToParameters(querySchema),
          strict: true,
        },
      },
      handler: async (args) => {
        const parsed = querySchema.parse(args)
        if (!isSafeDatabaseQuery(parsed.query)) {
          throw new Error('Unsafe database query. Only single read-only commands are allowed.')
        }
        const result = await apiModule.queryDatabase(parsed.query)
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'resolve_destinations',
          description: 'Resolve all required city destination IDs deterministically in one step. Use this instead of repeated destination SQL lookups once you know the destinations table exists.',
          parameters: schemaToParameters(resolveDestinationsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        resolveDestinationsSchema.parse(args)
        const result = await apiModule.queryDatabase('SELECT destination_id, name FROM destinations ORDER BY destination_id')
        const payload = parseObjectJson(result.json)
        const rows = Array.isArray(payload?.rows) ? payload.rows : []
        const byNormalizedName = new Map<string, Array<{ destinationId: number; name: string }>>()

        for (const row of rows) {
          if (!row || typeof row !== 'object') continue
          const destinationId = (row as { destination_id?: unknown }).destination_id
          const name = (row as { name?: unknown }).name
          if (typeof destinationId !== 'number' || typeof name !== 'string') continue
          const key = normalizeCityName(name)
          const bucket = byNormalizedName.get(key) ?? []
          bucket.push({ destinationId, name })
          byNormalizedName.set(key, bucket)
        }

        const resolved: Record<string, number> = {}
        const missing: string[] = []
        const ambiguous: Array<{ city: string; matches: Array<{ destinationId: number; name: string }> }> = []

        for (const city of Object.keys(food4cities)) {
          const matches = byNormalizedName.get(normalizeCityName(city)) ?? []
          if (matches.length === 0) {
            missing.push(city)
            continue
          }
          if (matches.length > 1) {
            ambiguous.push({ city, matches })
            continue
          }
          resolved[city] = matches[0].destinationId
        }

        return stringify({
          ok: missing.length === 0 && ambiguous.length === 0,
          resolved,
          missing,
          ambiguous,
        })
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'generate_signature',
          description: 'Generate a signature for a chosen login, birthday, and destination code.',
          parameters: schemaToParameters(signatureSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        const parsed = signatureSchema.parse(args)
        const result = await apiModule.generateSignature(parsed)
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'get_orders',
          description: 'Get the current remote warehouse orders. Use this after changes and after finalize errors to inspect current state.',
          parameters: schemaToParameters(getOrdersSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        const parsed = getOrdersSchema.parse({
          id: null,
          ...(args ?? {}),
        })
        const result = await apiModule.getOrders(parsed.id ?? undefined)
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'create_order',
          description: 'Create a new city order. Use the title format "Dostawa dla <city>" and pass the exact 40-character SHA1 hash returned by generate_signature as signature.',
          parameters: schemaToParameters(createOrderSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        const parsed = createOrderSchema.parse(args)
        if (!sha1Regex.test(parsed.signature)) {
          return stringify({
            isError: true,
            code: 'LOCAL_INVALID_SIGNATURE',
            message: 'Signature must be the exact 40-character SHA1 hash returned by generate_signature. Do not use placeholders or shortened values.',
          })
        }
        const result = await apiModule.createOrder(parsed)
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'append_items',
          description: 'Append items to an order using batch mode only. Re-adding an item increases its quantity.',
          parameters: schemaToParameters(appendItemsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        const parsed = appendItemsSchema.parse(args)
        const items = Object.fromEntries(parsed.items.map((item) => [item.name, item.quantity]))
        const result = await apiModule.appendOrderItems({
          id: parsed.id,
          items,
        })
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'delete_order',
          description: 'Delete an incorrect order so it can be recreated cleanly.',
          parameters: schemaToParameters(deleteOrderSchema),
          strict: true,
        },
      },
      handler: async (args, ctx) => {
        const parsed = deleteOrderSchema.parse(args)
        if (ctx.state.lastFinalize?.affectedOrderIds?.includes(parsed.id)) {
          throw new Error('This order was flagged by finalize as a system-generated irregular order. Do not delete it individually; use reset_orders and rebuild cleanly.')
        }
        const result = await apiModule.deleteOrder(parsed.id)
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'reset_orders',
          description: 'Reset the entire warehouse order state. Use only when incremental repair is too risky or too messy.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args, ctx) => {
        noArgsSchema.parse(args)
        ctx.state.resetCount += 1
        const result = await apiModule.resetOrders()
        return normalizeApiResult(result)
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'finalize',
          description: 'Call the remote done tool and treat its response as the source of truth. If finalize fails, inspect current orders and repair them instead of stopping.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args, ctx) => {
        noArgsSchema.parse(args)
        const finalizeResult = await buildFinalizeResult(apiModule)
        ctx.state.lastFinalize = finalizeResult
        log.tool('Finalize result', finalizeResult)
        return stringify(finalizeResult)
      },
    },
  ]
}

export function getToolDefinitions(specs: ToolSpec[]): ToolDefinition[] {
  return specs.map((spec) => spec.definition)
}

export function findToolHandler(specs: ToolSpec[], name: string): ToolSpec['handler'] | null {
  return specs.find((spec) => spec.definition.function.name === name)?.handler ?? null
}
