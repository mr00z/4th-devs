const GOODS_MAP: Record<string, string> = {
  makaron: 'makaron',
  makaronu: 'makaron',
  woda: 'woda',
  wody: 'woda',
  butelka_wody: 'woda',
  butelki_wody: 'woda',
  butelek_wody: 'woda',
  lopaty: 'lopata',
  lopat: 'lopata',
  lopata: 'lopata',
  chleb: 'chleb',
  chlebow: 'chleb',
  mlotki: 'mlotek',
  mlotkow: 'mlotek',
  mlotek: 'mlotek',
  ryz: 'ryz',
  ryzu: 'ryz',
  workow_ryzu: 'ryz',
  wiertarki: 'wiertarka',
  wiertarek: 'wiertarka',
  wiertarka: 'wiertarka',
  kilofy: 'kilof',
  kilofow: 'kilof',
  kilof: 'kilof',
  wolowina: 'wolowina',
  wolowiny: 'wolowina',
  porcje_wolowiny: 'wolowina',
  porcji_wolowiny: 'wolowina',
  kurczaka: 'kurczak',
  kurczak: 'kurczak',
  porcji_kurczaka: 'kurczak',
  ziemniaki: 'ziemniak',
  ziemniakow: 'ziemniak',
  kg_ziemniakow: 'ziemniak',
  ziemniak: 'ziemniak',
  kapusta: 'kapusta',
  marchew: 'marchew',
  maka: 'maka',
}

const CITY_MAP: Record<string, string> = {
  domatowa: 'domatowo',
  domatowie: 'domatowo',
  darzlubiu: 'darzlubie',
  darzlubiem: 'darzlubie',
  opalina: 'opalino',
  celbowa: 'celbowo',
}

const DIRECT_REPLACEMENTS: Array<[string, string]> = [
  ['mÄ…ka', 'maka'],
  ['woĹ‚owina', 'wolowina'],
  ['ryĹĽ', 'ryz'],
  ['mĹ‚otek', 'mlotek'],
  ['Ĺ‚opata', 'lopata'],
  ['ą', 'a'],
  ['ć', 'c'],
  ['ę', 'e'],
  ['ł', 'l'],
  ['ń', 'n'],
  ['ó', 'o'],
  ['ś', 's'],
  ['ź', 'z'],
  ['ż', 'z'],
]

export function stripDiacritics(value: string): string {
  let normalized = value
  for (const [from, to] of DIRECT_REPLACEMENTS) {
    normalized = normalized.replaceAll(from, to)
  }

  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function normalizeToken(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizePathName(value: string): string {
  return normalizeToken(value).replace(/\s+/g, '_')
}

export function normalizeGood(rawGood: string): string {
  const token = normalizeToken(rawGood).replace(/\s+/g, '_')
  return GOODS_MAP[token] || token
}

export function normalizeCity(rawCity: string): string {
  const token = normalizePathName(rawCity)
  return CITY_MAP[token] || token
}

export function normalizePersonFileName(fullName: string): string {
  return normalizePathName(fullName)
}
