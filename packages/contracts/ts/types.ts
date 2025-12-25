/**
 * @fileoverview Contract types for network smart contracts
 * @module @jejunetwork/contracts/types
 */

import { isValidAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Abi, Address } from 'viem'

export { ZERO_ADDRESS, isValidAddress }

export type NetworkName = 'localnet' | 'testnet' | 'mainnet'

export type ChainId = 31337 | 420690 | 420691 | 11155111 | 1

export const CHAIN_IDS = {
  localnet: 31337,
  anvil: 31337,
  testnet: 420690,
  testnetL2: 420691,
  sepolia: 11155111,
  mainnetL1: 1,
} as const

export const NETWORK_BY_CHAIN_ID: Record<ChainId, NetworkName> = {
  31337: 'localnet',
  420690: 'testnet',
  420691: 'testnet',
  11155111: 'testnet',
  1: 'mainnet',
}

export interface ContractABI {
  address?: Address
  abi: Abi
}

export type DeploymentFile =
  | 'uniswap-v4-31337'
  | 'uniswap-v4-420691'
  | 'bazaar-marketplace-31337'
  | 'erc20-factory-31337'
  | 'identity-system-31337'
  | 'localnet-addresses'
  | 'paymaster-system-localnet'
  | 'multi-token-system-31337'
  | 'eil-localnet'
  | 'eil-testnet'
  | 'predimarket-31337'
