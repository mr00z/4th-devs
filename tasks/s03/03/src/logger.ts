import fs from 'node:fs'
import path from 'node:path'

const timestamp = (): string => new Date().toLocaleTimeString('en-US', { hour12: false })
const fullTimestamp = (): string => new Date().toISOString()

const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

const logFilePath = path.join(logsDir, `reactor-agent-${new Date().toISOString().split('T')[0]}.log`)

function writeToFile(message: string): void {
  try {
    fs.appendFileSync(logFilePath, `${fullTimestamp()} ${message}\n`)
  } catch (err) {
    console.error('Failed to write log file:', err)
  }
}

function print(prefix: string, message: string): void {
  console.log(`[${timestamp()}] ${prefix} ${message}`)
  writeToFile(`${prefix} ${message}`)
}

console.log(`📝 Logs file: ${logFilePath}`)
writeToFile('=== LOG SESSION STARTED ===')

const log = {
  filePath: logFilePath,
  info: (message: string): void => print('INFO', message),
  warn: (message: string): void => print('WARN', message),
  error: (message: string): void => print('ERROR', message),
  toolCall: (name: string, args: Record<string, unknown>): void => {
    const asJson = JSON.stringify(args)
    const preview = asJson.length > 400 ? `${asJson.slice(0, 400)}...` : asJson
    print('TOOL', `${name} args=${preview}`)
  },
  toolResult: (name: string, result: string): void => {
    const preview = result.length > 500 ? `${result.slice(0, 500)}...` : result
    print('TOOL_RESULT', `${name} => ${preview}`)
  },
  api: (name: string, body: Record<string, unknown>, rawResponse?: string): void => {
    print('API', `${name} ${JSON.stringify(body)}`)
    if (typeof rawResponse === 'string') {
      const preview = rawResponse.length > 1200 ? `${rawResponse.slice(0, 1200)}...` : rawResponse
      print('API_RESPONSE', preview)
    }
  },
}

export default log
