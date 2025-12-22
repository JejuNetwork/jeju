/**
 * Shared Utilities for Jeju Bots
 * 
 * Common constants, types, and utilities used across the package
 */

import { WEIGHT_PRECISION } from './schemas';

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert weight (bigint with 18 decimals) to basis points (number)
 */
export function weightToBps(weight: bigint): number {
  return Number((weight * 10000n) / WEIGHT_PRECISION);
}

/**
 * Convert basis points (number) to weight (bigint with 18 decimals)
 */
export function bpsToWeight(bps: number): bigint {
  return (BigInt(bps) * WEIGHT_PRECISION) / 10000n;
}

/**
 * Calculate percentage difference between two values
 */
export function percentageDiff(a: bigint, b: bigint): number {
  if (a === 0n && b === 0n) return 0;
  const diff = a > b ? a - b : b - a;
  const avg = (a + b) / 2n;
  if (avg === 0n) return 0;
  return Number((diff * 10000n) / avg) / 100; // Returns percentage
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a bigint value between min and max
 */
export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Format bigint with decimals to string
 */
export function formatBigInt(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = value / divisor;
  const fracPart = value % divisor;
  const fracStr = fracPart.toString().padStart(decimals, '0');
  // Remove trailing zeros
  const trimmedFrac = fracStr.replace(/0+$/, '');
  return trimmedFrac ? `${wholePart}.${trimmedFrac}` : wholePart.toString();
}

/**
 * Parse string to bigint with decimals
 */
export function parseBigInt(value: string, decimals: number): bigint {
  const [whole, frac = ''] = value.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
