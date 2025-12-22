/**
 * Scripts Logger - Uses shared logger with CLI formatting utilities
 */

import { createLogger, type Logger as BaseLogger } from '@jejunetwork/shared';

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export class Logger {
  private baseLogger: BaseLogger;
  private prefix?: string;
  
  constructor(config: { prefix?: string } = {}) {
    this.prefix = config.prefix;
    this.baseLogger = createLogger(config.prefix ?? 'scripts');
  }
  
  debug(message: string, ...args: unknown[]): void {
    this.baseLogger.debug(message, args.length > 0 ? { args } : undefined);
  }
  
  info(message: string, ...args: unknown[]): void {
    this.baseLogger.info(message, args.length > 0 ? { args } : undefined);
  }
  
  success(message: string, ...args: unknown[]): void {
    this.baseLogger.info(`✅ ${message}`, args.length > 0 ? { args, success: true } : { success: true });
  }
  
  warn(message: string, ...args: unknown[]): void {
    this.baseLogger.warn(message, args.length > 0 ? { args } : undefined);
  }
  
  error(message: string, ...args: unknown[]): void {
    this.baseLogger.error(message, args.length > 0 ? { args } : undefined);
  }
  
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({ prefix: childPrefix });
  }
  
  // CLI formatting utilities
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
