import assert from 'node:assert/strict'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { food4cities } from '../food4cities.js'
import { isSafeDatabaseQuery, validateOrders } from '../core/validate.js'
import { getToolSpecs } from '../tools.js'
import { runAgent, type CompletionClient } from '../agent.js'
import * as client from '../api/client.js'
import type { NormalizedOrder, ToolContext } from '../types.js'

class FakeCompletionClient implements CompletionClient {
  constructor(private readonly scripted: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {}

  async complete(_messages: ChatCompletionMessageParam[]) {
    const next = this.scripted.shift()
    if (!next) {
      return { content: 'done', toolCalls: [] }
    }
    return {
      content: next.content ?? '',
      toolCalls: next.toolCalls ?? [],
    }
  }
}

async function run(): Promise<void> {
  assert.equal(Object.keys(food4cities).length, 8)
  assert.deepEqual(food4cities.opalino, { chleb: 45, woda: 120, mlotek: 6 })

  assert.equal(isSafeDatabaseQuery('show tables'), true)
  assert.equal(isSafeDatabaseQuery('.schema users'), true)
  assert.equal(isSafeDatabaseQuery('select * from users'), true)
  assert.equal(isSafeDatabaseQuery('select * from users; select * from orders'), false)
  assert.equal(isSafeDatabaseQuery('delete from users'), false)

  const invalidOrders: NormalizedOrder[] = [
    {
      id: '1',
      title: 'Dostawa dla opalino',
      destination: 123,
      creatorID: 1,
      items: { chleb: 44, woda: 120 },
      raw: {},
    },
  ]
  const validation = validateOrders(invalidOrders)
  assert.equal(validation.ok, false)
  assert.ok(validation.issues.some((issue) => issue.type === 'wrong_quantity' && issue.item === 'chleb'))
  assert.ok(validation.issues.some((issue) => issue.type === 'missing_item' && issue.item === 'mlotek'))
  assert.ok(validation.issues.some((issue) => issue.type === 'missing_city' && issue.city === 'domatowo'))

  const specs = getToolSpecs()
  const finalize = specs.find((spec) => spec.definition.function.name === 'finalize')
  const create = specs.find((spec) => spec.definition.function.name === 'create_order')
  const query = specs.find((spec) => spec.definition.function.name === 'query_database')
  const resolveDestinations = specs.find((spec) => spec.definition.function.name === 'resolve_destinations')
  const deleteOrder = specs.find((spec) => spec.definition.function.name === 'delete_order')
  assert.ok(finalize)
  assert.ok(create)
  assert.ok(query)
  assert.ok(resolveDestinations)
  assert.ok(deleteOrder)
  assert.match(finalize.definition.function.description, /repair/i)
  assert.match(create.definition.function.description, /Dostawa dla <city>/i)
  const parameters = query.definition.function.parameters as {
    properties: { query: { type: string } }
    required: string[]
  }
  assert.equal(parameters.properties.query.type, 'string')
  assert.deepEqual(parameters.required, ['query'])
  assert.match(resolveDestinations.definition.function.description, /deterministically/i)
  assert.match(create.definition.function.description, /40-character SHA1 hash/i)

  const invalidCreate = await create.handler({
    title: 'Dostawa dla opalino',
    creatorID: 1,
    destination: 991828,
    signature: '...',
  }, {
    state: {
      lastFinalize: null,
      resetCount: 0,
      iteration: 0,
    },
  })
  assert.match(invalidCreate, /LOCAL_INVALID_SIGNATURE/)

  const guardedContext: ToolContext = {
    state: {
      lastFinalize: {
        success: false,
        message: 'System operators noticed irregularities.',
        affectedOrderIds: ['seed-1'],
        raw: '{"affected_order_ids":["seed-1"]}',
      },
      resetCount: 0,
      iteration: 0,
    },
  }
  await assert.rejects(
    () => deleteOrder.handler({ id: 'seed-1' }, guardedContext),
    /Do not delete it individually|Do not delete those flagged orders/i,
  )

  const apiOverrides = {
    ...client,
    getWarehouseHelp: async () => ({ ok: true, status: 200, raw: '{"message":"ok"}', json: { message: 'ok' }, durationMs: 1 }),
    queryDatabase: async () => ({ ok: true, status: 200, raw: '[]', json: [], durationMs: 1 }),
    getOrders: async () => ({
      ok: true,
      status: 200,
      raw: JSON.stringify({
        orders: [
          { id: '1', title: 'Dostawa dla opalino', items: { chleb: 45, woda: 120, mlotek: 6 } },
          { id: '2', title: 'Dostawa dla domatowo', items: { makaron: 60, woda: 150, lopata: 8 } },
          { id: '3', title: 'Dostawa dla brudzewo', items: { ryz: 55, woda: 140, wiertarka: 5 } },
          { id: '4', title: 'Dostawa dla darzlubie', items: { wolowina: 25, woda: 130, kilof: 7 } },
          { id: '5', title: 'Dostawa dla celbowo', items: { kurczak: 40, woda: 125, mlotek: 6 } },
          { id: '6', title: 'Dostawa dla mechowo', items: { ziemniaki: 100, kapusta: 70, marchew: 65, woda: 165, lopata: 9 } },
          { id: '7', title: 'Dostawa dla puck', items: { chleb: 50, ryz: 45, woda: 175, wiertarka: 7 } },
          { id: '8', title: 'Dostawa dla karlinkowo', items: { makaron: 52, wolowina: 22, ziemniaki: 95, woda: 155, kilof: 6 } },
        ],
      }),
      json: {
        orders: [
          { id: '1', title: 'Dostawa dla opalino', items: { chleb: 45, woda: 120, mlotek: 6 } },
          { id: '2', title: 'Dostawa dla domatowo', items: { makaron: 60, woda: 150, lopata: 8 } },
          { id: '3', title: 'Dostawa dla brudzewo', items: { ryz: 55, woda: 140, wiertarka: 5 } },
          { id: '4', title: 'Dostawa dla darzlubie', items: { wolowina: 25, woda: 130, kilof: 7 } },
          { id: '5', title: 'Dostawa dla celbowo', items: { kurczak: 40, woda: 125, mlotek: 6 } },
          { id: '6', title: 'Dostawa dla mechowo', items: { ziemniaki: 100, kapusta: 70, marchew: 65, woda: 165, lopata: 9 } },
          { id: '7', title: 'Dostawa dla puck', items: { chleb: 50, ryz: 45, woda: 175, wiertarka: 7 } },
          { id: '8', title: 'Dostawa dla karlinkowo', items: { makaron: 52, wolowina: 22, ziemniaki: 95, woda: 155, kilof: 6 } },
        ],
      },
      durationMs: 1,
    }),
    done: async () => ({ ok: true, status: 200, raw: '{FLG:ok}', json: { message: 'done' }, durationMs: 1 }),
  }

  const fake = new FakeCompletionClient([
    {
      toolCalls: [
        { id: '1', name: 'load_city_demands', arguments: '{}' },
        { id: '2', name: 'warehouse_help', arguments: '{}' },
        { id: '3', name: 'finalize', arguments: '{}' },
      ],
    },
  ])
  const result = await runAgent(fake, apiOverrides)
  assert.equal(result.success, true)
  assert.equal(result.flag, '{FLG:ok}')

  let doneCalls = 0
  const recoveryApi = {
    ...apiOverrides,
    done: async () => {
      doneCalls += 1
      if (doneCalls === 1) {
        return { ok: true, status: 200, raw: '{"message":"Wrong destination mapping"}', json: { message: 'Wrong destination mapping' }, durationMs: 1 }
      }
      return { ok: true, status: 200, raw: '{FLG:recovered}', json: { message: 'done' }, durationMs: 1 }
    },
  }
  const recoveringClient = new FakeCompletionClient([
    {
      toolCalls: [
        { id: '1', name: 'load_city_demands', arguments: '{}' },
        { id: '2', name: 'warehouse_help', arguments: '{}' },
        { id: '3', name: 'finalize', arguments: '{}' },
      ],
    },
    {
      toolCalls: [
        { id: '4', name: 'get_orders', arguments: '{}' },
        { id: '5', name: 'finalize', arguments: '{}' },
      ],
    },
  ])
  const recovered = await runAgent(recoveringClient, recoveryApi)
  assert.equal(recovered.success, true)
  assert.equal(recovered.flag, '{FLG:recovered}')
  assert.equal(doneCalls, 2)

  console.log('All checks passed.')
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
