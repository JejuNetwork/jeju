/**
 * Colored logging with timestamps, prefixes, and emoji icons.
 */

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  timestamp: true,
};

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[90m',    // Gray
  info: '\x1b[34m',     // Blue
  success: '\x1b[32m',  // Green
  warn: '\x1b[33m',     // Yellow
  error: '\x1b[31m',    // Red
  reset: '\x1b[0m',
};

const ICONS = {
  debug: '🔍',
  info: 'ℹ️ ',
  success: '✅',
  warn: '⚠️ ',
  error: '❌',
};

export class Logger {
  private config: LoggerConfig;
  
  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }
  
  private format(level: LogLevel, message: string): string {
    const parts: string[] = [];
    
    if (this.config.timestamp) {
      const now = new Date().toISOString();
      parts.push(`[${now}]`);
    }
    
    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }
    
    parts.push(`${ICONS[level]} ${message}`);
    
    return parts.join(' ');
  }
  
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return;
    
    const formatted = this.format(level, message);
    const color = COLORS[level];
    const reset = COLORS.reset;
    
    const output = color + formatted + reset;
    
    if (level === 'error') {
      console.error(output, ...args);
    } else if (level === 'warn') {
      console.warn(output, ...args);
    } else {
      console.log(output, ...args);
    }
  }
  
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }
  
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }
  
  success(message: string, ...args: unknown[]): void {
    this.log('success', message, ...args);
  }
  
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }
  
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }
  
  child(prefix: string): Logger {
    const childPrefix = this.config.prefix
      ? `${this.config.prefix}:${prefix}`
      : prefix;
    
    return new Logger({
      ...this.config,
      prefix: childPrefix,
    });
  }
  
  separator(char: string = '=', length: number = 60): void {
    console.log(char.repeat(length));
  }
  
  box(message: string): void {
    const lines = message.split('\n');
    const maxLength = Math.max(...lines.map(l => l.length));
    const border = '═'.repeat(maxLength + 4);
    
    console.log('╔' + border + '╗');
    lines.forEach(line => {
      const padding = ' '.repeat(maxLength - line.length);
      console.log('║  ' + line + padding + '  ║');
    });
    console.log('╚' + border + '╝');
  }
}

// Default logger instance
export const logger = new Logger();

// Convenience exports
export const log = logger.info.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const success = logger.success.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);

