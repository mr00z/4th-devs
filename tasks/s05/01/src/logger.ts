import fs from 'node:fs'
import path from 'node:path'
import { paths, taskName } from './config.js'

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

if (!fs.existsSync(paths.logsDir)) {
  fs.mkdirSync(paths.logsDir, { recursive: true })
}
if (!fs.existsSync(paths.workspaceDir)) {
  fs.mkdirSync(paths.workspaceDir, { recursive: true })
}

const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
const logFile = path.join(paths.logsDir, `${taskName}-${timestamp}.log`)
const workspaceRunDir = path.join(paths.workspaceDir, `${taskName}-${timestamp}`)
if (!fs.existsSync(workspaceRunDir)) {
  fs.mkdirSync(workspaceRunDir, { recursive: true })
}

function nowIso(): string {
  return new Date().toISOString()
}

function render(details: unknown): string {
  if (details === undefined) return ''
  return typeof details === 'string' ? details : JSON.stringify(details)
}

function appendFile(level: string, message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${render(details)}`
  fs.appendFileSync(logFile, `${nowIso()} ${level} ${message}${suffix}\n`)
}

function print(level: string, color: string, message: string, details?: unknown): void {
  const suffix = details === undefined ? '' : ` ${render(details)}`
  console.log(`${colors.dim}[${nowIso()}]${colors.reset} ${color}${level}${colors.reset} ${message}${suffix}`)
  appendFile(level, message, details)
}

const log = {
  filePath: logFile,
  workspaceRunDir,
  info: (message: string, details?: unknown): void => print('INFO', colors.blue, message, details),
  success: (message: string, details?: unknown): void => print('SUCCESS', colors.green, message, details),
  warn: (message: string, details?: unknown): void => print('WARN', colors.yellow, message, details),
  error: (message: string, details?: unknown): void => print('ERROR', colors.red, message, details),
  tool: (message: string, details?: unknown): void => print('TOOL', colors.cyan, message, details),
  saveText: (fileName: string, content: string): string => {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const target = path.join(workspaceRunDir, safeName)
    fs.writeFileSync(target, content, 'utf8')
    return target
  },
  saveBytes: (relativePath: string, bytes: Uint8Array): string => {
    const target = path.join(workspaceRunDir, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    return target
  },
}

appendFile('INFO', '=== RADIOMONITORING SESSION START ===')
console.log(`${colors.dim}[${nowIso()}]${colors.reset} ${colors.cyan}LOG${colors.reset} file=${logFile}`)
console.log(`${colors.dim}[${nowIso()}]${colors.reset} ${colors.cyan}WORKSPACE${colors.reset} dir=${workspaceRunDir}`)

export default log
