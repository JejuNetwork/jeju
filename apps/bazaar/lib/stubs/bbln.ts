/**
 * BBLN Token Integration Stub
 *
 * Provides placeholder types and values for BBLN token integration.
 * Replace with actual babylon package imports when available.
 */

import type { Address } from 'viem'

export interface BBLNContractAddresses {
  token: Address
  presale: Address
}

export const BBLN_ADDRESSES: Record<string, BBLNContractAddresses> = {
  mainnet: {
    token: '0x0000000000000000000000000000000000000000',
    presale: '0x0000000000000000000000000000000000000000',
  },
  testnet: {
    token: '0x0000000000000000000000000000000000000000',
    presale: '0x0000000000000000000000000000000000000000',
  },
}

export const BBLN_TOKEN = {
  name: 'Babylon',
  symbol: 'BBLN',
  decimals: 18,
}

export const BBLN_TOKEN_ABI = [] as const
export const BBLN_PRESALE_ABI = [] as const

export function getBBLNAddresses(network: string): BBLNContractAddresses {
  return BBLN_ADDRESSES[network] ?? BBLN_ADDRESSES.mainnet
}

export function getBBLNHomeChainId(): number {
  return 1 // Ethereum mainnet
}

export function isBBLNDeployed(network: string): boolean {
  return network in BBLN_ADDRESSES
}
