/**
 * App-Specific Config Injection
 *
 * Provides a workerd-compatible config injection pattern for app-specific configuration.
 * Supports both public static config (from JSON) and private dynamic config (from env).
 *
 * Usage:
 * ```typescript
 * import { createAppConfig } from '@jejunetwork/config';
 *
 * interface MyAppConfig {
 *   apiUrl: string
 *   privateKey?: string
 * }
 *
 * const { config, configure } = createAppConfig<MyAppConfig>({
 *   apiUrl: 'http://localhost:3000',
 *   // Defaults
 * });
 *
 * // At startup, inject from env or other sources
 * configure({
 *   apiUrl: process.env.MY_APP_API_URL ?? config.apiUrl,
 *   privateKey: process.env.MY_APP_PRIVATE_KEY,
 * });
 * ```
 */

/**
 * Create a config injection system for an app
 */
export function createAppConfig<T extends object>(
  defaults: T,
): {
  config: T
  configure: (updates: Partial<T>) => void
  getConfig: () => T
} {
  let currentConfig: T = { ...defaults }

  function configure(updates: Partial<T>): void {
    currentConfig = { ...currentConfig, ...updates }
  }

  function getConfig(): T {
    return { ...currentConfig }
  }

  return {
    config: currentConfig,
    configure,
    getConfig,
  }
}

/**
 * Helper to safely read process.env with fallback
 * Workerd-compatible: Checks if process exists before accessing
 */
export function getEnvVar(
  key: string,
  defaultValue?: string,
): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return defaultValue
  }
  return process.env[key] ?? defaultValue
}

/**
 * Helper to safely read process.env as boolean
 */
export function getEnvBool(key: string, defaultValue = false): boolean {
  const value = getEnvVar(key)
  if (value === undefined) return defaultValue
  return value === 'true' || value === '1'
}

/**
 * Helper to safely read process.env as number
 */
export function getEnvNumber(
  key: string,
  defaultValue?: number,
): number | undefined {
  const value = getEnvVar(key)
  if (value === undefined) return defaultValue
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) return defaultValue
  return parsed
}

/**
 * Helper to safely check NODE_ENV
 */
export function getNodeEnv(): string | undefined {
  return getEnvVar('NODE_ENV')
}

/**
 * Helper to check if production
 */
export function isProductionEnv(): boolean {
  return getNodeEnv() === 'production'
}

/**
 * Helper to check if development
 */
export function isDevelopmentEnv(): boolean {
  return getNodeEnv() === 'development'
}

/**
 * Helper to check if test
 */
export function isTestEnv(): boolean {
  return getNodeEnv() === 'test'
}
