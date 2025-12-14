/**
 * @jeju/kms - Key Management System
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
 * import { getKMS } from '@jeju/kms';
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

// Core service
export { KMSService, getKMS, resetKMS } from './kms.js';

// Providers
export {
  LitProvider,
  getLitProvider,
  resetLitProvider,
  TEEProvider,
  getTEEProvider,
  resetTEEProvider,
  MPCProvider,
  getMPCProvider,
  resetMPCProvider,
} from './providers/index.js';

// MPC Coordinator
export {
  MPCCoordinator,
  getMPCCoordinator,
  resetMPCCoordinator,
  type MPCParty,
  type MPCKeyGenParams,
  type MPCKeyGenResult,
  type MPCSignRequest,
  type MPCSignSession,
  type MPCSignatureResult,
  type KeyRotationParams,
  type KeyRotationResult,
  type KeyVersion,
  type MPCCoordinatorConfig,
  DEFAULT_MPC_CONFIG,
  getMPCConfig,
} from './mpc/index.js';

// SecretVault
export {
  SecretVault,
  getSecretVault,
  resetSecretVault,
  type Secret,
  type SecretVersion,
  type SecretPolicy,
  type SecretAccessLog,
  type VaultConfig,
} from './vault/index.js';

// Types
export {
  // Enums
  KMSProviderType,
  ConditionOperator,
  // Type aliases
  type KeyType,
  type KeyCurve,
  // Provider types
  type KMSProvider,
  type KMSConfig,
  type LitConfig,
  type TEEConfig,
  type MPCConfig,
  // Access control
  type AccessCondition,
  type AccessControlPolicy,
  type ContractCondition,
  type TimestampCondition,
  type BalanceCondition,
  type StakeCondition,
  type RoleCondition,
  type AgentCondition,
  // Keys
  type KeyMetadata,
  type GeneratedKey,
  // Encryption
  type EncryptedPayload,
  type EncryptRequest,
  type DecryptRequest,
  // Signing
  type SignRequest,
  type SignedMessage,
  type ThresholdSignRequest,
  type ThresholdSignature,
  // Auth
  type AuthSignature,
  type SessionKey,
  // MPC
  type MPCKeyShare,
  type MPCSigningSession,
  // TEE
  type TEEAttestation,
  type TEEKeyInfo,
} from './types.js';

// Logger
export { createLogger, kmsLogger } from './logger.js';

// SDK utilities
export * from './sdk/index.js';
