/**
 * Bridge Logger - Standalone pino logger
 */

import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isProduction = process.env.NODE_ENV === 'production'
const logLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) ?? 'info'

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

export function createLogger(service: string): Logger {
  const logger = baseLogger.child({ service })

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
