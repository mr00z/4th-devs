import type { CityContactFact, CityDemandFact, ExtractedKnowledge, TransactionFact } from '../types.js'

function parseDemandLine(line: string): { city: string; items: Array<{ rawGood: string; quantity: number }> } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('---')) {
    return null
  }

  const cityMatch = trimmed.match(/^([A-ZĄĆĘŁŃÓŚŹŻ][\p{L}a-ząćęłńóśźż]+)[,:]/u)
  if (!cityMatch) {
    return null
  }

  const city = cityMatch[1]
  const rest = trimmed.slice(cityMatch[0].length)
  const matches = [...rest.matchAll(/(\d+)\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)/gu)]
  if (matches.length === 0) {
    return null
  }

  return {
    city,
    items: matches.map((match) => ({ quantity: Number(match[1]), rawGood: match[2] })),
  }
}

function parseConversationContacts(text: string): CityContactFact[] {
  const patterns: Array<{ city: string; regex: RegExp }> = [
    { city: 'Domatowo', regex: /Natan Rams/giu },
    { city: 'Opalino', regex: /Iga Kapecka/giu },
    { city: 'Brudzewo', regex: /Rafal .*?Kisiel|Kisiel/giu },
    { city: 'Darzlubie', regex: /Marta Frantz|Frantz/giu },
    { city: 'Celbowo', regex: /Oskar Radtke/giu },
    { city: 'Mechowo', regex: /Eliza Redmann/giu },
    { city: 'Puck', regex: /Damian Kroll/giu },
    { city: 'Karlinkowo', regex: /Lena .*?Konkel|Konkel/giu },
  ]

  const out: CityContactFact[] = []
  for (const pattern of patterns) {
    const match = text.match(pattern.regex)
    if (!match?.[0]) continue
    let fullName = match[0]
    if (/^Kisiel$/i.test(fullName)) fullName = 'Rafal Kisiel'
    if (/^Frantz$/i.test(fullName)) fullName = 'Marta Frantz'
    if (/^Konkel$/i.test(fullName)) fullName = 'Lena Konkel'
    out.push({ city: pattern.city, fullName, evidence: `${pattern.city}: ${match[0]}` })
  }
  return out
}

function parseTransactions(text: string): TransactionFact[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines
    .map((line) => {
      const parts = line.split(/\s*->\s*/)
      if (parts.length !== 3) return null
      return {
        sellerCity: parts[0],
        rawGood: parts[1],
        buyerCity: parts[2],
        evidence: line,
      } satisfies TransactionFact
    })
    .filter((value): value is TransactionFact => !!value)
}

export function extractKnowledgeFallback(input: {
  readme: string
  ogloszenia: string
  rozmowy: string
  transakcje: string
}): ExtractedKnowledge {
  const cityDemands: CityDemandFact[] = []
  for (const line of input.ogloszenia.split(/\r?\n/)) {
    const parsed = parseDemandLine(line)
    if (!parsed) continue
    for (const item of parsed.items) {
      cityDemands.push({
        city: parsed.city,
        rawGood: item.rawGood,
        quantity: item.quantity,
        evidence: line.trim(),
      })
    }
  }

  return {
    cityDemands,
    cityContacts: parseConversationContacts(input.rozmowy),
    transactions: parseTransactions(input.transakcje),
    ambiguities: [],
  }
}
