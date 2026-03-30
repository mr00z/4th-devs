import fs from 'node:fs'
import path from 'node:path'

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const

const timestamp = (): string => new Date().toLocaleTimeString('en-US', { hour12: false })
const fullTimestamp = (): string => new Date().toISOString()
const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')

const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

const logFile = path.join(logsDir, `agent-${fileStamp()}.log`)

const writeToFile = (message: string): void => {
  try {
    fs.appendFileSync(logFile, `${fullTimestamp()} ${message}\n`)
  } catch (err) {
    console.error('Failed to write to log file:', err)
  }
}

console.log(`${colors.cyan}📝 Logs will be saved to: ${logFile}${colors.reset}`)
writeToFile('=== LOG SESSION STARTED ===')

function print(level: string, color: string, message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`
  console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${color}${level}${colors.reset} ${message}${suffix}`)
  writeToFile(`${level} ${message}${suffix}`)
}

const log = {
  filePath: logFile,
  info: (message: string, details?: unknown): void => print('INFO', colors.blue, message, details),
  success: (message: string, details?: unknown): void => print('SUCCESS', colors.green, message, details),
  warn: (message: string, details?: unknown): void => print('WARN', colors.yellow, message, details),
  error: (message: string, details?: unknown): void => print('ERROR', colors.red, message, details),
  toolCall: (endpoint: string, query: string): void => {
    print('TOOL', colors.magenta, `${endpoint} :: ${query}`)
  },
  toolResult: (endpoint: string, status: number, bodyPreview: string): void => {
    print('TOOL_RESULT', colors.magenta, `${endpoint} status=${status}`, { bodyPreview })
  },
  verify: (answer: string[]): void => {
    print('VERIFY', colors.bright + colors.white, 'Submitting final answer', { answer })
  },
}

export default log
