import type { CaptureRecord, Clue } from './types.js'

interface CityCatalogEntry {
  name: string
  occupiedArea: number
  riverAccess: boolean
  farmAnimals: boolean
  inhabitants: number
}

interface CityTradeProfile {
  wants: Set<string>
  offers: Set<string>
  barter: Set<string>
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function stemPolishPlace(value: string): string {
  return normalizeForMatch(value)
    .replace(/^(z|ze)\s+/, '')
    .replace(/(ami|ach|owie|ego|emu|owi|ie|y|a|u|em)$/i, '')
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return dp[a.length][b.length]
}

function captureBody(capture: CaptureRecord): string {
  return [capture.message, capture.transcription, capture.decodedText, capture.summary].filter(Boolean).join('\n')
}

function parseCatalogEntries(captures: CaptureRecord[]): CityCatalogEntry[] {
  for (const capture of captures) {
    if (capture.kind !== 'attachment' || !capture.attachment?.mimeType.includes('json') || !capture.decodedText) continue
    try {
      const parsed = JSON.parse(capture.decodedText) as unknown
      if (!Array.isArray(parsed)) continue
      const entries = parsed.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const candidate = item as Record<string, unknown>
        if (typeof candidate.name !== 'string' || typeof candidate.occupiedArea !== 'number' || typeof candidate.riverAccess !== 'boolean' || typeof candidate.farmAnimals !== 'boolean' || typeof candidate.inhabitants !== 'number') {
          return []
        }
        return [{
          name: candidate.name,
          occupiedArea: candidate.occupiedArea,
          riverAccess: candidate.riverAccess,
          farmAnimals: candidate.farmAnimals,
          inhabitants: candidate.inhabitants,
        }]
      })
      if (entries.length > 0) return entries
    } catch {
      // Ignore malformed JSON attachments here.
    }
  }
  return []
}

function canonicalizeGood(value: string): string {
  const normalized = normalizeForMatch(value)
  if (/bydl|wolow|krow/.test(normalized)) return 'animals'
  if (/kilof/.test(normalized)) return 'kilof'
  if (/lopat/.test(normalized)) return 'lopata'
  if (/wod/.test(normalized)) return 'woda'
  if (/ziemniak/.test(normalized)) return 'ziemniaki'
  if (/ryb/.test(normalized)) return 'ryba'
  return normalized
}

function parseTradeProfiles(captures: CaptureRecord[]): Map<string, CityTradeProfile> {
  const profiles = new Map<string, CityTradeProfile>()
  for (const capture of captures) {
    if (!capture.decodedText?.includes('miasto,akcja,towar')) continue
    const lines = capture.decodedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    for (const line of lines.slice(1)) {
      const [city, action, goods, , barter] = line.split(',').map((part) => part?.trim() ?? '')
      if (!city) continue
      const key = normalizeForMatch(city)
      const profile = profiles.get(key) ?? { wants: new Set<string>(), offers: new Set<string>(), barter: new Set<string>() }
      if (action === 'szuka' && goods) profile.wants.add(canonicalizeGood(goods))
      if (action === 'sprzedaje' && goods) profile.offers.add(canonicalizeGood(goods))
      if (barter && !/kontakt|ustalenia|priv|robotnik/.test(normalizeForMatch(barter))) profile.barter.add(canonicalizeGood(barter))
      profiles.set(key, profile)
    }
  }
  return profiles
}

function scoreMentionAgainstCity(text: string, cityName: string): { exact: boolean; fuzzy: boolean } {
  const normalizedText = normalizeForMatch(text)
  const normalizedCity = normalizeForMatch(cityName)
  if (normalizedText.includes(normalizedCity)) {
    return { exact: true, fuzzy: true }
  }
  const cityStem = stemPolishPlace(cityName)
  const tokens = normalizedText.split(/[^a-z0-9]+/).filter((token) => token.length >= 5)
  for (const token of tokens) {
    const tokenStem = stemPolishPlace(token)
    if (!tokenStem || !cityStem) continue
    if (tokenStem === cityStem) return { exact: false, fuzzy: true }
    if (levenshtein(tokenStem, cityStem) <= 1) return { exact: false, fuzzy: true }
  }
  return { exact: false, fuzzy: false }
}

