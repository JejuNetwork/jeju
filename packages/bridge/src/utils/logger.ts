/**
 * Bridge Logger - Uses shared env utilities
 */

import { getEnv } from '@jejunetwork/shared'
import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isProduction = getEnv('NODE_ENV') === 'production'
const logLevel = (getEnv('LOG_LEVEL')?.toLowerCase() as LogLevel) ?? 'info'

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
    level: (label: string) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
})

import type { JsonRecord } from '@jejunetwork/sdk'

export interface Logger {
  debug: (message: string, data?: JsonRecord) => void
  info: (message: string, data?: JsonRecord) => void
  warn: (message: string, data?: JsonRecord) => void
  error: (message: string, data?: JsonRecord) => void
}

export function createLogger(service: string): Logger {
  const logger = baseLogger.child({ service })

  return {
    debug: (message: string, data?: JsonRecord) => {
      if (data) {
        logger.debug(data, message)
      } else {
        logger.debug(message)
      }
    },
    info: (message: string, data?: JsonRecord) => {
      if (data) {
        logger.info(data, message)
      } else {
        logger.info(message)
      }
    },
    warn: (message: string, data?: JsonRecord) => {
      if (data) {
        logger.warn(data, message)
      } else {
        logger.warn(message)
      }
    },
    error: (message: string, data?: JsonRecord) => {
      if (data) {
        logger.error(data, message)
      } else {
        logger.error(message)
      }
    },
  }
}
