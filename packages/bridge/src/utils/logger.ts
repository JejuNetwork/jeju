/**
 * Structured Logger using pino
 * Outputs JSON logs with consistent format for log aggregation
 */

import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Determine if we should use pretty printing (development) or JSON (production)
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

// Create the base logger with appropriate configuration
const baseLogger = pino({
  level: logLevel,
  transport: !isProduction ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
});

export interface Logger {
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
}

export function createLogger(service: string): Logger {
  const logger = baseLogger.child({ service });

  return {
    debug: (message: string, extra?: Record<string, unknown>) => {
      if (extra) {
        logger.debug(extra, message);
      } else {
        logger.debug(message);
      }
    },
    info: (message: string, extra?: Record<string, unknown>) => {
      if (extra) {
        logger.info(extra, message);
      } else {
        logger.info(message);
      }
    },
    warn: (message: string, extra?: Record<string, unknown>) => {
      if (extra) {
        logger.warn(extra, message);
      } else {
        logger.warn(message);
      }
    },
    error: (message: string, extra?: Record<string, unknown>) => {
      if (extra) {
        logger.error(extra, message);
      } else {
        logger.error(message);
      }
    },
  };
}
