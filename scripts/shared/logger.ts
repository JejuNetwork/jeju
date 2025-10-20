/**
 * @fileoverview Shared logging utility for consistent output across all Jeju scripts
 * @module scripts/shared/logger
 * 
 * Provides structured, colored logging with timestamps and prefixes.
 * Used throughout deployment scripts, monitoring tools, and test runners.
 * 
 * Features:
 * - Color-coded log levels (debug, info, success, warn, error)
 * - Optional timestamps
 * - Optional prefixes for context
 * - Emoji icons for quick visual scanning
 * - Log level filtering
 * - Child logger creation for scoped logging
 * 
 * @example Basic usage
 * ```ts
 * import { Logger } from './shared/logger';
 * 
 * const logger = new Logger();
 * logger.info('Starting deployment...');
 * logger.success('Contract deployed at 0x123...');
 * logger.warn('Gas price is high');
 * logger.error('Deployment failed', error);
 * ```
 * 
 * @example With configuration
 * ```ts
 * const logger = new Logger({
 *   level: 'debug',
 *   prefix: 'ORACLE',
 *   timestamp: true
 * });
 * 
 * logger.debug('Fetching prices from Uniswap...');
 * // Output: [2025-01-15T10:30:00.000Z] [ORACLE] 🔍 Fetching prices from Uniswap...
 * ```
 * 
 * @example Child loggers
 * ```ts
 * const mainLogger = new Logger({ prefix: 'DEPLOY' });
 * const contractLogger = mainLogger.child('CONTRACTS');
 * 
 * mainLogger.info('Starting deployment');
 * contractLogger.info('Deploying token');
 * // Output: [DEPLOY] [CONTRACTS] ℹ️  Deploying token
 * ```
 */

/**
 * Log severity levels
 * 
 * @typedef {'debug' | 'info' | 'success' | 'warn' | 'error'} LogLevel
 */
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

/**
 * Logger configuration options
 * 
 * @interface LoggerConfig
 * @property {LogLevel} level - Minimum level to log (filters out lower levels)
 * @property {string} [prefix] - Optional prefix for all log messages
 * @property {boolean} [timestamp] - Whether to include ISO timestamps (default: true)
 */
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
  
  private log(level: LogLevel, message: string, ...args: any[]): void {
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
  
  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args);
  }
  
  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args);
  }
  
  success(message: string, ...args: any[]): void {
    this.log('success', message, ...args);
  }
  
  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args);
  }
  
  error(message: string, ...args: any[]): void {
    this.log('error', message, ...args);
  }
  
  /**
   * Create a child logger with additional prefix
   */
  child(prefix: string): Logger {
    const childPrefix = this.config.prefix
      ? `${this.config.prefix}:${prefix}`
      : prefix;
    
    return new Logger({
      ...this.config,
      prefix: childPrefix,
    });
  }
  
  /**
   * Log a separator line
   */
  separator(char: string = '=', length: number = 60): void {
    console.log(char.repeat(length));
  }
  
  /**
   * Log with box around it
   */
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

