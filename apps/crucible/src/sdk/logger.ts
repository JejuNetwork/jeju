/**
 * Structured Logger - Provides consistent logging across all SDKs.
 */

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

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerConfig {
  level?: LogLevel;
  json?: boolean;
  silent?: boolean;
}

class StructuredLogger implements Logger {
  private component: string;
  private level: number;
  private json: boolean;
  private silent: boolean;

  constructor(component: string, config: LoggerConfig = {}) {
    this.component = component;
    this.level = LOG_LEVELS[config.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info'];
    this.json = config.json ?? process.env.LOG_FORMAT === 'json';
    this.silent = config.silent ?? false;
  }

  debug(message: string, data?: Record<string, unknown>) { this.log('debug', message, data); }
  info(message: string, data?: Record<string, unknown>) { this.log('info', message, data); }
  warn(message: string, data?: Record<string, unknown>) { this.log('warn', message, data); }
  error(message: string, data?: Record<string, unknown>) { this.log('error', message, data); }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (this.silent || LOG_LEVELS[level] < this.level) return;

    const entry: LogEntry = {
      level,
      component: this.component,
      message,
      timestamp: new Date().toISOString(),
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };

    if (this.json) {
      console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
    } else {
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.component}]`;
      const suffix = data ? ` ${JSON.stringify(data)}` : '';
      console[level === 'debug' ? 'log' : level](`${prefix} ${message}${suffix}`);
    }
  }
}

export function createLogger(component: string, config?: LoggerConfig): Logger {
  return new StructuredLogger(component, config);
}

// Singleton loggers for each component
const loggers = new Map<string, Logger>();

export function getLogger(component: string): Logger {
  if (!loggers.has(component)) {
    loggers.set(component, createLogger(component));
  }
  return loggers.get(component)!;
}
