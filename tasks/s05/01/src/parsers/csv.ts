import type { Clue } from '../types.js'
import { extractCluesFromText } from './text.js'

function splitRow(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  result.push(current.trim())
  return result
}

export function extractCluesFromCsv(text: string, sourceId: string): { clues: Clue[]; summary: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const delimiter = lines.some((line) => line.includes(';')) ? ';' : ','
  const rows = lines.map((line) => splitRow(line, delimiter))
  const summary = rows.slice(0, 10).map((row) => row.join(' | ')).join('\n')
  return {
    clues: extractCluesFromText(summary + '\n' + text.slice(0, 3000), sourceId),
    summary,
  }
}
