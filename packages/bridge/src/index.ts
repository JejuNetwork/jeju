/**
 * @jejunetwork/zksolbridge - Permissionless Solana↔EVM ZK Bridge
 * @packageDocumentation
 */

export * from "./types/index.js";

export {
	createEVMClient,
	createSolanaClient,
	EVMClient,
	type EVMClientConfig,
	SolanaClient,
	type SolanaClientConfig,
} from "./clients/index.js";

export {
	createHyperliquidClient,
	HyperliquidClient,
	type HyperliquidClientConfig,
	hyperliquidChain,
} from "./clients/hyperliquid-client.js";

export {
	createRouter,
	CrossChainRouter,
	type RouterConfig,
	type Route,
	type RouteRequest,
	type RouteStep,
	type ChainInfo,
	ChainType,
	BridgeMechanism,
	SUPPORTED_CHAINS,
	ASTER_CONTRACTS,
	createCCIPAdapter,
	CCIPAdapter,
	type CCIPTransferRequest,
	type CCIPTransferResult,
	CCIP_CHAIN_SELECTORS,
	CCIP_ROUTERS,
	createArbitrageDetector,
	ArbitrageDetector,
	type ArbOpportunity,
	type ArbRoute,
	type PriceQuote,
	createWormholeAdapter,
	WormholeAdapter,
	type WormholeConfig,
	type WormholeTransferParams,
	type WormholeTransferResult,
	type WormholeVAA,
	createMultiBridgeRouter,
	MultiBridgeRouter,
	type MultiBridgeConfig,
	type BridgeRoute,
	type BridgeProvider,
} from "./router/index.js";

export {
	type AttestationRequest,
	type AttestationResponse,
	type AttestationVerification,
	type AWSNitroConfig,
	AWSNitroProvider,
	createAWSNitroProvider,
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
} from "./tee/index.js";

export {
	createSP1Client,
	type ProofRequest,
	type ProofResult,
	SP1Client,
	type SP1Config,
} from "./prover/index.js";

export {
	createRelayerService,
	type EVMChainConfig,
	type RelayerConfig,
	RelayerService,
	type SolanaChainConfig,
} from "./relayer/index.js";

export {
	createXLPService,
	XLPService,
	type XLPConfig,
	type LiquidityPosition,
	type FillRequest,
	type RouteStats,
	type XLPStats,
	isSolanaChain,
	getSolanaTokenMint,
	getEvmTokenAddress,
} from "./xlp/index.js";

export {
	FederatedIdentityBridge,
	createFederatedIdentityBridge,
	type FederatedIdentityConfig,
	type SolanaAgent,
	type FederatedAgent,
	type CrossChainIdentityLink,
} from "./identity/index.js";

export {
	NFTBridgeService,
	createNFTBridgeService,
	type NFTBridgeConfig,
	type BridgeRequest as NFTBridgeRequest,
	type SolanaNFTMetadata,
	type CrossChainNFT,
	BridgeStatus as NFTBridgeStatus,
} from "./nft/index.js";

export {
	SolanaNetworkRegistry,
	createSolanaNetworkRegistry,
	registerSolanaNetworks,
	establishSolanaTrust,
	type NetworkRegistryConfig,
	type SolanaNetworkConfig,
	type NetworkContracts,
	type SolanaNetworkInfo,
	TrustTier,
} from "./federation/index.js";

export {
	type ComponentHealth,
	createHealthChecker,
	type HealthCheckConfig,
	HealthChecker,
	healthPlugin,
	type Metrics,
	type SystemHealth,
} from "./monitoring/index.js";

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
} from "./local-dev/config.js";

export const VERSION = "0.1.0";
