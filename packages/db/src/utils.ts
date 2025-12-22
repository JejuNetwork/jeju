/**
 * Shared utilities for CQL package
 */

import { z } from 'zod';

/**
 * Parse and validate a port number from an environment variable or default
 */
export function parsePort(envValue: string | undefined, defaultPort: number): number {
  if (!envValue) return defaultPort;
  
  const parsed = parseInt(envValue, 10);
  
  // Validate port is a valid number in valid range
  const PortSchema = z.number().int().min(1).max(65535);
  return PortSchema.parse(parsed);
}

/**
 * Parse and validate a timeout value from an environment variable
 */
export function parseTimeout(envValue: string | undefined, defaultTimeout: number): number {
  if (!envValue) return defaultTimeout;
  
  const parsed = parseInt(envValue, 10);
  
  // Validate timeout is a positive integer
  const TimeoutSchema = z.number().int().positive();
  return TimeoutSchema.parse(parsed);
}

/**
 * Parse boolean from environment variable string
 */
export function parseBoolean(envValue: string | undefined, defaultValue: boolean): boolean {
  if (envValue === undefined) return defaultValue;
  return envValue === 'true' || envValue === '1';
}
