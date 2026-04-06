import { z } from 'zod'
import { buildManifestFromKnowledge } from './buildManifest.js'
import { normalizeCity, normalizeGood, normalizePersonFileName } from './normalize.js'
import type { ExtractedKnowledge, FilesystemManifest, ValidatedKnowledge } from '../types.js'

const extractedKnowledgeSchema = z.object({
  cityDemands: z.array(z.object({
    city: z.string(),
    rawGood: z.string(),
    quantity: z.number(),
    evidence: z.string(),
  })),
  cityContacts: z.array(z.object({
    city: z.string(),
    fullName: z.string(),
    evidence: z.string(),
  })),
  transactions: z.array(z.object({
    sellerCity: z.string(),
    rawGood: z.string(),
    buyerCity: z.string(),
    evidence: z.string(),
  })),
  ambiguities: z.array(z.string()),
})

const manifestSchema = z.object({
  directories: z.tuple([z.literal('/miasta'), z.literal('/osoby'), z.literal('/towary')]),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })),
})

const CONTACT_NAME_MAP: Record<string, string> = {
  kisiel: 'Rafal Kisiel',
  konkel: 'Lena Konkel',
  frantz: 'Marta Frantz',
}

export function validateExtractedKnowledge(value: unknown): ExtractedKnowledge {
  return extractedKnowledgeSchema.parse(value)
}

export function normalizeContactFullName(fullName: string): string {
  const normalized = fullName.trim().replace(/\s+/g, ' ')
  const mapped = CONTACT_NAME_MAP[normalized.toLowerCase()]
  return mapped || normalized
}

function scoreContactName(fullName: string): number {
  const parts = fullName.split(/\s+/).filter(Boolean)
  return parts.length * 100 + fullName.length
}

function choosePreferredContact(
  current: { city: string; fullName: string; fileName: string } | undefined,
  candidate: { city: string; fullName: string; fileName: string },
): { city: string; fullName: string; fileName: string } {
  if (!current) return candidate
  return scoreContactName(candidate.fullName) > scoreContactName(current.fullName) ? candidate : current
}

function validateDirectoryOrKeyName(name: string, maxLength: number, errors: string[], label: string): void {
  if (name.length > maxLength) errors.push(`${label} exceeds max length ${maxLength}: ${name}`)
  if (!/^[a-z0-9_]+$/.test(name)) errors.push(`${label} must match ^[a-z0-9_]+$: ${name}`)
}

function validateFileName(name: string, errors: string[], label: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) {
    errors.push(`${label} must match ^[a-z0-9_]+$: ${name}`)
  }
}

function normalizeLinkTarget(sourcePath: string, link: string): string {
  if (link.startsWith('/')) return link
  const sourceSegments = sourcePath.split('/').filter(Boolean)
  const baseSegments = sourceSegments.slice(0, -1)
  for (const segment of link.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      baseSegments.pop()
      continue
    }
    baseSegments.push(segment)
  }
  return `/${baseSegments.join('/')}`
}

function extractMarkdownLinks(sourcePath: string, content: string): string[] {
  return [...content.matchAll(/\]\(([^)]+)\)/g)].map((match) => normalizeLinkTarget(sourcePath, match[1]))
}

function compareExpectedLinks(actual: string[], expected: string[], label: string, errors: string[]): void {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)

  for (const link of expectedSet) {
    if (!actualSet.has(link)) {
      errors.push(`${label} missing required link: ${link}`)
    }
  }
  for (const link of actualSet) {
    if (!expectedSet.has(link)) {
      errors.push(`${label} includes unexpected link: ${link}`)
    }
  }
}

export function normalizeKnowledge(extracted: ExtractedKnowledge): ValidatedKnowledge {
  const cityDemands: ValidatedKnowledge['cityDemands'] = {}
  for (const fact of extracted.cityDemands) {
    const city = normalizeCity(fact.city)
    const good = normalizeGood(fact.rawGood)
    if (fact.quantity <= 0) continue
    if (!cityDemands[city]) cityDemands[city] = {}
    cityDemands[city][good] = fact.quantity
  }

  const contactMap = new Map<string, { city: string; fullName: string; fileName: string }>()
  for (const fact of extracted.cityContacts) {
    const city = normalizeCity(fact.city)
    const fullName = normalizeContactFullName(fact.fullName)
    const candidate = {
      city,
      fullName,
      fileName: normalizePersonFileName(fullName),
    }
    contactMap.set(city, choosePreferredContact(contactMap.get(city), candidate))
  }

  const demandCities = Object.keys(cityDemands).sort((a, b) => a.localeCompare(b))
  const missingContacts = demandCities.filter((city) => !contactMap.has(city))
  if (missingContacts.length > 0) {
    throw new Error(`missing city contacts for demanded cities: ${missingContacts.join(', ')}`)
  }

  const goodsToCitiesMap = new Map<string, Set<string>>()
  for (const transaction of extracted.transactions) {
    const good = normalizeGood(transaction.rawGood)
    const city = normalizeCity(transaction.sellerCity)
    if (!goodsToCitiesMap.has(good)) goodsToCitiesMap.set(good, new Set())
    goodsToCitiesMap.get(good)!.add(city)
  }

  return {
    cityDemands,
    cityContacts: demandCities.map((city) => contactMap.get(city)!).sort((a, b) => a.city.localeCompare(b.city)),
    goodsToCities: Object.fromEntries(
      [...goodsToCitiesMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([good, cities]) => [good, [...cities].sort()]),
    ),
  }
}

