/**
 * Structured logger for KMS - outputs JSON in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  return (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') ? env : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getMinLevel()];
}

function formatLog(level: LogLevel, service: string, message: string, data?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...data,
  };
  
  // JSON in production, pretty in development
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry);
  }
  
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${service}]`;
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `${prefix} ${message}${dataStr}`;
}

export function createLogger(service: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog('debug')) console.debug(formatLog('debug', service, message, data));
    },
    info: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog('info')) console.info(formatLog('info', service, message, data));
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog('warn')) console.warn(formatLog('warn', service, message, data));
    },
    error: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog('error')) console.error(formatLog('error', service, message, data));
    },
  };
}

export const kmsLogger = createLogger('kms');
export const litLogger = createLogger('kms.lit');
export const teeLogger = createLogger('kms.tee');
export const mpcLogger = createLogger('kms.mpc');

