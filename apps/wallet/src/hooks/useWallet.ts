import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import {
  expectAddress,
  expectBigInt,
  expectChainId,
  expectHex,
  expectNonEmpty,
  expectSchema,
  requireDefined,
} from '../lib/validation'
import { chains, getChain } from '../sdk/chains'
import { TransactionSchema, UnifiedAccountSchema } from '../sdk/schemas'
import type { TokenBalance, Transaction, UnifiedAccount } from '../sdk/types'
import { oracleService } from '../services'

// Token prices cache (simple in-memory)
const priceCache = new Map<string, { price: number; timestamp: number }>()
const PRICE_CACHE_TTL = 30_000

export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { data: balanceData } = useBalance({ address })

  const [accounts, setAccounts] = useState<UnifiedAccount[]>([])
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>(
    [],
  )

  useEffect(() => {
    if (address && chainId) {
      expectAddress(address, 'address')
      expectChainId(chainId, 'chainId')

      const account: UnifiedAccount = {
        id: address,
        label: 'Primary Account',
        evmAccounts: [{ address, type: 'eoa', chainId, isDefault: true }],
        solanaAccounts: [],
        smartAccounts: [],
      }

      // Validate the account structure
      expectSchema(account, UnifiedAccountSchema, 'unified account')
      setAccounts([account])
    } else {
      setAccounts([])
    }
  }, [address, chainId])

  const chain = useMemo(
    () => (chainId ? getChain(chainId) : undefined),
    [chainId],
  )

  const connectWallet = useCallback(
    (connectorId?: string) => {
      const connector = connectorId
        ? connectors.find((c) => c.id === connectorId)
        : connectors[0]
      if (!connector) throw new Error('No connector available')
      connect({ connector })
    },
    [connect, connectors],
  )

  const signMessage = useCallback(
    async (message: string): Promise<Hex> => {
      expectNonEmpty(message, 'message')
      const client = requireDefined(walletClient, 'walletClient')
      const signature = await client.signMessage({ message })
      expectHex(signature, 'signature')
      return signature
    },
    [walletClient],
  )

  const sendTransaction = useCallback(
    async (params: {
      to: Address
      value?: bigint
      data?: Hex
    }): Promise<Hex> => {
      const client = requireDefined(walletClient, 'walletClient')
      expectAddress(params.to, 'params.to')
      if (params.data) {
        expectHex(params.data, 'params.data')
      }

      const value = params.value ?? 0n
      expectBigInt(value, 'params.value')

      const hash = await client.sendTransaction({
        to: params.to,
        value,
        data: params.data,
      })

      expectHex(hash, 'transaction hash')
      const currentChainId = requireDefined(chainId, 'chainId')
      const currentAddress = requireDefined(address, 'address')
      expectChainId(currentChainId, 'chainId')

      const transaction: Transaction = {
        id: hash,
        hash,
        chainId: currentChainId,
        from: currentAddress,
        to: params.to,
        value,
        data: params.data,
        status: 'submitted',
        timestamp: Date.now(),
      }

      expectSchema(transaction, TransactionSchema, 'transaction')
      setRecentTransactions((prev) => [transaction, ...prev.slice(0, 19)])

      return hash
    },
    [walletClient, chainId, address],
  )

  const supportedChains = useMemo(
    () =>
      Object.values(chains).map((c) => ({
        id: c.id,
        name: c.name,
        testnet: c.testnet ?? false,
        eilSupported: c.eilSupported,
        oifSupported: c.oifSupported,
      })),
    [],
  )

  return {
    isConnected,
    isConnecting,
    address,
    chainId,
    chain,
    balance: balanceData?.value,
    accounts,
    recentTransactions,
    connectors,
    supportedChains,
    connect: connectWallet,
    disconnect,
    switchChain: useCallback(
      (targetChainId: number) => {
        expectChainId(targetChainId, 'targetChainId')
        if (!chains[targetChainId]) {
          throw new Error(`Chain ${targetChainId} not supported`)
        }
        switchChain({ chainId: targetChainId })
      },
      [switchChain],
    ),
    signMessage,
    sendTransaction,
    walletClient,
    publicClient,
  }
}

interface BalanceWithUsd extends TokenBalance {
  usdValue: number
}

