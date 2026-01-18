/**
 * @jejunetwork/zksolbridge - Permissionless Solana↔EVM ZK Bridge
 * @packageDocumentation
 */

export {
  createHyperliquidClient,
  HyperliquidClient,
  type HyperliquidClientConfig,
  hyperliquidChain,
} from './clients/hyperliquid-client.js'

export {
  createEVMClient,
  createSolanaClient,
  EVMClient,
  type EVMClientConfig,
  SolanaClient,
  type SolanaClientConfig,
} from './clients/index.js'
export {
  createSolanaNetworkRegistry,
  establishSolanaTrust,
  type NetworkContracts,
  type NetworkRegistryConfig,
  registerSolanaNetworks,
  type SolanaNetworkConfig,
  type SolanaNetworkInfo,
  SolanaNetworkRegistry,
  TrustTier,
} from './federation/index.js'
export {
  type CrossChainIdentityLink,
  createFederatedIdentityBridge,
  type FederatedAgent,
  FederatedIdentityBridge,
  type FederatedIdentityConfig,
  type SolanaAgent,
} from './identity/index.js'
export {
  type GenesisState,
  getLocalBridgeConfig,
  getLocalGenesisState,
  LOCAL_CHAIN_CONFIG,
  LOCAL_PROVER_CONFIG,
  LOCAL_TEE_CONFIG,
  type LocalChainConfig,
  type LocalDeployedContracts,
  type LocalSolanaPrograms,
  MOCK_VALIDATORS,
  type MockValidator,
  TEST_TOKENS,
  type TestToken,
} from './local-dev/config.js'
export {
  type ComponentHealth,
  createHealthChecker,
  type HealthCheckConfig,
  HealthChecker,
  healthPlugin,
  type Metrics,
  type SystemHealth,
} from './monitoring/index.js'
export {
  type BridgeRequest as NFTBridgeRequest,
  BridgeStatus as NFTBridgeStatus,
  type CrossChainNFT,
  createNFTBridgeService,
  type NFTBridgeConfig,
  NFTBridgeService,
  type SolanaNFTMetadata,
} from './nft/index.js'
export {
  createSP1Client,
  type ProofRequest,
  type ProofResult,
  SP1Client,
  type SP1Config,
} from './prover/index.js'
export {
  createRelayerService,
  type EVMChainConfig,
  type RelayerConfig,
  RelayerService,
  type SolanaChainConfig,
} from './relayer/index.js'
export {
  ArbitrageDetector,
  type ArbOpportunity,
  type ArbRoute,
  ASTER_CONTRACTS,
  BridgeMechanism,
  type BridgeProvider,
  type BridgeRoute,
  CCIP_CHAIN_SELECTORS,
  CCIP_ROUTERS,
  CCIPAdapter,
  type CCIPTransferRequest,
  type CCIPTransferResult,
  type ChainInfo,
  ChainType,
  CrossChainRouter,
  createArbitrageDetector,
  createCCIPAdapter,
  createMultiBridgeRouter,
  createRouter,
  createWormholeAdapter,
  type MultiBridgeConfig,
  MultiBridgeRouter,
  type PriceQuote,
  type Route,
  type RouteRequest,
  type RouterConfig,
  type RouteStep,
  SUPPORTED_CHAINS,
  WormholeAdapter,
  type WormholeConfig,
  type WormholeTransferParams,
  type WormholeTransferResult,
  type WormholeVAA,
} from './router/index.js'
export {
  type AttestationRequest,
  type AttestationResponse,
  type AttestationVerification,
  createGCPConfidentialProvider,
  createMockProvider,
  createPhalaClient,
  createTEEBatcher,
  createTEEManager,
  type GCPConfidentialConfig,
  GCPConfidentialProvider,
  getTEEManager,
  type ITEEProvider,
  MockTEEProvider,
  type PhalaAttestationRequest,
  type PhalaAttestationResponse,
  type PhalaBatchAttestation,
  PhalaClient,
  type PhalaConfig,
  resetTEEManager,
  TEEBatcher,
  type TEECapability,
  type TEEEnvironment,
  TEEManager,
  type TEEProvider,
  type TEEProviderConfig,
} from './tee/index.js'
export * from './types/index.js'
export { SolanaHealthResponseSchema } from './utils/validation.js'
export {
  createXLPService,
  type FillRequest,
  getEvmTokenAddress,
  getSolanaTokenMint,
  isSolanaChain,
  type LiquidityPosition,
  type RouteStats,
  type XLPConfig,
  XLPService,
  type XLPStats,
} from './xlp/index.js'

export const VERSION = '0.1.0'
