import { Address } from 'viem'
import { EvmChainIds, SolanaNetworkIds } from '../config/multi-chain'

export type ChainType = 'evm' | 'solana'

export interface TokenBase {
  id: string
  chainType: ChainType
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  imageUrl?: string
  description?: string
  website?: string
  twitter?: string
  telegram?: string
  discord?: string
  createdAt: Date
  createdBy: string
  verified: boolean
  scamWarning: boolean
}

export interface EvmToken extends TokenBase {
  chainType: 'evm'
  chainId: EvmChainIds
  contractAddress: Address
  totalSupply: bigint
  marketCap?: bigint
  liquidity?: bigint
  priceUsd?: number
  price24hChange?: number
  volume24h?: bigint
  holders?: number
  bondingCurve?: {
    virtualReserves: bigint
    realReserves: bigint
    progress: number // 0-100
    graduated: boolean
    graduationTarget: bigint
  }
}

export interface SolanaToken extends TokenBase {
  chainType: 'solana'
  networkId: SolanaNetworkIds
  mint: string
  totalSupply: bigint
  marketCap?: bigint
  priceUsd?: number
  volume24h?: bigint
}

export type Token = EvmToken | SolanaToken

export interface TokenMetadata {
  name: string
  symbol: string
  description?: string
  imageUrl?: string
  website?: string
  twitter?: string
  telegram?: string
  discord?: string
}

export interface TokenTrade {
  id: string
  tokenId: string
  trader: string
  isBuy: boolean
  tokenAmount: bigint
  ethAmount: bigint
  pricePerToken: bigint
  timestamp: Date
  transactionHash: string
  blockNumber: number
}

export interface TokenHolder {
  address: string
  balance: bigint
  percentage: number
  firstPurchase: Date
  isCreator: boolean
  labels: string[]
}

export interface CreateTokenParams {
  chainType: ChainType
  chainId: EvmChainIds | SolanaNetworkIds
  metadata: TokenMetadata
  initialSupply?: bigint
  bondingCurveEnabled?: boolean
  aiGenerated?: boolean
}

export interface TokenListFilter {
  chain?: ChainType
  chainId?: EvmChainIds | SolanaNetworkIds
  verified?: boolean
  graduated?: boolean
  search?: string
  sortBy?: 'newest' | 'marketcap' | 'volume' | 'holders'
  sortOrder?: 'asc' | 'desc'
}