interface AggregatedBalance {
  symbol: string
  totalBalance: bigint
  totalUsdValue: number
  chains: Array<{
    token: TokenBalance['token']
    balance: bigint
    usdValue: number
  }>
}

export function useMultiChainBalances(address?: Address) {
  const [balances, setBalances] = useState<BalanceWithUsd[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBalances = useCallback(async () => {
    if (!address) return
    expectAddress(address, 'address')
    setIsLoading(true)
    setError(null)

    const newBalances: BalanceWithUsd[] = []

    // Fetch all balances in parallel
    const results = await Promise.allSettled(
      Object.entries(chains).map(async ([id, chain]) => {
        const chainId = Number(id)
        expectChainId(chainId, 'chainId')
        expectNonEmpty(chain.rpcUrls.default.http[0], 'rpcUrl')

        const response = await fetch(chain.rpcUrls.default.http[0], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getBalance',
            params: [address, 'latest'],
          }),
        })

        if (!response.ok) {
          throw new Error(
            `RPC request failed: ${response.status} ${response.statusText}`,
          )
        }

        const data = await response.json()
        if (!data || typeof data !== 'object' || !('result' in data)) {
          throw new Error(`Invalid RPC response: missing result field`)
        }

        const balanceStr = typeof data.result === 'string' ? data.result : '0'
        const balance = expectBigInt(balanceStr, 'balance')
        return { chainId, chain, balance }
      }),
    )

    // Get prices for native tokens
    const symbols = new Set<string>()
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.balance > 0n) {
        symbols.add(result.value.chain.nativeCurrency.symbol)
      }
    }

    const prices = await getTokenPrices(Array.from(symbols))

    // Build balance list with USD values
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.balance > 0n) {
        const { chainId, chain, balance } = result.value
        const symbol = chain.nativeCurrency.symbol
        const price = prices.get(symbol) || 0
        const amount = Number(balance) / 1e18

        newBalances.push({
          token: {
            address: '0x0000000000000000000000000000000000000000' as Address,
            chainId,
            symbol,
            name: chain.nativeCurrency.name,
            decimals: chain.nativeCurrency.decimals,
            isNative: true,
          },
          balance,
          usdValue: amount * price,
        })
      }
    }

    setBalances(newBalances)
    setIsLoading(false)
  }, [address])

  useEffect(() => {
    fetchBalances()
  }, [fetchBalances])

  const aggregatedBalances = useMemo((): AggregatedBalance[] => {
    const bySymbol = new Map<string, BalanceWithUsd[]>()
    for (const b of balances) {
      const arr = bySymbol.get(b.token.symbol) ?? []
      arr.push(b)
      bySymbol.set(b.token.symbol, arr)
    }
    return Array.from(bySymbol.entries()).map(([symbol, tokens]) => ({
      symbol,
      totalBalance: tokens.reduce((sum, t) => sum + t.balance, 0n),
      totalUsdValue: tokens.reduce((sum, t) => sum + t.usdValue, 0),
      chains: tokens.map((t) => ({
        token: t.token,
        balance: t.balance,
        usdValue: t.usdValue,
      })),
    }))
  }, [balances])

  const totalUsdValue = useMemo(
    () => aggregatedBalances.reduce((sum, a) => sum + a.totalUsdValue, 0),
    [aggregatedBalances],
  )

  return {
    balances,
    aggregatedBalances,
    totalUsdValue,
    isLoading,
    error,
    refetch: fetchBalances,
  }
}

// Helper to get prices with caching
async function getTokenPrices(symbols: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const toFetch: string[] = []

  for (const symbol of symbols) {
    const cached = priceCache.get(symbol)
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      result.set(symbol, cached.price)
    } else {
      toFetch.push(symbol)
    }
  }

  if (toFetch.length > 0) {
    const prices = await oracleService.getTokenPrices(toFetch)
    for (const [symbol, price] of prices) {
      result.set(symbol, price)
      priceCache.set(symbol, { price, timestamp: Date.now() })
    }
  }

  return result
}

// Format USD value for display
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value > 0) return `$${value.toFixed(4)}`
  return '$0.00'
}

// Format token amount for display
export function formatTokenAmount(amount: bigint, decimals = 18): string {
  const value = Number(amount) / 10 ** decimals
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(4)
  if (value > 0) return value.toFixed(6)
  return '0'
}
