/**
 * Standardized error handling utilities for Jeju scripts
 * @module scripts/shared/error-handling
 */

import { Logger } from './logger';

const logger = new Logger('ErrorHandler');

export interface ErrorOptions {
  context?: string;
  shouldExit?: boolean;
  exitCode?: number;
  showHelp?: boolean;
}

/**
 * Handle errors with standardized formatting and exit behavior
 */
export function handleError(error: unknown, options: ErrorOptions = {}): never {
  const {
    context = 'Operation',
    shouldExit = true,
    exitCode = 1,
    showHelp = false
  } = options;

  console.error('');
  console.error('❌ ================================================');
  console.error(`   ${context.toUpperCase()} FAILED`);
  console.error('   ================================================');
  console.error('');
  
  if (error instanceof Error) {
    console.error('Error:', error.message);
    if (error.stack && process.env.DEBUG) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
  } else {
    console.error('Error:', error);
  }
  
  console.error('');
  
  if (showHelp) {
    console.error('For help, see documentation or run with --help');
    console.error('');
  }

  if (shouldExit) {
    process.exit(exitCode);
  }

  throw error;
}

/**
 * Safely execute async operation with proper error handling
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  errorMessage: string,
  options: ErrorOptions = {}
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, { ...options, context: errorMessage });
  }
}

/**
 * Validate result from external command (cast, forge, etc.)
 */
export function validateCommandResult(
  result: string,
  commandName: string
): string {
  if (!result || result.trim().length === 0) {
    throw new Error(`${commandName} returned empty result`);
  }

  const trimmed = result.trim();
  
  // For address results
  if (commandName.includes('address') || commandName.includes('deploy')) {
    if (!trimmed.startsWith('0x') || trimmed.length < 10) {
      throw new Error(
        `${commandName} returned invalid address: "${trimmed}"\n` +
        `Expected format: 0x + 40 hex characters`
      );
    }
  }
  
  return trimmed;
}

/**
 * Retry operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    onRetry
  } = options;

  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delayMs = Math.min(
          initialDelayMs * Math.pow(2, attempt),
          maxDelayMs
        );
        
        if (onRetry) {
          onRetry(attempt + 1, error);
        }
        
        logger.warn(`Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError;
}

/**
 * Warn about non-critical errors without failing
 */
export function warnError(error: unknown, context: string): void {
  console.warn('');
  console.warn(`⚠️  Warning: ${context}`);
  console.warn('   (Non-critical, continuing...)');
  if (error instanceof Error) {
    console.warn(`   ${error.message}`);
  }
  console.warn('');
}

/**
 * Assert condition or throw error
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Check if error is specific type
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed')
  );
}

/**
 * Check if error is RPC-related
 */
export function isRPCError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('rpc') ||
    message.includes('provider') ||
    message.includes('json-rpc') ||
    message.includes('connection refused')
  );
}

