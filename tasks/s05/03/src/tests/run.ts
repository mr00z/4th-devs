import assert from 'node:assert/strict'
import { extractFlag } from '../api/client.js'
import { validateShellCommand } from '../shell-safety.js'
import { subtractOneDay } from '../utils.js'

assert.equal(extractFlag('ok {FLG:test-value} done'), '{FLG:test-value}')
assert.equal(extractFlag('no flag here'), null)

assert.equal(subtractOneDay('2020-01-01'), '2019-12-31')
assert.equal(subtractOneDay('2024-03-01'), '2024-02-29')

assert.equal(validateShellCommand('ls -la /data').ok, true)
assert.equal(validateShellCommand('find /data -type f | head').ok, true)
assert.equal(validateShellCommand("echo '{\"date\":\"2020-01-01\",\"city\":\"X\",\"longitude\":1,\"latitude\":2}'").ok, true)
assert.equal(validateShellCommand('rm -rf /data').ok, false)

console.log('All checks passed.')
