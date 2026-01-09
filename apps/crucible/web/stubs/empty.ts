/**
 * Empty stub for server-only modules in browser builds.
 * Provides minimal exports to prevent import errors.
 *
 * Used by the build process to replace server-only packages:
 * - @jejunetwork/kms
 * - @jejunetwork/db
 * - @jejunetwork/deployment
 * - @jejunetwork/messaging
 * - @jejunetwork/contracts
 * - elysia / @elysiajs/*
 * - ioredis
 */

// Export empty object for any default import
export default {}

// Export a no-op function for any named function import
export function noop(): void {}

// Elysia/cors stub - returns a no-op middleware
export function cors(): unknown {
  return {}
}
export class Elysia {
  use() { return this }
  get() { return this }
  post() { return this }
  group() { return this }
  derive() { return this }
  onBeforeHandle() { return this }
}

// Common database stub
export function getSQLit(): null {
  return null
}

// Contracts stub
export async function readContract(): Promise<null> {
  return null
}
export async function writeContract(): Promise<null> {
  return null
}
export const banManagerAbi = []

// Common type stubs
export type SQLitClient = never
