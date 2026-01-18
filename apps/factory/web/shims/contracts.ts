/**
 * Browser shim for @jejunetwork/contracts
 *
 * Provides empty exports for contracts package to prevent runtime errors
 * when the package is transitively imported in browser builds.
 *
 * These functions are used server-side and should not be called in the browser.
 */

// Types (exported as empty interfaces/types)
export type AuthorizationConfig = Record<string, unknown>
export type SignAuthorizationConfig = Record<string, unknown>
export type SignedAuthorization = Record<string, unknown>
export type WalletClientConfig = Record<string, unknown>

// Export empty objects/functions for common contract exports
export const addresses = {}
export const abis = {}
export const getContractAddress = () =>
  '0x0000000000000000000000000000000000000000'
export const getDeploymentAddress = () =>
  '0x0000000000000000000000000000000000000000'

// Contract interaction shims
export async function readContract(
  _config: unknown,
  _params: unknown,
): Promise<unknown> {
  console.warn(
    '[contracts shim] readContract called in browser - returning undefined',
  )
  return undefined
}

export async function writeContract(
  _config: unknown,
  _params: unknown,
): Promise<string> {
  console.warn(
    '[contracts shim] writeContract called in browser - returning mock hash',
  )
  return '0x0000000000000000000000000000000000000000000000000000000000000000'
}

// Authorization shims
export function prepareAuthorization(_config: unknown): unknown {
  console.warn('[contracts shim] prepareAuthorization called in browser')
  return {}
}

export function recoverAuthorizer(_auth: unknown): string {
  console.warn('[contracts shim] recoverAuthorizer called in browser')
  return '0x0000000000000000000000000000000000000000'
}

export function requiresAuthorization(_auth: unknown): boolean {
  console.warn('[contracts shim] requiresAuthorization called in browser')
  return false
}

export async function signAuthorization(
  _config: unknown,
): Promise<Record<string, unknown>> {
  console.warn('[contracts shim] signAuthorization called in browser')
  return {}
}

export function verifyAuthorizationSignature(_auth: unknown): boolean {
  console.warn(
    '[contracts shim] verifyAuthorizationSignature called in browser',
  )
  return false
}

// Shim ABIs (empty arrays)
export const banManagerAbi: readonly unknown[] = []

// Re-export as default
export default {
  addresses,
  abis,
  getContractAddress,
  getDeploymentAddress,
  readContract,
  writeContract,
  prepareAuthorization,
  recoverAuthorizer,
  requiresAuthorization,
  signAuthorization,
  verifyAuthorizationSignature,
  banManagerAbi,
}
