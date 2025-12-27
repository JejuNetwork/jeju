/**
 * Workerd-compatible EventEmitter
 *
 * Uses EventTarget API instead of Node.js EventEmitter for workerd/V8 isolate compatibility
 */

type EventCallback = (data?: unknown) => void
type EventHandler = (e: Event) => void

interface ListenerInfo {
  callback: EventCallback
  handler: EventHandler
}

export class WorkerdEventEmitter {
  private target = new EventTarget()
  private listeners = new Map<string, ListenerInfo[]>()

  emit(event: string, data?: unknown): boolean {
    this.target.dispatchEvent(new CustomEvent(event, { detail: data }))
    return (this.listeners.get(event)?.length ?? 0) > 0
  }

  on(event: string, callback: EventCallback): this {
    const handler: EventHandler = (e: Event) =>
      callback((e as CustomEvent).detail)

    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)?.push({ callback, handler })
    this.target.addEventListener(event, handler)
    return this
  }

  once(event: string, callback: EventCallback): this {
    const handler: EventHandler = (e: Event) => {
      callback((e as CustomEvent).detail)
      this.removeListener(event, callback)
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)?.push({ callback, handler })
    this.target.addEventListener(event, handler)
    return this
  }

  removeListener(event: string, callback: EventCallback): this {
    const eventListeners = this.listeners.get(event)
    if (!eventListeners) return this

    const index = eventListeners.findIndex((l) => l.callback === callback)
    if (index !== -1) {
      const listener = eventListeners[index]
      if (listener) {
        this.target.removeEventListener(event, listener.handler)
        eventListeners.splice(index, 1)
      }
    }
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      const eventListeners = this.listeners.get(event)
      if (eventListeners) {
        for (const listener of eventListeners) {
          this.target.removeEventListener(event, listener.handler)
        }
        this.listeners.delete(event)
      }
    } else {
      for (const [eventName, listeners] of this.listeners) {
        for (const listener of listeners) {
          this.target.removeEventListener(eventName, listener.handler)
        }
      }
      this.listeners.clear()
    }
    return this
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0
  }
}
