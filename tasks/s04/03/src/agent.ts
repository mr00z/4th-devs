import OpenAI from 'openai'
import { aiApiKey, chatApiBaseUrl, chatModel, extraApiHeaders, heartbeatIntervalMs, maxRuntimeMs, maxTurns } from './config.js'
import log from './logger.js'
import { createInitialContext, findTool, getToolDefinitions } from './tools.js'
import type { AgentContext } from './types.js'

const openai = aiApiKey
  ? new OpenAI({
    apiKey: aiApiKey,
    baseURL: chatApiBaseUrl,
    defaultHeaders: extraApiHeaders,
  })
  : null

const MISSION_RULES = [
  'Total budget: 300 AP',
  'Create scout: 5 AP',
  'Create transporter: 5 AP base + 5 AP per passenger',
  'Move scout: 7 AP per tile',
  'Move transporter: 1 AP per tile',
  'Inspect: 1 AP',
  'Dismount: 0 AP',
  'Transporters move on roads only.',
  'Scouts move only inside buildings.',
  'Inspect works on a scout\\\'s current position only.',
  'The helicopter may be called only after a scout confirms a human.',
  'Prefer transporter-assisted movement over long scout walks.',
  'Avoid redundant unit creation.',
  'Use read_logs after meaningful inspections.',
  'Use get_state_summary frequently to stay grounded.',
  'Use read_map when you need terrain plus current unit positions in one object.',
  'Do not guess the helicopter destination.',
]

const RADIO_CLUE = '"Przezylem. Bomby zniszczyly miasto. Zolnierze tu byli, szukali surowcow, zabrali rope. Teraz jest pusto. Mam bron, jestem ranny. Ukrylem sie w jednym z najwyzszych blokow. Nie mam jedzenia. Pomocy."'

const SYSTEM_PROMPT = `You are an autonomous rescue agent solving the Domatowo CTF challenge.

Goal:
- Find the hidden survivor in Domatowo and call the helicopter immediately after confirmation.

Facts:
${MISSION_RULES.slice(0, 6).map((rule) => `- ${rule}`).join('\n')}

Operational rules:
${MISSION_RULES.slice(6).map((rule) => `- ${rule}`).join('\n')}

Radio clue:
${RADIO_CLUE}

Style:
- Be agentic and decisive.
- Use tools to gather state before acting if uncertain.
- Keep responses short.
- If a guardrail blocks you, recover and choose a better next action.`

const PLANNING_PROMPT = `You are the mission planner for the Domatowo rescue challenge.

Your job is to produce a short execution plan before the autonomous tool loop begins.

Mission rules:
${MISSION_RULES.map((rule) => `- ${rule}`).join('\n')}

Radio clue:
${RADIO_CLUE}

Planning workflow:
- Call the get_map tool before finalizing the plan.
- Base the plan on the actual map returned by the tool.
- Favor the cheapest realistic opening that can inspect the highest-value buildings quickly.

Return JSON only with this shape:
{
  "missionGoal": string,
  "searchHypothesis": string,
  "priorityTargets": string[],
  "openingMoves": string[],
  "risks": string[]
}

Planning rules:
- Focus on the highest-value early search path.
- Prefer transporter-assisted scouting over long scout walks.
- Use only coordinates or terrain facts supported by the provided map data.
- Keep each list short and concrete.
- Do not invent a survivor location.`

interface MissionPlan {
  missionGoal: string
  searchHypothesis: string
  priorityTargets: string[]
  openingMoves: string[]
  risks: string[]
}

const missionPlanSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'mission_plan',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        missionGoal: { type: 'string' },
        searchHypothesis: { type: 'string' },
        priorityTargets: {
          type: 'array',
          items: { type: 'string' },
        },
        openingMoves: {
          type: 'array',
          items: { type: 'string' },
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['missionGoal', 'searchHypothesis', 'priorityTargets', 'openingMoves', 'risks'],
    },
  },
} as const

async function callTool(ctx: AgentContext, name: string, args: Record<string, unknown>): Promise<string> {
  const tool = findTool(name)
  if (!tool) {
    throw new Error(`Tool not found: ${name}`)
  }

  const result = await tool.handler(args, ctx)
  log.info('Tool executed', { name, args, result: result.slice(0, 500) })
  return result
}

function stringifyBootstrap(name: string, payload: string): string {
  return `${name}:\n${payload}`
}

