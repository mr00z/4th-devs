import type { LogEvent } from '../types.js'

const MOJIBAKE_REPLACEMENTS: Array<[string, string]> = [
  ['Ă„â€¦', 'a'],
  ['Ă„â€ˇ', 'c'],
  ['Ă„â„˘', 'e'],
  ['Äąâ€š', 'l'],
  ['Äąâ€ž', 'n'],
  ['Ä‚Ĺ‚', 'o'],
  ['Äąâ€ş', 's'],
  ['ÄąĹź', 'z'],
  ['ÄąÄ˝', 'z'],
  ['Ă„â€šÄąâ€š', 'o'],
  ['Ă„â€šĂ˘â‚¬Ĺ›', 'o'],
  ['Ä‚â€žĂ˘â‚¬Â¦', 'a'],
  ['Ä‚â€žĂ˘â‚¬Ë‡', 'c'],
  ['Ä‚â€žĂ˘â€žË', 'e'],
  ['Ă„Ä…Ă˘â‚¬Ĺˇ', 'l'],
  ['Ă„Ä…Ă˘â‚¬Ĺľ', 'n'],
  ['Ă„â€šÄąĹş', 'u'],
  ['Ă„Ä…Ă˘â‚¬Ĺź', 's'],
  ['Ă„Ä…ÄąĹş', 'z'],
  ['Ă„Ä…ÄąĹź', 'z'],
  ['Ă„Ä…Ă„Ëť', 'z'],
  ['Ä‚ËÄąË‡Ă‚Â Ă„ĹąĂ‚Â¸ÄąÄ…', 'warning'],
  ['Ä‚ËÄąË‡Ă‹â€ˇ', 'warning'],
  ['Ă„â€ÄąĹźĂ˘â‚¬ĹĄÄąÂ¤', 'discovery'],
  ['ostrzeĂ„Ä…Ă„Ëťenie', 'ostrzezenie'],
]

