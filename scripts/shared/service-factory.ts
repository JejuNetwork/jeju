/**
 * @module scripts/shared/service-factory
 * @description Generic singleton factory to eliminate copy-paste pattern
 */

/**
 * Creates a singleton service factory with get/reset methods
 * 
 * @example
 * ```ts
 * const { get: getMyService, reset: resetMyService } = createSingleton(
 *   (config: MyConfig) => new MyService(config),
 *   'MyService'
 * );
 * 
 * // Initialize with config
 * const service = getMyService({ ... });
 * 
 * // Get existing instance (no config needed)
 * const sameService = getMyService();
 * 
 * // Reset for testing
 * resetMyService();
 * ```
 */
export function createSingleton<T, C = unknown>(
  factory: (config: C) => T,
  serviceName: string
): {
  get: (config?: C) => T;
  reset: () => void;
  isInitialized: () => boolean;
} {
  let instance: T | null = null;

  return {
    get: (config?: C): T => {
      if (!instance && config !== undefined) {
        instance = factory(config);
      }
      if (!instance) {
        throw new Error(`${serviceName} not initialized. Call with config first.`);
      }
      return instance;
    },
    reset: (): void => {
      instance = null;
    },
    isInitialized: (): boolean => {
      return instance !== null;
    },
  };
}

/**
 * Creates a lazy singleton that initializes on first access
 * Uses a factory function that takes no arguments
 */
export function createLazySingleton<T>(
  factory: () => T,
  serviceName: string
): {
  get: () => T;
  reset: () => void;
  isInitialized: () => boolean;
} {
  let instance: T | null = null;

  return {
    get: (): T => {
      if (!instance) {
        instance = factory();
      }
      return instance;
    },
    reset: (): void => {
      instance = null;
    },
    isInitialized: (): boolean => {
      return instance !== null;
    },
  };
}

/**
 * Creates a keyed singleton factory for multi-instance scenarios
 * (e.g., one service instance per DAO)
 */
export function createKeyedSingleton<T, C = unknown>(
  factory: (key: string, config: C) => T,
  serviceName: string
): {
  get: (key: string, config?: C) => T;
  reset: (key?: string) => void;
  isInitialized: (key: string) => boolean;
  keys: () => string[];
} {
  const instances = new Map<string, T>();

  return {
    get: (key: string, config?: C): T => {
      if (!instances.has(key) && config !== undefined) {
        instances.set(key, factory(key, config));
      }
      const instance = instances.get(key);
      if (!instance) {
        throw new Error(`${serviceName}[${key}] not initialized. Call with config first.`);
      }
      return instance;
    },
    reset: (key?: string): void => {
      if (key) {
        instances.delete(key);
      } else {
        instances.clear();
      }
    },
    isInitialized: (key: string): boolean => {
      return instances.has(key);
    },
    keys: (): string[] => {
      return Array.from(instances.keys());
    },
  };
}

