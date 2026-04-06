import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManifestFromKnowledge } from '../core/buildManifest.js'
import { normalizeCity } from '../core/normalize.js'
import { normalizeContactFullName, normalizeKnowledge, validateManifest } from '../core/validate.js'
import type { ExtractedKnowledge } from '../types.js'

const extracted: ExtractedKnowledge = {
  cityDemands: [
    { city: 'Opalino', rawGood: 'chlebow', quantity: 45, evidence: 'x' },
    { city: 'Opalino', rawGood: 'butelek wody', quantity: 120, evidence: 'x' },
    { city: 'Opalino', rawGood: 'mlotkow', quantity: 6, evidence: 'x' },
    { city: 'Domatowa', rawGood: 'makaronu', quantity: 60, evidence: 'x' },
    { city: 'Domatowa', rawGood: 'butelek wody', quantity: 150, evidence: 'x' },
    { city: 'Domatowa', rawGood: 'lopat', quantity: 8, evidence: 'x' },
    { city: 'Brudzewo', rawGood: 'ryz', quantity: 55, evidence: 'x' },
    { city: 'Brudzewo', rawGood: 'butelek wody', quantity: 140, evidence: 'x' },
    { city: 'Brudzewo', rawGood: 'wiertarek', quantity: 5, evidence: 'x' },
    { city: 'Darzlubiu', rawGood: 'porcji wolowiny', quantity: 25, evidence: 'x' },
    { city: 'Darzlubiu', rawGood: 'butelek wody', quantity: 130, evidence: 'x' },
    { city: 'Darzlubiu', rawGood: 'kilofow', quantity: 7, evidence: 'x' },
    { city: 'Celbowo', rawGood: 'porcji kurczaka', quantity: 40, evidence: 'x' },
    { city: 'Celbowo', rawGood: 'butelek wody', quantity: 125, evidence: 'x' },
    { city: 'Celbowo', rawGood: 'mlotkow', quantity: 6, evidence: 'x' },
    { city: 'Mechowo', rawGood: 'ziemniaki', quantity: 100, evidence: 'x' },
    { city: 'Mechowo', rawGood: 'kapusta', quantity: 70, evidence: 'x' },
    { city: 'Mechowo', rawGood: 'marchew', quantity: 65, evidence: 'x' },
    { city: 'Mechowo', rawGood: 'woda', quantity: 165, evidence: 'x' },
    { city: 'Mechowo', rawGood: 'lopaty', quantity: 9, evidence: 'x' },
    { city: 'Puck', rawGood: 'chlebow', quantity: 50, evidence: 'x' },
    { city: 'Puck', rawGood: 'ryz', quantity: 45, evidence: 'x' },
    { city: 'Puck', rawGood: 'butelek wody', quantity: 175, evidence: 'x' },
    { city: 'Puck', rawGood: 'wiertarek', quantity: 7, evidence: 'x' },
    { city: 'Karlinkowo', rawGood: 'makaronu', quantity: 52, evidence: 'x' },
    { city: 'Karlinkowo', rawGood: 'porcje wolowiny', quantity: 22, evidence: 'x' },
    { city: 'Karlinkowo', rawGood: 'ziemniakow', quantity: 95, evidence: 'x' },
    { city: 'Karlinkowo', rawGood: 'butelek wody', quantity: 155, evidence: 'x' },
    { city: 'Karlinkowo', rawGood: 'kilofow', quantity: 6, evidence: 'x' },
  ],
  cityContacts: [
    { city: 'Domatowa', fullName: 'Natan Rams', evidence: 'x' },
    { city: 'Opalina', fullName: 'Iga Kapecka', evidence: 'x' },
    { city: 'Brudzewo', fullName: 'Kisiel', evidence: 'x' },
    { city: 'Brudzewo', fullName: 'Rafal', evidence: 'x' },
    { city: 'Darzlubiem', fullName: 'Frantz', evidence: 'x' },
    { city: 'Darzlubiem', fullName: 'Marta Frantz', evidence: 'x' },
    { city: 'Celbowa', fullName: 'Oskar Radtke', evidence: 'x' },
    { city: 'Mechowo', fullName: 'Eliza Redmann', evidence: 'x' },
    { city: 'Puck', fullName: 'Damian Kroll', evidence: 'x' },
    { city: 'Karlinkowo', fullName: 'Konkel', evidence: 'x' },
    { city: 'Karlinkowo', fullName: 'Lena', evidence: 'x' },
  ],
  transactions: [
    { sellerCity: 'Darzlubie', rawGood: 'ryĹĽ', buyerCity: 'Puck', evidence: 'x' },
    { sellerCity: 'Puck', rawGood: 'marchew', buyerCity: 'Mechowo', evidence: 'x' },
    { sellerCity: 'Domatowo', rawGood: 'chleb', buyerCity: 'Opalino', evidence: 'x' },
    { sellerCity: 'Opalino', rawGood: 'woĹ‚owina', buyerCity: 'Darzlubie', evidence: 'x' },
    { sellerCity: 'Puck', rawGood: 'kilof', buyerCity: 'Darzlubie', evidence: 'x' },
    { sellerCity: 'Karlinkowo', rawGood: 'wiertarka', buyerCity: 'Puck', evidence: 'x' },
    { sellerCity: 'Celbowo', rawGood: 'chleb', buyerCity: 'Opalino', evidence: 'x' },
    { sellerCity: 'Brudzewo', rawGood: 'mÄ…ka', buyerCity: 'Karlinkowo', evidence: 'x' },
    { sellerCity: 'Karlinkowo', rawGood: 'mĹ‚otek', buyerCity: 'Opalino', evidence: 'x' },
    { sellerCity: 'Opalino', rawGood: 'makaron', buyerCity: 'Domatowo', evidence: 'x' },
    { sellerCity: 'Celbowo', rawGood: 'kapusta', buyerCity: 'Mechowo', evidence: 'x' },
    { sellerCity: 'Domatowo', rawGood: 'ziemniaki', buyerCity: 'Mechowo', evidence: 'x' },
    { sellerCity: 'Opalino', rawGood: 'ryĹĽ', buyerCity: 'Brudzewo', evidence: 'x' },
    { sellerCity: 'Mechowo', rawGood: 'kilof', buyerCity: 'Karlinkowo', evidence: 'x' },
    { sellerCity: 'Brudzewo', rawGood: 'chleb', buyerCity: 'Puck', evidence: 'x' },
    { sellerCity: 'Darzlubie', rawGood: 'ziemniaki', buyerCity: 'Karlinkowo', evidence: 'x' },
    { sellerCity: 'Darzlubie', rawGood: 'kurczak', buyerCity: 'Celbowo', evidence: 'x' },
    { sellerCity: 'Karlinkowo', rawGood: 'ryĹĽ', buyerCity: 'Brudzewo', evidence: 'x' },
    { sellerCity: 'Brudzewo', rawGood: 'Ĺ‚opata', buyerCity: 'Domatowo', evidence: 'x' },
    { sellerCity: 'Puck', rawGood: 'Ĺ‚opata', buyerCity: 'Domatowo', evidence: 'x' },
    { sellerCity: 'Mechowo', rawGood: 'mÄ…ka', buyerCity: 'Domatowo', evidence: 'x' },
    { sellerCity: 'Mechowo', rawGood: 'mĹ‚otek', buyerCity: 'Celbowo', evidence: 'x' },
    { sellerCity: 'Celbowo', rawGood: 'kilof', buyerCity: 'Darzlubie', evidence: 'x' },
    { sellerCity: 'Domatowo', rawGood: 'wiertarka', buyerCity: 'Brudzewo', evidence: 'x' },
  ],
  ambiguities: [],
}