export function validateManifest(manifest: FilesystemManifest, knowledge?: ValidatedKnowledge): FilesystemManifest {
  const parsed = manifestSchema.parse(manifest)
  const errors: string[] = []
  const existingPaths = new Set(parsed.files.map((file) => file.path))
  const globalNames = new Set<string>()
  const seenCityFiles = new Set<string>()
  const seenPersonFiles = new Set<string>()
  const seenGoodsFiles = new Set<string>()
  const duplicatePaths = new Set<string>()
  const seenPaths = new Set<string>()

  for (const file of parsed.files) {
    if (seenPaths.has(file.path)) {
      duplicatePaths.add(file.path)
    }
    seenPaths.add(file.path)
  }
  if (duplicatePaths.size > 0) {
    errors.push(`duplicate file paths are not allowed: ${[...duplicatePaths].sort().join(', ')}`)
  }

  for (const directory of parsed.directories) {
    validateDirectoryOrKeyName(directory.slice(1), 30, errors, `directory ${directory}`)
    globalNames.add(directory.slice(1))
  }

  const expectedPersonByFile = knowledge
    ? new Map(knowledge.cityContacts.map((contact) => [contact.fileName, contact]))
    : new Map<string, ValidatedKnowledge['cityContacts'][number]>()
  const expectedGoodsByFile = knowledge
    ? new Map(Object.entries(knowledge.goodsToCities))
    : new Map<string, string[]>()

  const seenFilePaths = new Set<string>()
  for (const file of parsed.files) {
    if (seenFilePaths.has(file.path)) {
      continue
    }
    seenFilePaths.add(file.path)

    const segments = file.path.split('/').filter(Boolean)
    if (segments.length !== 2) {
      errors.push(`file path must be depth 2 from root: ${file.path}`)
      continue
    }
    const [directoryName, fileName] = segments
    validateFileName(fileName, errors, `file ${file.path}`)
    if (globalNames.has(fileName)) errors.push(`global name must be unique: ${fileName}`)
    globalNames.add(fileName)

    if (directoryName === 'miasta') {
      try {
        const parsedJson = JSON.parse(file.content) as Record<string, unknown>
        const city = fileName
        seenCityFiles.add(city)
        const expectedDemands = knowledge?.cityDemands[city] ?? null
        if (knowledge && !expectedDemands) {
          errors.push(`unexpected city file: ${file.path}`)
          continue
        }
        for (const [key, value] of Object.entries(parsedJson)) {
          validateDirectoryOrKeyName(key, 20, errors, `city json key ${key}`)
          if (typeof value !== 'number') errors.push(`city json values must be numbers in ${file.path}`)
          if (typeof value === 'number' && value <= 0) {
            errors.push(`city json values must be > 0 in ${file.path}: ${key}=${value}`)
          }
          if (expectedDemands && !(key in expectedDemands)) {
            errors.push(`city file includes unexpected good in ${file.path}: ${key}`)
          }
        }
        if (expectedDemands) {
          for (const [expectedGood, expectedQuantity] of Object.entries(expectedDemands)) {
            const actual = parsedJson[expectedGood]
            if (typeof actual !== 'number') {
              errors.push(`city file missing required good in ${file.path}: ${expectedGood}`)
              continue
            }
            if (actual !== expectedQuantity) {
              errors.push(`city file quantity mismatch in ${file.path}: ${expectedGood} expected ${expectedQuantity}, got ${actual}`)
            }
          }
        }
      } catch {
        errors.push(`city file must contain valid JSON: ${file.path}`)
      }
      continue
    }

    const links = extractMarkdownLinks(file.path, file.content)

    if (directoryName === 'osoby') {
      seenPersonFiles.add(fileName)
      const expectedContact = expectedPersonByFile.get(fileName)
      if (knowledge && !expectedContact) {
        errors.push(`unexpected person file: ${file.path}`)
      }
      if (links.length !== 1) {
        errors.push(`person file must contain exactly one city link: ${file.path}`)
      }
      if (expectedContact) {
        compareExpectedLinks(links, [`/miasta/${expectedContact.city}`], `person file ${file.path}`, errors)
      } else {
        for (const link of links) {
          if (!existingPaths.has(link)) errors.push(`markdown link target does not exist: ${file.path} -> ${link}`)
        }
      }
      continue
    }

    if (directoryName === 'towary') {
      seenGoodsFiles.add(fileName)
      const expectedCities = expectedGoodsByFile.get(fileName)
      if (knowledge && !expectedCities) {
        errors.push(`unexpected goods file: ${file.path}`)
      }
      if (expectedCities) {
        compareExpectedLinks(
          links,
          expectedCities.map((city) => `/miasta/${city}`),
          `goods file ${file.path}`,
          errors,
        )
      } else {
        for (const link of links) {
          if (!existingPaths.has(link)) errors.push(`markdown link target does not exist: ${file.path} -> ${link}`)
        }
      }
      continue
    }

    errors.push(`file must be inside /miasta, /osoby, or /towary: ${file.path}`)
  }

  if (knowledge) {
    for (const city of Object.keys(knowledge.cityDemands)) {
      if (!seenCityFiles.has(city)) {
        errors.push(`missing city file for demanded city: /miasta/${city}`)
      }
    }
    for (const contact of knowledge.cityContacts) {
      if (!seenPersonFiles.has(contact.fileName)) {
        errors.push(`missing person file for city contact: /osoby/${contact.fileName}`)
      }
    }
    for (const good of Object.keys(knowledge.goodsToCities)) {
      if (!seenGoodsFiles.has(good)) {
        errors.push(`missing goods file: /towary/${good}`)
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
  return parsed
}

export function buildValidatedManifest(knowledge: ValidatedKnowledge): FilesystemManifest {
  return validateManifest(buildManifestFromKnowledge(knowledge), knowledge)
}
