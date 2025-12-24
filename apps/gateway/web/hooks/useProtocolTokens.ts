import { useMemo } from 'react'
import {
  getPaymasterTokens,
  getPreferredToken,
  getProtocolTokens,
  type ProtocolToken,
} from '../../lib/tokens'

export type { ProtocolToken }

export function useProtocolTokens() {
  const tokens = useMemo(() => getProtocolTokens(), [])

  const tokensBySymbol = useMemo(() => {
    const map = new Map<string, ProtocolToken>()
    for (const token of tokens) {
      map.set(token.symbol, token)
    }
    return map
  }, [tokens])

  const tokensByAddress = useMemo(() => {
    const map = new Map<string, ProtocolToken>()
    for (const token of tokens) {
      map.set(token.address.toLowerCase(), token)
    }
    return map
  }, [tokens])

  const bridgeableTokens = useMemo(
    () => tokens.filter((t) => t.bridged),
    [tokens],
  )
  const nativeTokens = useMemo(() => tokens.filter((t) => !t.bridged), [tokens])
  const preferredToken = useMemo(() => getPreferredToken(), [])
  const paymasterTokens = useMemo(() => getPaymasterTokens(), [])

  const getToken = (symbolOrAddress: string): ProtocolToken | undefined => {
    return (
      tokensBySymbol.get(symbolOrAddress) ||
      tokensByAddress.get(symbolOrAddress.toLowerCase())
    )
  }

  const getBestPaymentToken = (
    balances: Record<string, bigint>,
  ): ProtocolToken | undefined => {
    if (
      preferredToken &&
      balances[preferredToken.symbol] &&
      balances[preferredToken.symbol] > 0n
    ) {
      return preferredToken
    }
    for (const token of paymasterTokens) {
      if (balances[token.symbol] && balances[token.symbol] > 0n) {
        return token
      }
    }
    return preferredToken
  }

  return {
    tokens,
    bridgeableTokens,
    nativeTokens,
    preferredToken,
    paymasterTokens,
    getToken,
    getBestPaymentToken,
    tokensBySymbol,
    tokensByAddress,
  }
}
