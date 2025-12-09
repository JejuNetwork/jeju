import { Address } from 'viem'
import tokenConfig from '@jejunetwork/config/tokens'

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

export const TOKENS: Record<string, TokenInfo> = tokenConfig.tokens as Record<string, TokenInfo>

export const NATIVE_TOKEN: TokenInfo = TOKENS.ETH

export const WRAPPED_NATIVE: TokenInfo = TOKENS.WETH

export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  return TOKENS[symbol]
}

export function getTokenByAddress(address: string): TokenInfo | undefined {
  return Object.values(TOKENS).find(
    (token) => token.address.toLowerCase() === address.toLowerCase()
  )
}

export function getAllTokens(): TokenInfo[] {
  return Object.values(TOKENS)
}

export function getPaymasterTokens(): TokenInfo[] {
  return getAllTokens().filter((token) => token.hasPaymaster)
}

export function isTokenDeployed(token: TokenInfo): boolean {
  if (!token.address) return false
  if (typeof token.address !== 'string') return false
  return !token.address.startsWith('TBD_') && token.address !== '0x'
}

export function getDeployedTokens(): TokenInfo[] {
  return getAllTokens().filter(isTokenDeployed)
}

