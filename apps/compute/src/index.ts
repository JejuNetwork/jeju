/**
 * @jejunetwork/compute - Decentralized AI Compute Marketplace
 *
 * Permissionless AI inference with ERC-8004 integration.
 * NO API KEYS. NO LOGINS. WALLET SIGNATURE ONLY.
 *
 * Production code uses:
 * - Arweave for permanent storage (wallet-signed)
 * - AES-256-GCM for encryption (Web Crypto API)
 * - secp256k1 for signatures (Ethereum-compatible)
 * - Jeju Compute Marketplace for TEE inference (Ethereum)
 *
 * Target chains: Anvil (local) → Sepolia → Ethereum Mainnet
 *
 * @see src/compute/scripts/demo.ts - Run the compute marketplace demo
 * @see src/compute/scripts/join-network.ts - Join as a provider
 */

// ============================================================================
// PRODUCTION EXPORTS (100% PERMISSIONLESS)
// ============================================================================

// Compute Marketplace Types
export type {
  AttestationReport,
  AuthHeaders,
  BanRecord,
  Capability,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ComputeResources,
  CreateRentalParams,
  GPUType,
  HardwareInfo,
  InferenceRequest,
  InferenceResponse,
  Ledger,
  ModelConfig,
  ModerationSDKConfig,
  NodeMetrics,
  Provider,
  ProviderConfig,
  ProviderResourcesInfo,
  ProviderSubAccount,
  Rental,
  RentalStatus,
  ResourcePricing,
  SDKConfig,
  Service,
  Settlement,
  Stake,
} from './compute/index.js';

// Compute Marketplace (Jeju integrated)
export {
  // SDK
  JejuComputeSDK,
  // Node
  ComputeNodeServer,
  countTokens,
  createInferenceEngine,
  createModerationSDK,
  createSDK,
  detectHardware,
  formatHardwareInfo,
  generateHardwareHash,
  generateSimulatedAttestation,
  getAttestationHash,
  isAttestationFresh,
  MockInferenceEngine,
  ModerationSDK,
  OllamaInferenceEngine,
  GPUTypeEnum,
  RentalStatusEnum,
  StakeType,
  startComputeNode,
  verifyAttestation,
} from './compute/index.js';

// Contract types
export type {
  ContractEvent,
  ContractSystem,
  GameConfig as ContractGameConfig,
  GameEvent,
  GameState as ContractGameState,
  GovernanceState,
  KeyRotationRequest,
  SecurityCouncilState,
  StakeInfo,
  StakingState,
} from './contracts/index.js';

// Cryptography (real, Web Crypto API)
export * from './crypto/index.js';

// Game logic
export {
  type AgentConfig,
  type AgentState,
  AIAgent,
  AITrainer,
  type GameConfig,
  GameEnvironment,
  type GameSession,
  type PatternType,
  type PredictionResult,
  type RoundResult,
  type TrainingConfig,
  type TrainingCycleResult,
  type TrainingSample,
} from './game/index.js';

// Infrastructure (real blockchain clients)
export {
  AttestationClient,
  BlockchainClient,
  type BlockchainConfig,
  type BootstrapConfig,
  type BootstrappedGame,
  bootstrap,
  type ChainId,
  createPhalaGateway,
  type DeploymentConfig,
  DStackClient,
  ENSDeployer,
  ENSRegistrar,
  type GameStatus,
  type GatewayConfig,
  OnChainAttestationClient,
  type OperatorInfo,
  PhalaGateway,
  type PhalaNode,
  ProductionTEEEnclave,
  type ProvisionRequest,
  type RegistrationResult,
} from './infra/index.js';

// Protocol (PBTS-aligned)
export {
  type AggregatedReceipts,
  aggregateReceipts,
  type Commitment,
  CommitRevealManager,
  createReceipt,
  type DHTAnnouncement,
  DHTFallbackManager,
  type PeerInfo,
  ReceiptManager,
  type Reveal,
  type TransferReceipt,
  type VerificationReport,
  VerifierClient,
  verifyReceipt,
} from './protocol/index.js';

// Storage (100% permissionless - wallet signatures only)
export {
  ArweaveStorage,
  type ArweaveStorageConfig,
  createArweaveOnlyStorage,
  createDecentralizedStorage,
  createDevnetStorage,
  createHybridStorage,
  createLocalIPFSStorage,
  createMainnetStorage,
  createPermissionlessStorage,
  DecentralizedStorage,
  type DecentralizedStorageConfig,
  FileStorage,
  type FileStorageConfig,
  PermissionlessStorage,
  type PermissionlessStorageConfig,
  type StateCheckpoint,
  StateManager,
  type StateManagerConfig,
  type Storage,
  type StorageStats,
  type TrainingDataset,
  type UploadOptions,
  type UploadResult,
} from './storage/index.js';

// TEE (simulated locally, real via Phala dstack)
export {
  type AttestationQuote,
  type EnclaveConfig,
  type EnclaveState,
  formatQuoteForDisplay,
  generateQuote,
  type SealedData,
  type SignedMessage,
  type SignedTransaction,
  setExpectedMeasurement,
  TEEEnclave,
  TEEKeystore,
  TEEWallet,
  type VerificationResult as AttestationVerificationResult,
  verifyQuote,
} from './tee/index.js';
