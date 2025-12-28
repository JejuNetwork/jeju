export {
  canDecrypt,
  createAuthSig,
  createSIWEAuthSig,
  decrypt,
  decryptAndVerify,
  decryptJSON,
  decryptPublic,
} from './decrypt.js'
export {
  agentOwnerPolicy,
  combineAnd,
  combineOr,
  encryptForAgent,
  encryptForRole,
  encryptForStakers,
  encryptTimeLocked,
  encryptWithPolicy,
  roleGatedPolicy,
  stakeGatedPolicy,
  timeLockedPolicy,
  tokenGatedPolicy,
} from './encrypt.js'

export {
  generateEncryptionKey,
  generateSigningKey,
  getKey,
  personalSign,
  revokeKey,
  sign,
  signTypedData,
  thresholdSign,
  thresholdSignTransaction,
} from './sign.js'

export {
  createThresholdSigner,
  DEFAULT_THRESHOLD_SIGNER_CONFIG,
  ThresholdSigner,
  type ThresholdSignerConfig,
  type ThresholdSignResult,
} from './threshold-signer.js'

export {
  decodeToken,
  issueToken,
  issueTokenWithWallet,
  isTokenExpired,
  refreshToken,
  type SignedToken,
  type TokenClaims,
  type TokenVerifyResult,
  verifyToken,
} from './tokens.js'

// ═══════════════════════════════════════════════════════════════════════════
//                         KMS SIGNER (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════
// Use these exports for all signing operations. This is the single source
// of truth for KMS-backed signing across all Jeju apps.

export {
  createKMSSigner,
  getKMSSigner,
  type KMSKeyInfo,
  KMSSigner,
  type KMSSignerConfig,
  requiresKMSSigning,
  resetKMSSigners,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from './signer.js'

export {
  createKMSClients,
  createKMSWalletClient,
  ExtendedKMSWalletClient,
  getKMSSignerAddress,
  type KMSWalletClientConfig,
  type KMSWalletClientResult,
} from './wallet-client.js'

// ═══════════════════════════════════════════════════════════════════════════
//                    MIGRATION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
// Use these during the migration from raw private keys to KMS.

export {
  auditPrivateKeyUsage,
  createMigrationWalletClient,
  enforceKMSSigningOnStartup,
  logSecurityAudit,
  type MigrationWalletConfig,
  type MigrationWalletResult,
  type PrivateKeyUsageAudit,
} from './migration.js'
