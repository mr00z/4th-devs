import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { runAgent, type CompletionClient } from '../agent.js'
import * as client from '../api/client.js'

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

test('runAgent stops when finalize returns a flag', async () => {
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
})
