/**
 * @deprecated Import from '@jejunetwork/contracts' instead.
 *
 * This module re-exports from @jejunetwork/contracts for backward compatibility.
 *
 * @example
 * ```typescript
 * // OLD (deprecated)
 * import { readContract, safeReadContract } from '@jejunetwork/shared/viem'
 *
 * // NEW (preferred)
 * import { readContract, safeReadContract, identityRegistryAbi } from '@jejunetwork/contracts'
 * ```
 *
 * @module @jejunetwork/shared/viem
 */

export {
  type Authorization,
  BATCH_EXECUTOR_ABI,
  type BatchCall,
  // Client creation utilities
  createTypedPublicClient,
  createTypedWalletClient,
  type EIP7702TransactionParams,
  getContract,
  hashAuthorizationMessage,
  // Types
  type PublicClientConfig,
  prepareAuthorization,
  // Typed contract utilities
  readContract,
  recoverAuthorizer,
  requiresAuthorization,
  type SignAuthorizationConfig,
  type SignedAuthorization,
  // Legacy utilities (deprecated)
  safeReadContract,
  safeWriteContract,
  // EIP-7702 utilities
  signAuthorization,
  verifyAuthorizationSignature,
  type WalletClientConfig,
  writeContract,
} from '@jejunetwork/contracts'
