import OpenAI from 'openai'
import { aiApiKey, chatApiBaseUrl, extraApiHeaders, maxTurns, roleChatModels } from './config.js'
import log from './logger.js'
import { applyFilesystemManifest, finalizeFilesystemTask, resetVirtualFilesystem } from './api/client.js'
import { extractKnowledgeFallback } from './core/extractFallback.js'
import { buildValidatedManifest, normalizeKnowledge, validateExtractedKnowledge, validateManifest } from './core/validate.js'
import { buildManifestFromKnowledge } from './core/buildManifest.js'
import { getToolDefinitions, getToolSpecs, findToolHandler } from './tools.js'
import type { AgentRole, ExtractedKnowledge, FilesystemManifest, ToolContext } from './types.js'

const openai = new OpenAI({
  apiKey: aiApiKey,
  baseURL: chatApiBaseUrl,
  defaultHeaders: extraApiHeaders,
})

const COMMON_TASK_CONTEXT = `Task context:
- You are organizing Natan Rams's trade notes into a remote virtual filesystem.

Source context:
- readme explains what each note file means.
- ogloszenia contains city demand.
- rozmowy contains city contact clues.
- transakcje contains seller city -> good -> buyer city records.`

const ORCHESTRATOR_CONTEXT = `${COMMON_TASK_CONTEXT}

Filesystem rules:
- The remote task expects exactly three directories: /miasta, /osoby, /towary.
- /miasta/<city> files must contain JSON only. Each JSON object stores goods that the city needs and numeric quantities without units.
- /osoby/<person_file> files must contain markdown only. Each file describes one responsible trade contact and must include a markdown link to the city file they manage.
- /towary/<good> files must contain markdown only. Each file lists the seller cities that offer that good, using markdown links to city files.
- Output names must use ASCII only, lowercase, and underscores where needed.
- Don't include extensions in file and directory names.
- Directory names max length: 30.
- File names max length: 20.
- Maximum directory depth: 3.
- Names must be globally unique across the virtual filesystem.
- Markdown links must point to files that exist in the manifest.`

const EXTRACTOR_CONTEXT = `${COMMON_TASK_CONTEXT}

Extraction rules:
- use evidence from the notes, not prior world knowledge.
- do not infer extra cities or goods.
- preserve evidence and original wording where useful.
- do not normalize names for paths, links, or filenames.`

const ARCHITECT_CONTEXT = `Manifest design context:
- You receive validated, normalized knowledge and must not reinterpret raw notes.
- Build exactly three directories: /miasta, /osoby, /towary.
- /miasta files must contain JSON only.
- For each /miasta/<city>, include only goods required by that city from input knowledge.
- Never include zero quantities or placeholder goods.
- City JSON must match input quantities exactly for that city.
- /osoby files must contain markdown only and link to exactly one city file.
- /towary files must contain markdown only and link to seller city files.
- Output names must use ASCII only, lowercase, and underscores where needed.
- Don't include extensions in file and directory names.
- Directory names max length: 30.
- File names max length: 20.
- Maximum directory depth: 3.
- Names must be globally unique across the virtual filesystem.
- Markdown links must point to files that exist in the manifest.`

const extractorJsonSchema = {
  name: 'notes_extractor_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cityDemands: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            city: { type: 'string' },
            rawGood: { type: 'string' },
            quantity: { type: 'number' },
            evidence: { type: 'string' },
          },
          required: ['city', 'rawGood', 'quantity', 'evidence'],
        },
      },
      cityContacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            city: { type: 'string' },
            fullName: { type: 'string' },
            evidence: { type: 'string' },
          },
          required: ['city', 'fullName', 'evidence'],
        },
      },
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sellerCity: { type: 'string' },
            rawGood: { type: 'string' },
            buyerCity: { type: 'string' },
            evidence: { type: 'string' },
          },
          required: ['sellerCity', 'rawGood', 'buyerCity', 'evidence'],
        },
      },
      ambiguities: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['cityDemands', 'cityContacts', 'transactions', 'ambiguities'],
  },
} as const

const architectJsonSchema = {
  name: 'filesystem_architect_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      directories: {
        type: 'array',
        items: { type: 'string', enum: ['/miasta', '/osoby', '/towary'] },
        minItems: 3,
        maxItems: 3,
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
} as const

