import test from 'node:test'
import assert from 'node:assert/strict'
import { selectManifestForExecution } from '../agent.js'
import { normalizeKnowledge } from '../core/validate.js'
import type { ExtractedKnowledge } from '../types.js'

const extracted: ExtractedKnowledge = {
  cityDemands: [
    { city: 'Domatowa', rawGood: 'makaronu', quantity: 60, evidence: 'x' },
    { city: 'Domatowa', rawGood: 'butelek wody', quantity: 150, evidence: 'x' },
    { city: 'Domatowa', rawGood: 'lopat', quantity: 8, evidence: 'x' },
    { city: 'Opalino', rawGood: 'chlebow', quantity: 45, evidence: 'x' },
    { city: 'Opalino', rawGood: 'butelek wody', quantity: 120, evidence: 'x' },
    { city: 'Opalino', rawGood: 'mlotkow', quantity: 6, evidence: 'x' },
  ],
  cityContacts: [
    { city: 'Domatowa', fullName: 'Natan Rams', evidence: 'x' },
    { city: 'Opalina', fullName: 'Iga Kapecka', evidence: 'x' },
  ],
  transactions: [
    { sellerCity: 'Opalino', rawGood: 'makaron', buyerCity: 'Domatowo', evidence: 'x' },
    { sellerCity: 'Domatowo', rawGood: 'chleb', buyerCity: 'Opalino', evidence: 'x' },
  ],
  ambiguities: [],
}

test('selectManifestForExecution falls back to deterministic manifest when architect output is incomplete', () => {
  const validatedKnowledge = normalizeKnowledge(extracted)
  const architectResult = JSON.stringify({
    directories: ['/miasta', '/osoby', '/towary'],
    files: [
      {
        path: '/miasta/domatowo',
        content: '{\n  "makaron": 60,\n  "woda": 150,\n  "lopata": 8\n}',
      },
      {
        path: '/miasta/opalino',
        content: '{\n  "chleb": 45,\n  "woda": 120,\n  "mlotek": 6\n}',
      },
      {
        path: '/osoby/natan_rams',
        content: 'Natan Rams\n\n[domatowo](/miasta/domatowo)',
      },
      {
        path: '/towary/makaron',
        content: 'makaron\n\n- [opalino](/miasta/opalino)',
      },
      {
        path: '/towary/chleb',
        content: 'chleb\n\n- [domatowo](/miasta/domatowo)',
      },
    ],
  })

  const selected = selectManifestForExecution({
    validatedKnowledge,
    architectResult,
  })

  assert.equal(selected.usedDeterministicFallback, true)
  assert.match(selected.reason || '', /invalid|differs/i)
  assert.ok(selected.manifest.files.some((file) => file.path === '/osoby/iga_kapecka'))
})
