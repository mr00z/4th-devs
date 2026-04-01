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

const now = new Date()
const date = now.toISOString().slice(0, 10)
const time = now.toTimeString().slice(0, 5).replace(':', '')
const logFile = path.join(logsDir, `okoeditor-${date}-${time}.log`)

const ts = (): string => new Date().toLocaleTimeString('en-US', { hour12: false })
const fullTs = (): string => new Date().toISOString()

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function write(line: string): void {
  fs.appendFileSync(logFile, `${fullTs()} ${line}\n`)
}

function print(level: string, color: string, message: string, details?: unknown): void {
  const preview = details === undefined ? '' : ` ${stringify(details)}`
  console.log(`${colors.dim}[${ts()}]${colors.reset} ${color}${level}${colors.reset} ${message}${preview}`)

  const full = details === undefined ? '' : ` ${JSON.stringify(details)}`
  write(`${level} ${message}${full}`)
}

console.log(`${colors.cyan}Logs: ${logFile}${colors.reset}`)
write('=== SESSION START ===')

function printApi(direction: '→' | '←', details: Record<string, unknown>): void {
  const prefix = `${colors.dim}[${ts()}]${colors.reset} ${colors.cyan}API${colors.reset} ${direction} `

  if (direction === '→') {
    // Request: action, page, id
    const parts: string[] = []
    if (details.action) parts.push(`action=${details.action}`)
    if (details.page) parts.push(`page=${details.page}`)
    if (details.id) parts.push(`id=${String(details.id).slice(0, 8)}...`)
    console.log(`${prefix}${parts.join(' ')}`)
  } else {
    // Response: status, duration, flag/error
    const statusColor = details.ok ? colors.green : colors.red
    const statusText = details.ok ? 'OK' : 'ERR'
    const status = `${statusColor}${details.status}${colors.reset} ${statusColor}${statusText}${colors.reset}`
    const duration = `${colors.dim}${details.duration}${colors.reset}`

    let extra = ''
    if (details.flag) {
      extra = ` ${colors.green}⚑ ${details.flag}${colors.reset}`
    } else if (!details.ok && details.raw) {
      const rawObj = details.raw as string
      const msgMatch = rawObj.match(/"message":\s*"([^"]+)"/)
      if (msgMatch) {
        extra = ` ${colors.red}${msgMatch[1]}${colors.reset}`
      }
    }

    console.log(`${prefix}${status} ${duration}${extra}`)
  }

  const full = ` ${JSON.stringify(details)}`
  write(`API ${direction}${full}`)
}

const log = {
  filePath: logFile,
  debug: (message: string, details?: unknown): void => print('DBG', colors.dim, message, details),
  info: (message: string, details?: unknown): void => print('INFO', colors.blue, message, details),
  success: (message: string, details?: unknown): void => print('OK', colors.green, message, details),
  warn: (message: string, details?: unknown): void => print('WARN', colors.yellow, message, details),
  error: (message: string, details?: unknown): void => print('ERR', colors.red, message, details),
  ai: (message: string, details?: unknown): void => print('AI', colors.cyan, message, details),
  browser: (message: string, details?: unknown): void => print('BRW', colors.yellow, message, details),
  api: {
    request: (details: Record<string, unknown>): void => printApi('→', details),
    response: (details: Record<string, unknown>): void => printApi('←', details),
  },
}

export default log
