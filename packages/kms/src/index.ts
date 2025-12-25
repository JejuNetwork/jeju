/**
 * @jejunetwork/kms - Key Management System
 *
 * Unified interface for key management:
 * - MPC: Threshold key sharing (Shamir's Secret Sharing)
 * - TEE: Hardware enclaves (set TEE_ENDPOINT for production)
 * - Encryption: AES-256-GCM with policy-based access
 *
 * Self-hosted - no external APIs or fees.
 *
 * @example
 * ```typescript
 * import { getKMS } from '@jejunetwork/kms';
 *
 * const kms = getKMS();
 * await kms.initialize();
 *
 * const encrypted = await kms.encrypt({
 *   data: JSON.stringify({ secret: 'data' }),
 *   policy: { conditions: [{ type: 'timestamp', value: 0 }], operator: 'and' }
 * });
 *
 * const decrypted = await kms.decrypt({ payload: encrypted });
 * ```
 */

// Attestation verification
export {
  type AttestationVerificationResult,
  AttestationVerifier,
  type AttestationVerifierConfig,
  createAttestationVerifier,
  type TrustedMeasurement,
} from './attestation-verifier.js'
// Crypto utilities
export {
  type AESGCMPayload,
  aesGcmDecrypt,
  aesGcmEncrypt,
  constantTimeCompare,
  decryptFromPayload,
  deriveEncryptionKey,
  deriveKeyForEncryption,
  deriveKeyFromSecret,
  encryptToPayload,
  extractRecoveryId,
  generateKeyId,
  parseCiphertextPayload,
  sealWithMasterKey,
  unsealWithMasterKey,
} from './crypto.js'
export {
  createKMSAPIWorker,
  type KMSAPIConfig,
  type KMSAPIWorker,
} from './dws-worker/api.js'
export {
  FROSTCoordinator as DWSFROSTCoordinator,
  type KeyGenContribution,
  type KeyGenResult,
} from './dws-worker/frost-coordinator.js'
// DWS Workers (decentralized deployment)
export {
  createMPCPartyWorker,
  type MPCPartyConfig,
  type MPCPartyWorker,
} from './dws-worker/index.js'
export {
  createMPCClient,
  type MPCCluster,
  type MPCDiscoveryConfig,
  MPCPartyDiscovery,
  type MPCPartyNode,
  MPCSigningClient,
  type SignatureResult,
} from './dws-worker/mpc-discovery.js'
// Core service
export { getKMS, KMSService, resetKMS } from './kms.js'
// Logger
export { createLogger, kmsLogger } from './logger.js'
// FROST Threshold Signing
export {
  aggregateSignatures,
  computeBindingFactor,
  computeChallenge,
  computeGroupCommitment,
  type FROSTCluster,
  FROSTCoordinator,
  type FROSTKeyShare,
  type FROSTParty,
  type FROSTSignature,
  type FROSTSignatureShare,
  type FROSTSigningCommitment,
  generateKeyShares,
  generateSignatureShare,
  generateSigningCommitment,
  publicKeyToAddress,
  randomScalar,
  verifySignature,
} from './mpc/frost-signing.js'
// MPC Coordinator
export {
  DEFAULT_MPC_CONFIG,
  getMPCConfig,
  getMPCCoordinator,
  type KeyRotationParams,
  type KeyRotationResult,
  type KeyVersion,
  MPCCoordinator,
  type MPCCoordinatorConfig,
  type MPCKeyGenParams,
  type MPCKeyGenResult,
  type MPCParty,
  type MPCSignatureResult,
  type MPCSignRequest,
  type MPCSignSession,
  resetMPCCoordinator,
} from './mpc/index.js'
// On-chain verification
export {
  getOnChainVerifier,
  OnChainVerifier,
  type OnChainVerifierConfig,
  resetOnChainVerifier,
  type VerificationResult,
} from './on-chain-verifier.js'
// Providers
export {
  EncryptionProvider,
  getEncryptionProvider,
  getMPCProvider,
  getTEEProvider,
  MPCProvider,
  resetEncryptionProvider,
  resetMPCProvider,
  resetTEEProvider,
  TEEProvider,
} from './providers/index.js'
// Validation schemas
export {
  ciphertextPayloadSchema,
  encryptionConfigSchema,
  encryptRequestSchema,
  generateKeyOptionsSchema,
  kmsConfigSchema,
  mpcConfigSchema,
  mpcCoordinatorConfigSchema,
  mpcKeyGenParamsSchema,
  mpcPartySchema,
  mpcSignRequestSchema,
  parseEnvInt,
  secretPolicySchema,
  signRequestSchema,
  teeConfigSchema,
  thresholdSignRequestSchema,
  tokenClaimsSchema,
  tokenHeaderSchema,
  tokenOptionsSchema,
  validateOrThrow,
  vaultConfigSchema,
  verifyTokenOptionsSchema,
} from './schemas.js'
// SDK utilities
export * from './sdk/index.js'
// Types
export {
  // Access control
  type AccessCondition,
  type AccessControlPolicy,
  type AgentCondition,
  // Auth
  type AuthSignature,
  type BalanceCondition,
  ConditionOperator,
  type ContractCondition,
  type DecryptRequest,
  // Encryption
  type EncryptedPayload,
  type EncryptionConfig,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  // Keys
  type KeyMetadata,
  // Type aliases
  type KeyType,
  type KMSConfig,
  // Provider types
  type KMSProvider,
  // Enums
  KMSProviderType,
  type MPCConfig,
  // MPC
  type MPCKeyShare,
  type MPCSigningSession,
  type RoleCondition,
  type SessionKey,
  type SignedMessage,
  // Signing
  type SignRequest,
  type StakeCondition,
  // TEE
  type TEEAttestation,
  type TEEConfig,
  type TEEKeyInfo,
  type ThresholdSignature,
  type ThresholdSignRequest,
  type TimestampCondition,
} from './types.js'
// SecretVault
export {
  getSecretVault,
  resetSecretVault,
  type Secret,
  type SecretAccessLog,
  type SecretPolicy,
  SecretVault,
  type SecretVersion,
  type VaultConfig,
} from './vault/index.js'
