import { Address } from 'viem'
import tokenList from '../../../config/jeju-tokens.json'

export interface TokenInfo {
  address: Address | string
  name: string
  symbol: string
  decimals: number
  isNative?: boolean
  logoUrl?: string
  tags?: string[]
  description?: string
}

export const TOKENS: Record<string, TokenInfo> = tokenList.tokens as Record<string, TokenInfo>

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

export function isTokenDeployed(token: TokenInfo): boolean {
  return !token.address.startsWith('TBD_')
}

export function getDeployedTokens(): TokenInfo[] {
  return getAllTokens().filter(isTokenDeployed)
}

