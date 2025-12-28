/**
 * Secure Signer - Routes all signing through KMS with threshold cryptography
 *
 * @deprecated This module re-exports from @jejunetwork/kms.
 * Import directly from '@jejunetwork/kms' instead:
 *
 * ```typescript
 * import { createKMSSigner, KMSSigner } from '@jejunetwork/kms'
 * ```
 */

// Re-export canonical KMS signer for backward compatibility
// Legacy alias - use KMSSigner instead
export {
  createKMSSigner,
  getKMSSigner,
  type KMSKeyInfo,
  KMSSigner,
  KMSSigner as SecureSigner,
  type KMSSignerConfig,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'
