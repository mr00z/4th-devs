import { hubApiKey, shellApiUrl, verifyUrl } from './config.js'
import log from './logger.js'
import { extractConfirmationCode, firstLine, normalizeWhitespaces } from './parsers.js'
import { CommandPolicy } from './policy.js'

interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>) => Promise<string>
}

interface ShellResponse {
  raw: string
  firstLine: string
  confirmationCode: string | null
}

const policy = new CommandPolicy()
const seenCommands = new Map<string, number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractBanDelaySeconds(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as {
      ban?: { seconds_left?: number; ttl_seconds?: number }
    }
    const secondsLeft = parsed?.ban?.seconds_left
    if (typeof secondsLeft === 'number' && Number.isFinite(secondsLeft) && secondsLeft > 0) {
      return Math.ceil(secondsLeft)
    }

    const ttlSeconds = parsed?.ban?.ttl_seconds
    if (typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      return Math.ceil(ttlSeconds)
    }
  } catch {
    return null
  }

  return null
}

async function callShell(cmd: string): Promise<ShellResponse> {
  const body = {
    apikey: hubApiKey,
    cmd,
  }

  log.api('POST /api/shell', body)

  const response = await fetch(shellApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const raw = await response.text()
  if (!response.ok) {
    if (response.status === 403) {
      const delaySeconds = extractBanDelaySeconds(raw)
      if (delaySeconds) {
        log.warn(`Shell API ban detected. Pausing agent for ${delaySeconds}s before continuing.`)
        await sleep(delaySeconds * 1000)
      }
    }
    throw new Error(`Shell API error ${response.status} ${response.statusText}: ${raw}`)
  }

  const detected = extractConfirmationCode(raw)

  if (cmd.startsWith('cat ') && cmd.includes('.gitignore')) {
    const target = cmd.slice(4).trim()
    const directory = target.replace(/\/\.gitignore$/, '')
    policy.registerGitignore(directory, raw)
    log.info(`Registered .gitignore policy for ${directory}`)
  }

  return {
    raw,
    firstLine: firstLine(raw),
    confirmationCode: detected,
  }
}

function trackCommand(cmd: string): void {
  const count = seenCommands.get(cmd) ?? 0
  seenCommands.set(cmd, count + 1)
}

function shouldBlockForLoop(cmd: string): string | null {
  const count = seenCommands.get(cmd) ?? 0
  if (count >= 3) {
    return `Command repeated too many times (${count + 1}): ${cmd}`
  }
  return null
}

async function callVerify(confirmation: string): Promise<string> {
  const body = {
    apikey: hubApiKey,
    task: 'firmware',
    answer: {
      confirmation,
    },
  }

  log.api('POST /verify', body)

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    return `Error: verify failed ${response.status} ${response.statusText} ${text}`
  }

  return text
}

function normalizeCommandArg(args: Record<string, unknown>): string {
  const raw = typeof args.cmd === 'string' ? args.cmd : ''
  return normalizeWhitespaces(raw)
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'shell_help',
      description: 'Run help command on the remote Linux environment. Use this first.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async (): Promise<string> => {
      const cmd = 'help'
      trackCommand(cmd)
      const result = await callShell(cmd)
      return result.raw
    },
  },
  {
    definition: {
      type: 'function',
      name: 'run_shell_command',
      description: 'Run a shell command on remote VM with strict safety policy.',
      parameters: {
        type: 'object',
        properties: {
          cmd: {
            type: 'string',
            description: 'Linux command to execute remotely.',
          },
        },
        required: ['cmd'],
      },
    },
    handler: async (args): Promise<string> => {
      const cmd = normalizeCommandArg(args)
      if (!cmd) {
        return 'Error: Missing cmd'
      }

      const loopBlock = shouldBlockForLoop(cmd)
      if (loopBlock) {
        return `Blocked: ${loopBlock}`
      }

      const validation = policy.validateCommand(cmd)
      if (!validation.allowed) {
        return `Blocked: ${validation.reason}`
      }

      trackCommand(validation.normalizedCommand)
      const result = await callShell(validation.normalizedCommand)
      if (result.confirmationCode) {
        return `${result.raw}\n\n[confirmation_detected] ${result.confirmationCode}`
      }
      return result.raw
    },
  },
  {
    definition: {
      type: 'function',
      name: 'reboot_remote',
      description: 'Reboot remote VM only when environment is unusable.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      },
    },
    handler: async (args): Promise<string> => {
      const reason = typeof args.reason === 'string' ? args.reason : 'no reason provided'
      log.warn(`Remote reboot requested: ${reason}`)
      trackCommand('reboot')
      const result = await callShell('reboot')
      return result.raw
    },
  },
  {
    definition: {
      type: 'function',
      name: 'validate_command',
      description: 'Local dry-run safety validator. Does not execute anything remotely.',
      parameters: {
        type: 'object',
        properties: {
          cmd: {
            type: 'string',
            description: 'Command proposal for local safety validation.',
          },
        },
        required: ['cmd'],
      },
    },
    handler: async (args): Promise<string> => {
      const cmd = normalizeCommandArg(args)
      if (!cmd) {
        return 'Error: Missing cmd'
      }

      const validation = policy.validateCommand(cmd)
      if (!validation.allowed) {
        return `INVALID: ${validation.reason}`
      }

      return `VALID: ${validation.normalizedCommand}`
    },
  },
  {
    definition: {
      type: 'function',
      name: 'submit_confirmation',
      description: 'Submit discovered ECCS confirmation code to verify endpoint.',
      parameters: {
        type: 'object',
        properties: {
          confirmation: {
            type: 'string',
            description: 'Code in format ECCS-xxxxxxxx...',
          },
        },
        required: ['confirmation'],
      },
    },
    handler: async (args): Promise<string> => {
      const confirmation = typeof args.confirmation === 'string' ? args.confirmation.trim() : ''
      if (!confirmation) {
        return 'Error: Missing confirmation'
      }
      if (!confirmation.startsWith('ECCS-')) {
        return 'Error: confirmation must start with ECCS-'
      }

      return callVerify(confirmation)
    },
  },
]

export function findTool(name: string): Tool | undefined {
  return tools.find((tool) => tool.definition.name === name)
}

export { tools }
