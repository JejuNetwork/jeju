/**
 * @jejunetwork/oauth3
 * 
 * Fully decentralized OAuth3 authentication with:
 * - TEE-backed key management (dstack CVM or Phala CVM)
 * - FROST threshold MPC signing (2-of-3 by default)
 * - Cross-chain identity support via Open Intents
 * - JNS integration for app/identity resolution
 * - Decentralized storage (IPFS) for sessions and credentials
 * - Compute marketplace integration for TEE node discovery
 * - W3C Verifiable Credentials for identity attestations
 * 
 * Deployment modes:
 * - localnet: Local development with simulated TEE (chain 420691)
 * - testnet: Jeju Testnet with real TEE (chain 420690)
 * - mainnet: Jeju Mainnet production (chain 420692)
 */

// Core types
export * from './types.js';

// Decentralized Infrastructure
export {
  // JNS Integration
  OAuth3JNSService,
  createOAuth3JNSService,
  resetOAuth3JNSService,
  type OAuth3JNSConfig,
  type OAuth3AppJNS,
  type IdentityJNS,
  type TEENodeJNS,
  type JNSRecords,
} from './infrastructure/jns-integration.js';

export {
  // Decentralized Storage
  OAuth3StorageService,
  createOAuth3StorageService,
  resetOAuth3StorageService,
  type StorageConfig,
  type StoredSession,
  type StoredCredential,
  type StorageResult,
  type StorageTier,
} from './infrastructure/storage-integration.js';

export {
  // Compute Integration
  OAuth3ComputeService,
  createOAuth3ComputeService,
  resetOAuth3ComputeService,
  type ComputeConfig,
  type ComputeProvider,
  type OAuth3NodeDeployment,
  type DeployNodeParams,
} from './infrastructure/compute-integration.js';

export {
  // Decentralized Discovery
  OAuth3DecentralizedDiscovery,
  createDecentralizedDiscovery,
  resetDecentralizedDiscovery,
  type DecentralizedConfig,
  type DiscoveredNode,
  type DiscoveredApp,
} from './infrastructure/discovery.js';

export {
  // Threshold Encryption
  ThresholdEncryptionService,
  createThresholdEncryption,
  deriveLocalEncryptionKey,
  type ThresholdKeyConfig,
  type EncryptedPayload,
  type DecryptionShare,
} from './infrastructure/threshold-encryption.js';

export {
  // x402 Payments
  X402PaymentClient,
  createX402PaymentClient,
  resetX402PaymentClient,
  calculateStorageFee,
  calculateComputeFee,
  type PaymentConfig,
  type PaymentRequest,
  type PaymentAuthorization,
  type PaymentReceipt,
} from './infrastructure/x402-payments.js';

export {
  // Contract ABIs
  JNS_REGISTRY_ABI,
  JNS_RESOLVER_ABI,
  OAUTH3_APP_REGISTRY_ABI,
  OAUTH3_IDENTITY_REGISTRY_ABI,
  OAUTH3_TEE_VERIFIER_ABI,
  namehash,
  labelhash,
} from './infrastructure/abis.js';

export {
  // Shared Config
  CONTRACTS,
  CHAIN_IDS,
  RPC_URLS,
  IPFS_ENDPOINTS,
  DWS_ENDPOINTS,
  DEFAULT_RPC,
  DEFAULT_IPFS_API,
  DEFAULT_IPFS_GATEWAY,
  MIN_STAKE,
  MPC_DEFAULTS,
  ATTESTATION_VALIDITY_MS,
  CACHE_EXPIRY_MS,
  ZERO_ADDRESS,
  getNetworkType,
  getContracts,
  getRpcUrl,
  getIPFSEndpoints,
  getEnvironmentConfig,
  getAgentConfig,
  type NetworkType,
  type TEEMode,
  type OAuth3AgentConfig,
} from './infrastructure/config.js';

// TEE Agent
export { DstackAuthAgent, startAuthAgent } from './tee/dstack-agent.js';

// MPC/FROST Signing
export {
  FROSTCoordinator,
  generateKeyShares,
  generateSigningCommitment,
  generateSignatureShare,
  aggregateSignatures,
  verifySignature,
  publicKeyToAddress,
  type FROSTKeyShare,
  type FROSTSigningCommitment,
  type FROSTSignatureShare,
  type FROSTSignature,
  type FROSTCluster,
} from './mpc/frost-signing.js';

// Farcaster Provider
export {
  FarcasterProvider,
  farcasterProvider,
  type FarcasterProfile,
  type FarcasterSigner,
  type FarcasterCast,
  type FarcasterFrameContext,
} from './providers/farcaster.js';

