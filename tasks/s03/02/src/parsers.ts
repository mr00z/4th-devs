const ECCS_REGEX = /ECCS-[A-Za-z0-9-]{32,80}/g

export function extractConfirmationCode(text: string): string | null {
  const matches = text.match(ECCS_REGEX)
  if (!matches || matches.length === 0) {
    return null
  }
  return matches[matches.length - 1] ?? null
}

export function normalizeWhitespaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function firstLine(value: string): string {
  const line = value.split(/\r?\n/)[0]
  return line?.trim() ?? ''
}
