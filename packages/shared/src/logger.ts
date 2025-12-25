/**
 * Shared Structured Logger
 *
 * Universal logger that works in Node.js, Bun, and browsers.
 * Uses pino in Node.js/Bun (with optional pino-pretty in dev),
 * falls back to console-based logging in browsers.
 *
 * Usage:
 *   import { createLogger, Logger } from '@jejunetwork/shared';
 */

import type { JsonRecord, LogLevel } from '@jejunetwork/types'
import { getEnv, isBrowser } from './env'

export type { LogLevel }

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/** Lazy-initialized log level */
function getLogLevel(): LogLevel {
  const envLevel = getEnv('LOG_LEVEL') as LogLevel | undefined
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel
  }
  const isProduction = getEnv('NODE_ENV') === 'production'
  return isProduction ? 'info' : 'debug'
}

/** Format log entry for console output */
function formatLogEntry(
  level: LogLevel,
  service: string,
  message: string,
  data?: JsonRecord,
): string {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  return `[${timestamp}] [${service}] [${level.toUpperCase()}] ${message}${dataStr}`
}

/** Console-based logger implementation (browser + fallback) */
function createConsoleLogger(service: string, level: LogLevel): LoggerInstance {
  const shouldLog = (msgLevel: LogLevel): boolean =>
    LOG_LEVELS[msgLevel] >= LOG_LEVELS[level]

  return {
    level,
    debug: (message: string, data?: JsonRecord) => {
      if (shouldLog('debug'))
        console.debug(formatLogEntry('debug', service, message, data))
    },
    info: (message: string, data?: JsonRecord) => {
      if (shouldLog('info'))
        console.info(formatLogEntry('info', service, message, data))
    },
    warn: (message: string, data?: JsonRecord) => {
      if (shouldLog('warn'))
        console.warn(formatLogEntry('warn', service, message, data))
    },
    error: (message: string, data?: JsonRecord) => {
      if (shouldLog('error'))
        console.error(formatLogEntry('error', service, message, data))
    },
  }
}

/** Pino-based logger for Node.js/Bun */
import type pino from 'pino'

type PinoLogger = ReturnType<typeof pino>
let pinoBaseLogger: PinoLogger | null = null

async function getPinoLogger(): Promise<PinoLogger | null> {
  if (isBrowser()) return null

  if (pinoBaseLogger) return pinoBaseLogger

  // Dynamic import to avoid bundling pino in browser builds
  const pinoMod = await import('pino')
  const pinoFn = pinoMod.default

  const isProduction = getEnv('NODE_ENV') === 'production'
  const logLevel = getLogLevel()

  // Try to use pino-pretty in development (may not be available)
  let transport: pino.TransportSingleOptions | undefined
  if (!isProduction) {
    try {
      // pino-pretty is optional - only use if available
      transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    } catch {
      // pino-pretty not available, use default output
    }
  }

  pinoBaseLogger = pinoFn({
    level: logLevel,
    transport,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  })

  return pinoBaseLogger
}

function createPinoLoggerSync(
  service: string,
  baseLogger: PinoLogger,
  config?: LoggerConfig,
): LoggerInstance {
  const childLogger = baseLogger.child({ service })

  if (config?.level) {
    childLogger.level = config.level
  }
  if (config?.silent) {
    childLogger.level = 'silent'
  }

  return {
    level: childLogger.level as LogLevel,
    debug: (message: string, data?: JsonRecord) => {
      if (data) childLogger.debug(data, message)
      else childLogger.debug(message)
    },
    info: (message: string, data?: JsonRecord) => {
      if (data) childLogger.info(data, message)
      else childLogger.info(message)
    },
    warn: (message: string, data?: JsonRecord) => {
      if (data) childLogger.warn(data, message)
      else childLogger.warn(message)
    },
    error: (message: string, data?: JsonRecord) => {
      if (data) childLogger.error(data, message)
      else childLogger.error(message)
    },
  }
}

interface LoggerInstance {
  level: LogLevel | string
  debug: (message: string, data?: JsonRecord) => void
  info: (message: string, data?: JsonRecord) => void
  warn: (message: string, data?: JsonRecord) => void
  error: (message: string, data?: JsonRecord) => void
}

