/**
 * Local Development Configuration for ZK Bridge
 */

import type { BridgeConfig, ChainId, ChainRPCConfig, ProverConfig, TEEBatchingConfig } from "../types/index.js";

export interface LocalChainConfig {
	evm: {
		chainId: number;
		rpcUrl: string;
		wsUrl: string;
		privateKeys: string[];
		blockTime: number;
	};
	solana: {
		rpcUrl: string;
		wsUrl: string;
		keypairPath: string;
		slotTime: number;
	};
}

export const LOCAL_CHAIN_CONFIG: LocalChainConfig = {
	evm: {
		chainId: 31337,
		rpcUrl: "http://127.0.0.1:8545",
		wsUrl: "ws://127.0.0.1:8545",
		privateKeys: [
			"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
			"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
			"0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
		],
		blockTime: 1,
	},
	solana: {
		rpcUrl: "http://127.0.0.1:8899",
		wsUrl: "ws://127.0.0.1:8900",
		keypairPath: "~/.config/solana/id.json",
		slotTime: 400,
	},
};

export interface LocalDeployedContracts {
	groth16Verifier: string;
	solanaLightClient: string;
	crossChainBridge: string;
	crossChainToken: string;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export let LOCAL_DEPLOYED_CONTRACTS: LocalDeployedContracts = {
	groth16Verifier: ZERO_ADDR,
	solanaLightClient: ZERO_ADDR,
	crossChainBridge: ZERO_ADDR,
	crossChainToken: ZERO_ADDR,
};

export function setLocalDeployedContracts(contracts: LocalDeployedContracts): void {
	LOCAL_DEPLOYED_CONTRACTS = contracts;
}

export function areLocalContractsDeployed(): boolean {
	return Object.values(LOCAL_DEPLOYED_CONTRACTS).every((addr) => addr !== ZERO_ADDR);
}

export interface LocalSolanaPrograms {
	evmLightClient: string;
	tokenBridge: string;
	crossChainToken: string;
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export let LOCAL_SOLANA_PROGRAMS: LocalSolanaPrograms = {
	evmLightClient: SYSTEM_PROGRAM,
	tokenBridge: SYSTEM_PROGRAM,
	crossChainToken: SYSTEM_PROGRAM,
};

export function setLocalSolanaPrograms(programs: LocalSolanaPrograms): void {
	LOCAL_SOLANA_PROGRAMS = programs;
}

export function areLocalSolanaProgramsDeployed(): boolean {
	return Object.values(LOCAL_SOLANA_PROGRAMS).every((id) => id !== SYSTEM_PROGRAM);
}

export const LOCAL_TEE_CONFIG: TEEBatchingConfig = {
	maxBatchSize: 10,
	maxBatchWaitMs: 5000,
	minBatchSize: 1,
	targetCostPerItem: BigInt(1000000000000000),
	teeEndpoint: "http://127.0.0.1:8080/tee",
};

export const LOCAL_PROVER_CONFIG: ProverConfig = {
	mode: "self-hosted",
	workers: 2,
	maxMemoryMb: 8192,
	timeoutMs: 300000,
	programPaths: {
		ed25519Aggregation: "./circuits/ed25519/target/release/ed25519_aggregation",
		solanaConsensus: "./circuits/consensus/target/release/solana_consensus",
		ethereumConsensus: "./circuits/ethereum/target/release/ethereum_consensus",
		tokenTransfer: "./circuits/state/target/release/token_transfer",
	},
};

export function getLocalBridgeConfig(): BridgeConfig {
	const chains: ChainRPCConfig[] = [
		{
			chainId: 31337 as ChainId,
			rpcUrl: LOCAL_CHAIN_CONFIG.evm.rpcUrl,
			wsUrl: LOCAL_CHAIN_CONFIG.evm.wsUrl,
			commitment: "finalized",
			confirmations: 1,
		},
		{
			chainId: 104 as ChainId,
			rpcUrl: LOCAL_CHAIN_CONFIG.solana.rpcUrl,
			wsUrl: LOCAL_CHAIN_CONFIG.solana.wsUrl,
			commitment: "finalized",
			confirmations: 1,
		},
	];

	return {
		chains,
		lightClients: new Map<ChainId, Uint8Array>(),
		bridges: new Map<ChainId, Uint8Array>(),
		teeBatching: LOCAL_TEE_CONFIG,
		prover: LOCAL_PROVER_CONFIG,
	};
}

export interface TestToken {
	name: string;
	symbol: string;
	decimals: number;
	initialSupply: bigint;
	evmAddress?: string;
	solanaMint?: string;
}

export const TEST_TOKENS: TestToken[] = [
	{ name: "Test USD Coin", symbol: "USDC", decimals: 6, initialSupply: BigInt(1000000000000) },
	{ name: "Test Wrapped Ether", symbol: "WETH", decimals: 18, initialSupply: BigInt(10000) * BigInt(10 ** 18) },
	{ name: "Test Cross Chain Token", symbol: "XCT", decimals: 18, initialSupply: BigInt(100000000) * BigInt(10 ** 18) },
];

export interface GenesisState {
	solana: {
		slot: bigint;
		bankHash: Uint8Array;
		epoch: bigint;
		epochStakesRoot: Uint8Array;
		totalStake: bigint;
	};
	ethereum: {
		slot: bigint;
		beaconRoot: Uint8Array;
		executionStateRoot: Uint8Array;
		syncCommitteeRoot: Uint8Array;
	};
}

export function getLocalGenesisState(): GenesisState {
	return {
		solana: {
			slot: BigInt(0),
			bankHash: new Uint8Array(32).fill(1),
			epoch: BigInt(0),
			epochStakesRoot: new Uint8Array(32).fill(2),
			totalStake: BigInt(1000000000000000),
		},
		ethereum: {
			slot: BigInt(0),
			beaconRoot: new Uint8Array(32).fill(3),
			executionStateRoot: new Uint8Array(32).fill(4),
			syncCommitteeRoot: new Uint8Array(32).fill(5),
		},
	};
}

export interface MockValidator {
	pubkey: Uint8Array;
	stake: bigint;
	voteAccount: Uint8Array;
}

export function generateMockValidators(count: number): MockValidator[] {
	const totalStake = BigInt(1000000000000000);
	const stakePerValidator = totalStake / BigInt(count);

	return Array.from({ length: count }, (_, i) => {
		const pubkey = new Uint8Array(32);
		const voteAccount = new Uint8Array(32);
		for (let j = 0; j < 32; j++) {
			pubkey[j] = (i * 7 + j * 13) % 256;
			voteAccount[j] = (i * 11 + j * 17) % 256;
		}
		return { pubkey, stake: stakePerValidator, voteAccount };
	});
}

export const MOCK_VALIDATORS = generateMockValidators(10);