function scoreCity(entry: CityCatalogEntry, captures: CaptureRecord[], trades: Map<string, CityTradeProfile>): { score: number; reasons: string[]; warehouseCount: number | null } {
  let score = 0
  const reasons: string[] = []
  let warehouseCount: number | null = null
  const profile = trades.get(normalizeForMatch(entry.name))
  const syjon = trades.get('syjon')

  if (syjon) {
    if (syjon.wants.has('kilof') && profile?.wants.has('kilof')) {
      score += 1.1
      reasons.push('trade profile matches Syjon kilof demand')
    }
    if (syjon.offers.has('animals') && (profile?.offers.has('animals') || profile?.barter.has('animals'))) {
      score += 1.5
      reasons.push('trade profile matches Syjon animal supply')
    }
  }

  for (const capture of captures) {
    const body = captureBody(capture)
    if (!body) continue
    const mention = scoreMentionAgainstCity(body, entry.name)
    if (!mention.fuzzy) continue

    const normalizedBody = normalizeForMatch(body)
    if (mention.exact) {
      score += 0.5
      reasons.push(`exact city mention in ${capture.id}`)
    } else {
      score += 0.8
      reasons.push(`fuzzy city mention in ${capture.id}`)
    }

    if (entry.farmAnimals && /(bydl|wolow|krow|zwierzat)/.test(normalizedBody)) {
      score += 1.2
      reasons.push(`animals clue in ${capture.id}`)
    }
    if (entry.riverAccess && /(wod|rzek|oczyszczaj|sciek|pic|plynie)/.test(normalizedBody)) {
      score += 1.2
      reasons.push(`water clue in ${capture.id}`)
    }
    const warehouseClue = capture.clues.find((clue) => clue.field === 'warehousesCount')
    if (warehouseClue && warehouseCount === null) {
      warehouseCount = Number(warehouseClue.value)
      score += 2.6
      reasons.push(`warehouse clue linked via ${capture.id}`)
    }
  }

  if (entry.farmAnimals && entry.riverAccess) {
    for (const capture of captures) {
      const normalizedBody = normalizeForMatch(captureBody(capture))
      if (!normalizedBody.includes('syjon')) continue
      if (/(bydl|krow|wolow)/.test(normalizedBody) && /(wod|produkcje|eksportujemy)/.test(normalizedBody)) {
        score += 1.1
        reasons.push(`Syjon livestock+water description aligns in ${capture.id}`)
      }
    }
  }

  return { score, reasons, warehouseCount }
}

export function deriveCatalogClues(captures: CaptureRecord[]): Clue[] {
  const entries = parseCatalogEntries(captures)
  if (entries.length === 0) return []

  const trades = parseTradeProfiles(captures)
  const scored = entries
    .map((entry) => ({ entry, ...scoreCity(entry, captures, trades) }))
    .sort((left, right) => right.score - left.score)

  const best = scored[0]
  const runnerUp = scored[1]
  if (!best || best.score < 3.5) return []
  if (runnerUp && best.score - runnerUp.score < 1.0) return []

  const clues: Clue[] = [
    {
      field: 'cityName',
      value: best.entry.name,
      confidence: Math.min(2.4, best.score / 2),
      sourceId: 'derived:catalog-match',
      reason: `Catalog-backed city match: ${best.reasons.slice(0, 4).join('; ')}`,
    },
    {
      field: 'cityArea',
      value: String(best.entry.occupiedArea),
      confidence: 1.15,
      sourceId: 'derived:catalog-match',
      reason: `City area taken from catalog row for ${best.entry.name}`,
    },
  ]

  if (best.warehouseCount !== null) {
    clues.push({
      field: 'warehousesCount',
      value: best.warehouseCount,
      confidence: 1.1,
      sourceId: 'derived:catalog-match',
      reason: `Warehouse count linked to ${best.entry.name} via city mention and catalog-backed match`,
    })
  }

  return clues
}