// Social OAuth Providers (Google, Apple, Twitter, GitHub, Discord)
export {
  GoogleProvider,
  AppleProvider,
  TwitterProvider,
  GitHubProvider,
  DiscordProvider,
  createOAuthProvider,
  type OAuthConfig,
  type OAuthState,
  type OAuthToken,
  type OAuthProfile,
} from './providers/social.js';

// Email Authentication Provider
export {
  EmailProvider,
  createEmailProvider,
  type EmailAuthConfig,
  type EmailUser,
  type MagicLinkToken,
  type OTPToken,
  type EmailAuthResult,
} from './providers/email.js';

// Phone/SMS Authentication Provider
export {
  PhoneProvider,
  createPhoneProvider,
  type PhoneAuthConfig,
  type PhoneUser,
  type PhoneOTP,
  type PhoneAuthResult,
} from './providers/phone.js';

// Multi-Factor Authentication (MFA)
export {
  PasskeyManager,
  createPasskeyManager,
  type PasskeyCredential,
  type PasskeyChallenge,
  type PasskeyAuthResult,
  type PasskeyRegistrationOptions,
  type PasskeyAuthenticationOptions,
} from './mfa/passkeys.js';

export {
  TOTPManager,
  createTOTPManager,
  type TOTPSecret,
  type TOTPVerifyResult,
  type TOTPSetupResult,
} from './mfa/totp.js';

export {
  BackupCodesManager,
  createBackupCodesManager,
  type BackupCode,
  type BackupCodesSet,
} from './mfa/backup-codes.js';

export {
  MFAMethod,
  type MFAStatus,
  type MFAChallenge,
} from './mfa/index.js';

// React SDK (separate entry point for tree-shaking)
// import { OAuth3Provider, useOAuth3 } from '@jejunetwork/oauth3/react'

// Verifiable Credentials
export {
  VerifiableCredentialIssuer,
  VerifiableCredentialVerifier,
  createCredentialHash,
  credentialToOnChainAttestation,
  didFromAddress,
  addressFromDid,
  type CredentialIssuanceParams,
  type CredentialVerificationResult,
  type CredentialPresentation,
} from './credentials/verifiable-credentials.js';

// Multi-tenant Council
export {
  MultiTenantCouncilManager,
  createMultiTenantCouncilManager,
  type CouncilDeployment,
  type CEOConfig,
  type CouncilAgentConfig,
} from './council/multi-tenant.js';

// SDK Client
export {
  OAuth3Client,
  createOAuth3Client,
  type OAuth3Config,
  type LoginOptions,
  type LinkOptions,
  type SignMessageOptions,
  type TransactionOptions,
  type OAuth3EventType,
  type OAuth3Event,
  type OAuth3EventHandler,
} from './sdk/client.js';

// Cross-chain Identity (Open Intents)
export {
  CrossChainIdentityManager,
  crossChainIdentityManager,
  ChainId,
  encodeTransferIntent,
  encodeContractCallIntent,
  computeIntentHash,
  type SupportedChain,
  type CrossChainIdentityState,
  type ChainIdentityState,
  type IdentitySyncIntent,
  type CrossChainAuthIntent,
} from './intents/cross-chain-identity.js';

// Validation (Zod schemas and utilities)
export {
  // Core schemas
  HexSchema,
  AddressSchema,
  Bytes32Schema,
  OAuth3ConfigSchema,
  OAuth3SessionSchema,
  TEEAttestationSchema,
  VerifiableCredentialSchema,
  CredentialSubjectSchema,
  CredentialProofSchema,
  
  // API response schemas
  ErrorResponseSchema,
  TOTPSetupResponseSchema,
  MFAStatusSchema,
  PasskeyListItemSchema,
  OAuthInitResponseSchema,
  SignResponseSchema,
  CredentialVerifyResponseSchema,
  
  // External API schemas
  NeynarUserSchema,
  NeynarCastSchema,
  OAuthTokenResponseSchema,
  GoogleUserInfoSchema,
  GitHubUserSchema,
  TwitterUserSchema,
  DiscordUserSchema,
  IPFSAddResponseSchema,
  
  // Validation utilities
  expect,
  expectEndpoint,
  getEndpointWithDevFallback,
  extractError,
  validateConfig,
  validateResponse,
  safeParseJson,
  fetchAndValidate,
  isHex,
  isAddress,
  generateOTP,
  
  // Types
  type ValidatedOAuth3Config,
  type NeynarUser,
  type NeynarCast,
  type OAuthTokenResponse,
} from './validation.js';
