import log from './logger.js'
import { hubApiKey } from './config.js'
import { vision } from './vision.js'
import fs from 'fs/promises'
import path from 'path'

const IMAGE_URL = `https://hub.ag3nts.org/data/${process.env.HUB_API_KEY}/drone.png`
const DESTINATION_OBJECT_ID = 'PWR6132PL'
const VERIFY_URL = 'https://hub.ag3nts.org/verify'
const CACHE_FILE_PATH = path.join(process.cwd(), '.cache', 'dam-sector.json')
const CACHE_TTL_MS = 60 * 60 * 1000

const ALLOWED_LITERAL_INSTRUCTIONS = new Set([
  'flyToLocation',
  'selfCheck',
  'getFirmwareVersion',
  'getConfig',
  'calibrateCompass',
  'calibrateGPS',
  'hardReset',
])

const ALLOWED_REGEX_INSTRUCTIONS: RegExp[] = [
  /^setDestinationObject\([A-Z]{3}[0-9]+[A-Z]{2}\)$/,
  /^set\(\d+,\d+\)$/,
  /^set\((engineON|engineOFF)\)$/,
  /^set\((100|[1-9][0-9]?)%\)$/,
  /^set\((100|[1-9][0-9]?)m\)$/,
  /^set\((video|image|destroy|return)\)$/,
  /^setName\(.+\)$/,
  /^setOwner\(.+\)$/,
  /^setLed\(#[0-9A-Fa-f]{6}\)$/,
]

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

interface SectorResult {
  row: number
  column: number
  confidence?: string
  evidence?: string
}

interface SectorCache {
  image_url: string
  created_at: number
  sector: SectorResult
}

let verificationAttempt = 0

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Vision did not return JSON: ${text}`)
  }
  return text.slice(start, end + 1)
}

function parseSectorResult(text: string): SectorResult {
  const parsed = JSON.parse(extractJsonObject(text)) as Partial<SectorResult>
  const row = Number(parsed.row)
  const column = Number(parsed.column)

  if (!Number.isInteger(row) || row < 1 || row > 4 || !Number.isInteger(column) || column < 1 || column > 3) {
    throw new Error(`Invalid sector from vision: ${text}`)
  }

  return {
    row,
    column,
    confidence: typeof parsed.confidence === 'string' ? parsed.confidence : undefined,
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : undefined,
  }
}

function buildSectorPayload(sector: SectorResult): string {
  return JSON.stringify({ image_url: IMAGE_URL, destination_object_id: DESTINATION_OBJECT_ID, ...sector })
}

async function readSectorCache(): Promise<SectorResult | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SectorCache>
    if (parsed.image_url !== IMAGE_URL || typeof parsed.created_at !== 'number' || !parsed.sector) {
      return null
    }

    const age = Date.now() - parsed.created_at
    if (age > CACHE_TTL_MS) {
      return null
    }

    const sector = parsed.sector
    if (
      !Number.isInteger(sector.row) || sector.row < 1 || sector.row > 4 ||
      !Number.isInteger(sector.column) || sector.column < 1 || sector.column > 3
    ) {
      return null
    }

    return {
      row: sector.row,
      column: sector.column,
      confidence: typeof sector.confidence === 'string' ? sector.confidence : undefined,
      evidence: typeof sector.evidence === 'string' ? sector.evidence : undefined,
    }
  } catch {
    return null
  }
}

async function writeSectorCache(sector: SectorResult): Promise<void> {
  const payload: SectorCache = {
    image_url: IMAGE_URL,
    created_at: Date.now(),
    sector,
  }

  await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true })
  await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function isValidApiInstruction(instruction: string): boolean {
  if (ALLOWED_LITERAL_INSTRUCTIONS.has(instruction)) {
    return true
  }

  return ALLOWED_REGEX_INSTRUCTIONS.some((pattern) => pattern.test(instruction))
}

function validateInstructions(instructions: string[]): string[] {
  return instructions
    .map((instruction) => instruction.trim())
    .filter((instruction) => !isValidApiInstruction(instruction))
}

async function locateDamSector(): Promise<string> {
  const cached = await readSectorCache()
  if (cached) {
    log.info('Using cached dam sector analysis (valid for 1 hour)')
    return buildSectorPayload(cached)
  }

  const question = [
    'You are analyzing one aerial image split into a 4x3 grid.',
    'Identify the single grid cell that contains a dam.',
    'Rows are numbered 1 to 4 from top to bottom.',
    'Columns are numbered 1 to 3 from left to right.',
    'If the dam spans multiple cells, choose the cell containing the visual center of the dam.',
    'Return strict JSON only in this format: {"row": number, "column": number, "confidence": "low|medium|high", "evidence": "short phrase"}.',
  ].join(' ')

  const raw = await vision(question, IMAGE_URL)
  const sector = parseSectorResult(raw)
  await writeSectorCache(sector)
  return buildSectorPayload(sector)
}

async function callVerifyApi(body: Record<string, unknown>): Promise<string> {
  verificationAttempt += 1

  try {
    log.verification(verificationAttempt)
    console.log(`         Sending to: ${VERIFY_URL}`)

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: hubApiKey, ...body }),
    })

    const data = await response.text()
    console.log(`         Raw Response Status: ${response.status} ${response.statusText}`)
    console.log(`         Raw Response Body: ${data}`)

    if (!response.ok) {
      log.verificationResult(false, `HTTP ${response.status} ${response.statusText}: ${data}`)
      return `Error: API error: ${response.status} ${response.statusText} - ${data}`
    }

    log.verificationResult(true, data)
    return data
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.verificationResult(false, msg)
    return `Error: ${msg}`
  }
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'locate_dam_sector',
      description: 'Analyze the drone target image and return the 3x3 grid sector containing the dam.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async () => {
      log.tool('locate_dam_sector', {})
      try {
        const result = await locateDamSector()
        log.toolResult('locate_dam_sector', true, result)
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.toolResult('locate_dam_sector', false, msg)
        return `Error: ${msg}`
      }
    },
  },
  {
    definition: {
      type: 'function',
      name: 'submit_instructions',
      description: 'Submit the current drone instruction list for verification. Instructions must contain only the steps necessary to destroy the correct sector.',
      parameters: {
        type: 'object',
        properties: {
          instructions: {
            type: 'array',
            description: 'Ordered list of drone instructions to verify.',
            items: { type: 'string' },
          },
        },
        required: ['instructions'],
      },
    },
    handler: async (args) => {
      const instructions = Array.isArray(args.instructions)
        ? args.instructions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []

      if (instructions.length === 0) {
        return 'Missing required field: instructions'
      }

      const invalidInstructions = validateInstructions(instructions)
      if (invalidInstructions.length > 0) {
        return `Invalid instructions (not in API spec): ${invalidInstructions.join(', ')}. Use exact API formats, e.g. setDestinationObject(PWR6132PL), set(destroy), flyToLocation (without parentheses).`
      }

      const requestBody = {
        task: 'drone',
        answer: {
          instructions,
        },
      }

      log.tool('submit_instructions', { instructions })
      console.log(`         Request Body: ${JSON.stringify(requestBody, null, 2)}`)

      const result = await callVerifyApi(requestBody)
      log.toolResult('submit_instructions', !result.startsWith('Error'), result)
      return result
    },
  },
]

export { DESTINATION_OBJECT_ID, IMAGE_URL, tools }

export const findTool = (name: string): Tool | undefined =>
  tools.find((tool) => tool.definition.name === name)
