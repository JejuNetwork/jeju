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

export {
  // Contract ABIs
  JNS_REGISTRY_ABI,
  JNS_RESOLVER_ABI,
  labelhash,
  namehash,
  OAUTH3_APP_REGISTRY_ABI,
  OAUTH3_IDENTITY_REGISTRY_ABI,
  OAUTH3_TEE_VERIFIER_ABI,
} from './infrastructure/abis.js'
export {
  type ComputeConfig,
  type ComputeProvider,
  createOAuth3ComputeService,
  type DeployNodeParams,
  // Compute Integration
  OAuth3ComputeService,
  type OAuth3NodeDeployment,
  resetOAuth3ComputeService,
} from './infrastructure/compute-integration.js'
export {
  ATTESTATION_VALIDITY_MS,
  CACHE_EXPIRY_MS,
  CHAIN_IDS,
  // Shared Config
  CONTRACTS,
  DEFAULT_IPFS_API,
  DEFAULT_IPFS_GATEWAY,
  DEFAULT_RPC,
  DWS_ENDPOINTS,
  getAgentConfig,
  getContracts,
  getEnvironmentConfig,
  getIPFSEndpoints,
  getNetworkType,
  getRpcUrl,
  IPFS_ENDPOINTS,
  MIN_STAKE,
  MPC_DEFAULTS,
  type NetworkType,
  type OAuth3AgentConfig,
  RPC_URLS,
  type TEEMode,
  ZERO_ADDRESS,
} from './infrastructure/config.js'
export {
  createDecentralizedDiscovery,
  type DecentralizedConfig,
  type DiscoveredApp,
  type DiscoveredNode,
  // Decentralized Discovery
  OAuth3DecentralizedDiscovery,
  resetDecentralizedDiscovery,
} from './infrastructure/discovery.js'
// Decentralized Infrastructure
export {
  createOAuth3JNSService,
  type IdentityJNS,
  type JNSRecords,
  type OAuth3AppJNS,
  type OAuth3JNSConfig,
  // JNS Integration
  OAuth3JNSService,
  resetOAuth3JNSService,
  type TEENodeJNS,
} from './infrastructure/jns-integration.js'
export {
  createOAuth3StorageService,
  // Decentralized Storage
  OAuth3StorageService,
  resetOAuth3StorageService,
  type StorageConfig,
  type StorageResult,
  type StorageTier,
  type StoredCredential,
  type StoredSession,
} from './infrastructure/storage-integration.js'
export {
  createThresholdEncryption,
  type DecryptionShare,
  deriveLocalEncryptionKey,
  type EncryptedPayload,
  // Threshold Encryption
  ThresholdEncryptionService,
  type ThresholdKeyConfig,
} from './infrastructure/threshold-encryption.js'
export {
  calculateComputeFee,
  calculateStorageFee,
  createX402PaymentClient,
  type PaymentAuthorization,
  type PaymentConfig,
  type PaymentReceipt,
  type PaymentRequest,
  resetX402PaymentClient,
  // x402 Payments
  X402PaymentClient,
} from './infrastructure/x402-payments.js'
export {
  type BackupCode,
  BackupCodesManager,
  type BackupCodesSet,
  createBackupCodesManager,
} from './mfa/backup-codes.js'
export {
  type MFAChallenge,
  type MFAChallengeMetadata,
  MFAMethod,
  type MFAStatus,
} from './mfa/index.js'
// Multi-Factor Authentication (MFA)
export {
  createPasskeyManager,
  type PasskeyAuthenticationOptions,
  type PasskeyAuthResult,
  type PasskeyChallenge,
  type PasskeyCredential,
  PasskeyManager,
  type PasskeyRegistrationOptions,
} from './mfa/passkeys.js'
export {
  createTOTPManager,
  TOTPManager,
  type TOTPSecret,
  type TOTPSetupResult,
  type TOTPVerifyResult,
} from './mfa/totp.js'
// MPC/FROST Signing
export {
  aggregateSignatures,
  type FROSTCluster,
  FROSTCoordinator,
  type FROSTKeyShare,
  type FROSTSignature,
  type FROSTSignatureShare,
  type FROSTSigningCommitment,
  generateKeyShares,
  generateSignatureShare,
  generateSigningCommitment,
  publicKeyToAddress,
  verifySignature,
} from './mpc/frost-signing.js'

