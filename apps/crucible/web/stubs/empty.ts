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

// Common database stub
export function getSQLit(): null {
  return null
}

// Common type stubs
export type SQLitClient = never