test('normalizeCity canonicalizes inflected city names', () => {
  assert.equal(normalizeCity('Domatowa'), 'domatowo')
  assert.equal(normalizeCity('Domatowie'), 'domatowo')
  assert.equal(normalizeCity('Darzlubiu'), 'darzlubie')
  assert.equal(normalizeCity('Darzlubiem'), 'darzlubie')
  assert.equal(normalizeCity('Opalina'), 'opalino')
  assert.equal(normalizeCity('Celbowa'), 'celbowo')
})

test('normalizeContactFullName expands known partial names', () => {
  assert.equal(normalizeContactFullName('Kisiel'), 'Rafal Kisiel')
  assert.equal(normalizeContactFullName('Konkel'), 'Lena Konkel')
  assert.equal(normalizeContactFullName('Frantz'), 'Marta Frantz')
  assert.equal(normalizeContactFullName('Marta Frantz'), 'Marta Frantz')
})

test('normalizeKnowledge resolves canonical cities and preferred contacts', () => {
  const knowledge = normalizeKnowledge(extracted)

  assert.deepEqual(knowledge.cityDemands.domatowo, { makaron: 60, woda: 150, lopata: 8 })
  assert.equal(knowledge.cityContacts.find((contact) => contact.city === 'brudzewo')?.fullName, 'Rafal Kisiel')
  assert.equal(knowledge.cityContacts.find((contact) => contact.city === 'karlinkowo')?.fullName, 'Lena Konkel')
  assert.equal(knowledge.cityContacts.find((contact) => contact.city === 'darzlubie')?.fileName, 'marta_frantz')
})

