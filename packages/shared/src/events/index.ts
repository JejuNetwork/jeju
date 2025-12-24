/**
 * Universal EventEmitter
 *
 * A browser/worker/node compatible EventEmitter implementation.
 * Use this instead of `node:events` for universal compatibility.
 */

type EventHandler = (...args: unknown[]) => void

/**
 * Universal EventEmitter that works in browsers, workers, and Node.js
 */
export class EventEmitter {
  private events: Map<string | symbol, Set<EventHandler>> = new Map()
  private maxListeners = 10

  /**
   * Register an event listener
   */
  on(event: string | symbol, handler: EventHandler): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    const handlers = this.events.get(event)
    if (handlers && handlers.size >= this.maxListeners) {
      console.warn(
        `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. ` +
          `${handlers.size + 1} ${String(event)} listeners added. ` +
          `Use emitter.setMaxListeners() to increase limit`,
      )
    }
    handlers?.add(handler)
    return this
  }

  /**
   * Register a one-time event listener
   */
  once(event: string | symbol, handler: EventHandler): this {
    const onceWrapper: EventHandler = (...args) => {
      this.off(event, onceWrapper)
      handler(...args)
    }
    return this.on(event, onceWrapper)
  }

  /**
   * Remove an event listener
   */
  off(event: string | symbol, handler: EventHandler): this {
    this.events.get(event)?.delete(handler)
    return this
  }

  /**
   * Emit an event
   */
  emit(event: string | symbol, ...args: unknown[]): boolean {
    const handlers = this.events.get(event)
    if (!handlers?.size) return false
    for (const handler of handlers) {
      handler(...args)
    }
    return true
  }

  /**
   * Add a listener (alias for on)
   */
  addListener(event: string | symbol, handler: EventHandler): this {
    return this.on(event, handler)
  }

  /**
   * Remove a listener (alias for off)
   */
  removeListener(event: string | symbol, handler: EventHandler): this {
    return this.off(event, handler)
  }

  /**
   * Remove all listeners for an event (or all events)
   */
  removeAllListeners(event?: string | symbol): this {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
    return this
  }

  /**
   * Get all listeners for an event
   */
  listeners(event: string | symbol): EventHandler[] {
    return Array.from(this.events.get(event) ?? [])
  }

  /**
   * Get the count of listeners for an event
   */
  listenerCount(event: string | symbol): number {
    return this.events.get(event)?.size ?? 0
  }

  /**
   * Get all event names with listeners
   */
  eventNames(): (string | symbol)[] {
    return Array.from(this.events.keys())
  }

  /**
   * Set the maximum number of listeners per event
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n
    return this
  }

  /**
   * Get the maximum number of listeners per event
   */
  getMaxListeners(): number {
    return this.maxListeners
  }
}

/**
 * Create an EventEmitter
 */
export function createEventEmitter(): EventEmitter {
  return new EventEmitter()
}
