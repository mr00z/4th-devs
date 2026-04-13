import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractFlag } from '../api/client.js'
import { finalReportFromCandidateReport, formatArea, saveFinalAnswerArtifact, scopeCluesToTarget, selectBestFields, shouldReviewAtCapture, shouldStopFromReview } from '../agent.js'
import { deriveCatalogClues } from '../candidates.js'
import log from '../logger.js'
import { parseEvidenceReviewJson, setTestAudioTranscriptionOverride } from '../llm.js'
import { routeCapture } from '../router.js'
import { extractCluesFromCsv } from '../parsers/csv.js'
import { extractCluesFromJson } from '../parsers/json.js'
import { decodeTaTiSignal, looksLikeTaTiSignal } from '../parsers/morse.js'
import { extractCluesFromText, normalizeText } from '../parsers/text.js'
import { extractCluesFromXml } from '../parsers/xml.js'
import type { CaptureRecord, Clue } from '../types.js'

async function run(): Promise<void> {
  assert.equal(looksLikeTaTiSignal('TaTa TiTiTa'), true)
  const decoded = decodeTaTiSignal('TaTiTi TaTiTi Ti Ti TiTaTaTi')
  assert.ok(decoded.tokenCount > 0)

  const normalized = normalizeText('bzzt ...powtarz... pisk ...czekam na po...  kshhh ...powtarzam ostatni ko...')
  assert.ok(!normalized.includes('kshhh'))

  const textClues = extractCluesFromText('Syjon to Gdynia. Kontakt: 123 456 789. Miasto ma 14 magazynow i powierzchnie 12.345 km2.', 't1')
  assert.ok(textClues.some((clue) => clue.field === 'cityName' && clue.value === 'Gdynia'))
  assert.ok(textClues.some((clue) => clue.field === 'phoneNumber' && clue.value === '123456789'))
  assert.ok(textClues.some((clue) => clue.field === 'warehousesCount' && clue.value === 14))
  const ordinalWarehouseClues = extractCluesFromText('Planujemy na wiosne wybudowac dwunasty magazyn.', 't1b')
  assert.ok(ordinalWarehouseClues.some((clue) => clue.field === 'warehousesCount' && clue.value === 11))
  assert.ok(!ordinalWarehouseClues.some((clue) => clue.field === 'warehousesCount' && clue.value === 12))

  const jsonResult = extractCluesFromJson(JSON.stringify({ city: 'Gdynia', syjon: true, phone: '987654321', warehousesCount: 11, area: '12.44' }), 'j1')
  assert.ok(jsonResult.clues.some((clue) => clue.field === 'phoneNumber'))

  const malformedJsonResult = extractCluesFromJson('{bad json', 'j2')
  assert.deepEqual(malformedJsonResult.clues, [])

  const csvResult = extractCluesFromCsv('name,alias,warehouses,phone\nGdynia,Syjon,8,123456789', 'c1')
  assert.ok(csvResult.clues.some((clue) => clue.field === 'phoneNumber'))

  const xmlResult = extractCluesFromXml('<root><city>Gdynia</city><alias>Syjon</alias><phone>123456789</phone></root>', 'x1')
  assert.ok(xmlResult.clues.some((clue) => clue.field === 'phoneNumber'))

  assert.equal(formatArea('12.345'), '12.35')
  assert.equal(formatArea(2), '2.00')

  const selection = selectBestFields([
    { field: 'cityName', value: 'Gdynia', confidence: 0.8, sourceId: 'a', reason: 'x' },
    { field: 'cityName', value: 'Gdynia', confidence: 0.7, sourceId: 'b', reason: 'x' },
    { field: 'cityName', value: 'Sopot', confidence: 0.9, sourceId: 'c', reason: 'x' },
  ])
  assert.equal(selection.cityName?.value, 'Gdynia')

  const citySelectionWithWeakLlmRepeats = selectBestFields([
    { field: 'cityName', value: 'Skarszewy', confidence: 0.83, sourceId: 'explicit:1', reason: 'Syjon alias clue: Syjon to Skarszewy' },
    { field: 'cityName', value: 'Jerusalem', confidence: 0.72, sourceId: 'capture:2', reason: 'LLM extracted cityName' },
    { field: 'cityName', value: 'Jerusalem', confidence: 0.72, sourceId: 'capture:15', reason: 'LLM extracted cityName' },
    { field: 'cityName', value: 'Jerusalem', confidence: 0.72, sourceId: 'capture:20', reason: 'LLM extracted cityName' },
    { field: 'cityName', value: 'Jerusalem', confidence: 0.72, sourceId: 'capture:28', reason: 'LLM extracted cityName' },
  ])
  assert.equal(citySelectionWithWeakLlmRepeats.cityName?.value, 'Skarszewy')

  const citySelectionWithDerivedCatalogMatch = selectBestFields([
    ...Array.from({ length: 28 }, (_, index) => ({
      field: 'cityName' as const,
      value: 'Domatowa',
      confidence: 0.72,
      sourceId: `capture:${index + 1}`,
      reason: 'LLM extracted cityName',
    })),
    { field: 'cityName', value: 'Skarszewy', confidence: 2.4, sourceId: 'derived:catalog-match', reason: 'Catalog-backed city match: trade profile matches Syjon kilof demand' },
  ])
  assert.equal(citySelectionWithDerivedCatalogMatch.cityName?.value, 'Skarszewy')

  const areaSelection = selectBestFields([
    { field: 'cityArea', value: '12.3', confidence: 0.8, sourceId: 'a', reason: 'x' },
    { field: 'cityArea', value: '12.30', confidence: 0.79, sourceId: 'b', reason: 'x' },
    { field: 'cityArea', value: '12.40', confidence: 1.0, sourceId: 'c', reason: 'x' },
  ])
  assert.equal(areaSelection.cityArea?.value, '12.30')

  const invalidAreaSelection = selectBestFields([
    { field: 'cityArea', value: 'polnocnego sektora', confidence: 0.95, sourceId: 'bad', reason: 'x' },
    { field: 'cityArea', value: '15.68', confidence: 0.8, sourceId: 'good', reason: 'x' },
  ])
  assert.equal(invalidAreaSelection.cityArea?.value, '15.68')

  const targetCaptures: CaptureRecord[] = [
    { id: 'capture:1', index: 1, kind: 'text', raw: null, message: 'Syjon to Gdynia', clues: [] },
    { id: 'capture:2', index: 2, kind: 'text', raw: null, message: 'Puck area 16.94', clues: [] },
    { id: 'capture:3', index: 3, kind: 'text', raw: null, message: 'Gdynia area 15.68 phone 123456789', clues: [] },
    { id: 'capture:4', index: 4, kind: 'text', raw: null, message: 'Syjon ma 999 magazynow', clues: [] },
  ]
  const targetClues: Clue[] = [
    { field: 'cityName', value: 'Gdynia', confidence: 0.9, sourceId: 'capture:1', reason: 'x' },
    { field: 'cityArea', value: '16.94', confidence: 0.95, sourceId: 'capture:2', reason: 'x' },
    { field: 'cityArea', value: '15.68', confidence: 0.8, sourceId: 'capture:3', reason: 'x' },
    { field: 'phoneNumber', value: '123456789', confidence: 0.8, sourceId: 'capture:3', reason: 'x' },
    { field: 'warehousesCount', value: 999, confidence: 0.95, sourceId: 'capture:4', reason: 'x' },
  ]
  const scopedClues = scopeCluesToTarget(targetCaptures, targetClues, 'Gdynia')
  assert.ok(!scopedClues.some((clue) => clue.sourceId === 'capture:2'))
  assert.ok(scopedClues.some((clue) => clue.sourceId === 'capture:3' && clue.field === 'cityArea'))
  assert.ok(!scopedClues.some((clue) => clue.sourceId === 'capture:4'))

  const imageLikeTargetCaptures: CaptureRecord[] = [
    { id: 'capture:image', index: 1, kind: 'attachment', raw: null, message: 'Signal captured.', summary: 'image/png capture.png', decodedText: '', clues: [] },
  ]
  const imageLikeTargetClues: Clue[] = [
    { field: 'cityName', value: 'Skarszewy', confidence: 0.72, sourceId: 'capture:image', reason: 'LLM extracted cityName' },
    { field: 'phoneNumber', value: '644122092', confidence: 0.74, sourceId: 'capture:image', reason: 'LLM extracted phoneNumber' },
  ]
  const scopedImageLikeClues = scopeCluesToTarget(imageLikeTargetCaptures, imageLikeTargetClues, 'Skarszewy')
  assert.ok(scopedImageLikeClues.some((clue) => clue.sourceId === 'capture:image' && clue.field === 'phoneNumber'))

  const catalogDrivenCaptures: CaptureRecord[] = [
    {
      id: 'capture:csv',
      index: 1,
      kind: 'attachment',
      raw: null,
      message: 'Signal captured.',
      decodedText: 'miasto,akcja,towar,ilosc,w_zamian\nSyjon,szuka,kilof,,bydlo\nSyjon,sprzedaje,bydlo,,kilof\nSkarszewy,szuka,kilof,,wolowina\nSkarszewy,sprzedaje,wolowina,1,kilof',
      clues: [],
    },
    {
      id: 'capture:text1',
      index: 2,
      kind: 'text',
      raw: null,
      message: 'Signal captured.',
      decodedText: 'Ze Skarszewami to zawsze byl problem. Bydlo mowia, ze maja swoje. Nad rzeka mieszkaja, wiec wody nie potrzebuja.',
      clues: [],
    },
    {
      id: 'capture:text2',
      index: 3,
      kind: 'text',
      raw: null,
      message: 'Signal captured.',
      decodedText: 'Z Karszewach mamy juz pelne magazyny. Planujemy na wiosne wybudowac dwunasty magazyn. Mamy wolowine na wymiane.',
      clues: [{ field: 'warehousesCount', value: 11, confidence: 0.95, sourceId: 'capture:text2', reason: 'Future warehouse plan implies current count: wybudowac dwunasty magazyn' }],
    },
    {
      id: 'capture:json',
      index: 4,
      kind: 'attachment',
      raw: null,
      message: 'Signal captured.',
      decodedText: JSON.stringify([
        { name: 'Narew', occupiedArea: 3.2195, riverAccess: true, farmAnimals: false, inhabitants: 264 },
        { name: 'Skarszewy', occupiedArea: 10.7284, riverAccess: true, farmAnimals: true, inhabitants: 201 },
        { name: 'Drohiczyn', occupiedArea: 15.6841, riverAccess: true, farmAnimals: true, inhabitants: 156 },
      ]),
      attachment: { path: 'x', relativePath: 'cities.json', hash: 'h', mimeType: 'application/json', size: 1, extension: '.json' },
      clues: [],
    },
  ]
  const derivedCatalogClues = deriveCatalogClues(catalogDrivenCaptures)
  assert.ok(derivedCatalogClues.some((clue) => clue.field === 'cityName' && clue.value === 'Skarszewy'))
  assert.ok(derivedCatalogClues.some((clue) => clue.field === 'cityArea' && clue.value === '10.7284'))
  assert.ok(derivedCatalogClues.some((clue) => clue.field === 'warehousesCount' && clue.value === 11))

  const derivedScopedClues = scopeCluesToTarget(catalogDrivenCaptures, derivedCatalogClues, 'Skarszewy')
  assert.ok(derivedScopedClues.some((clue) => clue.sourceId === 'derived:catalog-match' && clue.field === 'cityArea'))

  const textCapture = await routeCapture(1, {
    code: 100,
    message: 'Signal captured.',
    transcription: 'Slyszales, ze Syjon to Gdynia? Kontakt do miasta: 123 456 789. Maja 12 magazynow i powierzchnie 99.99 km2.',
  })
  assert.equal(textCapture.kind, 'text')
  assert.ok(textCapture.clues.length >= 3)

  const jsonAttachmentPayload = {
    code: 100,
    message: 'Signal captured.',
    meta: 'application/json',
    attachment: Buffer.from(JSON.stringify({ cityName: 'Gdynia', phoneNumber: '123456789' }), 'utf8').toString('base64'),
    filesize: 42,
  }
  const attachmentCapture = await routeCapture(2, jsonAttachmentPayload)
  assert.equal(attachmentCapture.kind, 'attachment')
  assert.ok(attachmentCapture.attachment?.path)
  assert.ok(attachmentCapture.clues.some((clue) => clue.field === 'phoneNumber'))

  setTestAudioTranscriptionOverride(async () => ({
    text: 'Syjon ma 12 magazynow. Kontakt 123 456 789.',
    clues: extractCluesFromText('Syjon ma 12 magazynow. Kontakt 123 456 789.', 'capture:audio'),
  }))
  const audioAttachmentCapture = await routeCapture(5, {
    code: 100,
    message: 'Signal captured.',
    meta: 'audio/mpeg',
    attachment: Buffer.from('fake-audio', 'utf8').toString('base64'),
    filesize: 10,
  })
  setTestAudioTranscriptionOverride(null)
  assert.equal(audioAttachmentCapture.kind, 'attachment')
  assert.equal(audioAttachmentCapture.decodedText, 'Syjon ma 12 magazynow. Kontakt 123 456 789.')
  assert.ok(audioAttachmentCapture.clues.some((clue) => clue.field === 'warehousesCount' && clue.value === 12))

  const malformedAttachmentCapture = await routeCapture(4, {
    code: 100,
    message: 'Signal captured.',
    meta: 'application/json',
    attachment: Buffer.from('{bad json', 'utf8').toString('base64'),
    filesize: 9,
  })
  assert.equal(malformedAttachmentCapture.kind, 'attachment')
  assert.equal(malformedAttachmentCapture.decodedText, '{bad json')

  const terminalCapture = await routeCapture(3, { code: 0, message: 'Masz juz wystarczajaco duzo danych do analizy.' })
  assert.equal(terminalCapture.kind, 'terminal')

  assert.equal(shouldReviewAtCapture(9), false)
  assert.equal(shouldReviewAtCapture(10), true)
  assert.equal(shouldReviewAtCapture(14), false)
  assert.equal(shouldReviewAtCapture(15), true)

  const parsedReview = parseEvidenceReviewJson(JSON.stringify({
    decision: 'stop',
    confidence: 0.91,
    reason: 'All required fields are corroborated.',
    missingFields: [],
    cityName: 'Gdynia',
    cityArea: '15.68',
    warehousesCount: 12,
    phoneNumber: '123 456 789',
  }))
  assert.ok(parsedReview)
  assert.equal(parsedReview?.decision, 'stop')
  assert.equal(parsedReview?.candidateReport?.phoneNumber, '123456789')
  assert.equal(shouldStopFromReview(parsedReview!), true)
  const invalidPhoneReview = parseEvidenceReviewJson(JSON.stringify({
    decision: 'continue',
    confidence: 0.8,
    reason: 'Phone number is too short.',
    missingFields: ['phoneNumber'],
    cityName: 'Gdynia',
    cityArea: '15.68',
    warehousesCount: 12,
    phoneNumber: '472',
  }))
  assert.ok(invalidPhoneReview)
  assert.equal(invalidPhoneReview?.candidateReport?.phoneNumber, undefined)

  const weakReview = parseEvidenceReviewJson(JSON.stringify({
    decision: 'stop',
    confidence: 0.69,
    reason: 'Probably enough.',
    missingFields: [],
    cityName: 'Gdynia',
    cityArea: '15.68',
    warehousesCount: 12,
    phoneNumber: '123456789',
  }))
  assert.ok(weakReview)
  assert.equal(shouldStopFromReview(weakReview!), false)
  assert.equal(parseEvidenceReviewJson('not json at all'), null)

  const reviewBackedFinalReport = finalReportFromCandidateReport({
    cityName: 'Skarszewy',
    cityArea: '10.7284',
    warehousesCount: 12,
    phoneNumber: '644 122 092',
  })
  assert.deepEqual(reviewBackedFinalReport, {
    cityName: 'Skarszewy',
    cityArea: '10.73',
    warehousesCount: 12,
    phoneNumber: '644122092',
  })
  assert.equal(finalReportFromCandidateReport({
    cityName: 'Skarszewy',
    cityArea: '10.7284',
    warehousesCount: 12,
  }), null)

  const finalAnswerPath = saveFinalAnswerArtifact({
    cityName: 'Gdynia',
    cityArea: '15.68',
    warehousesCount: 12,
    phoneNumber: '123456789',
  }, 'ok {FLG:test-value}', '{FLG:test-value}', 15)
  assert.ok(finalAnswerPath.startsWith(log.workspaceRunDir))
  const finalAnswer = JSON.parse(fs.readFileSync(finalAnswerPath, 'utf8')) as Record<string, unknown>
  assert.equal(finalAnswer.flag, '{FLG:test-value}')
  assert.equal(finalAnswer.captureCount, 15)
  assert.ok(typeof finalAnswer.lastUpdatedAt === 'string')

  assert.equal(extractFlag('ok {FLG:test-value} done'), '{FLG:test-value}')
  assert.equal(extractFlag('no flag here'), null)

  console.log('All checks passed.')
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
