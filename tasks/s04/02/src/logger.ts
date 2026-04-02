import fs from 'node:fs'
import path from 'node:path'

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

const dayStamp = new Date().toISOString().slice(0, 10)
const logFile = path.join(logsDir, `windpower-${dayStamp}.log`)

function nowIso(): string {
  return new Date().toISOString()
}

function serialize(details: unknown): string {
  if (details === undefined) {
    return ''
  }
  if (typeof details === 'string') {
    return details
  }
  return JSON.stringify(details)
}

function appendFile(level: string, message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`
  const line = `${nowIso()} ${level} ${message}${suffix}\n`
  fs.appendFileSync(logFile, line)
}

function print(level: string, color: string, message: string, details?: unknown): void {
  const ts = nowIso()
  const suffix = details === undefined ? '' : ` ${serialize(details)}`
  console.log(`${colors.dim}[${ts}]${colors.reset} ${color}${level}${colors.reset} ${message}${suffix}`)
  appendFile(level, message, details)
}

const log = {
  filePath: logFile,
  info: (message: string, details?: unknown): void => print('INFO', colors.blue, message, details),
  success: (message: string, details?: unknown): void => print('SUCCESS', colors.green, message, details),
  warn: (message: string, details?: unknown): void => print('WARN', colors.yellow, message, details),
  error: (message: string, details?: unknown): void => print('ERROR', colors.red, message, details),
  apiRequest: (action: string, payload: unknown): void => print('API→', colors.cyan, action, payload),
  apiResponse: (action: string, details: unknown): void => print('API←', colors.cyan, action, details),
}

appendFile('INFO', '=== WINDPOWER SESSION START ===')
console.log(`${colors.dim}[${nowIso()}]${colors.reset} ${colors.cyan}LOG${colors.reset} file=${logFile}`)

export default log
