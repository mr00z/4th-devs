import { hubApiKey, requestTimeoutMs, retryCount, taskName, verifyUrl } from '../config.js'
import log from '../logger.js'
import type { FilesystemManifest, VerifyCallResult } from '../types.js'

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function singleCall(answer: unknown): Promise<VerifyCallResult> {
  const payload = {
    apikey: hubApiKey,
    task: taskName,
    answer,
  }

  const startedAt = Date.now()
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

  const raw = await response.text()
  const durationMs = Date.now() - startedAt
  log.info('Verify response', {
    status: response.status,
    durationMs,
    preview: raw.slice(0, 400),
  })

  return {
    ok: response.ok,
    status: response.status,
    raw,
    json: parseJson(raw),
    durationMs,
  }
}

export async function callVerify(answer: unknown): Promise<VerifyCallResult> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      log.info('Verify request', { attempt, answer })
      return await singleCall(answer)
    } catch (error: unknown) {
      lastError = error
      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  }

  throw new Error(`Verify call failed after retries: ${String(lastError)}`)
}

export async function resetVirtualFilesystem(): Promise<VerifyCallResult> {
  return callVerify({ action: 'reset' })
}

export async function finalizeFilesystemTask(): Promise<VerifyCallResult> {
  return callVerify({ action: 'done' })
}

export async function inspectVirtualDirectory(path = '/'): Promise<VerifyCallResult> {
  return callVerify({ action: 'listFiles', path })
}

export function manifestToActions(manifest: FilesystemManifest): unknown[] {
  const actions: unknown[] = []
  for (const directory of manifest.directories) {
    actions.push({ action: 'createDirectory', path: directory })
  }
  for (const file of manifest.files) {
    actions.push({ action: 'createFile', path: file.path, content: file.content })
  }
  return actions
}

export async function applyFilesystemManifest(manifest: FilesystemManifest): Promise<VerifyCallResult> {
  return callVerify(manifestToActions(manifest))
}

export function extractFlag(raw: string): string | null {
  const match = raw.match(/\{FLG:[^}]+\}/)
  return match ? match[0] : null
}
