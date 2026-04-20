const blockedPatterns = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkfs\b/i,
  /\bkill(?:all)?\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bapt(?:-get)?\b/i,
  /\byum\b/i,
  /\bdnf\b/i,
  /\bpip\b/i,
  /\bnpm\b/i,
  /\bbun\b/i,
  /\bpython\b.*\b(open|write|unlink|remove|rmtree)\b/i,
]

const allowedFirstCommands = new Set([
  'awk',
  'cat',
  'cut',
  'date',
  'echo',
  'file',
  'find',
  'grep',
  'head',
  'jq',
  'ls',
  'printf',
  'pwd',
  'sed',
  'sort',
  'tail',
  'tr',
  'uniq',
  'wc',
])

export function validateShellCommand(cmd: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = cmd.trim()
  if (!trimmed) return { ok: false, reason: 'Command is empty.' }
  if (trimmed.length > 4000) return { ok: false, reason: 'Command is too long.' }
  if (/[;&]\s*(rm|rmdir|mv|chmod|chown|mkfs|kill|shutdown|reboot)\b/i.test(trimmed)) {
    return { ok: false, reason: 'Command contains a destructive sequence.' }
  }
  if (/(^|[^<])>{1,2}(?!&)/.test(trimmed)) {
    return { ok: false, reason: 'Output redirection is not allowed on the remote server.' }
  }
  for (const pattern of blockedPatterns) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `Command matches blocked pattern: ${pattern.source}` }
    }
  }

  const first = trimmed.match(/^\s*(?:env\s+)?([a-zA-Z0-9_.-]+)/)?.[1]
  if (!first || !allowedFirstCommands.has(first)) {
    return { ok: false, reason: `Command must start with an allowed read/exploration command, got: ${first || '[unknown]'}` }
  }

  return { ok: true }
}