const PROFILES: Record<AgentRole, string> = {
  orchestrator: `You are the orchestrator for a task that converts Natan Rams's chaotic trade notes into a remote virtual filesystem.

Goals:
- use delegated specialists
- validate all specialist output
- only you may mutate the remote virtual filesystem
- prefer the happy path: delegate extraction, normalize, delegate manifest design, validate, reset, apply manifest, finalize

Important:
- rely on the tool descriptions
- keep tool usage purposeful
- after specialist output comes back, you must continue until the task is completed

${ORCHESTRATOR_CONTEXT}`,
  notes_extractor: `You are the notes_extractor specialist for Natan Rams's trade-note cleanup task.

Rules:
- start from read_natan_note(readme)
- then read the three notes
- extract only facts with evidence
- cityDemands must come from ogloszenia demand notes
- cityContacts must come from rozmowy
- transactions must come from transakcje
- if a clue is incomplete, record an ambiguity instead of guessing
- do not normalize filenames or markdown links
- do not propose API actions
- final answer will be collected via structured output, so focus on correctness and evidence

${EXTRACTOR_CONTEXT}`,
  filesystem_architect: `You are the filesystem_architect specialist for the Natan Rams trade-note task.

Rules:
- you receive already validated normalized knowledge
- produce exactly three directories: /miasta, /osoby, /towary
- city files must contain JSON only
- person and goods files must contain markdown only
- person files must include a markdown link to exactly one city file
- goods files must include markdown links to seller city files
- no extra folders
- no extra files
- do not emit raw API actions
- final answer will be collected via structured output, so focus on manifest correctness

${ARCHITECT_CONTEXT}`,
}

function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Agent did not return JSON.')
    return JSON.parse(match[0])
  }
}

function getStructuredSchema(role: AgentRole) {
  if (role === 'notes_extractor') {
    return extractorJsonSchema
  }
  if (role === 'filesystem_architect') {
    return architectJsonSchema
  }
  return null
}

function normalizeManifestForComparison(manifest: FilesystemManifest): FilesystemManifest {
  return {
    directories: [...manifest.directories].sort() as FilesystemManifest['directories'],
    files: [...manifest.files].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function manifestSignature(manifest: FilesystemManifest): string {
  return JSON.stringify(normalizeManifestForComparison(manifest))
}

export function selectManifestForExecution(args: {
  validatedKnowledge: ToolContext['validatedKnowledge']
  architectResult: string
}): { manifest: FilesystemManifest; usedDeterministicFallback: boolean; reason?: string } {
  if (!args.validatedKnowledge) {
    throw new Error('validatedKnowledge is required')
  }

  const canonicalManifest = buildValidatedManifest(args.validatedKnowledge)

  try {
    const candidate = validateManifest(extractJsonBlock(args.architectResult) as FilesystemManifest, args.validatedKnowledge)
    if (manifestSignature(candidate) !== manifestSignature(canonicalManifest)) {
      return {
        manifest: canonicalManifest,
        usedDeterministicFallback: true,
        reason: 'Architect manifest differs from canonical deterministic manifest.',
      }
    }
    return {
      manifest: canonicalManifest,
      usedDeterministicFallback: false,
    }
  } catch (error) {
    return {
      manifest: canonicalManifest,
      usedDeterministicFallback: true,
      reason: `Architect manifest invalid: ${String(error)}`,
    }
  }
}

async function executeManifestDeterministically(manifest: FilesystemManifest): Promise<string> {
  let lastResponse = ''

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const resetResult = await resetVirtualFilesystem()
    lastResponse = resetResult.raw
    if (!resetResult.ok) {
      log.warn('Filesystem reset failed before apply', {
        attempt,
        response: resetResult.raw.slice(0, 500),
      })
      continue
    }

    const applyResult = await applyFilesystemManifest(manifest)
    lastResponse = applyResult.raw
    if (!applyResult.ok) {
      log.warn('Manifest apply failed', {
        attempt,
        response: applyResult.raw.slice(0, 500),
      })
      continue
    }

    const finalizeResult = await finalizeFilesystemTask()
    lastResponse = finalizeResult.raw
    if (finalizeResult.raw.includes('{FLG:')) {
      return finalizeResult.raw
    }

    log.warn('Finalize returned without flag after deterministic apply', {
      attempt,
      response: finalizeResult.raw.slice(0, 500),
    })
  }

  return lastResponse
}

async function runRole(args: {
  role: AgentRole
  userContent: string
  ctx: ToolContext
  runDelegate: (args: { agent: 'notes_extractor' | 'filesystem_architect'; task: string; input: Record<string, unknown> }) => Promise<string>
}): Promise<string> {
  const model = roleChatModels[args.role]
  const specs = getToolSpecs(args.runDelegate)
  const toolDefinitions = getToolDefinitions(specs, args.role)
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: PROFILES[args.role] },
    { role: 'user', content: args.userContent },
  ]

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const completion = await openai.chat.completions.create({
      model,
      // temperature: 0.1,
      messages: messages as never,
      tools: toolDefinitions,
      tool_choice: 'auto',
    })

    const message = completion.choices[0]?.message
    if (!message) throw new Error(`No message returned for role ${args.role}`)

    messages.push(message as never)
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const schema = getStructuredSchema(args.role)
      if (!schema) {
        return message.content || ''
      }

      const structured = await openai.chat.completions.create({
        model,
        // temperature: 0,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Return the final result using the required structured schema only.',
          },
        ] as never,
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
      })

      const structuredContent = structured.choices[0]?.message?.content
      if (!structuredContent) {
        throw new Error(`No structured output returned for role ${args.role}`)
      }
      return structuredContent
    }

    for (const toolCall of message.tool_calls) {
      const handler = findToolHandler(specs, args.role, toolCall.function.name)
      if (!handler) throw new Error(`Tool not available for role ${args.role}: ${toolCall.function.name}`)
      const parsedArgs = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>
      log.agent(`${args.role} -> ${toolCall.function.name}`, parsedArgs)
      let result: string
      try {
        result = await handler(parsedArgs, args.ctx)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(`${args.role} tool call failed`, {
          tool: toolCall.function.name,
          message,
        })
        result = JSON.stringify({
          ok: false,
          error: message,
          tool: toolCall.function.name,
          hint: 'Recover by adjusting arguments, inspecting state, or choosing another tool.',
        })
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      } as never)
    }
  }

  throw new Error(`Agent loop exceeded max turns for ${args.role}`)
}

