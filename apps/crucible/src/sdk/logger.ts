/**
 * Structured Logger using pino - Provides consistent logging across all SDKs.
 */

import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  component: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface LoggerConfig {
  level?: LogLevel;
  json?: boolean;
  silent?: boolean;
}

// Determine environment settings
const isProduction = process.env.NODE_ENV === 'production';
const defaultLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const useJson = process.env.LOG_FORMAT === 'json' || isProduction;

// Create the base pino logger
const baseLogger = pino({
  level: defaultLevel,
  transport: !useJson ? {
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

class PinoLogger implements Logger {
  private logger: pino.Logger;
  private silent: boolean;

  constructor(component: string, config: LoggerConfig = {}) {
    this.silent = config.silent ?? false;
    const level = config.level ?? defaultLevel;
    this.logger = baseLogger.child({ component });
    if (config.level) {
      this.logger.level = level;
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    data ? this.logger.debug(data, message) : this.logger.debug(message);
  }

  info(message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    data ? this.logger.info(data, message) : this.logger.info(message);
  }

  warn(message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    data ? this.logger.warn(data, message) : this.logger.warn(message);
  }

  error(message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    data ? this.logger.error(data, message) : this.logger.error(message);
  }
}

export function createLogger(component: string, config?: LoggerConfig): Logger {
  return new PinoLogger(component, config);
}

// Singleton loggers for each component
const loggers = new Map<string, Logger>();

export function getLogger(component: string): Logger {
  if (!loggers.has(component)) {
    loggers.set(component, createLogger(component));
  }
  return loggers.get(component)!;
}
