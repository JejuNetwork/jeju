/**
 * Bazaar Secrets Management
 *
 * SECURITY: All secrets must be retrieved through this module.
 * This ensures:
 * 1. Anvil dev keys are ONLY used on verified localnet
 * 2. Production secrets are retrieved from KMS SecretVault
 * 3. No hardcoded secrets appear in public code
 *
 * @see packages/kms for the underlying secret management system
 */

import { isLocalnet as isLocalnetFromRpc } from '@jejunetwork/config/ports'
import {
  getCurrentNetwork,
  isLocalnet as isLocalnetFromNetwork,
} from '@jejunetwork/config'

/**
 * Well-known Anvil/Hardhat test key - account[0]
 * This is public and ONLY safe for local development.
 * NEVER use on any real network.
 */
const ANVIL_ACCOUNT_0_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

/**
 * Strict validation that we're on localnet before using dev keys
 *
 * Returns true only if ALL conditions are met:
 * 1. Network is localnet (from config)
 * 2. RPC URL points to localhost/127.0.0.1 (if provided)
 * 3. NODE_ENV is not 'production'
 */
function isStrictlyLocalnet(rpcUrl?: string): boolean {
  // Never use dev keys in production build
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  // Check network config
  if (!isLocalnetFromNetwork()) {
    return false
  }

  // If RPC URL provided, validate it points to local
  if (rpcUrl && !isLocalnetFromRpc(rpcUrl)) {
    return false
  }

  return true
}

/**
 * Get deployer private key for script execution.
 *
 * SECURITY RULES:
 * 1. Always checks PRIVATE_KEY env var first (for CI/CD and production)
 * 2. Falls back to Anvil key ONLY on verified localnet
 * 3. Throws error if not on localnet and no key provided
 *
 * @param rpcUrl - The RPC URL being used (for additional localnet verification)
 * @returns The private key as a hex string
 * @throws Error if not on localnet and PRIVATE_KEY not set
 */
export function getDeployerKey(rpcUrl: string): string {
  // Always prefer explicit env var
  const envKey = process.env.PRIVATE_KEY
  if (envKey) {
    return envKey
  }

  // Strict localnet check before using dev key
  if (!isStrictlyLocalnet(rpcUrl)) {
    throw new Error(
      'PRIVATE_KEY environment variable required for non-local deployments.\n' +
        'For production: Use KMS-managed secrets\n' +
        'For CI/CD: Set PRIVATE_KEY in secrets\n' +
        'For local dev: Run with localnet (jeju dev)',
    )
  }

  // Safe to use Anvil key on localnet
  console.log('  [secrets] Using Anvil dev key (localnet only)')
  return ANVIL_ACCOUNT_0_KEY
}

/**
 * Get SQLit database private key for API operations.
 *
 * This key is used for database authentication, not blockchain transactions.
 * It should be stored in KMS SecretVault in production.
 *
 * @returns The SQLit private key or undefined if not configured
 */
export function getSqlitPrivateKey(): string | undefined {
  const network = getCurrentNetwork()

  // For production, the key should come from KMS or secure env injection
  // The key should NEVER be committed to source control
  const key = process.env.SQLIT_PRIVATE_KEY

  if (!key && network !== 'localnet') {
    console.warn(
      '[secrets] SQLIT_PRIVATE_KEY not set. Database operations may fail.',
    )
  }

  return key || undefined
}
