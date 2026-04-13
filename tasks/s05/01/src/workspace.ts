import crypto from 'node:crypto'
import path from 'node:path'
import log from './logger.js'
import type { SavedAttachment } from './types.js'

const mimeToExtension: Record<string, string> = {
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/csv': '.csv',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'text/plain': '.txt',
}

export function mimeToExt(mimeType: string): string {
  return mimeToExtension[mimeType.toLowerCase()] || '.bin'
}

export function hashBytes(bytes: Uint8Array): string {
  return crypto.createHash('sha1').update(bytes).digest('hex')
}

export function saveAttachment(index: number, mimeType: string, bytes: Uint8Array): SavedAttachment {
  const hash = hashBytes(bytes)
  const extension = mimeToExt(mimeType)
  const relativePath = path.join('captures', `${String(index).padStart(3, '0')}-${hash.slice(0, 12)}${extension}`)
  const savedPath = log.saveBytes(relativePath, bytes)
  return {
    path: savedPath,
    relativePath,
    hash,
    mimeType,
    size: bytes.byteLength,
    extension,
  }
}
