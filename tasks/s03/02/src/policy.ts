import path from 'node:path'

export interface ValidationResult {
  allowed: boolean
  reason?: string
  normalizedCommand: string
  blockedPaths: string[]
}

const FORBIDDEN_PATHS = ['/etc', '/root', '/proc']
const DANGEROUS_TOKENS = [
  'rm -rf',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'chmod -r',
  'chown -r',
  '>/dev/sd',
]

interface IgnoreScope {
  root: string
  patterns: string[]
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

function normalizePath(input: string): string {
  const normalized = normalizeSlashes(input)
  if (!normalized.startsWith('/')) {
    return `/${normalized}`
  }
  return path.posix.normalize(normalized)
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function tokenizeCommand(command: string): string[] {
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? []
  return tokens.map((token) => stripQuotes(token.trim())).filter((token) => token.length > 0)
}

function looksLikePath(token: string): boolean {
  if (!token) return false
  if (token.startsWith('-')) return false
  if (token.includes('=')) {
    const [, right] = token.split('=', 2)
    if (!right) return false
    return looksLikePath(right)
  }
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.includes('/')
}

function pathContains(base: string, candidate: string): boolean {
  return candidate === base || candidate.startsWith(`${base}/`)
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function isIgnoredRelativePath(relativePath: string, patterns: string[]): boolean {
  let ignored = false
  const rel = normalizeSlashes(relativePath).replace(/^\//, '')

  for (const rawPattern of patterns) {
    const line = rawPattern.trim()
    if (!line || line.startsWith('#')) continue

    const negate = line.startsWith('!')
    const pattern = negate ? line.slice(1) : line
    if (!pattern) continue

    const normalizedPattern = normalizeSlashes(pattern).replace(/^\//, '')
    const regex = globToRegex(normalizedPattern)
    const match = regex.test(rel)

    if (match) {
      ignored = !negate
    }
  }

  return ignored
}

function isBinaryReadAttempt(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const command = tokens[0]?.toLowerCase() ?? ''
  const readCommands = new Set(['cat', 'less', 'more', 'tail', 'head', 'strings'])
  if (!readCommands.has(command)) return false

  return tokens.some((token) => {
    const value = token.includes('=') ? token.split('=', 2)[1] ?? '' : token
    const normalized = normalizePath(value).toLowerCase()
    return normalized.endsWith('.bin')
  })
}

export class CommandPolicy {
  private ignoreScopes: IgnoreScope[] = []

  registerGitignore(directory: string, content: string): void {
    const root = normalizePath(directory)
    const patterns = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)

    const existingIndex = this.ignoreScopes.findIndex((scope) => scope.root === root)
    const scope = { root, patterns }

    if (existingIndex >= 0) {
      this.ignoreScopes[existingIndex] = scope
      return
    }

    this.ignoreScopes.push(scope)
    this.ignoreScopes.sort((a, b) => b.root.length - a.root.length)
  }

  validateCommand(input: string): ValidationResult {
    const normalizedCommand = normalizeWhitespaces(input)
    const lowered = normalizedCommand.toLowerCase()

    for (const token of DANGEROUS_TOKENS) {
      if (lowered.includes(token)) {
        return {
          allowed: false,
          reason: `Command blocked by safety token: ${token}`,
          normalizedCommand,
          blockedPaths: [],
        }
      }
    }

    const tokens = tokenizeCommand(normalizedCommand)
    if (isBinaryReadAttempt(tokens)) {
      return {
        allowed: false,
        reason: 'Reading binary files is blocked. Execute the binary directly instead.',
        normalizedCommand,
        blockedPaths: [],
      }
    }

    const paths = this.extractPaths(tokens)

    for (const foundPath of paths) {
      for (const forbiddenPath of FORBIDDEN_PATHS) {
        if (pathContains(forbiddenPath, foundPath)) {
          return {
            allowed: false,
            reason: `Access to protected path is forbidden: ${forbiddenPath}`,
            normalizedCommand,
            blockedPaths: [foundPath],
          }
        }
      }
    }

    const ignoredHits = paths.filter((p) => this.isPathIgnored(p))
    if (ignoredHits.length > 0) {
      return {
        allowed: false,
        reason: `Command touches .gitignore-protected path(s): ${ignoredHits.join(', ')}`,
        normalizedCommand,
        blockedPaths: ignoredHits,
      }
    }

    return {
      allowed: true,
      normalizedCommand,
      blockedPaths: [],
    }
  }

  private extractPaths(tokens: string[]): string[] {
    const candidates: string[] = []

    for (const token of tokens) {
      if (!looksLikePath(token)) continue

      const value = token.includes('=') ? token.split('=', 2)[1] ?? '' : token
      const normalized = normalizePath(value)
      candidates.push(normalized)
    }

    return [...new Set(candidates)]
  }

  private isPathIgnored(absolutePath: string): boolean {
    for (const scope of this.ignoreScopes) {
      if (!pathContains(scope.root, absolutePath)) {
        continue
      }

      const relative = absolutePath.slice(scope.root.length).replace(/^\//, '')
      if (!relative) {
        continue
      }

      if (isIgnoredRelativePath(relative, scope.patterns)) {
        return true
      }
    }

    return false
  }
}

export function normalizeWhitespaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
