import { z } from 'zod'
import { applyFilesystemManifest, finalizeFilesystemTask, inspectVirtualDirectory, resetVirtualFilesystem } from './api/client.js'
import { callMcpTool } from './mcp.js'
import type { SourceNoteId, ToolContext, ToolDefinition, ToolSpec } from './types.js'

const NOTE_PATHS: Record<SourceNoteId, string> = {
  readme: 'natan_notes/README.md',
  ogloszenia: 'natan_notes/ogloszenia.txt',
  rozmowy: 'natan_notes/rozmowy.txt',
  transakcje: 'natan_notes/transakcje.txt',
}

const readNoteSchema = z.object({
  note: z.enum(['readme', 'ogloszenia', 'rozmowy', 'transakcje']),
})

const searchNotesSchema = z.object({
  query: z.string().min(1),
})

const delegateSchema = z.object({
  agent: z.enum(['notes_extractor', 'filesystem_architect']),
  task: z.string().min(1),
  input_json: z.string().default('{}'),
})

const delegateParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agent: {
      type: 'string',
      enum: ['notes_extractor', 'filesystem_architect'],
    },
    task: { type: 'string' },
    input_json: { type: 'string' },
  },
  required: ['agent', 'task', 'input_json'],
} as const

const manifestSchema = z.object({
  manifest: z.object({
    directories: z.tuple([z.literal('/miasta'), z.literal('/osoby'), z.literal('/towary')]),
    files: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })),
  }),
})

const applyManifestParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    manifest: {
      type: 'object',
      additionalProperties: false,
      properties: {
        directories: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'string', enum: ['/miasta', '/osoby', '/towary'] },
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['directories', 'files'],
    },
  },
  required: ['manifest'],
} as const

const inspectSchema = z.object({
  path: z.enum(['/', '/miasta', '/osoby', '/towary']).default('/'),
})

const inspectParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', enum: ['/', '/miasta', '/osoby', '/towary'] },
  },
  required: ['path'],
} as const

const noArgsSchema = z.object({})

function schemaToParameters(schema: z.AnyZodObject): Record<string, unknown> {
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  const toProperty = (value: z.ZodTypeAny): Record<string, unknown> => {
    if (value instanceof z.ZodDefault) {
      return toProperty(value._def.innerType)
    }
    if (value instanceof z.ZodRecord) {
      return { type: 'object', additionalProperties: false }
    }
    if (value instanceof z.ZodEnum) {
      return { type: 'string', enum: value.options }
    }
    if (value instanceof z.ZodString) {
      return { type: 'string' }
    }
    return { type: 'object', additionalProperties: false }
  }
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, toProperty(value)]),
    ),
    required: Object.keys(shape),
    additionalProperties: false,
  }
}