export function normalizeForMatching(value: string): string {
  let normalized = value
  for (const [from, to] of MOJIBAKE_REPLACEMENTS) {
    normalized = normalized.split(from).join(to)
  }

  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function extractMessageFromObject(obj: Record<string, unknown>): string {
  const candidates: Array<keyof typeof obj> = ['msg', 'message', 'text', 'content', 'log']
  for (const key of candidates) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return JSON.stringify(obj)
}

function extractTimestampFromObject(obj: Record<string, unknown>): string | undefined {
  const candidates: Array<keyof typeof obj> = ['timestamp', 'time', 'created_at', 'createdAt']
  for (const key of candidates) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

function extractFieldCoord(obj: Record<string, unknown>): string | undefined {
  const field = obj.field
  if (typeof field === 'string') {
    const upper = field.trim().toUpperCase()
    if (/^[A-Z]\d{1,2}$/.test(upper)) {
      return upper
    }
  }
  return undefined
}

export function parseLogs(rawLogs: unknown): LogEvent[] {
  const events: LogEvent[] = []

  if (!rawLogs) return events

  if (typeof rawLogs === 'string') {
    const lines = rawLogs.split('\n').filter((line) => line.trim())
    for (const line of lines) {
      events.push(parseLogLine(line))
    }
  } else if (Array.isArray(rawLogs)) {
    for (const entry of rawLogs) {
      if (typeof entry === 'string') {
        events.push(parseLogLine(entry))
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>
        const message = extractMessageFromObject(obj)
        events.push({
          timestamp: extractTimestampFromObject(obj),
          message,
          type: 'info',
          coordinates: extractFieldCoord(obj) || extractCoordinates(message),
          scoutId: typeof obj.scout === 'string' ? obj.scout : undefined,
        })
      }
    }
  } else if (typeof rawLogs === 'object') {
    const obj = rawLogs as Record<string, unknown>

    if (Array.isArray(obj.logs)) return parseLogs(obj.logs)
    if (Array.isArray(obj.events)) return parseLogs(obj.events)
    if (Array.isArray(obj.messages)) return parseLogs(obj.messages)

    const message = extractMessageFromObject(obj)
    events.push({
      timestamp: extractTimestampFromObject(obj),
      message,
      type: 'info',
      coordinates: extractFieldCoord(obj) || extractCoordinates(message),
      scoutId: typeof obj.scout === 'string' ? obj.scout : undefined,
    })
  }

  return events
}

function parseLogLine(line: string): LogEvent {
  return {
    message: line,
    type: 'info',
    coordinates: extractCoordinates(line),
  }
}

function extractCoordinates(message: string): string | undefined {
  const match = message.match(/\b([A-Z]\d{1,2})\b/)
  return match ? match[1] : undefined
}

export function summarizeLogsForAgent(events: LogEvent[], maxLines: number = 10): string {
  if (events.length === 0) {
    return 'No new log entries.'
  }

  const lines: string[] = []
  const recent = events.slice(-maxLines)

  for (const event of recent) {
    const ts = event.timestamp ? `${event.timestamp} ` : ''
    let line = `${ts}${event.message}`
    if (event.coordinates) {
      line += ` [at ${event.coordinates}]`
    }
    lines.push(line)
  }

  if (events.length > maxLines) {
    lines.push(`... and ${events.length - maxLines} more entries`)
  }

  return lines.join('\n')
}

export function getLogFingerprint(event: LogEvent): string {
  return [
    event.timestamp || '',
    event.scoutId || '',
    event.coordinates || '',
    event.message,
  ].join('|')
}

export function extractNewEvents(
  allEvents: LogEvent[],
  seenCounts: Map<string, number>
): { newEvents: LogEvent[]; nextSeenCounts: Map<string, number> } {
  const remainingSeen = new Map(seenCounts)
  const nextSeenCounts = new Map<string, number>()
  const newEvents: LogEvent[] = []

  for (const event of allEvents) {
    const fingerprint = getLogFingerprint(event)
    const seenCount = remainingSeen.get(fingerprint) || 0

    if (seenCount > 0) {
      remainingSeen.set(fingerprint, seenCount - 1)
    } else {
      newEvents.push(event)
    }

    nextSeenCounts.set(fingerprint, (nextSeenCounts.get(fingerprint) || 0) + 1)
  }

  return { newEvents, nextSeenCounts }
}

const STRONG_POSITIVE_PATTERNS = [
  /znalezion.*czlowiek/,
  /czlowiek.*bron/,
  /czlowiek.*rann/,
  /znalezion.*partyzant/,
  /partyzant.*zyw/,
  /partyzant.*rann/,
  /ocalal/,
  /zywy/,
]

const SOFT_POSITIVE_PATTERNS = [
  /czlowiek/,
  /bron/,
  /rann/,
  /pomoc/,
  /przezyl/,
]

const NEGATIVE_PATTERNS = [
  /pust/,
  /brak/,
  /nikog/,
  /brak sladow/,
  /nie znaleziono/,
  /nie ma.*partyzant/,
  /nie ma.*czlowiek/,
  /brak.*partyzant/,
  /brak.*czlowiek/,
  /nie odnaleziono/,
]

export function interpretEventsDeterministically(
  events: LogEvent[],
  inspectedCoord?: string
): {
  confirmed: boolean
  coord: string | null
  confidence: 'low' | 'medium' | 'high'
  positiveSignals: string[]
  negativeSignals: string[]
} {
  const positiveSignals: string[] = []
  const negativeSignals: string[] = []

  let coord: string | null = null
  let strongHits = 0
  let softHits = 0

  for (const event of events) {
    const normalized = normalizeForMatching(event.message)
    if (!coord && event.coordinates) {
      coord = event.coordinates
    }

    for (const pattern of STRONG_POSITIVE_PATTERNS) {
      if (pattern.test(normalized)) {
        strongHits += 1
        positiveSignals.push(event.message)
        break
      }
    }

    for (const pattern of SOFT_POSITIVE_PATTERNS) {
      if (pattern.test(normalized)) {
        softHits += 1
        if (!positiveSignals.includes(event.message)) {
          positiveSignals.push(event.message)
        }
        break
      }
    }

    for (const pattern of NEGATIVE_PATTERNS) {
      if (pattern.test(normalized)) {
        negativeSignals.push(event.message)
        break
      }
    }
  }

  const fallbackCoord = coord || inspectedCoord || null
  const hasNegative = negativeSignals.length > 0
  const confirmed = strongHits > 0 && !hasNegative && !!fallbackCoord

  let confidence: 'low' | 'medium' | 'high' = 'low'
  if (confirmed) {
    confidence = strongHits >= 2 || softHits >= 3 ? 'high' : 'medium'
  } else if (softHits > 0 && !hasNegative) {
    confidence = 'medium'
  }

  return {
    confirmed,
    coord: fallbackCoord,
    confidence,
    positiveSignals,
    negativeSignals,
  }
}