async function createMissionPlan(args: {
  initialState: string
  initialMapSummary: string
  ctx: AgentContext
}): Promise<MissionPlan | null> {
  if (!openai) {
    return null
  }

  try {
    const planningMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: PLANNING_PROMPT },
      {
        role: 'user',
        content: [
          'Create the mission plan.',
          'You must inspect the actual map with get_map before producing the final plan.',
          stringifyBootstrap('Initial state', args.initialState),
          stringifyBootstrap('Initial map summary', args.initialMapSummary),
        ].join('\n\n'),
      },
    ]

    const planningToolCompletion = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.1,
      messages: planningMessages as never,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_map',
            description: 'Fetch the current Domatowo map with terrain, candidate buildings, and live unit positions.',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: {
          name: 'get_map',
        },
      },
    })

    const planningMessage = planningToolCompletion.choices[0]?.message
    if (!planningMessage) {
      return null
    }

    planningMessages.push({
      role: 'assistant',
      content: planningMessage.content ?? '',
      tool_calls: planningMessage.tool_calls as unknown as Record<string, unknown>[] | undefined,
    })

    for (const toolCall of planningMessage.tool_calls || []) {
      if (toolCall.function.name !== 'get_map') {
        continue
      }
      const mapPayload = await callTool(args.ctx, 'read_map', {})
      planningMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: mapPayload,
      })
    }

    const completion = await openai.beta.chat.completions.parse({
      model: chatModel,
      temperature: 0.1,
      response_format: missionPlanSchema,
      messages: [
        ...planningMessages,
        {
          role: 'user',
          content: 'Now return the final mission plan using the required structured schema.',
        },
      ] as never,
    })

    return completion.choices[0]?.message?.parsed as MissionPlan | null
  } catch (error) {
    log.warn('Failed to create mission plan', { error: String(error) })
    return null
  }
}

export async function runAgent(): Promise<string> {
  if (!openai) {
    throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is required for the agentic loop.')
  }

  const ctx = createInitialContext()
  const startedAt = Date.now()
  const deadline = startedAt + maxRuntimeMs
  let lastHeartbeatAt = startedAt

  const initialMap = await callTool(ctx, 'read_map', {})
  const initialState = await callTool(ctx, 'get_state_summary', {})
  const initialMapSummary = await callTool(ctx, 'get_map_summary', {})
  const missionPlan = await createMissionPlan({ ctx, initialState, initialMapSummary })

  if (missionPlan) {
    log.info('Mission plan created', missionPlan)
  }

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Mission started. The board has already been reset.',
        'Begin operating immediately.',
        stringifyBootstrap('Initial map', initialMap),
        stringifyBootstrap('Initial state', initialState),
        stringifyBootstrap('Initial map summary', initialMapSummary),
        missionPlan ? stringifyBootstrap('Mission plan', JSON.stringify(missionPlan, null, 2)) : '',
      ].join('\n\n'),
    },
  ]

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const now = Date.now()
    if (now > deadline) {
      throw new Error(`Runtime budget exceeded after ${maxRuntimeMs}ms without finding the flag.`)
    }

    if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
      lastHeartbeatAt = now
      log.info('Agent heartbeat', {
        turn,
        apRemaining: ctx.state.actionPointsRemaining,
        inspectedTiles: ctx.state.inspectedTiles.size,
        remainingCandidates: ctx.state.candidateTiles.size,
        survivorConfirmed: ctx.state.confirmedSurvivorTile,
      })
    }

    const completion = await openai.chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages: messages as never,
      tools: getToolDefinitions().map((definition) => ({
        type: 'function',
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        },
      })),
      tool_choice: 'auto',
    })

    const message = completion.choices[0]?.message
    if (!message) {
      throw new Error('Model returned no message.')
    }

    const assistantMessage: Record<string, unknown> = {
      role: 'assistant',
      content: message.content ?? '',
    }
    if (message.tool_calls) {
      assistantMessage.tool_calls = message.tool_calls as unknown as Record<string, unknown>[]
    }
    messages.push(assistantMessage)

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) as Record<string, unknown> : {}
        const result = await callTool(ctx, toolCall.function.name, args)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })

        if (ctx.doneFlag) {
          return ctx.doneFlag
        }
      }
      continue
    }

    const content = typeof message.content === 'string' ? message.content.trim() : ''
    log.info('Assistant reasoning', { turn, content: content.slice(0, 400) })

    if (ctx.doneFlag) {
      return ctx.doneFlag
    }

    messages.push({
      role: 'user',
      content: 'Continue by choosing the best next tool call. Do not stop until the survivor is confirmed and the helicopter is called.',
    })
  }

  throw new Error(`Turn limit reached (${maxTurns}) without obtaining the flag.`)
}
