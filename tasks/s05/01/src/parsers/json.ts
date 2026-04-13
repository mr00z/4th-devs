import type { Clue } from '../types.js'
import { extractCluesFromText } from './text.js'

function flattenJson(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) {
    return []
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${prefix}: ${String(value)}`]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`))
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => flattenJson(item, prefix ? `${prefix}.${key}` : key))
  }
  return []
}

export function extractCluesFromJson(text: string, sourceId: string): { clues: Clue[]; summary: string; parsed: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return {
      clues: extractCluesFromText(text, sourceId),
      summary: text.slice(0, 500),
      parsed: false,
    }
  }
  const flattened = flattenJson(parsed)
  return {
    clues: extractCluesFromText(flattened.join('\n'), sourceId),
    summary: flattened.slice(0, 30).join('\n'),
    parsed: true,
  }
}
