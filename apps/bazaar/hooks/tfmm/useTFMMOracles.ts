'use client'

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits, type Address } from 'viem'
import { useCallback, useMemo } from 'react'

// Oracle Registry ABI
const ORACLE_REGISTRY_ABI = [
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'price', type: 'uint256' }],
  },
  {
    name: 'getPrices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokens', type: 'address[]' }],
    outputs: [{ name: 'prices', type: 'uint256[]' }],
  },
  {
    name: 'isPriceStale',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'stale', type: 'bool' }],
  },
  {
    name: 'getOracleConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'feed', type: 'address' },
      { name: 'heartbeat', type: 'uint256' },
      { name: 'decimals', type: 'uint8' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    name: 'getOracleType',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'oracleType', type: 'uint8' }],
  },
  {
    name: 'getPriceWithValidation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'primaryPrice', type: 'uint256' },
      { name: 'fallbackPrice', type: 'uint256' },
      { name: 'deviation', type: 'uint256' },
      { name: 'isValid', type: 'bool' },
    ],
  },
] as const

export type OracleType = 'pyth' | 'chainlink' | 'twap' | 'custom'

export interface OracleConfig {
  token: Address
  symbol: string
  oracleType: OracleType
  feed: Address
  heartbeat: number
  decimals: number
  active: boolean
  price: bigint
  isStale: boolean
  lastUpdate: number
}

export interface OracleStatus {
  primary: OracleType
  fallback: OracleType | null
  primaryPrice: bigint
  fallbackPrice: bigint
  deviation: number
  isValid: boolean
}

const ORACLE_TYPE_MAP: Record<number, OracleType> = {
  0: 'chainlink',
  1: 'pyth',
  2: 'twap',
  3: 'custom',
}

// Mock oracle data for development
const MOCK_ORACLES: Omit<OracleConfig, 'price' | 'isStale' | 'lastUpdate'>[] = [
  {
    token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    symbol: 'WETH',
    oracleType: 'pyth',
    feed: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6' as Address,
    heartbeat: 3600,
    decimals: 8,
    active: true,
  },
  {
    token: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address,
    symbol: 'WBTC',
    oracleType: 'pyth',
    feed: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6' as Address,
    heartbeat: 3600,
    decimals: 8,
    active: true,
  },
  {
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    symbol: 'USDC',
    oracleType: 'chainlink',
    feed: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6' as Address,
    heartbeat: 86400,
    decimals: 8,
    active: true,
  },
]

export function useTFMMOracles(oracleRegistryAddress: Address | null) {
  // Mock data for development
  const oracles: OracleConfig[] = MOCK_ORACLES.map((oracle) => ({
    ...oracle,
    price: BigInt(oracle.symbol === 'WETH' ? 3000_00000000 : oracle.symbol === 'WBTC' ? 60000_00000000 : 1_00000000),
    isStale: false,
    lastUpdate: Date.now() - 60000,
  }))

  return {
    oracles,
    isLoading: false,
  }
}

export function useOraclePrice(oracleRegistryAddress: Address | null, tokenAddress: Address | null) {
  const { data: price, isLoading, refetch } = useReadContract({
    address: oracleRegistryAddress ?? undefined,
    abi: ORACLE_REGISTRY_ABI,
    functionName: 'getPrice',
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!oracleRegistryAddress && !!tokenAddress,
    },
  })

  return {
    price: price ?? 0n,
    isLoading,
    refetch,
  }
}

export function useOraclePrices(oracleRegistryAddress: Address | null, tokenAddresses: Address[]) {
  const { data: prices, isLoading, refetch } = useReadContract({
    address: oracleRegistryAddress ?? undefined,
    abi: ORACLE_REGISTRY_ABI,
    functionName: 'getPrices',
    args: tokenAddresses.length > 0 ? [tokenAddresses] : undefined,
    query: {
      enabled: !!oracleRegistryAddress && tokenAddresses.length > 0,
    },
  })

  return {
    prices: prices ?? [],
    isLoading,
    refetch,
  }
}

export function useOracleStatus(oracleRegistryAddress: Address | null, tokenAddress: Address | null) {
  const { data, isLoading } = useReadContract({
    address: oracleRegistryAddress ?? undefined,
    abi: ORACLE_REGISTRY_ABI,
    functionName: 'getPriceWithValidation',
    args: tokenAddress ? [tokenAddress] : undefined,
    query: {
      enabled: !!oracleRegistryAddress && !!tokenAddress,
    },
  })

  const status: OracleStatus | null = data
    ? {
        primary: 'pyth',
        fallback: 'chainlink',
        primaryPrice: data[0],
        fallbackPrice: data[1],
        deviation: Number(data[2]),
        isValid: data[3],
      }
    : null

  return {
    status,
    isLoading,
  }
}

export function formatPrice(price: bigint, decimals = 8): string {
  const value = Number(formatUnits(price, decimals))
  if (value >= 1000) {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$${value.toFixed(4)}`
}

export function formatDeviation(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function getOracleTypeIcon(type: OracleType): string {
  switch (type) {
    case 'pyth':
      return '🔮'
    case 'chainlink':
      return '🔗'
    case 'twap':
      return '📊'
    case 'custom':
      return '⚙️'
    default:
      return '❓'
  }
}

export function getOracleTypeName(type: OracleType): string {
  switch (type) {
    case 'pyth':
      return 'Pyth Network'
    case 'chainlink':
      return 'Chainlink'
    case 'twap':
      return 'Uniswap TWAP'
    case 'custom':
      return 'Custom Feed'
    default:
      return 'Unknown'
  }
}

export function getOracleTypeColor(type: OracleType): string {
  switch (type) {
    case 'pyth':
      return 'text-purple-400'
    case 'chainlink':
      return 'text-blue-400'
    case 'twap':
      return 'text-orange-400'
    case 'custom':
      return 'text-gray-400'
    default:
      return 'text-gray-400'
  }
}