export async function runWorkflow(ctx: ToolContext): Promise<string> {
  const delegate = async (args: { agent: 'notes_extractor' | 'filesystem_architect'; task: string; input: Record<string, unknown> }): Promise<string> => {
    const content = `${args.task}\n\nInput JSON:\n${JSON.stringify(args.input, null, 2)}`
    return runRole({
      role: args.agent,
      userContent: content,
      ctx,
      runDelegate: async () => {
        throw new Error('Specialist agents cannot delegate further.')
      },
    })
  }

  const extractorResult = await delegate({
    agent: 'notes_extractor',
    task: `Read the source notes and extract candidate facts with evidence.

Required result:
- cityDemands: facts from ogloszenia only
- cityContacts: person-to-city responsibility clues from rozmowy only
- transactions: seller city -> good -> buyer city facts from transakcje only
- ambiguities: unresolved issues, if any

Do not normalize names. Do not propose directories, files, markdown links, or API actions.`,
    input: {},
  })
  const extractorOutputPath = log.saveWorkspaceText('notes_extractor-output.json', extractorResult)
  log.info('Saved notes_extractor output', { path: extractorOutputPath })

  let extracted: ExtractedKnowledge
  try {
    extracted = validateExtractedKnowledge(extractJsonBlock(extractorResult))
  } catch (error) {
    log.warn('Specialist extraction invalid, using deterministic fallback', { error: String(error) })
    const specs = getToolSpecs(delegate)
    const read = specs.find((spec) => spec.definition.function.name === 'read_natan_note')
    if (!read) throw new Error('read_natan_note tool is required for fallback')
    const readme = await read.handler({ note: 'readme' }, ctx)
    const ogloszenia = await read.handler({ note: 'ogloszenia' }, ctx)
    const rozmowy = await read.handler({ note: 'rozmowy' }, ctx)
    const transakcje = await read.handler({ note: 'transakcje' }, ctx)
    extracted = extractKnowledgeFallback({ readme, ogloszenia, rozmowy, transakcje })
  }

  const validatedKnowledge = normalizeKnowledge(extracted)
  ctx.validatedKnowledge = validatedKnowledge

  const architectResult = await delegate({
    agent: 'filesystem_architect',
    task: `Produce the final manifest for the required virtual filesystem.

Requirements:
- directories must be exactly /miasta, /osoby, /towary
- /miasta files contain JSON only
- each city file must include only that city's demanded goods from input
- do not include zero quantities, nulls, placeholders, or goods from other cities
- /osoby files contain markdown only and link to one city file
- /towary files contain markdown only and link to seller city files
- no extra directories
- no extra files
- do not output API actions`,
    input: validatedKnowledge as unknown as Record<string, unknown>,
  })
  const architectOutputPath = log.saveWorkspaceText('filesystem_architect-output.json', architectResult)
  log.info('Saved filesystem_architect output', { path: architectOutputPath })

  const manifestSelection = selectManifestForExecution({
    validatedKnowledge,
    architectResult,
  })
  let manifest = manifestSelection.manifest
  if (manifestSelection.usedDeterministicFallback) {
    log.warn('Architect manifest rejected, using deterministic manifest builder', {
      reason: manifestSelection.reason,
    })
  }

  log.info('Validated manifest ready', {
    directories: manifest.directories,
    files: manifest.files.length,
  })

  const orchestratorResult = await executeManifestDeterministically(manifest)
  const orchestratorOutputPath = log.saveWorkspaceText('orchestrator-output.txt', orchestratorResult)
  log.info('Saved orchestrator output', { path: orchestratorOutputPath })
  const manifestPath = log.saveWorkspaceText('validated-manifest.json', JSON.stringify(manifest, null, 2))
  log.info('Saved validated manifest', { path: manifestPath })
  return orchestratorResult
}

export function buildDeterministicManifestForTests(knowledge: ToolContext['validatedKnowledge']): FilesystemManifest {
  if (!knowledge) throw new Error('validatedKnowledge is required')
  return buildManifestFromKnowledge(knowledge)
}
