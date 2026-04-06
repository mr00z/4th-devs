import type { FilesystemManifest, ValidatedKnowledge } from '../types.js'

export function buildManifestFromKnowledge(knowledge: ValidatedKnowledge): FilesystemManifest {
  const files: FilesystemManifest['files'] = []
  const allCities = new Set<string>()

  for (const city of Object.keys(knowledge.cityDemands)) {
    allCities.add(city)
  }
  for (const contact of knowledge.cityContacts) {
    allCities.add(contact.city)
  }
  for (const cities of Object.values(knowledge.goodsToCities)) {
    for (const city of cities) {
      allCities.add(city)
    }
  }

  for (const city of [...allCities].sort((a, b) => a.localeCompare(b))) {
    const demands = Object.fromEntries(
      Object.entries(knowledge.cityDemands[city] ?? {}).filter(([, quantity]) => quantity > 0),
    )
    files.push({
      path: `/miasta/${city}`,
      content: JSON.stringify(demands),
    })
  }

  for (const person of knowledge.cityContacts.sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    files.push({
      path: `/osoby/${person.fileName}`,
      content: `${person.fullName}\nMiasto: [${person.city}](/miasta/${person.city})`,
    })
  }

  for (const [good, cities] of Object.entries(knowledge.goodsToCities).sort(([a], [b]) => a.localeCompare(b))) {
    const lines = ['Sprzedawcy:']
    for (const city of cities) {
      lines.push(`- [${city}](/miasta/${city})`)
    }
    files.push({
      path: `/towary/${good}`,
      content: lines.join('\n'),
    })
  }

  return {
    directories: ['/miasta', '/osoby', '/towary'],
    files,
  }
}
