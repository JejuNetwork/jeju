'use client'

/**
 * Token Registry Hook
 * For managing token metadata
 */

import { useCallback, useMemo } from 'react'
import { useReadContract } from 'wagmi'
import { type Address } from 'viem'

const TOKEN_REGISTRY_ABI = [
  {
    name: 'getTokenInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'symbol', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'decimals', type: 'uint8' },
    ],
  },
] as const

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
}

// Known tokens for fallback
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x0000000000000000000000000000000000000000': {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
  },
}

export function useTokenRegistry() {
  const getTokenInfo = useCallback((address: string): TokenInfo | undefined => {
    const normalizedAddress = address.toLowerCase()
    return KNOWN_TOKENS[normalizedAddress]
  }, [])

  const tokens = useMemo(() => Object.values(KNOWN_TOKENS), [])

  return {
    tokens,
    getTokenInfo,
  }
}
