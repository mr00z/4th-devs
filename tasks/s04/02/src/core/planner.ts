import type { ConfigPoint, ParsedInputs, PlanResult, WeatherPoint } from '../types.js'

function timestampToMs(timestamp: string): number {
  const iso = timestamp.replace(' ', 'T') + 'Z'
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function nextHourPoint(base: WeatherPoint): ConfigPoint {
  const ms = timestampToMs(base.timestamp)
  const next = new Date(ms + 60 * 60 * 1000)
  const date = next.toISOString().slice(0, 10)
  const hour = `${String(next.getUTCHours()).padStart(2, '0')}:00:00`
  const timestamp = `${date} ${hour}`

  return {
    key: `${timestamp}#post-storm`,
    date,
    hour,
    timestamp,
    pitchAngle: 90,
    turbineMode: 'idle',
    windMs: base.windMs,
  }
}

function getDate(timestamp: string): string {
  return timestamp.split(' ')[0]
}

export function buildPlan(input: ParsedInputs): PlanResult {
  const { weatherPoints, powerDeficitKw, capabilities } = input

  const stormThreshold = capabilities.stormWindMs
  const majorStormThreshold = capabilities.majorStormWindMs

  // Group weather points by date
  const byDate = new Map<string, WeatherPoint[]>()
  for (const point of weatherPoints) {
    const date = point.date
    if (!byDate.has(date)) {
      byDate.set(date, [])
    }
    byDate.get(date)!.push(point)
  }

  // Find storms and major storms
  const storms = weatherPoints.filter((point) => point.windMs > stormThreshold)
  const majorStorms = weatherPoints.filter((point) => point.windMs >= majorStormThreshold)

  // Calculate minimum wind needed to meet power deficit (based on power curve)
  // From docs: 14kW rated, at 6m/s ~30-40% yield = ~4-5kW
  const minWindForDeficit = powerDeficitKw / capabilities.powerCoeffKwPerWindMs

  // Find the best production point prioritizing: 1) sufficient wind, 2) fewest storms on that day
  let bestProductionPoint: WeatherPoint | null = null
  let minStormsOnDate = Infinity

  // Sort all safe points by wind speed (descending) to find strongest winds first
  const allSafePoints = weatherPoints
    .filter((p) => p.windMs > 0 && p.windMs <= stormThreshold)
    .sort((a, b) => b.windMs - a.windMs)

  for (const point of allSafePoints) {
    const date = point.date
    const pointsOnDate = byDate.get(date) || []
    const stormsOnDate = pointsOnDate.filter((p) => p.windMs > stormThreshold).length

    // Check if this point has sufficient wind for the deficit
    if (point.windMs >= minWindForDeficit) {
      // Prioritize: first by sufficient wind, then by fewest storms on that day
      if (stormsOnDate < minStormsOnDate || bestProductionPoint === null) {
        bestProductionPoint = point
        minStormsOnDate = stormsOnDate

        // If we found a storm-free day with sufficient wind, we're done
        if (stormsOnDate === 0) break
      }
    }
  }

  // If no point with sufficient wind found, pick the strongest available
  if (!bestProductionPoint && allSafePoints.length > 0) {
    bestProductionPoint = allSafePoints[0]
    const pointsOnDate = byDate.get(bestProductionPoint.date) || []
    minStormsOnDate = pointsOnDate.filter((p) => p.windMs > stormThreshold).length
  }

  if (!bestProductionPoint) {
    throw new Error('No safe production window found in weather data')
  }

  const planned = new Map<string, ConfigPoint>()

  // Add production point
  planned.set(bestProductionPoint.timestamp, {
    key: `${bestProductionPoint.timestamp}#production`,
    date: bestProductionPoint.date,
    hour: bestProductionPoint.hour,
    timestamp: bestProductionPoint.timestamp,
    pitchAngle: capabilities.productionPitchAngle,
    turbineMode: 'production',
    windMs: bestProductionPoint.windMs,
  })

  // Protect all storms (both major and regular) - prioritize by severity
  // With only 4 points (1 production + 3 protection), we skip major storm follow-up
  // and focus on protecting each unique storm timestamp

  // First, protect major storms (highest priority, but no follow-up to save points)
  for (const major of majorStorms) {
    if (planned.size >= 4) break

    if (!planned.has(major.timestamp)) {
      planned.set(major.timestamp, {
        key: `${major.timestamp}#storm-protect`,
        date: major.date,
        hour: major.hour,
        timestamp: major.timestamp,
        pitchAngle: capabilities.protectionPitchAngle,
        turbineMode: 'idle',
        windMs: major.windMs,
      })
    }
  }

  // Then protect regular storms
  for (const storm of storms) {
    if (planned.size >= 4) break
    if (!planned.has(storm.timestamp)) {
      planned.set(storm.timestamp, {
        key: `${storm.timestamp}#storm-protect`,
        date: storm.date,
        hour: storm.hour,
        timestamp: storm.timestamp,
        pitchAngle: capabilities.protectionPitchAngle,
        turbineMode: 'idle',
        windMs: storm.windMs,
      })
    }
  }

  // Only add follow-up for major storms if we have spare points
  if (planned.size < 4) {
    for (const major of majorStorms) {
      if (planned.size >= 4) break
      const after = nextHourPoint(major)
      if (!planned.has(after.timestamp)) {
        planned.set(after.timestamp, {
          ...after,
          pitchAngle: capabilities.protectionPitchAngle,
        })
      }
    }
  }

  const configPoints = [...planned.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const rationale = [
    `stormThreshold=${stormThreshold}m/s`,
    `majorStormThreshold=${majorStormThreshold}m/s`,
    `storms=${storms.length}`,
    `majorStorms=${majorStorms.length}`,
    `production=${bestProductionPoint.timestamp} wind=${bestProductionPoint.windMs}m/s`,
    `productionDateStorms=${minStormsOnDate}`,
    `requiredPowerKw=${powerDeficitKw}`,
    `totalPoints=${configPoints.length}`,
  ]

  return {
    configPoints,
    rationale,
  }
}
