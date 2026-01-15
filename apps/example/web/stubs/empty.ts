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

// KMS stub
export function getSecureSigningService(): {
  generateKey: () => Promise<{ publicKey: string; keyId: string }>
  sign: (keyId: string, message: string) => Promise<string>
  verify: (publicKey: string, message: string, signature: string) => Promise<boolean>
} {
  return {
    generateKey: async () => ({ publicKey: '', keyId: '' }),
    sign: async () => '',
    verify: async () => false,
  }
}
export type SecureSigningService = ReturnType<typeof getSecureSigningService>

export function createMPCClient(): {
  sign: (keyId: string, message: string) => Promise<string>
  generateKey: () => Promise<{ publicKey: string; keyId: string }>
} {
  return {
    sign: async () => '',
    generateKey: async () => ({ publicKey: '', keyId: '' }),
  }
}
export type MPCSigningClient = ReturnType<typeof createMPCClient>

// Contracts stub - browser doesn't need contract reading
export async function readContract(): Promise<never> {
  throw new Error('readContract is not available in browser')
}
export async function writeContract(): Promise<never> {
  throw new Error('writeContract is not available in browser')
}
export async function deployContract(): Promise<never> {
  throw new Error('deployContract is not available in browser')
}

// ABI stubs
export const banManagerAbi: unknown[] = []
export const identityRegistryAbi: unknown[] = []
export const moderationMarketplaceAbi: unknown[] = []
export const reputationRegistryAbi: unknown[] = []
