import { enqueueUnlockCodeGenerator } from '../api/client.js'
import log from '../logger.js'
import type { ConfigPoint, QueueItemBase } from '../types.js'
import type { ResultQueue } from './resultQueue.js'

function parseUnlockCode(item: QueueItemBase): string | null {
  const candidates = [item.unlockCode, item.codeValue, item.signature, item.hash]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  if (typeof item.message === 'string') {
    const match = item.message.match(/[a-f0-9]{32}/i)
    if (match) {
      return match[0]
    }
  }

  return null
}

function sameFloat(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001
}

function matchToPoint(item: QueueItemBase, points: ConfigPoint[]): ConfigPoint | null {
  const date = typeof item.startDate === 'string' ? item.startDate : typeof item.date === 'string' ? item.date : null
  const hour = typeof item.startHour === 'string' ? item.startHour : typeof item.hour === 'string' ? item.hour : null
  const windMs = typeof item.windMs === 'number' ? item.windMs : typeof item.wind === 'number' ? item.wind : null
  const pitchAngle = typeof item.pitchAngle === 'number' ? item.pitchAngle : typeof item.pitch === 'number' ? item.pitch : null

  const byFullMatch = points.find((point) => {
    if (point.unlockCode) {
      return false
    }
    const dateOk = date === null || point.date === date
    const hourOk = hour === null || point.hour === hour
    const windOk = windMs === null || sameFloat(point.windMs, windMs)
    const pitchOk = pitchAngle === null || sameFloat(point.pitchAngle, pitchAngle)
    return dateOk && hourOk && windOk && pitchOk
  })

  if (byFullMatch) {
    return byFullMatch
  }

  return points.find((point) => !point.unlockCode) ?? null
}

export async function signAllConfigPoints(params: {
  queue: ResultQueue
  points: ConfigPoint[]
  timeoutMs: number
}): Promise<ConfigPoint[]> {
  const { queue, points, timeoutMs } = params

  for (const point of points) {
    await enqueueUnlockCodeGenerator({
      startDate: point.date,
      startHour: point.hour,
      windMs: point.windMs,
      pitchAngle: point.pitchAngle,
    })
  }

  let resolved = 0
  while (resolved < points.length) {
    const unlockItem = await queue.waitFor(
      (item) => item.sourceFunction === 'unlockCodeGenerator' || (typeof item.unlockCode === 'string' && item.unlockCode.length > 0),
      timeoutMs,
      'unlockCodeGenerator result',
    )

    const code = parseUnlockCode(unlockItem)
    if (!code) {
      throw new Error(`Unlock code response missing code: ${JSON.stringify(unlockItem)}`)
    }

    const targetPoint = matchToPoint(unlockItem, points)
    if (!targetPoint) {
      throw new Error(`No matching config point for unlock response: ${JSON.stringify(unlockItem)}`)
    }

    if (!targetPoint.unlockCode) {
      targetPoint.unlockCode = code
      resolved += 1
      log.info('Unlock code assigned', { timestamp: targetPoint.timestamp, resolved, total: points.length })
    }
  }

  return points
}
