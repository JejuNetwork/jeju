/**
 * KMS Logger - Uses shared logger utilities
 */

import { getEnv } from '@jejunetwork/shared'
import pino from 'pino'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Primitive types that can be logged */
type LogPrimitive = string | number | boolean | null | undefined | bigint

/** Value types that can be logged - primitives, arrays, or nested objects */
type LogValue =
  | LogPrimitive
  | LogPrimitive[]
  | string[]
  | number[]
  | Record<string, LogPrimitive>

/** Structured log data - strongly typed instead of Record<string, unknown> */
export type LogData = Record<string, LogValue>

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

interface Logger {
  debug: (message: string, data?: LogData) => void
  info: (message: string, data?: LogData) => void
  warn: (message: string, data?: LogData) => void
  error: (message: string, data?: LogData) => void
}

export function createLogger(service: string): Logger {
  const logger = baseLogger.child({ service })

  return {
    debug: (message: string, data?: LogData) => {
      if (data) {
        logger.debug(data, message)
      } else {
        logger.debug(message)
      }
    },
    info: (message: string, data?: LogData) => {
      if (data) {
        logger.info(data, message)
      } else {
        logger.info(message)
      }
    },
    warn: (message: string, data?: LogData) => {
      if (data) {
        logger.warn(data, message)
      } else {
        logger.warn(message)
      }
    },
    error: (message: string, data?: LogData) => {
      if (data) {
        logger.error(data, message)
      } else {
        logger.error(message)
      }
    },
  }
}

// Pre-configured loggers for KMS components
export const kmsLogger = createLogger('kms')
export const encLogger = createLogger('kms.enc')
export const teeLogger = createLogger('kms.tee')
export const mpcLogger = createLogger('kms.mpc')
