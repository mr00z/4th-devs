import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGood, normalizePathName, normalizePersonFileName, stripDiacritics } from '../core/normalize.js'

test('stripDiacritics removes polish diacritics', () => {
  assert.equal(stripDiacritics('mąka łódź żółć'), 'maka lodz zolc')
})

test('normalizeGood singularizes expected goods', () => {
  assert.equal(normalizeGood('łopaty'), 'lopata')
  assert.equal(normalizeGood('wiertarki'), 'wiertarka')
  assert.equal(normalizeGood('ryż'), 'ryz')
  assert.equal(normalizeGood('ziemniaki'), 'ziemniak')
})

test('normalize path and person names', () => {
  assert.equal(normalizePathName('Marta Frantz'), 'marta_frantz')
  assert.equal(normalizePersonFileName('Iga Kapecka'), 'iga_kapecka')
})
