/**
 * KMS Signer - Gateway Application
 *
 * Re-exports from @jejunetwork/kms for signing operations.
 *
 * SECURITY: Private keys are NEVER exposed. All signing uses:
 * - MPC/FROST threshold signing in production
 * - TEE hardware isolation when available
 */

export {
  auditPrivateKeyUsage,
  createKMSClients,
  createKMSSigner,
  createKMSWalletClient,
  ExtendedKMSWalletClient,
  enforceKMSSigningOnStartup,
  getKMSSigner,
  getKMSSignerAddress,
  type KMSKeyInfo,
  KMSSigner,
  type KMSSignerConfig,
  type KMSWalletClientConfig,
  type KMSWalletClientResult,
  logSecurityAudit,
  type PrivateKeyUsageAudit,
  requiresKMSSigning,
  resetKMSSigners,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'
