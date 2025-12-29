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

// Import directly from @jejunetwork/types:
// import { TEEAttestation, TEEAttestationVerificationResult, TEEKeyInfo, TEENodeInfo, TEEPlatform, TEEPlatform as TEEPlatformEnum } from '@jejunetwork/types'
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
  bigintSecurityWarning,
  constantTimeCompare,
  decryptFromPayload,
  deriveEncryptionKey,
  deriveKeyForEncryption,
  deriveKeyFromSecret,
  deriveKeyFromSecretAsync,
  encryptToPayload,
  extractRecoveryId,
  generateKeyId,
  parseCiphertextPayload,
  sealWithMasterKey,
  secureZero,
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
// HSM abstraction layer
export {
  createHSMProvider,
  getHSMProvider,
  type HSMConfig,
  type HSMCredentials,
  type HSMEncryptResult,
  type HSMKeyRef,
  type HSMProvider,
  type HSMSignResult,
  resetHSMProvider,
  SoftHSMProvider,
} from './hsm/index.js'
// Distributed KMS Infrastructure
export {
  createDistributedKMSService,
  type DistributedCluster,
  type DistributedKMSConfig,
  DistributedKMSService,
  type DistributedParty,
  type SignRequest as DistributedSignRequest,
  type SignResult as DistributedSignResult,
} from './infrastructure/distributed-kms-service.js'
// FROST Key Rotation
export {
  createDefaultRotationConfig,
  createFROSTKeyRotationManager,
  FROSTKeyRotationManager,
  type RefreshedShare,
  type RotationConfig,
  type RotationContribution,
  type RotationSession,
} from './infrastructure/frost-key-rotation.js'
export {
  createHSMRootKeyManager,
  HSMRootKeyManager,
} from './infrastructure/hsm-root-key-manager.js'
export {
  type ClusterRotationState,
  createKeyRotationScheduler,
  KeyRotationScheduler,
  type RotationEvent,
  type SchedulerConfig,
} from './infrastructure/key-rotation-scheduler.js'
// KMS Monitoring
export {
  type Alert,
  type AlertCondition,
  type AlertRule,
  type AlertSeverity,
  type AlertType,
  createKMSMonitor,
  DEFAULT_ALERT_RULES,
  type KMSEvent,
  KMSMonitor,
  type MonitoringConfig,
  type MonitoringMetrics,
} from './infrastructure/kms-monitoring.js'
export {
  type AttestationVerifierConfig as InfraTEEAttestationVerifierConfig,
  createTEEAttestationVerifier,
  TEEAttestationVerifier,
} from './infrastructure/tee-attestation-verifier.js'
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
// Secure Signing Service (RECOMMENDED - uses FROST, never reconstructs keys)
export {
  getSecureSigningService,
  type KeyGenResult as SecureKeyGenResult,
  resetSecureSigningService,
  SecureSigningService,
  type SignatureResult as SecureSignatureResult,
  type SignRequest as SecureSignRequest,
  type SignTypedDataRequest,
} from './signing-service.js'
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
  // TEE (config only - other types from @jejunetwork/types)
  type TEEConfig,
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
