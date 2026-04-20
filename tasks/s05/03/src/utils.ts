export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}

export function subtractOneDay(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`)
  }
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

export function parseFinalAnswerFromText(text: string): {
  date: string
  city: string
  longitude: number
  latitude: number
} | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    if (
      typeof parsed.date === 'string'
      && typeof parsed.city === 'string'
      && typeof parsed.longitude === 'number'
      && typeof parsed.latitude === 'number'
    ) {
      return {
        date: parsed.date,
        city: parsed.city,
        longitude: parsed.longitude,
        latitude: parsed.latitude,
      }
    }
  } catch {
    return null
  }

  return null
}

export function truncate(value: string, max = 900): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}
