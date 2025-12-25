import type { JsonRecord } from '@jejunetwork/types'
import { getLogLevelEnv, type LogLevel } from '@jejunetwork/types'

/**
 * Crucible Logger
 *
 * Simple structured logging for Crucible components.
 */

export type { LogLevel }

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

export interface LogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  data?: JsonRecord
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel = getLogLevelEnv()

function shouldLog(level: LogLevel, config?: LoggerConfig): boolean {
  if (config?.silent) return false
  const minLevel = config?.level ?? currentLevel
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
}

function formatLog(
  service: string,
  level: LogLevel,
  message: string,
  data?: JsonRecord,
): string {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${message}${dataStr}`
}

/**
 * Create a logger instance for a specific service/component
 */
export function createLogger(service: string, config?: LoggerConfig): Logger {
  return {
    debug: (message: string, data?: JsonRecord) => {
      if (shouldLog('debug', config)) {
        console.debug(formatLog(service, 'debug', message, data))
      }
    },
    info: (message: string, data?: JsonRecord) => {
      if (shouldLog('info', config)) {
        console.info(formatLog(service, 'info', message, data))
      }
    },
    warn: (message: string, data?: JsonRecord) => {
      if (shouldLog('warn', config)) {
        console.warn(formatLog(service, 'warn', message, data))
      }
    },
    error: (message: string, data?: JsonRecord) => {
      if (shouldLog('error', config)) {
        console.error(formatLog(service, 'error', message, data))
      }
    },
  }
}

// Singleton loggers cache
const loggers = new Map<string, Logger>()

/**
 * Get or create a logger for a service (cached)
 */
export function getLogger(service: string): Logger {
  let logger = loggers.get(service)
  if (!logger) {
    logger = createLogger(service)
    loggers.set(service, logger)
  }
  return logger
}
