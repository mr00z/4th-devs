import test from 'node:test'
import assert from 'node:assert/strict'
import { getToolSpecs } from '../tools.js'

test('tool descriptions mention recovery and exact title convention', () => {
  const specs = getToolSpecs()
  const finalize = specs.find((spec) => spec.definition.function.name === 'finalize')
  const create = specs.find((spec) => spec.definition.function.name === 'create_order')
  assert.ok(finalize)
  assert.ok(create)
  assert.match(finalize.definition.function.description, /repair/i)
  assert.match(create.definition.function.description, /Dostawa dla <city>/i)
})

test('query_database tool has a single query string input', () => {
  const specs = getToolSpecs()
  const query = specs.find((spec) => spec.definition.function.name === 'query_database')
  assert.ok(query)
  const parameters = query.definition.function.parameters as {
    properties: { query: { type: string } }
    required: string[]
  }
  assert.equal(parameters.properties.query.type, 'string')
  assert.deepEqual(parameters.required, ['query'])
})
