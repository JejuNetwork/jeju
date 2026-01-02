// Browser polyfills MUST be imported first before any other modules
import './polyfills'

/**
 * @jejunetwork/auth
 *
 * Fully decentralized OAuth3 authentication with:
 * - TEE-backed key management (dstack CVM or Phala CVM)
 * - FROST threshold MPC signing (2-of-3 by default)
 * - Cross-chain identity support via Open Intents
 * - JNS integration for app/identity resolution
 * - Decentralized storage (IPFS) for sessions and credentials
 * - Compute marketplace integration for TEE node discovery
 * - W3C Verifiable Credentials for identity attestations
 * - DID (Decentralized Identity) management
 * - Gas sponsorship via Paymaster
 *
 * Deployment modes:
 * - localnet: Local development with simulated TEE (chain 420691)
 * - testnet: Jeju Testnet with real TEE (chain 420690)
 * - mainnet: Jeju Mainnet production (chain 420692)
 */

// Multi-tenant Council
export {
  type CouncilAgentConfig,
  type CouncilDeployment,
  createMultiTenantCouncilManager,
  type DirectorConfig,
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
// DID (Decentralized Identity)
export {
  type AuthMethod,
  type CreateIdentityResult,
  createDID,
  createDIDFromAddress,
  type DID,
  type DIDDocument,
  DIDManager,
  type DIDManagerConfig,
  DIDNetwork,
  didEquals,
  extractAddressFromDID,
  generateRandomDID,
  getNetwork,
  isLocalnet,
  isMainnet,
  isTestnet,
  type ParsedDID,
  parseDID,
  type VerificationMethod,
  validateDID,
} from './did/index.js'
// DWS Worker (decentralized deployment)
export {
  createOAuth3Worker,
  type OAuth3Worker,
  type OAuth3WorkerConfig,
} from './dws-worker/index.js'
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
// Cross-chain Identity (Open Intents)
export {
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
export {
  type BackupOptions,
  createKeyBackupManager,
  type KeyBackup,
  KeyBackupManager,
  KeyBackupSchema,
} from './mfa/key-backup.js'
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
// Paymaster (Gas Sponsorship)
export {
  createGasEstimator,
  createTreasuryPaymaster,
  type GasEstimate,
  GasEstimator,
  type GasEstimatorConfig,
  type PaymasterConfig,
  type PaymasterData,
  type PaymasterDecision,
  type SponsorshipPolicy,
  type SponsorshipResult,
  TreasuryPaymaster,
  type UserOperation,
  type UserSponsorshipState,
} from './paymaster/index.js'
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
// React SDK
export {
  ConnectedAccount,
  type ConnectedAccountProps,
  type LinkedAccount,
  LoginButton,
  type LoginButtonProps,
  LoginModal,
  type LoginModalProps,
  MFASetup,
  type MFASetupProps,
  type OAuth3ContextValue,
  OAuth3Provider,
  OAuth3Provider as JejuAuthProvider,
  type OAuth3ProviderProps,
  type TypedDataParams,
  type UseCredentialsReturn,
  type UseJejuAuthReturn,
  type UseJejuWalletReturn,
  type UseLoginOptions,
  type UseLoginReturn,
  type UseMFAOptions,
  type UseMFAReturn,
  type UseSessionReturn,
  useCredentials,
  useJejuAuth,
  useJejuWallet,
  useLogin,
  useMFA,
  useOAuth3,
  useOAuth3Client,
  useSession,
} from './react/index.js'
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
// Core types
export * from './types.js'
// PKCE utilities
export {
  generateCodeChallenge,
  generateCodeVerifier,
  generatePKCE,
  type PKCEParams,
  PKCEParamsSchema,
  validatePKCEState,
} from './utils/pkce.js'
// Validation (Zod schemas and utilities)
export {
  AddressSchema,
  AuthCallbackDataSchema,
  Bytes32Schema,
  base64urlToArrayBuffer,
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
  // Core schemas
  HexSchema,
  IPFSAddResponseSchema,
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
  type PasskeyPublicKeyOptions,
  SignResponseSchema,
  safeParseJson,
  TEEAttestationSchema,
  TOTPSetupResponseSchema,
  TwitterUserSchema,
  toWebAuthnCreationOptions,
  toWebAuthnRequestOptions,
  // Types
  type ValidatedOAuth3Config,
  VerifiableCredentialSchema,
  validateConfig,
  validateResponse,
} from './validation.js'
