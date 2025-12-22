/**
 * Shared Structured Logger using pino
 *
 * All packages should import from here:
 * import { createLogger, Logger } from '@jejunetwork/shared/logger';
 */

import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isProduction = process.env.NODE_ENV === 'production'
const logLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'

// Base pino logger with appropriate configuration
const baseLogger = pino({
  level: logLevel,
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
})

export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

export interface LoggerConfig {
  level?: LogLevel
  silent?: boolean
}

/**
 * Create a logger instance for a specific service/component
 */
export function createLogger(service: string, config?: LoggerConfig): Logger {
  const logger = baseLogger.child({ service })

  if (config?.level) {
    logger.level = config.level
  }

  if (config?.silent) {
    logger.level = 'silent'
  }

  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      if (data) {
        logger.debug(data, message)
      } else {
        logger.debug(message)
      }
    },
    info: (message: string, data?: Record<string, unknown>) => {
      if (data) {
        logger.info(data, message)
      } else {
        logger.info(message)
      }
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      if (data) {
        logger.warn(data, message)
      } else {
        logger.warn(message)
      }
    },
    error: (message: string, data?: Record<string, unknown>) => {
      if (data) {
        logger.error(data, message)
      } else {
        logger.error(message)
      }
    },
  }
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
export function getLogger(service: string): Logger {
  const existing = loggers.get(service)
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

  const newLogger = createLogger(service)
  loggers.set(service, newLogger)
  return newLogger
}

/**
 * Clear the logger cache (useful for testing)
 */
export function clearLoggerCache(): void {
  loggers.clear()
}

// Default logger for quick usage
export const logger = createLogger('app')
