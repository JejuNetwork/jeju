/**
 * Test Data and Constants for Gateway Synpress Tests
 */

export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';
export const RPC_URL = 'http://127.0.0.1:9545';

/**
 * Test wallet (Hardhat default account #0)
 */
export const TEST_WALLET = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

/**
 * Secondary test wallet (Hardhat account #1)
 */
export const TEST_WALLET_2 = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
};

/**
 * Protocol tokens
 */
export const PROTOCOL_TOKENS = {
  ELIZAOS: {
    symbol: 'elizaOS',
    name: 'elizaOS Token',
    decimals: 18,
    priceUSD: 0.10,
    bridgeable: false,
  },
  CLANKER: {
    symbol: 'CLANKER',
    name: 'tokenbot',
    decimals: 18,
    priceUSD: 26.14,
    bridgeable: true,
    l1Address: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb',
  },
  VIRTUAL: {
    symbol: 'VIRTUAL',
    name: 'Virtuals Protocol',
    decimals: 18,
    priceUSD: 1.85,
    bridgeable: true,
    l1Address: '0x44ff8620b8cA30902395A7bD3F2407e1A091BF73',
  },
  CLANKERMON: {
    symbol: 'CLANKERMON',
    name: 'Clankermon',
    decimals: 18,
    priceUSD: 0.15,
    bridgeable: true,
    l1Address: '0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5',
  },
};

/**
 * Test amounts
 */
export const TEST_AMOUNTS = {
  ETH: {
    SMALL: '0.1',
    MEDIUM: '1.0',
    LARGE: '10.0',
  },
  TOKEN: {
    SMALL: '100',
    MEDIUM: '1000',
    LARGE: '10000',
  },
  NODE_STAKE_USD: '1000', // Minimum stake in USD
};

/**
 * Geographic regions
 */
export const REGIONS = {
  NORTH_AMERICA: 0,
  SOUTH_AMERICA: 1,
  EUROPE: 2,
  ASIA: 3,
  AFRICA: 4,
  OCEANIA: 5,
};

/**
 * Underserved regions (get +50% bonus)
 */
export const UNDERSERVED_REGIONS = [REGIONS.AFRICA, REGIONS.SOUTH_AMERICA];

/**
 * Test RPC URLs for node registration
 */
export const TEST_RPC_URLS = {
  VALID: 'https://node.example.com:8545',
  INVALID: 'not-a-url',
  UNREACHABLE: 'https://unreachable.example.com:8545',
};

/**
 * App registry tags
 */
export const REGISTRY_TAGS = {
  APP: 'app',
  GAME: 'game',
  MARKETPLACE: 'marketplace',
  DEFI: 'defi',
  SOCIAL: 'social',
  INFO_PROVIDER: 'info-provider',
  SERVICE: 'service',
};

/**
 * Test app data
 */
export const TEST_APP = {
  name: 'E2E Test App',
  description: 'Test application for E2E testing',
  a2aEndpoint: 'http://localhost:4003/a2a',
  tags: [REGISTRY_TAGS.GAME, REGISTRY_TAGS.SOCIAL],
};

/**
 * Moderation report types
 */
export const REPORT_TYPES = {
  NETWORK_BAN: 0,
  APP_BAN: 1,
  LABEL_HACKER: 2,
  LABEL_SCAMMER: 3,
};

/**
 * Severity levels
 */
export const SEVERITY = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Report bonds (in ETH)
 */
export const REPORT_BONDS = {
  [SEVERITY.LOW]: '0.001',
  [SEVERITY.MEDIUM]: '0.01',
  [SEVERITY.HIGH]: '0.05',
  [SEVERITY.CRITICAL]: '0.1',
};

/**
 * Reputation tiers
 */
export const REPUTATION_TIERS = {
  NONE: 0,
  SMALL: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Tier stakes (in ETH)
 */
export const TIER_STAKES = {
  [REPUTATION_TIERS.NONE]: '0',
  [REPUTATION_TIERS.SMALL]: '0.001',
  [REPUTATION_TIERS.MEDIUM]: '0.01',
  [REPUTATION_TIERS.HIGH]: '0.1',
};

/**
 * Time constants
 */
export const TIME = {
  ONE_MINUTE: 60,
  ONE_HOUR: 3600,
  ONE_DAY: 86400,
  ONE_WEEK: 604800,
  ONE_MONTH: 2592000,
};

/**
 * Fee margins (in basis points)
 */
export const FEE_MARGINS = {
  MIN: 0,
  DEFAULT: 100, // 1%
  MAX: 500, // 5%
};

/**
 * Storage duration options (in months)
 */
export const STORAGE_DURATIONS = {
  ONE_MONTH: 1,
  SIX_MONTHS: 6,
  ONE_YEAR: 12,
};

/**
 * Test file for upload
 */
export const TEST_FILE = {
  name: 'test-evidence.txt',
  content: 'This is test evidence for E2E testing',
  size: 37, // bytes
};

/**
 * Gas limits
 */
export const GAS_LIMITS = {
  SIMPLE_TX: 100000,
  TOKEN_APPROVAL: 50000,
  PAYMASTER_DEPLOY: 3000000,
  BRIDGE: 200000,
};

/**
 * Timeouts for different operations
 */
export const TIMEOUTS = {
  QUICK: 5000,
  NORMAL: 15000,
  TRANSACTION: 30000,
  DEPLOYMENT: 90000,
  BRIDGE: 120000,
};

/**
 * Screenshot paths
 */
export function getScreenshotPath(testName: string, step: string): string {
  return `test-results/screenshots/${testName}/${step}.png`;
}

/**
 * Calculate required stake in token for $1000 USD
 */
export function calculateStakeAmount(tokenPriceUSD: number, targetUSD: number = 1000): string {
  const amount = targetUSD / tokenPriceUSD;
  return amount.toFixed(2);
}

/**
 * Calculate required app registry stake (0.001 ETH worth ≈ $3.50)
 */
export function calculateRegistryStake(tokenPriceUSD: number, ethPrice: number = 3500): string {
  const targetUSD = 0.001 * ethPrice; // 0.001 ETH worth
  const amount = targetUSD / tokenPriceUSD;
  return amount.toFixed(6);
}

/**
 * Test node data
 */
export const TEST_NODE = {
  stakeAmount: calculateStakeAmount(PROTOCOL_TOKENS.ELIZAOS.priceUSD), // $1000 worth
  rpcUrl: TEST_RPC_URLS.VALID,
  region: REGIONS.AFRICA, // +50% bonus
};

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Generate random address (for testing)
 */
export function randomAddress(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `0x${hex}`;
}

/**
 * Format wei to ETH string
 */
export function formatWei(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}

/**
 * Parse ETH string to wei
 */
export function parseEth(eth: string): bigint {
  const [whole, decimal = ''] = eth.split('.');
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * BigInt(1e18) + BigInt(paddedDecimal.padEnd(18, '0'));
}


