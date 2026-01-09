/**
 * Empty stub for server-only modules in browser builds.
 * Provides minimal exports to prevent import errors.
 *
 * Used by the build process to replace server-only packages:
 * - pino / pino-pretty
 * - @jejunetwork/contracts
 * - @jejunetwork/db
 * - @jejunetwork/kms
 * - ioredis
 */

// Pino-compatible logger stub
interface NoopLogger {
  info: () => void
  warn: () => void
  error: () => void
  debug: () => void
  trace: () => void
  fatal: () => void
  child: () => NoopLogger
}

const noopLogger: NoopLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  debug: (): void => {},
  trace: (): void => {},
  fatal: (): void => {},
  child: (): NoopLogger => noopLogger,
}

export function pino(): typeof noopLogger {
  return noopLogger
}
export default pino

// Database stub
export function getSQLit(): null {
  return null
}
export type SQLitClient = never
