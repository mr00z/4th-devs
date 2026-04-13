import type { Clue } from '../types.js'

const noisePatterns = [
  /\bbz+t+\b/gi,
  /\bk+s+h+\b/gi,
  /\bk+s+s+s*h+\b/gi,
  /\btrzask\b/gi,
  /\bpisk\b/gi,
  /\bszum\b/gi,
  /\bkh+h+\b/gi,
]

const numberWords: Record<string, number> = {
  zero: 0, jeden: 1, jedna: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5, szesc: 6, siedem: 7, osiem: 8, dziewiec: 9,
  dziesiec: 10, jedenascie: 11, dwanascie: 12, trzynascie: 13, czternascie: 14, pietnascie: 15, szesnascie: 16, siedemnascie: 17, osiemnascie: 18, dziewietnascie: 19,
  dwadziescia: 20, trzydziesci: 30, czterdziesci: 40, piecdziesiat: 50, szescdziesiat: 60, siedemdziesiat: 70, osiemdziesiat: 80, dziewiecdziesiat: 90, sto: 100,
  pierwszy: 1, pierwsza: 1, pierwsze: 1,
  drugi: 2, druga: 2, drugie: 2,
  trzeci: 3, trzecia: 3, trzecie: 3,
  czwarty: 4, czwarta: 4, czwarte: 4,
  piaty: 5, piatej: 5, piata: 5, piate: 5,
  szosty: 6, szosta: 6, szoste: 6,
  siodmy: 7, siodma: 7, siodme: 7,
  osmy: 8, osma: 8, osme: 8,
  dziewiaty: 9, dziewiata: 9, dziewiate: 9,
  dziesiaty: 10, dziesiata: 10, dziesiate: 10,
  jedenasty: 11, jedenasta: 11, jedenaste: 11,
  dwunasty: 12, dwunasta: 12, dwunaste: 12,
  trzynasty: 13, trzynasta: 13, trzynaste: 13,
  czternasty: 14, czternasta: 14, czternaste: 14,
  pietnasty: 15, pietnasta: 15, pietnaste: 15,
  szesnasty: 16, szesnasta: 16, szesnaste: 16,
  siedemnasty: 17, siedemnasta: 17, siedemnaste: 17,
  osiemnasty: 18, osiemnasta: 18, osiemnaste: 18,
  dziewietnasty: 19, dziewietnasta: 19, dziewietnaste: 19,
  dwudziesty: 20, dwudziesta: 20, dwudzieste: 20,
}

export function normalizeText(input: string): string {
  let output = input
  for (const pattern of noisePatterns) {
    output = output.replace(pattern, ' ')
  }
  return output.replace(/\s+/g, ' ').trim()
}

export function textLooksMostlyNoise(input: string): boolean {
  const normalized = normalizeText(input)
  if (!normalized) return true
  if (normalized.length < 8) return true
  const letters = normalized.match(/[\p{L}]/gu)?.length ?? 0
  return letters / Math.max(1, normalized.length) < 0.45
}

function parseNumberToken(value: string): number | null {
  const normalized = value.trim().toLowerCase()
  if (/^\d+$/.test(normalized)) {
    return Number(normalized)
  }
  return numberWords[normalized] ?? null
}

function pushWarehouseClue(clues: Clue[], value: number, confidence: number, sourceId: string, reason: string): void {
  clues.push({ field: 'warehousesCount', value, confidence, sourceId, reason })
}

function localContext(text: string, index: number, length: number): string {
  return text.slice(Math.max(0, index - 50), Math.min(text.length, index + length + 50)).toLowerCase()
}

function looksLikeFutureWarehouseContext(context: string): boolean {
  return /(planuj|wybudowac|zbudowac|dobudowac|powstac|na wiosn|zamierz|bedzie|bede)/.test(context)
}

