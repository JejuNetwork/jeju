/**
 * Browser-safe environment utilities
 *
 * Provides cross-environment access to configuration,
 * working in Node.js, Bun, browsers, and workers.
 *
 * Usage:
 *   import { getEnv, isBrowser, isServer } from '@jejunetwork/shared';
 *
 * Browser config injection:
 *   // In your HTML or app initialization:
 *   globalThis.ENV = { LOG_LEVEL: 'debug', JEJU_NETWORK: 'testnet' };
 */

/**
 * Check if running in a browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * Check if running in a server environment (Node.js/Bun)
 */
export function isServer(): boolean {
  return typeof process !== 'undefined' && !!process.env
}

/** Worker global scope with importScripts function */
interface WorkerGlobalScope {
  importScripts?: (...urls: string[]) => void
}

/**
 * Check if running in a worker environment (Web Worker, Service Worker)
 */
export function isWorker(): boolean {
  return (
    typeof self !== 'undefined' &&
    typeof window === 'undefined' &&
    // Check for importScripts which exists in Web Workers
    typeof (self as WorkerGlobalScope).importScripts === 'function'
  )
}

/** Global scope with ENV config injection */
interface GlobalWithEnv {
  ENV?: Record<string, string>
}

/**
 * Get an environment variable safely
 *
 * Checks in order:
 * 1. process.env (Node.js/Bun)
 * 2. globalThis.ENV (browser/worker injected config)
 *
 * @param key The environment variable name
 * @returns The value or undefined if not set
 */
export function getEnv(key: string): string | undefined {
  // Node.js/Bun: check process.env
  if (typeof process !== 'undefined' && process.env) {
    const value = process.env[key]
    if (value !== undefined) return value
  }

  // Browser/Worker: check globalThis.ENV for injected config
  const g = globalThis as GlobalWithEnv
  return g.ENV?.[key]
}

/**
 * Get an environment variable with a default fallback
 *
 * @param key The environment variable name
 * @param defaultValue The default value if not set
 * @returns The value or the default
 */
export function getEnvOrDefault(key: string, defaultValue: string): string {
  return getEnv(key) ?? defaultValue
}

/**
 * Get an environment variable, throwing if not set
 *
 * @param key The environment variable name
 * @returns The value
 * @throws Error if the variable is not set
 */
export function requireEnv(key: string): string {
  const value = getEnv(key)
  if (value === undefined) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}

/**
 * Get an environment variable as a number
 *
 * @param key The environment variable name
 * @param defaultValue The default value if not set or invalid
 * @returns The parsed number or default
 */
export function getEnvNumber(key: string, defaultValue: number): number {
  const value = getEnv(key)
  if (value === undefined) return defaultValue
  const parsed = Number(value)
  return Number.isNaN(parsed) ? defaultValue : parsed
}

/**
 * Get an environment variable as a boolean
 *
 * Truthy values: 'true', '1', 'yes', 'on'
 * Falsy values: 'false', '0', 'no', 'off'
 *
 * @param key The environment variable name
 * @param defaultValue The default value if not set
 * @returns The parsed boolean or default
 */
export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = getEnv(key)?.toLowerCase()
  if (value === undefined) return defaultValue
  if (['true', '1', 'yes', 'on'].includes(value)) return true
  if (['false', '0', 'no', 'off'].includes(value)) return false
  return defaultValue
}

/**
 * Set a runtime environment variable (for browser/worker config)
 *
 * This only affects the globalThis.ENV object, not process.env
 *
 * @param key The environment variable name
 * @param value The value to set
 */
export function setEnv(key: string, value: string): void {
  const g = globalThis as GlobalWithEnv
  if (!g.ENV) {
    g.ENV = {}
  }
  g.ENV[key] = value
}

/**
 * Initialize environment from a config object
 *
 * Useful for browser apps to inject config at startup
 *
 * @param config Object with environment variable key-value pairs
 */
export function initEnv(config: Record<string, string>): void {
  const g = globalThis as GlobalWithEnv
  g.ENV = { ...g.ENV, ...config }
}
