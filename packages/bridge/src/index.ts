/**
 * @jejunetwork/zksolbridge
 *
 * Permissionless Solana↔EVM ZK Light Client Interoperability Layer
 *
 * This package provides trustless cross-chain interoperability between
 * EVM chains (Ethereum, Base, Arbitrum, Optimism, BSC) and Solana using
 * zero-knowledge proofs for verification. No intermediaries, just math.
 *
 * Key Components:
 * - Solana Light Client on EVM (verified by ZK proofs of consensus)
 * - EVM Light Client on Solana (verified by ZK proofs of sync committee)
 * - Cross-Chain Token Bridge (burn/mint or lock/unlock)
 * - TEE Batching for efficient proof generation
 * - Self-hosted proving infrastructure
 * - Relayer service for orchestrating cross-chain transfers
 * - Health monitoring and metrics
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export * from "./types/index.js";

// =============================================================================
// CLIENT EXPORTS
// =============================================================================

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

// =============================================================================
// ROUTER EXPORTS
// =============================================================================

export {
	// Router
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
	// CCIP
	createCCIPAdapter,
	CCIPAdapter,
	type CCIPTransferRequest,
	type CCIPTransferResult,
	CCIP_CHAIN_SELECTORS,
	CCIP_ROUTERS,
	// Arbitrage
	createArbitrageDetector,
	ArbitrageDetector,
	type ArbOpportunity,
	type ArbRoute,
	type PriceQuote,
} from "./router/index.js";

// =============================================================================
// TEE EXPORTS
// =============================================================================

export {
	// Types
	type AttestationRequest,
	type AttestationResponse,
	type AttestationVerification,
	type AWSNitroConfig,
	// AWS Nitro provider
	AWSNitroProvider,
	createAWSNitroProvider,
	// GCP Confidential provider
	createGCPConfidentialProvider,
	// Mock provider (local dev)
	createMockProvider,
	// Phala provider (optional)
	createPhalaClient,
	// Batcher
	createTEEBatcher,
	// TEE Manager (unified interface)
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

// =============================================================================
// PROVER EXPORTS
// =============================================================================

export {
	createSP1Client,
	type ProofRequest,
	type ProofResult,
	SP1Client,
	type SP1Config,
} from "./prover/index.js";

// =============================================================================
// RELAYER EXPORTS
// =============================================================================

export {
	createRelayerService,
	type EVMChainConfig,
	type RelayerConfig,
	RelayerService,
	type SolanaChainConfig,
} from "./relayer/index.js";

// =============================================================================
// MONITORING EXPORTS
// =============================================================================

export {
	type ComponentHealth,
	createHealthChecker,
	type HealthCheckConfig,
	HealthChecker,
	healthPlugin,
	type Metrics,
	type SystemHealth,
} from "./monitoring/index.js";

// =============================================================================
// LOCAL DEVELOPMENT
// =============================================================================

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

// =============================================================================
// VERSION
// =============================================================================

export const VERSION = "0.1.0";
