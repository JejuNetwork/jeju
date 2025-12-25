/**
 * Test Data and Constants for Gateway Synpress Tests
 */

import { isValidAddress } from '@jejunetwork/types'

export { isValidAddress }

export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001'
export const RPC_URL = 'http://127.0.0.1:6546'

/**
 * Test wallet (Anvil default account #0)
 */
export const TEST_WALLET = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
} as const

/**
 * Secondary test wallet (Anvil account #1)
 */
export const TEST_WALLET_2 = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
} as const

/**
 * Protocol tokens
 */
export const PROTOCOL_TOKENS = {
  JEJU: {
    symbol: 'JEJU',
    name: 'Network',
    decimals: 18,
    priceUSD: 0.05,
    bridgeable: false,
  },
} as const

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
  NODE_STAKE_USD: '1000',
} as const

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
} as const

/**
 * Underserved regions (get +50% bonus)
 */
export const UNDERSERVED_REGIONS = [
  REGIONS.AFRICA,
  REGIONS.SOUTH_AMERICA,
] as const

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
} as const

/**
 * Fee margins (in basis points)
 */
export const FEE_MARGINS = {
  MIN: 0,
  DEFAULT: 100, // 1%
  MAX: 500, // 5%
} as const

/**
 * Timeouts for different operations
 */
export const TIMEOUTS = {
  QUICK: 5000,
  NORMAL: 15000,
  TRANSACTION: 30000,
  DEPLOYMENT: 90000,
  BRIDGE: 120000,
} as const

/**
 * Generate random address (for testing)
 */
export function randomAddress(): `0x${string}` {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('')
  return `0x${hex}` as `0x${string}`
}

/**
 * Format wei to ETH string
 */
export function formatWei(wei: bigint): string {
  const eth = Number(wei) / 1e18
  return eth.toFixed(4)
}

/**
 * Parse ETH string to wei
 */
export function parseEth(eth: string): bigint {
  const [whole, decimal = ''] = eth.split('.')
  const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18)
  return BigInt(whole) * BigInt(1e18) + BigInt(paddedDecimal)
}

/**
 * Screenshot path helper
 */
export function getScreenshotPath(testName: string, step: string): string {
  return `test-results/screenshots/${testName}/${step}.png`
}
