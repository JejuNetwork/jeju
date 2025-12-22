/**
 * Singleton Utility
 *
 * Provides a reusable singleton pattern for server instances.
 * Prevents double initialization and handles cleanup.
 */

/**
 * Type for the global object used for singleton storage.
 * Values are stored with type safety through generics.
 */
interface GlobalSingletonStorage {
  [key: string]: unknown
}

/**
 * Helper to get typed global object for singleton storage.
 */
function getGlobalStorage(): GlobalSingletonStorage {
  // Global is a special Node.js object that holds global state
  return global as GlobalSingletonStorage
}

/**
 * Singleton accessor interface
 */
export interface SingletonAccessor<T> {
  getInstance: () => T | null
  setInstance: (instance: T) => void
  clearInstance: () => void
}

/**
 * Port-aware singleton accessor interface
 */
export interface PortSingletonAccessor<T> {
  getInstance: (port?: number) => T | null
  setInstance: (instance: T, port?: number) => void
  clearInstance: () => void
}

/**
 * Creates a singleton getter/setter pattern for a type T
 *
 * @template T - The type of the singleton instance
 * @returns Object with getInstance, setInstance, and clearInstance methods
 *
 * @example
 * ```typescript
 * const dbSingleton = createSingleton<Database>();
 * dbSingleton.setInstance(new Database());
 * const db = dbSingleton.getInstance();
 * ```
 */
export function createSingleton<T>(): SingletonAccessor<T> {
  let instance: T | null = null

  return {
    getInstance: () => instance,
    setInstance: (inst: T) => {
      instance = inst
    },
    clearInstance: () => {
      instance = null
    },
  }
}

/**
 * Creates a global singleton that survives hot module reloads
 * Uses Node.js global object to persist across module reloads
 *
 * @template T - The type of the singleton instance
 * @param globalKey - Unique key for storing the singleton globally
 * @returns Object with getInstance, setInstance, and clearInstance methods
 *
 * @example
 * ```typescript
 * const serverSingleton = createGlobalSingleton<Server>('__myServer__');
 * serverSingleton.setInstance(new Server());
 * const server = serverSingleton.getInstance();
 * ```
 */
export function createGlobalSingleton<T>(
  globalKey: string,
): SingletonAccessor<T> {
  const globalObj = getGlobalStorage()

  return {
    getInstance: () => {
      const value = globalObj[globalKey]
      return (value as T | undefined) ?? null
    },
    setInstance: (instance: T) => {
      globalObj[globalKey] = instance
    },
    clearInstance: () => {
      globalObj[globalKey] = undefined
    },
  }
}

/**
 * Creates a port-aware singleton for WebSocket servers
 * Prevents multiple servers from binding to the same port
 *
 * @template T - The type of the singleton instance
 * @param globalKey - Unique key for storing the singleton globally
 * @param portKey - Key for storing the port number (defaults to globalKey + 'Port')
 * @returns Object with getInstance, setInstance, and clearInstance methods
 *
 * @example
 * ```typescript
 * const wsSingleton = createPortSingleton<WebSocketServer>('__wsServer__');
 * wsSingleton.setInstance(new WebSocketServer(), 8080);
 * const ws = wsSingleton.getInstance(8080);
 * ```
 */
export function createPortSingleton<T>(
  globalKey: string,
  portKey = `${globalKey}Port`,
): PortSingletonAccessor<T> {
  const globalObj = getGlobalStorage()

  return {
    getInstance: (port?: number) => {
      const existing = globalObj[globalKey] as T | undefined
      const existingPort = globalObj[portKey] as number | undefined

      // If port is specified, only return if it matches
      if (port !== undefined && existingPort !== port) {
        return null
      }

      return existing ?? null
    },
    setInstance: (instance: T, port?: number) => {
      globalObj[globalKey] = instance
      if (port !== undefined) {
        globalObj[portKey] = port
      }
    },
    clearInstance: () => {
      globalObj[globalKey] = undefined
      globalObj[portKey] = undefined
    },
  }
}
