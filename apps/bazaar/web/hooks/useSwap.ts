/**
 * useSwap Hook
 * Provides token swap functionality using XLPRouter for same-chain swaps
 * Falls back to direct token transfers when router isn't available
 */

import { getContract } from '@jejunetwork/config'
import { useCallback, useEffect, useState } from 'react'
import { type Address, erc20Abi, formatUnits } from 'viem'
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CHAIN_ID, NETWORK } from '../config'

// Safe contract getter that returns undefined instead of throwing
function safeGetContract(
  category: string,
  name: string,
  network: string,
): string | undefined {
  try {
    const result = getContract(
      category as 'amm' | 'tokens',
      name,
      network as 'localnet' | 'testnet' | 'mainnet',
    )
    return result && result !== '' ? result : undefined
  } catch {
    return undefined
  }
}

// XLP Router ABI - minimal interface for swaps
const XLP_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokensV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokensV2',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETHV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'quoteForRouter',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'poolType', type: 'uint8' },
      { name: 'fee', type: 'uint24' },
    ],
  },
] as const

export interface SwapToken {
  symbol: string
  name: string
  address: Address
  decimals: number
  logoUrl?: string
}

export interface SwapQuote {
  inputAmount: bigint
  outputAmount: bigint
  priceImpact: number
  fee: number
  route: Address[]
}

export type SwapStatus =
  | 'idle'
  | 'quoting'
  | 'approving'
  | 'swapping'
  | 'success'
  | 'error'

// Native ETH token
const ETH_TOKEN: SwapToken = {
  symbol: 'ETH',
  name: 'Ether',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
}

// Zero address for comparison
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function useSwapRouter() {
  const routerAddress = safeGetContract('amm', 'XLPRouter', NETWORK) as
    | Address
    | undefined
  const wethAddress = safeGetContract('tokens', 'weth', NETWORK) as
    | Address
    | undefined

  return {
    routerAddress,
    wethAddress,
    isAvailable: !!routerAddress,
  }
}

export function useSwap() {
  const { address: userAddress, chain } = useAccount()
  const publicClient = usePublicClient()
  const {
    routerAddress,
    wethAddress,
    isAvailable: routerAvailable,
  } = useSwapRouter()

  const [status, setStatus] = useState<SwapStatus>('idle')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    writeContract,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const isCorrectChain = chain?.id === CHAIN_ID

  // Update status based on transaction state
  useEffect(() => {
    if (isPending) setStatus('swapping')
    else if (isConfirming) setStatus('swapping')
    else if (isSuccess) setStatus('success')
  }, [isPending, isConfirming, isSuccess])

  // Get quote for a swap
  const getQuote = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: bigint,
    ): Promise<SwapQuote | null> => {
      if (!publicClient || !routerAddress || amountIn <= 0n) {
        return null
      }

      setStatus('quoting')
      setError(null)

      // Determine actual addresses (use WETH for native ETH)
      const inputAddress =
        tokenIn.address === ZERO_ADDRESS ? wethAddress : tokenIn.address
      const outputAddress =
        tokenOut.address === ZERO_ADDRESS ? wethAddress : tokenOut.address

      if (!inputAddress || !outputAddress) {
        setError('WETH not configured')
        setStatus('idle')
        return null
      }

      const [amountOut, , fee] = await publicClient.readContract({
        address: routerAddress,
        abi: XLP_ROUTER_ABI,
        functionName: 'quoteForRouter',
        args: [inputAddress, outputAddress, amountIn],
      })

      // Calculate price impact (simplified)
      const inputValue = Number(formatUnits(amountIn, tokenIn.decimals))
      const outputValue = Number(formatUnits(amountOut, tokenOut.decimals))
      const priceImpact =
        inputValue > 0 ? Math.abs((1 - outputValue / inputValue) * 100) : 0

      const newQuote: SwapQuote = {
        inputAmount: amountIn,
        outputAmount: amountOut,
        priceImpact,
        fee: Number(fee) / 10000, // Convert bps to percentage
        route: [inputAddress, outputAddress],
      }

      setQuote(newQuote)
      setStatus('idle')
      return newQuote
    },
    [publicClient, routerAddress, wethAddress],
  )

  // Execute swap
  const executeSwap = useCallback(
    async (
      tokenIn: SwapToken,
      tokenOut: SwapToken,
      amountIn: bigint,
      slippageBps: number = 50, // 0.5% default
    ) => {
      if (!userAddress || !routerAddress || !publicClient) {
        setError('Wallet not connected or router not available')
        return
      }

      setStatus('swapping')
      setError(null)

      // Get fresh quote
      const currentQuote = await getQuote(tokenIn, tokenOut, amountIn)
      if (!currentQuote) {
        setError('Failed to get quote')
        setStatus('error')
        return
      }

      // Calculate minimum output with slippage
      const minOutput =
        (currentQuote.outputAmount * BigInt(10000 - slippageBps)) / 10000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800) // 30 minutes

      const isETHIn = tokenIn.address === ZERO_ADDRESS
      const isETHOut = tokenOut.address === ZERO_ADDRESS

      // Approve token if not ETH
      if (!isETHIn) {
        setStatus('approving')
        const allowance = await publicClient.readContract({
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddress, routerAddress],
        })

        if (allowance < amountIn) {
          writeContract({
            address: tokenIn.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [routerAddress, amountIn],
          })
          return // Will continue after approval
        }
      }

      // Execute swap based on token types
      setStatus('swapping')

      if (isETHIn && !isETHOut) {
        // ETH -> Token
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactETHForTokensV2',
          args: [minOutput, currentQuote.route, userAddress, deadline],
          value: amountIn,
        })
      } else if (!isETHIn && isETHOut) {
        // Token -> ETH
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactTokensForETHV2',
          args: [
            amountIn,
            minOutput,
            currentQuote.route,
            userAddress,
            deadline,
          ],
        })
      } else {
        // Token -> Token
        writeContract({
          address: routerAddress,
          abi: XLP_ROUTER_ABI,
          functionName: 'swapExactTokensForTokensV2',
          args: [
            amountIn,
            minOutput,
            currentQuote.route,
            userAddress,
            deadline,
          ],
        })
      }
    },
    [userAddress, routerAddress, publicClient, writeContract, getQuote],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setQuote(null)
    setError(null)
    resetWrite()
  }, [resetWrite])

  return {
    // State
    status,
    quote,
    error,
    txHash,
    isCorrectChain,
    routerAvailable,

    // Actions
    getQuote,
    executeSwap,
    reset,
  }
}

