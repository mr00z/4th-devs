import test from 'node:test'
import assert from 'node:assert/strict'
import { getToolSpecs } from '../tools.js'

test('tool descriptions carry core remote constraints', () => {
  const specs = getToolSpecs(async () => '')
  const apply = specs.find((spec) => spec.definition.function.name === 'apply_filesystem_manifest')
  assert.ok(apply)
  const description = apply.definition.function.description
  assert.match(description, /directory names max 30 chars/)
  assert.match(description, /file names max 20 chars/)
  assert.match(description, /global unique names/)
  assert.match(description, /city files must contain JSON/)
})

test('read_natan_note schema restricts note ids via enum', () => {
  const specs = getToolSpecs(async () => '')
  const read = specs.find((spec) => spec.definition.function.name === 'read_natan_note')
  assert.ok(read)
  const parameters = read.definition.function.parameters as { properties: { note: { enum: string[] } } }
  assert.deepEqual(parameters.properties.note.enum, ['readme', 'ogloszenia', 'rozmowy', 'transakcje'])
})

test('inspect_virtual_directory path is constrained', () => {
  const specs = getToolSpecs(async () => '')
  const inspect = specs.find((spec) => spec.definition.function.name === 'inspect_virtual_directory')
  assert.ok(inspect)
  const parameters = inspect.definition.function.parameters as { properties: { path: { enum: string[] } } }
  assert.deepEqual(parameters.properties.path.enum, ['/', '/miasta', '/osoby', '/towary'])
})
