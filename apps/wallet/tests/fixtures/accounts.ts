/**
 * Test Accounts and Keys
 * 
 * Standard test accounts derived from the common test mnemonic.
 * NEVER use these in production.
 */

// Standard test mnemonic (DO NOT use in production)
export const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
export const TEST_PASSWORD = 'TestPassword123_';

// Derived accounts from standard test mnemonic
export const TEST_ACCOUNTS = {
  // Account 0 (default) - same as dev wallet
  primary: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
  },
  // Account 1
  secondary: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
  },
  // Account 2
  third: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const,
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const,
  },
} as const;

// Network configurations for testing
export const TEST_NETWORKS = {
  // network localnet (default for E2E)
  jeju: {
    chainId: 1337,
    name: 'Jeju Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
    symbol: 'ETH',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    symbol: 'ETH',
    blockExplorer: 'https://sepolia.basescan.org',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    symbol: 'ETH',
    blockExplorer: 'https://basescan.org',
  },
} as const;

// Test tokens on Base
export const TEST_TOKENS = {
  usdc: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
    symbol: 'USDC',
    decimals: 6,
  },
  weth: {
    address: '0x4200000000000000000000000000000000000006' as const,
    symbol: 'WETH',
    decimals: 18,
  },
} as const;

export type TestAccount = typeof TEST_ACCOUNTS.primary;
export type TestNetwork = typeof TEST_NETWORKS.jeju;
