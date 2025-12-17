/**
 * Structured Logger for Production
 * Outputs JSON logs with consistent format for log aggregation
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(entry: LogEntry): string {
  if (isProduction) {
    return JSON.stringify(entry);
  }
  // Human-readable format for development
  const { timestamp, level, service, message, ...extra } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${service}]`;
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  return `${prefix} ${message}${extraStr}`;
}

export function createLogger(service: string) {
  function log(level: LogLevel, message: string, extra: Record<string, unknown> = {}): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...extra,
    };

    const formatted = formatLog(entry);

    switch (level) {
      case 'debug':
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  return {
    debug: (message: string, extra?: Record<string, unknown>) => log('debug', message, extra),
    info: (message: string, extra?: Record<string, unknown>) => log('info', message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => log('warn', message, extra),
    error: (message: string, extra?: Record<string, unknown>) => log('error', message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;

