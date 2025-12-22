'use client'

/**
 * Protocol Tokens Hook
 * Provides token metadata and utilities for the bazaar
 */

import { useCallback, useMemo } from 'react'
import { type Address } from 'viem'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
  logoUri?: string
  logoUrl?: string
  chainId?: number
  priceUSD?: number
}

// Known protocol tokens
const PROTOCOL_TOKENS: Record<string, TokenInfo> = {
  '0x0000000000000000000000000000000000000000': {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    priceUSD: 3500,
  },
  // Add more tokens as needed
}

export function useProtocolTokens() {
  const getToken = useCallback((address: string): TokenInfo | undefined => {
    const normalizedAddress = address.toLowerCase()
    return PROTOCOL_TOKENS[normalizedAddress]
  }, [])

  const tokens = useMemo(() => Object.values(PROTOCOL_TOKENS), [])
  
  // Bridgeable tokens are the same as protocol tokens for now
  const bridgeableTokens = useMemo(() => Object.values(PROTOCOL_TOKENS), [])

  return {
    tokens,
    bridgeableTokens,
    getToken,
  }
}
