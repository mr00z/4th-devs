import fs from 'node:fs'
import path from 'node:path'

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function loadEnvFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return
  }

  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(filePath)
    return
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    if (!key || process.env[key] !== undefined) {
      continue
    }

    const value = normalized.slice(separatorIndex + 1)
    process.env[key] = stripMatchingQuotes(value)
  }
}

const rootEnvPath = path.resolve(process.cwd(), '../../../.env')
loadEnvFromFile(rootEnvPath)