export function getToolSpecs(runDelegate: (args: { agent: 'notes_extractor' | 'filesystem_architect'; task: string; input: Record<string, unknown> }) => Promise<string>): ToolSpec[] {
  return [
    {
      roles: ['orchestrator', 'notes_extractor'],
      definition: {
        type: 'function',
        function: {
          name: 'read_natan_note',
          description: 'Read one source note through the local files MCP from tasks/s04/04/natan_notes/. Use readme first because it explains the role of each note. ogloszenia contains city demand, rozmowy contains conversation-based city/contact clues, transakcje contains seller city -> good -> buyer city facts.',
          parameters: schemaToParameters(readNoteSchema),
          strict: true,
        },
      },
      handler: async (args, ctx) => {
        const { note } = readNoteSchema.parse(args)
        const result = await callMcpTool(ctx.mcp.client, 'fs_read', {
          path: NOTE_PATHS[note],
        }) as { content?: { text?: string } }
        return typeof result?.content?.text === 'string' ? result.content.text : JSON.stringify(result)
      },
    },
    {
      roles: ['orchestrator', 'notes_extractor'],
      definition: {
        type: 'function',
        function: {
          name: 'search_natan_notes',
          description: 'Search the note set through files MCP for names, cities, or goods. Use only to verify or recover a missing fact. Prefer read_natan_note first. Search results are evidence, not final truth until corroborated.',
          parameters: schemaToParameters(searchNotesSchema),
          strict: true,
        },
      },
      handler: async (args, ctx) => {
        const { query } = searchNotesSchema.parse(args)
        const result = await callMcpTool(ctx.mcp.client, 'fs_search', {
          path: 'natan_notes',
          query,
          target: 'content',
          patternMode: 'literal',
          caseInsensitive: true,
          depth: 3,
          maxResults: 20,
          context: 1,
        })
        return JSON.stringify(result)
      },
    },
    {
      roles: ['orchestrator'],
      definition: {
        type: 'function',
        function: {
          name: 'delegate',
          description: 'Delegate only bounded tasks to notes_extractor or filesystem_architect. Specialist outputs are proposals for validation. Specialists do not perform remote writes.',
          parameters: delegateParameters,
          strict: true,
        },
      },
      handler: async (args) => {
        const hasLegacyInput = typeof (args as { input?: unknown }).input === 'object'
          && (args as { input?: unknown }).input !== null
        const normalizedArgs = hasLegacyInput
          ? {
            ...args,
            input_json: JSON.stringify((args as { input: Record<string, unknown> }).input),
          }
          : args

        const parsed = delegateSchema.parse(normalizedArgs)
        let input: Record<string, unknown>
        try {
          const decoded = JSON.parse(parsed.input_json) as unknown
          if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            throw new Error('input_json must decode to a JSON object')
          }
          input = decoded as Record<string, unknown>
        } catch (error) {
          throw new Error(`delegate input_json must be valid JSON object: ${String(error)}`)
        }
        return runDelegate({
          agent: parsed.agent,
          task: parsed.task,
          input,
        })
      },
    },
    {
      roles: ['orchestrator'],
      definition: {
        type: 'function',
        function: {
          name: 'reset_virtual_filesystem',
          description: 'Reset the remote virtual filesystem before final submission. This clears the entire virtual filesystem. Use once before final batch creation. Only the orchestrator may call this tool. Do not use for exploration.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        noArgsSchema.parse(args)
        const result = await resetVirtualFilesystem()
        return result.raw
      },
    },
    {
      roles: ['orchestrator'],
      definition: {
        type: 'function',
        function: {
          name: 'apply_filesystem_manifest',
          description: 'Create exactly the three required directories and all files in one batch from a validated manifest. This converts the manifest into sequential createDirectory and createFile API actions. Preferred write path. All content must already satisfy these rules: directory names max 30 chars and match ^[a-z0-9_]+$, file names max 20 chars and match ^[a-z0-9_]+$, max depth 3, global unique names, markdown links must point to existing created files, and city files must contain JSON with ASCII keys and numeric values only.',
          parameters: applyManifestParameters,
          strict: true,
        },
      },
      handler: async (args) => {
        const { manifest } = manifestSchema.parse(args)
        const result = await applyFilesystemManifest(manifest)
        return result.raw
      },
    },
    {
      roles: ['orchestrator'],
      definition: {
        type: 'function',
        function: {
          name: 'finalize_filesystem_task',
          description: 'Finalize the filesystem task after successful manifest application. Runs final validation against task rules and returns the flag on success.',
          parameters: schemaToParameters(noArgsSchema),
          strict: true,
        },
      },
      handler: async (args) => {
        noArgsSchema.parse(args)
        const result = await finalizeFilesystemTask()
        return result.raw
      },
    },
    {
      roles: ['orchestrator'],
      definition: {
        type: 'function',
        function: {
          name: 'inspect_virtual_directory',
          description: 'Optional debug tool for listing remote directories. Use only for recovery or inspection. It is not required in the happy path.',
          parameters: inspectParameters,
          strict: true,
        },
      },
      handler: async (args) => {
        const { path } = inspectSchema.parse(args)
        const result = await inspectVirtualDirectory(path)
        return result.raw
      },
    },
  ]
}

export function getToolDefinitions(specs: ToolSpec[], role: ToolContext['role']): ToolDefinition[] {
  return specs.filter((spec) => spec.roles.includes(role)).map((spec) => spec.definition)
}

export function findToolHandler(specs: ToolSpec[], role: ToolContext['role'], name: string): ToolSpec['handler'] | null {
  const found = specs.find((spec) => spec.roles.includes(role) && spec.definition.function.name === name)
  return found?.handler ?? null
}