export interface Logger {
  debug: (message: string, data?: JsonRecord) => void
  info: (message: string, data?: JsonRecord) => void
  warn: (message: string, data?: JsonRecord) => void
  error: (message: string, data?: JsonRecord) => void
}

export interface LoggerConfig {
  level?: LogLevel
  silent?: boolean
}

// Cache for sync logger creation - initialized lazily
let syncPinoLogger: PinoLogger | null = null
let syncLoggerInitialized = false

/** Pino module shape for require() */
interface PinoModule {
  default: typeof pino
}

function initSyncPinoLogger(): void {
  if (syncLoggerInitialized || isBrowser()) return
  syncLoggerInitialized = true

  // Synchronous pino initialization for Node.js/Bun
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pinoMod = require('pino') as PinoModule
  const pinoFn = pinoMod.default
  const logLevel = getLogLevel()

  // In sync mode, skip pino-pretty (requires async transport)
  syncPinoLogger = pinoFn({
    level: logLevel,
    // Skip transport in sync mode - use JSON output
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  })
}

/**
 * Create a logger instance for a specific service/component
 *
 * Works synchronously in both browser and Node.js/Bun.
 * In Node.js/Bun: Uses pino with JSON output (no pino-pretty in sync mode)
 * In browser: Uses console with formatted output
 */
export function createLogger(service: string, config?: LoggerConfig): Logger {
  const level = config?.silent ? 'error' : (config?.level ?? getLogLevel())

  // Browser: use console-based logger
  if (isBrowser()) {
    return createConsoleLogger(service, level)
  }

  // Node.js/Bun: try to use pino
  initSyncPinoLogger()

  if (syncPinoLogger) {
    return createPinoLoggerSync(service, syncPinoLogger, config)
  }

  // Fallback to console logger if pino isn't available
  return createConsoleLogger(service, level)
}

/**
 * Create a logger instance asynchronously (enables pino-pretty in dev)
 *
 * Use this when you can await initialization (e.g., server startup).
 * Falls back to sync createLogger if already initialized.
 */
export async function createLoggerAsync(
  service: string,
  config?: LoggerConfig,
): Promise<Logger> {
  const level = config?.silent ? 'error' : (config?.level ?? getLogLevel())

  // Browser: use console-based logger
  if (isBrowser()) {
    return createConsoleLogger(service, level)
  }

  // Node.js/Bun: try to use pino with pretty printing
  const pinoLogger = await getPinoLogger()

  if (pinoLogger) {
    return createPinoLoggerSync(service, pinoLogger, config)
  }

  // Fallback to console logger
  return createConsoleLogger(service, level)
}

// Singleton loggers cache with max size to prevent memory leaks
const MAX_LOGGERS_CACHE_SIZE = 1000
const loggers = new Map<string, Logger>()

/**
 * Get or create a logger for a service (cached)
 *
 * Note: The cache is bounded to prevent memory leaks from dynamic service names.
 * If the cache is full, the oldest loggers are evicted.
 */
export function getLogger(service: string, config?: LoggerConfig): Logger {
  const cacheKey = config ? `${service}:${JSON.stringify(config)}` : service
  const existing = loggers.get(cacheKey)
  if (existing) {
    return existing
  }

  // Evict oldest loggers if cache is full
  if (loggers.size >= MAX_LOGGERS_CACHE_SIZE) {
    // Delete the first (oldest) entry
    const firstKey = loggers.keys().next().value
    if (firstKey) {
      loggers.delete(firstKey)
    }
  }

  const newLogger = createLogger(service, config)
  loggers.set(cacheKey, newLogger)
  return newLogger
}

/**
 * Clear the logger cache (useful for testing)
 */
export function clearLoggerCache(): void {
  loggers.clear()
  syncLoggerInitialized = false
  syncPinoLogger = null
  pinoBaseLogger = null
}

// Lazy-initialized default logger
let defaultLogger: Logger | null = null

/**
 * Get the default app logger (lazy-initialized)
 */
export function getDefaultLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = createLogger('app')
  }
  return defaultLogger
}

// For backwards compatibility, export a logger getter
// Note: This creates the logger on first access, not at module load
export const logger: Logger = {
  get debug() {
    return getDefaultLogger().debug
  },
  get info() {
    return getDefaultLogger().info
  },
  get warn() {
    return getDefaultLogger().warn
  },
  get error() {
    return getDefaultLogger().error
  },
}
