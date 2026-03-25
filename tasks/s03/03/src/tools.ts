import { assessOptions, executeCommand, getStateForRecovery, type ReactorCommand } from './reactor.js'

interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>) => Promise<string>
}

function normalizeCommand(raw: unknown): ReactorCommand | null {
  if (typeof raw !== 'string') {
    return null
  }
  const value = raw.trim().toLowerCase()
  if (value === 'start' || value === 'reset' || value === 'left' || value === 'wait' || value === 'right') {
    return value
  }
  return null
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'reactor_step',
      description:
        'Execute one reactor command (start/reset/left/wait/right). Returns compact safety summary, not full board dump.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['start', 'reset', 'left', 'wait', 'right'],
          },
          rationale: {
            type: 'string',
            description: 'Optional reason for traceability.',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    handler: async (args): Promise<string> => {
      const command = normalizeCommand(args.command)
      if (!command) {
        return 'Error: command must be one of start/reset/left/wait/right'
      }
      return executeCommand(command)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'assess_options',
      description:
        'Inspect current reactor state and return compact move safety assessment plus recommended move.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async (): Promise<string> => {
      return assessOptions()
    },
  },
  {
    definition: {
      type: 'function',
      name: 'explain_recovery',
      description:
        'Return condensed internal state + recent command history to help recover from anomalies or loops.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async (): Promise<string> => {
      return getStateForRecovery()
    },
  },
]

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.definition.name === name)
}

export { tools }
