import type { ParsedInputs, QueueItemBase, TurbineCapabilities, WeatherPoint } from '../types.js'

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim()
    const parsed = Number.parseFloat(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseRangeLowerBound(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const rangeMatch = value.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/)
    if (rangeMatch) {
      const lower = Number.parseFloat(rangeMatch[1].replace(',', '.'))
      if (Number.isFinite(lower)) {
        return lower
      }
    }

    const single = Number.parseFloat(value.replace(',', '.'))
    if (Number.isFinite(single)) {
      return single
    }
  }
  return null
}

function normalizeDate(dateRaw: string): string {
  const trimmed = dateRaw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const date = new Date(trimmed)
  if (!Number.isNaN(date.valueOf())) {
    return date.toISOString().slice(0, 10)
  }

  return trimmed.slice(0, 10)
}

function normalizeHour(hourRaw: string): string {
  const trimmed = hourRaw.trim()
  const hhmmss = trimmed.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (hhmmss) {
    return `${hhmmss[1]}:00:00`
  }

  const justHour = trimmed.match(/^(\d{1,2})$/)
  if (justHour) {
    const hour = Number.parseInt(justHour[1], 10)
    const safeHour = Math.min(23, Math.max(0, hour))
    return `${String(safeHour).padStart(2, '0')}:00:00`
  }

  const date = new Date(trimmed)
  if (!Number.isNaN(date.valueOf())) {
    return `${String(date.getUTCHours()).padStart(2, '0')}:00:00`
  }

  return '00:00:00'
}

function textFromDocumentation(documentationResponse: unknown): string {
  if (typeof documentationResponse === 'string') {
    return documentationResponse
  }

  const obj = asObject(documentationResponse)
  const direct = obj.documentation
  if (typeof direct === 'string') {
    return direct
  }

  const message = obj.message
  if (typeof message === 'string') {
    return message
  }

  return JSON.stringify(documentationResponse)
}

function detectCapabilities(docsText: string, turbineCheck: QueueItemBase): TurbineCapabilities {
  const combined = `${docsText}\n${JSON.stringify(turbineCheck)}`.toLowerCase()

  const stormCandidate = combined.match(/(?:max(?:imum)?\s*(?:safe|allowed)?\s*wind|wind\s*limit|wytrzyma(?:ł|l)o[śćc]\s*wiatraka)\D{0,20}(\d+(?:[.,]\d+)?)/i)
  const stormWindMs = stormCandidate
    ? Number.parseFloat(stormCandidate[1].replace(',', '.'))
    : 20

  const majorCandidate = combined.match(/(?:major\s*storm|większ(?:a|e)\s*wichur[ay])\D{0,20}(\d+(?:[.,]\d+)?)/i)
  const majorStormWindMs = majorCandidate
    ? Number.parseFloat(majorCandidate[1].replace(',', '.'))
    : Math.max(stormWindMs + 4, 24)

  const productionPitchCandidate = combined.match(/(?:optimal\s*pitch|pitch\s*for\s*production|produk(?:cj|cy)\w*\s*nachylenie)\D{0,20}(\d{1,3})/i)
  const productionPitchAngle = productionPitchCandidate ? Number.parseInt(productionPitchCandidate[1], 10) : 45

  const protectionPitchCandidate = combined.match(/(?:protect(?:ion)?\s*pitch|idle\s*pitch|tryb\s*ochronny\D{0,20})(\d{1,3})/i)
  const protectionPitchAngle = protectionPitchCandidate ? Number.parseInt(protectionPitchCandidate[1], 10) : 90

  // Based on docs: 14kW rated, at 4m/s = 10-15% yield (~1.4-2.1kW)
  // For 2-3kW deficit, we need ~5-6 m/s minimum
  const powerCoeffKwPerWindMs = 0.35

  return {
    stormWindMs,
    majorStormWindMs,
    productionPitchAngle,
    protectionPitchAngle,
    powerCoeffKwPerWindMs,
  }
}

function mapRawWeatherPoint(raw: unknown, fallbackIndex: number): WeatherPoint | null {
  const obj = asObject(raw)

  const dateCandidate =
    (typeof obj.startDate === 'string' && obj.startDate)
    || (typeof obj.date === 'string' && obj.date)
    || (typeof obj.day === 'string' && obj.day)
    || (typeof obj.timestamp === 'string' ? obj.timestamp.slice(0, 10) : '')

  const hourCandidate =
    (typeof obj.startHour === 'string' && obj.startHour)
    || (typeof obj.hour === 'string' && obj.hour)
    || (typeof obj.time === 'string' && obj.time)
    || (typeof obj.timestamp === 'string' ? obj.timestamp.slice(11, 13) : '')

  const windCandidate =
    asNumber(obj.windMs)
    ?? asNumber(obj.wind)
    ?? asNumber(obj.windSpeed)
    ?? asNumber(obj.wind_speed)
    ?? asNumber(obj.wind_m_s)

  if (!dateCandidate || !hourCandidate || windCandidate === null) {
    return null
  }

  const date = normalizeDate(dateCandidate)
  const hour = normalizeHour(hourCandidate)
  const timestamp = `${date} ${hour}`

  return {
    key: `${timestamp}#${fallbackIndex}`,
    date,
    hour,
    timestamp,
    windMs: windCandidate,
  }
}

function parseWeatherPoints(weatherResult: QueueItemBase): WeatherPoint[] {
  // TODO: adapt to real API payload once complete weather schema is known.
  const candidates: unknown[] = []

  const weatherObj = asObject(weatherResult)
  if (Array.isArray(weatherObj.weather)) {
    candidates.push(...weatherObj.weather)
  }
  if (Array.isArray(weatherObj.data)) {
    candidates.push(...weatherObj.data)
  }
  if (Array.isArray(weatherObj.forecast)) {
    candidates.push(...weatherObj.forecast)
  }
  if (Array.isArray(weatherObj.points)) {
    candidates.push(...weatherObj.points)
  }

  if (candidates.length === 0) {
    for (const value of Object.values(weatherObj)) {
      if (Array.isArray(value)) {
        candidates.push(...value)
      }
    }
  }

  const mapped = candidates
    .map((candidate, index) => mapRawWeatherPoint(candidate, index))
    .filter((point): point is WeatherPoint => point !== null)

  mapped.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return mapped
}

function parsePowerDeficitKw(powerplantResult: QueueItemBase): number {
  const direct = parseRangeLowerBound(powerplantResult.powerDeficitKw)
  if (direct !== null && direct > 0) {
    return direct
  }

  const produced = asNumber(powerplantResult.producedPowerKw) ?? 0
  const target = asNumber(powerplantResult.requiredPowerKw) ?? asNumber(powerplantResult.targetPowerKw)

  if (target !== null) {
    const deficit = target - produced
    if (deficit > 0) {
      return deficit
    }
  }

  return 4
}

export function parseInputs(input: {
  documentation: unknown
  weatherResult: QueueItemBase
  powerplantResult: QueueItemBase
  turbineResult: QueueItemBase
}): ParsedInputs {
  const docsText = textFromDocumentation(input.documentation)
  const weatherPoints = parseWeatherPoints(input.weatherResult)
  const powerDeficitKw = parsePowerDeficitKw(input.powerplantResult)
  const capabilities = detectCapabilities(docsText, input.turbineResult)

  return {
    weatherPoints,
    powerDeficitKw,
    docsText,
    capabilities,
  }
}