test('buildManifestFromKnowledge creates canonical files for the full notes fixture', () => {
  const manifest = buildManifestFromKnowledge(normalizeKnowledge(extracted))
  const cityFiles = manifest.files.filter((file) => file.path.startsWith('/miasta/'))
  const personFiles = manifest.files.filter((file) => file.path.startsWith('/osoby/'))
  const goodsFiles = manifest.files.filter((file) => file.path.startsWith('/towary/'))

  assert.equal(cityFiles.length, 8)
  assert.equal(personFiles.length, 8)
  assert.equal(goodsFiles.length, 13)
  assert.ok(cityFiles.some((file) => file.path === '/miasta/domatowo'))
  assert.ok(cityFiles.some((file) => file.path === '/miasta/darzlubie'))
  assert.ok(personFiles.some((file) => file.path === '/osoby/rafal_kisiel'))
  assert.ok(personFiles.some((file) => file.path === '/osoby/lena_konkel'))
})

test('validateManifest accepts deterministic manifest for the full notes fixture', () => {
  const knowledge = normalizeKnowledge(extracted)
  const manifest = buildManifestFromKnowledge(knowledge)
  assert.doesNotThrow(() => validateManifest(manifest, knowledge))
})

test('validateManifest rejects missing person files', () => {
  const knowledge = normalizeKnowledge(extracted)
  const manifest = buildManifestFromKnowledge(knowledge)
  const broken = {
    ...manifest,
    files: manifest.files.filter((file) => file.path !== '/osoby/iga_kapecka'),
  }

  assert.throws(() => validateManifest(broken, knowledge), /missing person file/)
})

test('validateManifest rejects missing goods files', () => {
  const knowledge = normalizeKnowledge(extracted)
  const manifest = buildManifestFromKnowledge(knowledge)
  const broken = {
    ...manifest,
    files: manifest.files.filter((file) => file.path !== '/towary/kurczak'),
  }

  assert.throws(() => validateManifest(broken, knowledge), /missing goods file/)
})

test('validateManifest rejects wrong person link target', () => {
  const knowledge = normalizeKnowledge(extracted)
  const manifest = buildManifestFromKnowledge(knowledge)
  const broken = {
    ...manifest,
    files: manifest.files.map((file) => (
      file.path === '/osoby/iga_kapecka'
        ? { ...file, content: 'Iga Kapecka\nMiasto: [puck](/miasta/puck)' }
        : file
    )),
  }

  assert.throws(() => validateManifest(broken, knowledge), /includes unexpected link|missing required link/)
})

test('validateManifest rejects incomplete goods seller list', () => {
  const knowledge = normalizeKnowledge(extracted)
  const manifest = buildManifestFromKnowledge(knowledge)
  const broken = {
    ...manifest,
    files: manifest.files.map((file) => (
      file.path === '/towary/chleb'
        ? { ...file, content: 'Sprzedawcy:\n- [domatowo](/miasta/domatowo)' }
        : file
    )),
  }

  assert.throws(() => validateManifest(broken, knowledge), /goods file .*missing required link|includes unexpected link/)
})

test('validateManifest rejects inflected city filenames', () => {
  const knowledge = normalizeKnowledge(extracted)
  assert.throws(
    () => validateManifest({
      directories: ['/miasta', '/osoby', '/towary'],
      files: [
        { path: '/miasta/domatowa', content: '{"makaron":60,"woda":150,"lopata":8}' },
        { path: '/miasta/opalino', content: '{"chleb":45,"woda":120,"mlotek":6}' },
        { path: '/osoby/natan_rams', content: 'Natan Rams\nMiasto: [domatowo](/miasta/domatowo)' },
        { path: '/towary/makaron', content: 'Sprzedawcy:\n- [opalino](/miasta/opalino)' },
      ],
    }, knowledge),
    /unexpected city file|missing city file for demanded city/,
  )
})
