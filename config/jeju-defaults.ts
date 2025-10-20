/**
 * Jeju Network Default Configuration
 * 
 * This is the SINGLE SOURCE OF TRUTH for all Jeju network configuration.
 * All scripts, tests, and apps MUST import from here.
 * 
 * Philosophy: Everything defaults to Jeju localnet for testing.
 * External networks (Base, Ethereum, etc.) require explicit configuration.
 */

export const JEJU_CHAIN_IDS = {
	/** Jeju Mainnet - Production network */
	MAINNET: 420691,

	/** Jeju Testnet - Public test network */
	TESTNET: 420690,

	/** Jeju Localnet (Kurtosis) - Development network using Kurtosis */
	LOCALNET_KURTOSIS: 1337,

	/** Jeju Localnet (Standalone) - Development network using standalone node/Anvil configured as Jeju */
	LOCALNET_STANDALONE: 420691,
} as const;

export const JEJU_RPC_URLS = {
	/** Mainnet RPC (production) */
	MAINNET: process.env.JEJU_MAINNET_RPC_URL || 'https://rpc.jeju.network',

	/** Testnet RPC (public testing) */
	TESTNET: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',

	/** Localnet RPC (local development) - dynamically detected */
	LOCALNET: process.env.JEJU_RPC_URL || 'http://127.0.0.1:8545',

	/** Localnet RPC fallback port (if Kurtosis uses different port) */
	LOCALNET_ALT: 'http://127.0.0.1:9545',
} as const;

export const JEJU_EXPLORERS = {
	MAINNET: 'https://explorer.jeju.network',
	TESTNET: 'https://testnet-explorer.jeju.network',
	LOCALNET: 'http://localhost:4000', // Local block explorer if running
} as const;

export const JEJU_WS_URLS = {
	MAINNET: 'wss://ws.jeju.network',
	TESTNET: 'wss://testnet-ws.jeju.network',
	LOCALNET: undefined, // WebSocket not typically used in localnet
} as const;

/**
 * Default network for all local testing
 * Override with JEJU_NETWORK env var
 */
export function getDefaultJejuNetwork(): 'mainnet' | 'testnet' | 'localnet' {
	const network = process.env.JEJU_NETWORK || process.env.NEXT_PUBLIC_JEJU_NETWORK || 'localnet';
	if (network === 'mainnet' || network === 'testnet' || network === 'localnet') {
		return network;
	}
	console.warn(`⚠️  Invalid JEJU_NETWORK: ${network}, defaulting to localnet`);
	return 'localnet';
}

/**
 * Get Jeju chain ID for current network
 */
export function getJejuChainId(): number {
	const network = getDefaultJejuNetwork();
	switch (network) {
		case 'mainnet':
			return JEJU_CHAIN_IDS.MAINNET;
		case 'testnet':
			return JEJU_CHAIN_IDS.TESTNET;
		case 'localnet':
			// Default to Kurtosis chain ID, can be overridden
			return parseInt(process.env.CHAIN_ID || String(JEJU_CHAIN_IDS.LOCALNET_KURTOSIS));
	}
}

/**
 * Get Jeju RPC URL for current network
 */
export function getJejuRpcUrl(): string {
	const network = getDefaultJejuNetwork();
	switch (network) {
		case 'mainnet':
			return JEJU_RPC_URLS.MAINNET;
		case 'testnet':
			return JEJU_RPC_URLS.TESTNET;
		case 'localnet':
			return process.env.JEJU_RPC_URL || JEJU_RPC_URLS.LOCALNET;
	}
}

/**
 * Check if a chain ID is a valid Jeju chain
 */
export function isJejuChainId(chainId: number): boolean {
	return (Object.values(JEJU_CHAIN_IDS) as number[]).includes(chainId);
}

/**
 * Get network name from chain ID
 */
export function getJejuNetworkName(chainId: number): string {
	switch (chainId) {
		case JEJU_CHAIN_IDS.MAINNET:
			return 'Jeju Mainnet';
		case JEJU_CHAIN_IDS.TESTNET:
			return 'Jeju Testnet';
		case JEJU_CHAIN_IDS.LOCALNET_KURTOSIS:
			return 'Jeju Localnet (Kurtosis)';
		case JEJU_CHAIN_IDS.LOCALNET_STANDALONE:
			return 'Jeju Localnet';
		default:
			return `Unknown Jeju Network (${chainId})`;
	}
}

/**
 * Jeju localnet default accounts (same as Anvil/Hardhat defaults)
 * These are PUBLIC test accounts - NEVER use in production
 */
export const JEJU_LOCALNET_ACCOUNTS = {
	DEPLOYER: {
		address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
		privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
		name: 'Deployer (Test Account #0)',
	},
	USER1: {
		address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
		privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
		name: 'User 1 (Test Account #1)',
	},
	USER2: {
		address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
		privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
		name: 'User 2 (Test Account #2)',
	},
	USER3: {
		address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
		privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
		name: 'User 3 (Test Account #3)',
	},
} as const;

/**
 * Native currency for all Jeju networks
 */
export const JEJU_NATIVE_CURRENCY = {
	name: 'Ether',
	symbol: 'ETH',
	decimals: 18,
} as const;

/**
 * Export everything as default config
 */
export const JejuConfig = {
	CHAIN_IDS: JEJU_CHAIN_IDS,
	RPC_URLS: JEJU_RPC_URLS,
	EXPLORERS: JEJU_EXPLORERS,
	WS_URLS: JEJU_WS_URLS,
	LOCALNET_ACCOUNTS: JEJU_LOCALNET_ACCOUNTS,
	NATIVE_CURRENCY: JEJU_NATIVE_CURRENCY,
	getDefaultNetwork: getDefaultJejuNetwork,
	getChainId: getJejuChainId,
	getRpcUrl: getJejuRpcUrl,
	isJejuChainId,
	getNetworkName: getJejuNetworkName,
} as const;

export default JejuConfig;

