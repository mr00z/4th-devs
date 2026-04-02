import { pollIntervalMs } from '../config.js'
import log from '../logger.js'
import { pollGetResult } from '../api/client.js'
import type { QueueItemBase } from '../types.js'

type QueueResolver = {
  predicate: (item: QueueItemBase) => boolean
  resolve: (item: QueueItemBase) => void
  reject: (error: Error) => void
  expiresAtMs: number
  label: string
}

export class ResultQueue {
  private running = false

  private resolvers: QueueResolver[] = []

  private bufferedItems: QueueItemBase[] = []

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  waitFor(predicate: (item: QueueItemBase) => boolean, timeoutMs: number, label: string): Promise<QueueItemBase> {
    return new Promise<QueueItemBase>((resolve, reject) => {
      for (let index = 0; index < this.bufferedItems.length; index += 1) {
        const item = this.bufferedItems[index]
        if (predicate(item)) {
          this.bufferedItems.splice(index, 1)
          resolve(item)
          return
        }
      }

      this.resolvers.push({
        predicate,
        resolve,
        reject,
        expiresAtMs: Date.now() + timeoutMs,
        label,
      })
    })
  }

  private expireResolvers(now: number): void {
    const keep: QueueResolver[] = []
    for (const resolver of this.resolvers) {
      if (now > resolver.expiresAtMs) {
        resolver.reject(new Error(`Timed out waiting for queue item: ${resolver.label}`))
      } else {
        keep.push(resolver)
      }
    }
    this.resolvers = keep
  }

  private dispatch(item: QueueItemBase): boolean {
    for (let index = 0; index < this.resolvers.length; index += 1) {
      const resolver = this.resolvers[index]
      if (resolver.predicate(item)) {
        this.resolvers.splice(index, 1)
        resolver.resolve(item)
        return true
      }
    }

    return false
  }

  private buffer(item: QueueItemBase): void {
    this.bufferedItems.push(item)
    if (this.bufferedItems.length > 64) {
      this.bufferedItems.shift()
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const startedAt = Date.now()
      this.expireResolvers(startedAt)

      try {
        const response = await pollGetResult()
        const item = (response.json ?? {}) as QueueItemBase

        if (typeof item.code === 'number' && item.code === 11) {
          // Queue empty, do nothing.
        } else {
          const dispatched = this.dispatch(item)
          if (!dispatched) {
            this.buffer(item)
            log.warn('Queue item buffered without waiting consumer', {
              sourceFunction: item.sourceFunction,
              code: item.code,
              message: item.message,
            })
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('Queue polling error', { message: msg })
      }

      const elapsed = Date.now() - startedAt
      const sleepMs = Math.max(25, pollIntervalMs - elapsed)
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
}
