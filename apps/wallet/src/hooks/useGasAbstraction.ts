/**
 * @fileoverview Gas abstraction hooks
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi'
import { getChainContracts } from '../sdk/chains'
import { EILClient } from '../sdk/eil'
import type { GasOption, TokenBalance } from '../sdk/types'

// ============================================================================
// Hook: useGasOptions
// ============================================================================

export function useGasOptions(tokenBalances: TokenBalance[]) {
  const chainId = useChainId()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [gasOptions, setGasOptions] = useState<GasOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eilClient = useMemo(() => {
    if (!publicClient) return null
    return new EILClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
    })
  }, [chainId, publicClient, walletClient])

  // Fetch gas options for user's tokens
  const fetchGasOptions = useCallback(
    async (estimatedGas: bigint) => {
      if (!eilClient || !address || !publicClient) return

      setIsLoading(true)
      setError(null)

      try {
        const gasPrice = await publicClient.getGasPrice()
        const gasCostETH = estimatedGas * gasPrice

        // Filter tokens on current chain
        const chainBalances = tokenBalances.filter(
          (tb) => tb.token.chainId === chainId,
        )
        const options: GasOption[] = []

        for (const tb of chainBalances) {
          const sponsorCheck = await eilClient.canSponsor(
            gasCostETH,
            tb.token.address,
            address,
          )

          if (sponsorCheck.canSponsor) {
            options.push({
              token: tb.token,
              tokenAmount: sponsorCheck.tokenCost,
              ethEquivalent: gasCostETH,
              usdValue: tb.usdValue ?? 0,
            })
          }
        }

        // Sort by USD value (cheapest first)
        options.sort((a, b) => a.usdValue - b.usdValue)

        // Mark recommended
        if (options.length > 0) {
          options[0].isPreferred = true
          options[0].reason = 'Lowest cost'
        }

        setGasOptions(options)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch gas options')
      } finally {
        setIsLoading(false)
      }
    },
    [eilClient, address, publicClient, tokenBalances, chainId],
  )

  // Get recommended gas token
  const recommendedOption = useMemo(() => {
    return gasOptions.find((o) => o.isPreferred) ?? gasOptions[0]
  }, [gasOptions])

  // Check if can pay with specific token
  const canPayWithToken = useCallback(
    (tokenAddress: Address) => {
      return gasOptions.some((o) => o.token.address === tokenAddress)
    },
    [gasOptions],
  )

  return {
    gasOptions,
    recommendedOption,
    isLoading,
    error,
    fetchGasOptions,
    canPayWithToken,
  }
}

export function useGasPreview(
  tokenAddress: Address | undefined,
  estimatedGas: bigint,
) {
  const chainId = useChainId()
  const publicClient = usePublicClient()

  const [tokenCost, setTokenCost] = useState<bigint>(0n)
  const [isLoading, setIsLoading] = useState(false)

  const eilClient = useMemo(() => {
    if (!publicClient) return null
    return new EILClient({
      chainId,
      publicClient,
    })
  }, [chainId, publicClient])

  useEffect(() => {
    if (!eilClient || !tokenAddress || estimatedGas === 0n || !publicClient)
      return

    const fetchPreview = async () => {
      setIsLoading(true)
      const gasPrice = await publicClient.getGasPrice()
      const cost = await eilClient.previewTokenCost(
        estimatedGas,
        gasPrice,
        tokenAddress,
      )
      setTokenCost(cost)
      setIsLoading(false)
    }

    fetchPreview()
  }, [eilClient, tokenAddress, estimatedGas, publicClient])

  return { tokenCost, isLoading }
}

export function useGasStatus() {
  const chainId = useChainId()
  const { address } = useAccount()
  const publicClient = usePublicClient()

  const [hasGas, setHasGas] = useState(false)
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n)
  const [needsBridge, setNeedsBridge] = useState(false)

  useEffect(() => {
    if (!address || !publicClient) return

    const checkGas = async () => {
      const balance = await publicClient.getBalance({ address })
      setNativeBalance(balance)

      // Consider having gas if balance > 0.001 ETH
      const minGas = 1000000000000000n // 0.001 ETH
      setHasGas(balance >= minGas)
      setNeedsBridge(balance < minGas)
    }

    checkGas()
  }, [address, publicClient])

  return {
    chainId,
    hasGas,
    nativeBalance,
    needsBridge,
  }
}

export function usePaymasterData() {
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const eilClient = useMemo(() => {
    if (!publicClient) return null
    return new EILClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
    })
  }, [chainId, publicClient, walletClient])

  // Build paymaster data for a transaction
  const buildPaymasterData = useCallback(
    (paymentToken: Address, appAddress?: Address) => {
      if (!eilClient) return '0x' as const
      return eilClient.buildPaymasterData(paymentToken, appAddress)
    },
    [eilClient],
  )

  // Get paymaster address
  const paymasterAddress = useMemo(() => {
    const contracts = getChainContracts(chainId)
    return contracts.crossChainPaymaster
  }, [chainId])

  return {
    buildPaymasterData,
    paymasterAddress,
    isReady: !!eilClient,
  }
}