export function useSwapTokens() {
  const [tokens, setTokens] = useState<SwapToken[]>([ETH_TOKEN])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadTokens() {
      setIsLoading(true)
      const loadedTokens: SwapToken[] = [ETH_TOKEN]
      const tokenAddresses = new Set<string>([ZERO_ADDRESS]) // Track addresses to avoid duplicates

      // Always add JEJU token from CONTRACTS if available (same as Coins page)
      try {
        const { CONTRACTS } = await import('../config')
        if (CONTRACTS.jeju && CONTRACTS.jeju !== '0x0000000000000000000000000000000000000000') {
          const { createPublicClient, http } = await import('viem')
          const { erc20Abi } = await import('viem')
          const { RPC_URL } = await import('../config')
          const rpcUrl = typeof window !== 'undefined' ? '/api/rpc' : RPC_URL
          const client = createPublicClient({ transport: http(rpcUrl) })

          try {
            const [name, symbol, decimals] = await Promise.all([
              client.readContract({
                address: CONTRACTS.jeju,
                abi: erc20Abi,
                functionName: 'name',
              }),
              client.readContract({
                address: CONTRACTS.jeju,
                abi: erc20Abi,
                functionName: 'symbol',
              }),
              client.readContract({
                address: CONTRACTS.jeju,
                abi: erc20Abi,
                functionName: 'decimals',
              }),
            ])

            loadedTokens.push({
              symbol: symbol as string,
              name: name as string,
              address: CONTRACTS.jeju,
              decimals: decimals as number,
            })
            tokenAddresses.add(CONTRACTS.jeju.toLowerCase())
          } catch {
            // JEJU token contract error - skip
          }
        }
      } catch {
        // CONTRACTS import failed - continue
      }

      // Try to fetch tokens from indexer
      try {
        const response = await fetch('/api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `
              query GetSwapTokens {
                tokens(limit: 50, orderBy: createdAt_DESC) {
                  address
                  name
                  symbol
                  decimals
                  logoUrl
                  liquidityUSD
                }
              }
            `,
          }),
        })

        if (response.ok) {
          const json = await response.json()
          const indexerTokens = (json.data?.tokens ?? []) as Array<{
            address: string
            name: string
            symbol: string
            decimals: number
            logoUrl?: string
            liquidityUSD?: number
          }>

          // Include all tokens from indexer (avoid duplicates)
          for (const t of indexerTokens) {
            const addr = t.address.toLowerCase()
            if (!tokenAddresses.has(addr)) {
              loadedTokens.push({
                symbol: t.symbol,
                name: t.name,
                address: t.address as Address,
                decimals: t.decimals,
                logoUrl: t.logoUrl,
              })
              tokenAddresses.add(addr)
            }
          }
        }
      } catch (error) {
        // Indexer failed, will try seed-state fallback
        console.debug('[Swap] Indexer query failed, trying seed-state fallback')
      }

      // Always try seed-state to get BZRT, MEME, DEGEN (even if indexer returned tokens)
      try {
        const seedResponse = await fetch('/api/seed-state')
        if (seedResponse.ok) {
          const seedState = await seedResponse.json()
          if (seedState.coins && Array.isArray(seedState.coins)) {
            // Load token details from RPC for each seeded token
            const { createPublicClient, http } = await import('viem')
            const { erc20Abi } = await import('viem')
            const { RPC_URL } = await import('../config')
            const rpcUrl = typeof window !== 'undefined' ? '/api/rpc' : RPC_URL
            const client = createPublicClient({ transport: http(rpcUrl) })

            for (const coin of seedState.coins) {
              if (coin.address && coin.address !== '0x0000000000000000000000000000000000000000') {
                const addr = coin.address.toLowerCase()
                // Skip if already added
                if (tokenAddresses.has(addr)) continue

                try {
                  const [name, symbol, decimals] = await Promise.all([
                    client.readContract({
                      address: coin.address as Address,
                      abi: erc20Abi,
                      functionName: 'name',
                    }),
                    client.readContract({
                      address: coin.address as Address,
                      abi: erc20Abi,
                      functionName: 'symbol',
                    }),
                    client.readContract({
                      address: coin.address as Address,
                      abi: erc20Abi,
                      functionName: 'decimals',
                    }),
                  ])

                  loadedTokens.push({
                    symbol: symbol as string,
                    name: name as string,
                    address: coin.address as Address,
                    decimals: decimals as number,
                  })
                  tokenAddresses.add(addr)
                } catch {
                  // Token contract error - skip
                }
              }
            }
          }
        }
      } catch {
        // Seed-state fetch failed - continue with what we have
      }

      setTokens(loadedTokens)
      setIsLoading(false)
    }

    loadTokens()
  }, [])

  return { tokens, isLoading }
}

// Export ETH token for convenience
export { ETH_TOKEN }
