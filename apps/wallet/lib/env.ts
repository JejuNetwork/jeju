/**
 * Environment Variable Access
 *
 * Provides a unified way to access environment variables that works in both
 * Vite (import.meta.env) and Bun (process.env) environments.
 */

type EnvVars = Record<string, string | undefined>

/**
 * Get environment variables object for the current runtime
 */
function getEnvObject(): EnvVars {
  // Browser with Vite
  if (
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env !== 'undefined'
  ) {
    return import.meta.env as EnvVars
  }

  // Node/Bun server-side
  if (typeof process !== 'undefined' && process.env) {
    return process.env as EnvVars
  }

  // Fallback: empty object
  return {}
}

const envCache = getEnvObject()

/**
 * Get an environment variable value
 * @param key - The environment variable name
 * @returns The value or undefined
 */
export function getEnv(key: string): string | undefined {
  return envCache[key]
}

/**
 * Get an environment variable with a default fallback
 * @param key - The environment variable name
 * @param defaultValue - Default value if not set
 * @returns The value or the default
 */
export function getEnvOrDefault(key: string, defaultValue: string): string {
  return envCache[key] || defaultValue
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  return (
    getEnv('NODE_ENV') === 'development' ||
    (typeof window !== 'undefined' && window.location?.hostname === 'localhost')
  )
}

/**
 * Check if running in production mode
 */
export function isProd(): boolean {
  return getEnv('NODE_ENV') === 'production'
}

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined'
}