export function extractCluesFromText(text: string, sourceId: string): Clue[] {
  const normalized = normalizeText(text)
  const clues: Clue[] = []

  const phoneMatches = normalized.match(/(?<!\d)(?:\+48\s*)?(\d{3}[ -]?\d{3}[ -]?\d{3})(?!\d)/g) ?? []
  for (const match of phoneMatches) {
    const value = match.replace(/\D/g, '').slice(-9)
    clues.push({ field: 'phoneNumber', value, confidence: 0.94, sourceId, reason: `Phone-like sequence extracted from text: ${match}` })
  }

  const futureWarehouseRegex = /(?:planuj\w*|zamierz\w*|bed\w*|bede?\w*|ma\w*\s+powstac|wybudowac|zbudowac|dobudowac)\D{0,50}?(\d{1,4}|[\p{L}]+)\D{0,8}magazyn(?:y|ow|ów)?/giu
  for (const match of normalized.matchAll(futureWarehouseRegex)) {
    const parsed = parseNumberToken(match[1] ?? '')
    if (parsed !== null && parsed > 1) {
      pushWarehouseClue(clues, parsed - 1, 0.95, sourceId, `Future warehouse plan implies current count: ${match[0]}`)
    }
  }

  const warehouseRegex = /(?:magazyn(?:y|ow|ów)?|warehouse(?:s)?)\D{0,12}(\d{1,4}|[\p{L}]+)/giu
  for (const match of normalized.matchAll(warehouseRegex)) {
    const parsed = parseNumberToken(match[1] ?? '')
    if (parsed !== null) {
      if (looksLikeFutureWarehouseContext(localContext(normalized, match.index ?? 0, match[0].length))) continue
      pushWarehouseClue(clues, parsed, 0.88, sourceId, `Warehouse count mention: ${match[0]}`)
    }
  }

  const warehousesBeforeRegex = /(\d{1,4}|[\p{L}]+)\D{0,8}magazyn(?:y|ow|ów)?/giu
  for (const match of normalized.matchAll(warehousesBeforeRegex)) {
    const parsed = parseNumberToken(match[1] ?? '')
    if (parsed !== null) {
      if (looksLikeFutureWarehouseContext(localContext(normalized, match.index ?? 0, match[0].length))) continue
      pushWarehouseClue(clues, parsed, 0.86, sourceId, `Warehouse count mention: ${match[0]}`)
    }
  }

  const areaRegex = /(?:powierzchni(?:a)?|area|obszar)\D{0,20}(\d+(?:[.,]\d+)?)/gi
  for (const match of normalized.matchAll(areaRegex)) {
    clues.push({ field: 'cityArea', value: match[1].replace(',', '.'), confidence: 0.9, sourceId, reason: `Area mention: ${match[0]}` })
  }

  const kmRegex = /(\d+(?:[.,]\d+)?)\s*(?:km2|km\^2|hektar(?:y|ów)?|ha)\b/gi
  for (const match of normalized.matchAll(kmRegex)) {
    clues.push({ field: 'cityArea', value: match[1].replace(',', '.'), confidence: 0.82, sourceId, reason: `Surface unit mention: ${match[0]}` })
  }

  const syjonRegexes = [
    /(?:Syjon(?:ie|owi|em)?\s+to\s+)([\p{Lu}][\p{L}-]+)/gu,
    /([\p{Lu}][\p{L}-]+)\s*\([^)]*Syjon[^)]*\)/gu,
    /miast[oa]\s+(?:Syjon|"Syjon")\D{0,30}([\p{Lu}][\p{L}-]+)/gu,
    /([\p{Lu}][\p{L}-]+)\D{0,20}(?:to|jest)\D{0,12}Syjon/giu,
  ]
  for (const regex of syjonRegexes) {
    for (const match of normalized.matchAll(regex)) {
      const value = match[1]
      if (value) {
        clues.push({ field: 'cityName', value, confidence: 0.83, sourceId, reason: `Syjon alias clue: ${match[0]}` })
      }
    }
  }

  return clues
}

export function compactTextForLlm(text: string): string {
  return normalizeText(text).slice(0, 4000)
}
