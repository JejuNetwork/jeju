import {
  expectAddress,
  expectBigInt,
  expectChainId,
  expectHex,
} from '@jejunetwork/types'
import { useQueries, useQuery } from '@tanstack/react-query'
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
import { expectNonEmpty, expectSchema, requireDefined } from '../lib/validation'
import { chains, getChain } from '../sdk/chains'
import { TransactionSchema, WalletAccountSchema } from '../sdk/schemas'
import type { TokenBalance, Transaction, WalletAccount } from '../sdk/types'
import { oracleService } from '../services'

export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { data: balanceData } = useBalance({ address })

  const [accounts, setAccounts] = useState<WalletAccount[]>([])
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>(
    [],
  )

  useEffect(() => {
    if (address && chainId) {
      expectAddress(address, 'address')
      expectChainId(chainId, 'chainId')

      const account: WalletAccount = {
        id: address,
        label: 'Primary Account',
        evmAccounts: [{ address, type: 'eoa', chainId, isDefault: true }],
        solanaAccounts: [],
        smartAccounts: [],
      }

      // Validate the account structure
      expectSchema(account, WalletAccountSchema, 'wallet account')
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

const balanceQueryKeys = {
  all: ['balances'] as const,
  multiChain: (address: string) =>
    [...balanceQueryKeys.all, 'multiChain', address] as const,
  prices: (symbols: string[]) =>
    [...balanceQueryKeys.all, 'prices', symbols.sort().join(',')] as const,
}

async function fetchChainBalance(
  chainId: number,
  chain: (typeof chains)[keyof typeof chains],
  address: Address,
): Promise<{ chainId: number; chain: typeof chain; balance: bigint }> {
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
    throw new Error('Invalid RPC response: missing result field')
  }

  const balanceStr = typeof data.result === 'string' ? data.result : '0'
  const balance = expectBigInt(balanceStr, 'balance')
  return { chainId, chain, balance }
}

export function useMultiChainBalances(address?: Address) {
  // Fetch balances from all chains in parallel
  const chainQueries = useQueries({
    queries: Object.entries(chains).map(([id, chain]) => ({
      queryKey: [...balanceQueryKeys.multiChain(address ?? ''), id],
      queryFn: () => fetchChainBalance(Number(id), chain, address as Address),
      enabled: !!address,
      staleTime: 30_000,
      retry: 1,
    })),
  })

  // Collect symbols for price fetching
  const symbolsToFetch = useMemo(() => {
    const symbols = new Set<string>()
    for (const query of chainQueries) {
      if (query.data?.balance && query.data.balance > 0n) {
        symbols.add(query.data.chain.nativeCurrency.symbol)
      }
    }
    return Array.from(symbols)
  }, [chainQueries])

  // Fetch prices for tokens with balances
  const { data: prices = new Map() } = useQuery({
    queryKey: balanceQueryKeys.prices(symbolsToFetch),
    queryFn: async () => oracleService.getTokenPrices(symbolsToFetch),
    enabled: symbolsToFetch.length > 0,
    staleTime: 30_000,
  })

  // Build balance list with USD values
  const balances = useMemo((): BalanceWithUsd[] => {
    const result: BalanceWithUsd[] = []
    for (const query of chainQueries) {
      if (query.data?.balance && query.data.balance > 0n) {
        const { chainId, chain, balance } = query.data
        const symbol = chain.nativeCurrency.symbol
        const price = prices.get(symbol) || 0
        const amount = Number(balance) / 1e18

        result.push({
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
    return result
  }, [chainQueries, prices])

  const isLoading = chainQueries.some((q) => q.isLoading)
  const error = chainQueries.find((q) => q.error)?.error?.message ?? null

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

  const refetch = useCallback(() => {
    for (const query of chainQueries) {
      query.refetch()
    }
  }, [chainQueries])

  return {
    balances,
    aggregatedBalances,
    totalUsdValue,
    isLoading,
    error,
    refetch,
  }
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