// Email Authentication Provider
export {
  createEmailProvider,
  type EmailAuthConfig,
  type EmailAuthResult,
  EmailProvider,
  type EmailUser,
  type MagicLinkToken,
  type OTPToken,
} from './providers/email.js'
// Farcaster Provider
export {
  type FarcasterCast,
  type FarcasterFrameContext,
  type FarcasterProfile,
  FarcasterProvider,
  type FarcasterSigner,
  farcasterProvider,
} from './providers/farcaster.js'
// Phone/SMS Authentication Provider
export {
  createPhoneProvider,
  type PhoneAuthConfig,
  type PhoneAuthResult,
  type PhoneOTP,
  PhoneProvider,
  type PhoneUser,
} from './providers/phone.js'
// Social OAuth Providers (Google, Apple, Twitter, GitHub, Discord)
export {
  AppleProvider,
  createOAuthProvider,
  DiscordProvider,
  GitHubProvider,
  GoogleProvider,
  type OAuthConfig,
  type OAuthProfile,
  type OAuthState,
  type OAuthToken,
  TwitterProvider,
} from './providers/social.js'
// TEE Agent
export { DstackAuthAgent, startAuthAgent } from './tee/dstack-agent.js'
// Core types
export * from './types.js'

// React SDK (separate entry point for tree-shaking)
// import { OAuth3Provider, useOAuth3 } from '@jejunetwork/oauth3/react'

// Multi-tenant Council
export {
  type CEOConfig,
  type CouncilAgentConfig,
  type CouncilDeployment,
  createMultiTenantCouncilManager,
  MultiTenantCouncilManager,
} from './council/multi-tenant.js'
// Verifiable Credentials
export {
  addressFromDid,
  type CredentialIssuanceParams,
  type CredentialPresentation,
  type CredentialVerificationResult,
  createCredentialHash,
  credentialToOnChainAttestation,
  didFromAddress,
  VerifiableCredentialIssuer,
  VerifiableCredentialVerifier,
} from './credentials/verifiable-credentials.js'
// Cross-chain Identity (Open Intents)
export {
  ChainId,
  type ChainIdentityState,
  type CrossChainAuthIntent,
  CrossChainIdentityManager,
  type CrossChainIdentityState,
  computeIntentHash,
  crossChainIdentityManager,
  encodeContractCallIntent,
  encodeTransferIntent,
  type IdentitySyncIntent,
  type SupportedChain,
} from './intents/cross-chain-identity.js'
// SDK Client
export {
  createOAuth3Client,
  type LinkOptions,
  type LoginOptions,
  OAuth3Client,
  type OAuth3Config,
  type OAuth3Event,
  type OAuth3EventHandler,
  type OAuth3EventType,
  type SignMessageOptions,
  type TransactionOptions,
} from './sdk/client.js'

// Validation (Zod schemas and utilities)
export {
  AddressSchema,
  AuthCallbackDataSchema,
  Bytes32Schema,
  CredentialProofSchema,
  CredentialSubjectSchema,
  CredentialVerifyResponseSchema,
  DiscordUserSchema,
  // API response schemas
  ErrorResponseSchema,
  // Validation utilities
  expect,
  expectEndpoint,
  extractError,
  fetchAndValidate,
  GitHubUserSchema,
  GoogleUserInfoSchema,
  generateOTP,
  getEndpointWithDevFallback,
  // Core schemas
  HexSchema,
  IPFSAddResponseSchema,
  isAddress,
  isHex,
  MFAStatusSchema,
  type NeynarCast,
  NeynarCastSchema,
  type NeynarUser,
  // External API schemas
  NeynarUserSchema,
  NodeResourcesSchema,
  OAuth3ConfigSchema,
  OAuth3SessionSchema,
  OAuthInitResponseSchema,
  type OAuthTokenResponse,
  OAuthTokenResponseSchema,
  PasskeyListItemSchema,
  SignResponseSchema,
  safeParseJson,
  TEEAttestationSchema,
  TOTPSetupResponseSchema,
  TwitterUserSchema,
  // Types
  type ValidatedOAuth3Config,
  VerifiableCredentialSchema,
  validateConfig,
  validateResponse,
} from './validation.js'
