import fs from 'node:fs/promises'
import path from 'node:path'
import { evaluateDeterministic, type SensorFileRecord } from './anomaly.js'
import { hubApiKey, verifyUrl } from './config.js'
import { NoteClassifier } from './notes.js'

interface ProcessedFile {
  fileName: string
  record: SensorFileRecord
  deterministic: ReturnType<typeof evaluateDeterministic>
}

interface VerifyRequestBody {
  apikey: string
  task: 'evaluation'
  answer: {
    recheck: string[]
  }
}

const SENSORS_DIR = path.join(process.cwd(), 'sensors')

function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.json')
}

async function loadSensorRecord(filePath: string): Promise<SensorFileRecord> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as SensorFileRecord
}

async function callVerify(body: VerifyRequestBody): Promise<string> {
  console.log('\n[VERIFY REQUEST]')
  console.log(JSON.stringify(body, null, 2))

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await response.text()

  console.log('\n[VERIFY RESPONSE STATUS]')
  console.log(`${response.status} ${response.statusText}`)
  console.log('\n[VERIFY RESPONSE BODY]')
  console.log(text)

  if (!response.ok) {
    throw new Error(`Verify endpoint failed: ${response.status} ${response.statusText}`)
  }

  return text
}

async function main(): Promise<void> {
  console.log('========================================')
  console.log(' Task 11 — Sensor Evaluation')
  console.log('========================================')

  const entries = await fs.readdir(SENSORS_DIR)
  const files = entries.filter(isJsonFile).sort((a: string, b: string) => a.localeCompare(b))

  console.log(`Loaded ${files.length} sensor files from ${SENSORS_DIR}`)

  const classifier = new NoteClassifier({ logRequests: true })
  const recheck: string[] = []
  const processedFiles: ProcessedFile[] = []

  for (const fileName of files) {
    const fullPath = path.join(SENSORS_DIR, fileName)
    const record = await loadSensorRecord(fullPath)
    const deterministic = evaluateDeterministic(record)
    processedFiles.push({ fileName, record, deterministic })
  }

  const noteAssessments = await classifier.classifyBatch(
    processedFiles.map((item) => ({ id: item.fileName, note: item.record.operator_notes })),
  )

  for (const item of processedFiles) {
    const noteAssessment = noteAssessments.get(item.fileName) ?? 'inconclusive'
    const noteContradiction =
      (noteAssessment === 'ok' && item.deterministic.hasDeterministicAnomaly)
      || (noteAssessment === 'issues' && item.deterministic.measurementsLookOk)

    const shouldRecheck = item.deterministic.hasDeterministicAnomaly || noteContradiction

    if (shouldRecheck) {
      recheck.push(item.fileName)
    }

    console.log(
      `[${item.fileName}] deterministic=${item.deterministic.hasDeterministicAnomaly ? 'anomaly' : 'ok'} note=${noteAssessment} contradiction=${noteContradiction ? 'yes' : 'no'} recheck=${shouldRecheck ? 'yes' : 'no'}`,
    )
  }

  console.log('\nProcessing complete.')
  console.log(`Files marked for recheck: ${recheck.length}`)
  console.log(`LLM cache stats: ${JSON.stringify(classifier.getCacheStats())}`)

  const payload: VerifyRequestBody = {
    apikey: hubApiKey,
    task: 'evaluation',
    answer: {
      recheck,
    },
  }

  await callVerify(payload)
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('\nFatal error:', message)
  process.exit(1)
})
