/**
 * Logger Utility
 *
 * Production-ready logging with configurable levels and environment awareness.
 * Works in both browser and Node.js/Bun environments.
 */

import { getEnv } from '@jejunetwork/shared'
import type { JsonValue, LogLevel } from '@jejunetwork/types'

/**
 * Log data payload - structured data for logging
 */
export type LogData = Record<string, JsonValue> | Error | JsonValue

export type { LogLevel }

/**
 * Log entry structure
 */
interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: LogData
  context?: string
}

/**
 * Logger Class
 *
 * Provides structured logging with configurable levels, context support,
 * and safe serialization of complex objects.
 */
export class Logger {
  private level: LogLevel
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(level?: LogLevel) {
    if (level && this.levelPriority[level] !== undefined) {
      this.level = level
    } else {
      const envLevel = getEnv('LOG_LEVEL') as LogLevel | undefined
      if (envLevel && this.levelPriority[envLevel] !== undefined) {
        this.level = envLevel
      } else {
        this.level = getEnv('NODE_ENV') === 'production' ? 'info' : 'debug'
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level]
  }

  private formatLog(entry: LogEntry): string {
    const contextStr = entry.context ? `[${entry.context}]` : ''
    let dataStr = ''
    if (entry.data) {
      const seen = new Set<JsonValue>()
      const replacer = (_key: string, value: JsonValue): JsonValue => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack ?? null,
          } satisfies Record<string, JsonValue>
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]'
          }
          seen.add(value)
        }
        return value
      }
      dataStr = ` ${JSON.stringify(entry.data, replacer)}`
    }
    return `[${entry.timestamp}] ${contextStr} [${entry.level.toUpperCase()}] ${entry.message}${dataStr}`
  }

  private log(
    level: LogLevel,
    message: string,
    data?: LogData,
    context?: string,
  ): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      context,
    }

    const formatted = this.formatLog(entry)

    switch (level) {
      case 'debug':
      case 'info':
        console.log(formatted)
        break
      case 'warn':
        console.warn(formatted)
        break
      case 'error':
        console.error(formatted)
        break
    }
  }

  debug(message: string, data?: LogData, context?: string): void {
    this.log('debug', message, data, context)
  }

  info(message: string, data?: LogData, context?: string): void {
    this.log('info', message, data, context)
  }

  warn(message: string, data?: LogData, context?: string): void {
    this.log('warn', message, data, context)
  }

  error(message: string, data?: LogData, context?: string): void {
    this.log('error', message, data, context)
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }
}

/**
 * Singleton logger instance
 */
export const logger = new Logger()
