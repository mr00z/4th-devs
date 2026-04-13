import type { Clue } from '../types.js'
import { extractCluesFromText } from './text.js'

export function extractCluesFromXml(text: string, sourceId: string): { clues: Clue[]; summary: string } {
  const tagText = text
    .replace(/<\?xml[^>]*>/gi, ' ')
    .replace(/<([^/!][^\s>]*)([^>]*)>/g, ' <$1$2> ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    clues: extractCluesFromText(tagText, sourceId),
    summary: tagText.slice(0, 2000),
  }
}
