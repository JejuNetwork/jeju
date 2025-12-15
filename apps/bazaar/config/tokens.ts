import { Address } from 'viem'

export interface TokenInfo {
  address: Address | string
  name: string
  symbol: string
  decimals: number
  isNative?: boolean
  logoUrl?: string
  tags?: string[]
  description?: string
  priceUSD?: number
  hasPaymaster?: boolean
}

// Client-safe token configuration
export const TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: '0x0000000000000000000000000000000000000000',
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
    isNative: true,
    hasPaymaster: true,
  },
  WETH: {
    address: process.env.NEXT_PUBLIC_WETH_ADDRESS || '0x4200000000000000000000000000000000000006',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    hasPaymaster: true,
  },
  JEJU: {
    address: process.env.NEXT_PUBLIC_JEJU_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
    name: 'Jeju',
    symbol: 'JEJU',
    decimals: 18,
    hasPaymaster: true,
    description: 'Native governance token',
  },
  USDC: {
    address: process.env.NEXT_PUBLIC_USDC_ADDRESS || '0x0000000000000000000000000000000000000000',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    hasPaymaster: true,
  },
}

export const NATIVE_TOKEN: TokenInfo = TOKENS.ETH
export const WRAPPED_NATIVE: TokenInfo = TOKENS.WETH
export const PREFERRED_TOKEN: TokenInfo | undefined = TOKENS.JEJU

export function getPreferredToken(): TokenInfo | undefined {
  return TOKENS.JEJU || Object.values(TOKENS).find(t => t.hasPaymaster)
}

export function getPaymasterTokensSorted(): TokenInfo[] {
  return getPaymasterTokens().sort((a, b) => {
    if (a.symbol === 'JEJU') return -1
    if (b.symbol === 'JEJU') return 1
    return 0
  })
}

export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  return TOKENS[symbol]
}

export function getTokenByAddress(address: string): TokenInfo | undefined {
  return Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
}

export function getAllTokens(): TokenInfo[] {
  return Object.values(TOKENS)
}

export function getPaymasterTokens(): TokenInfo[] {
  return getAllTokens().filter(t => t.hasPaymaster)
}

export function isTokenDeployed(token: TokenInfo): boolean {
  if (!token.address) return false
  if (typeof token.address !== 'string') return false
  return !token.address.startsWith('TBD_') && token.address !== '0x'
}

export function getDeployedTokens(): TokenInfo[] {
  return getAllTokens().filter(isTokenDeployed)
}
