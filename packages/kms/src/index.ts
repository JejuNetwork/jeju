/**
 * @jeju/kms - Decentralized Key Management System
 *
 * Unified interface for key management across:
 * - Lit Protocol (distributed threshold cryptography)
 * - TEE (hardware-secured enclaves)
 * - MPC (multi-party computation)
 *
 * @example
 * ```typescript
 * import { getKMS, encryptForAgent, decrypt } from '@jeju/kms';
 *
 * // Initialize KMS
 * const kms = getKMS();
 * await kms.initialize();
 *
 * // Encrypt data for an agent owner
 * const encrypted = await encryptForAgent(
 *   JSON.stringify({ secret: 'data' }),
 *   REGISTRY_ADDRESS,
 *   'base-sepolia',
 *   123
 * );
 *
 * // Decrypt with auth signature
 * const decrypted = await decrypt(encrypted, authSig);
 * ```
 */

// Core service
export { KMSService, getKMS, resetKMS } from './kms.js';

// Providers
export {
  LitProvider,
  getLitProvider,
  TEEProvider,
  getTEEProvider,
  MPCProvider,
  getMPCProvider,
} from './providers/index.js';

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

