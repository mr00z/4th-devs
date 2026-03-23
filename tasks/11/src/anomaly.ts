export interface SensorFileRecord {
  sensor_type: string
  timestamp: number
  temperature_K: number
  pressure_bar: number
  water_level_meters: number
  voltage_supply_v: number
  humidity_percent: number
  operator_notes: string
}

type SensorKey = 'temperature' | 'pressure' | 'water' | 'voltage' | 'humidity'

type MeasurementField =
  | 'temperature_K'
  | 'pressure_bar'
  | 'water_level_meters'
  | 'voltage_supply_v'
  | 'humidity_percent'

interface SensorRule {
  field: MeasurementField
  min: number
  max: number
}

const SENSOR_RULES: Record<SensorKey, SensorRule> = {
  temperature: { field: 'temperature_K', min: 553, max: 873 },
  pressure: { field: 'pressure_bar', min: 60, max: 160 },
  water: { field: 'water_level_meters', min: 5.0, max: 15.0 },
  voltage: { field: 'voltage_supply_v', min: 229.0, max: 231.0 },
  humidity: { field: 'humidity_percent', min: 40.0, max: 80.0 },
}

const KNOWN_SENSORS = new Set<SensorKey>(Object.keys(SENSOR_RULES) as SensorKey[])

export interface DeterministicEvaluation {
  activeSensors: Set<string>
  reasons: string[]
  hasMeasurementAnomaly: boolean
  hasUnexpectedSensorData: boolean
  hasDeterministicAnomaly: boolean
  measurementsLookOk: boolean
}

function toActiveSensorSet(sensorType: string): Set<string> {
  return new Set(
    sensorType
      .split('/')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
}

export function evaluateDeterministic(record: SensorFileRecord): DeterministicEvaluation {
  const activeSensors = toActiveSensorSet(record.sensor_type)
  const reasons: string[] = []
  let hasMeasurementAnomaly = false
  let hasUnexpectedSensorData = false

  for (const sensorName of activeSensors) {
    if (!KNOWN_SENSORS.has(sensorName as SensorKey)) {
      hasMeasurementAnomaly = true
      reasons.push(`unknown active sensor in sensor_type: ${sensorName}`)
    }
  }

  for (const [sensorName, rule] of Object.entries(SENSOR_RULES) as Array<[SensorKey, SensorRule]>) {
    const value = record[rule.field]
    const isActive = activeSensors.has(sensorName)

    if (!Number.isFinite(value)) {
      hasMeasurementAnomaly = true
      reasons.push(`${rule.field} is not a finite number`)
      continue
    }

    if (isActive) {
      if (value < rule.min || value > rule.max) {
        hasMeasurementAnomaly = true
        reasons.push(`${rule.field} out of range for active sensor (${value}; expected ${rule.min}-${rule.max})`)
      }
      continue
    }

    if (value !== 0) {
      hasUnexpectedSensorData = true
      reasons.push(`${rule.field} has value ${value} for inactive sensor ${sensorName}`)
    }
  }

  const hasDeterministicAnomaly = hasMeasurementAnomaly || hasUnexpectedSensorData

  return {
    activeSensors,
    reasons,
    hasMeasurementAnomaly,
    hasUnexpectedSensorData,
    hasDeterministicAnomaly,
    measurementsLookOk: !hasDeterministicAnomaly,
  }
}
