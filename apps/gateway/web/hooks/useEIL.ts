import {
  APP_TOKEN_PREFERENCE_ABI,
  type AppPreference,
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  L1_STAKE_MANAGER_ABI,
  SUPPORTED_CHAINS,
  type SwapStatus,
  type XLPPosition,
} from '@jejunetwork/shared'
import { type StakeStatus, ZERO_ADDRESS } from '@jejunetwork/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, parseEther } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { NETWORK } from '../../lib/config'
import { IERC20_ABI } from '../lib/constants'
import { useTypedWriteContract } from './useTypedWriteContract'

type XLPStakeTuple = readonly [bigint, bigint, bigint, bigint, boolean, bigint]

// ABI-inferred type for getAppPreference return value
// Returns: (appAddr, preferredToken, tokenSymbol, tokenDecimals, allowFallback, minBalance, isActive, registrant, registrationTime)
type AppPreferenceTuple = readonly [
  Address,
  Address,
  string,
  number,
  boolean,
  bigint,
  boolean,
  Address,
  bigint,
]

// Converter functions
function xlpStakeFromTuple(
  tuple: XLPStakeTuple,
  chains: readonly bigint[],
): XLPPosition {
  return {
    stakedAmount: tuple[0],
    unbondingAmount: tuple[1],
    unbondingStartTime: Number(tuple[2]),
    slashedAmount: tuple[3],
    isActive: tuple[4],
    registeredAt: Number(tuple[5]),
    supportedChains: chains.map((c) => Number(c)),
    tokenLiquidity: new Map(),
    ethBalance: 0n,
    pendingFees: 0n,
    totalEarnings: 0n,
  }
}

function appPreferenceFromTuple(tuple: AppPreferenceTuple): AppPreference {
  return {
    appAddress: tuple[0],
    preferredToken: tuple[1],
    tokenSymbol: tuple[2],
    tokenDecimals: tuple[3],
    allowFallback: tuple[4],
    minBalance: tuple[5],
    isActive: tuple[6],
    registrant: tuple[7],
    registrationTime: tuple[8],
  }
}

import {
  type EILChainConfig,
  getContractsConfig,
  getEILChains,
  getEILHub,
} from '@jejunetwork/config'

// Get liquidity contracts for current network
function getLiquidityContracts() {
  const config = getContractsConfig(NETWORK)
  return config.liquidity
}

// Find chain config by chainId from EIL config
function findChainConfigById(chainId: number): EILChainConfig | undefined {
  const chains = getEILChains(NETWORK)
  return Object.values(chains).find((c) => c.chainId === chainId)
}

export function useEILConfig() {
  const { chain } = useAccount()

  // Get hub config for L1 stake manager
  const hub = getEILHub(NETWORK)

  // Default empty state
  const emptyState = {
    isAvailable: false,
    crossChainPaymaster: undefined as Address | undefined,
    appTokenPreference: undefined as Address | undefined,
    supportedChains: [] as Array<
      (typeof SUPPORTED_CHAINS)[number] & { paymasterAddress?: Address }
    >,
    l1StakeManager: undefined as Address | undefined,
    supportedTokens: [] as Address[],
    riskSleeve: undefined as Address | undefined,
    liquidityRouter: undefined as Address | undefined,
    multiServiceStakeManager: undefined as Address | undefined,
  }

  if (!chain?.id) {
    return emptyState
  }

  // Find chain config by ID
  const chainConfig = findChainConfigById(chain.id)

  // Helper to convert empty string to undefined and validate address
  const toAddress = (addr: string | undefined | null): Address | undefined => {
    if (!addr || addr.length === 0 || addr === ZERO_ADDRESS) return undefined
    return addr as Address
  }

  // Get paymaster address for current chain
  const crossChainPaymaster = toAddress(chainConfig?.crossChainPaymaster)
  const isAvailable = Boolean(crossChainPaymaster)

  // Map supported chains with their paymaster addresses
  const configuredChains = SUPPORTED_CHAINS.map((supportedChain) => {
    const config = findChainConfigById(supportedChain.id)
    return {
      ...supportedChain,
      paymasterAddress: toAddress(config?.crossChainPaymaster),
    }
  })

  // Get appTokenPreference address from chain config if available
  const appTokenPreferenceAddr = toAddress(
    chainConfig?.tokens?.appTokenPreference,
  )

  // Get liquidity contracts from contracts.json
  const liquidityContracts = getLiquidityContracts()

  // Get supported tokens for current chain
  const supportedTokens = chainConfig?.tokens
    ? Object.values(chainConfig.tokens)
        .map((addr) => toAddress(addr))
        .filter((addr): addr is Address => Boolean(addr))
    : []

  return {
    isAvailable,
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    appTokenPreference: appTokenPreferenceAddr,
    supportedChains: configuredChains,
    l1StakeManager: toAddress(hub.l1StakeManager),
    supportedTokens,
    riskSleeve: toAddress(liquidityContracts?.riskSleeve),
    liquidityRouter: toAddress(liquidityContracts?.liquidityRouter),
    multiServiceStakeManager: toAddress(
      liquidityContracts?.multiServiceStakeManager,
    ),
  }
}

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const {
    write: writeContract,
    hash,
    isPending,
    error: writeError,
    isConfirming,
    isSuccess,
  } = useTypedWriteContract()

  useEffect(() => {
    if (writeError) {
      setSwapStatus('idle')
      setError(writeError.message)
    } else if (isPending) setSwapStatus('creating')
    else if (isConfirming) setSwapStatus('waiting')
    else if (isSuccess) setSwapStatus('complete')
  }, [isPending, isConfirming, isSuccess, writeError])

  const executeCrossChainSwap = useCallback(
    async (params: CrossChainSwapParams) => {
      if (!paymasterAddress || !userAddress) {
        setError('Wallet not connected or EIL not configured')
        return
      }

      setSwapStatus('creating')
      setError(null)

      const maxFee = parseEther('0.01')
      const feeIncrement = parseEther('0.0001')
      const gasOnDestination = parseEther('0.001')

      const isETH = params.sourceToken === ZERO_ADDRESS
      const txValue = isETH ? params.amount + maxFee : maxFee

      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'createVoucherRequest',
        args: [
          params.sourceToken,
          params.amount,
          params.destinationToken,
          BigInt(params.destinationChainId),
          params.recipient || userAddress,
          gasOnDestination,
          maxFee,
          feeIncrement,
        ],
        value: txValue,
      })
    },
    [paymasterAddress, userAddress, writeContract],
  )

  const reset = useCallback(() => {
    setSwapStatus('idle')
    setError(null)
  }, [])

  return {
    executeCrossChainSwap,
    swapStatus,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
    reset,
  }
}

export function useXLPPosition(stakeManagerAddress: Address | undefined) {
  const { address } = useAccount()

  const { data: stakeData } = useReadContract({
    address: stakeManagerAddress,
    abi: L1_STAKE_MANAGER_ABI,
    functionName: 'getXLPStake',
    args: address ? [address] : undefined,
  })

  const { data: chainsData } = useReadContract({
    address: stakeManagerAddress,
    abi: L1_STAKE_MANAGER_ABI,
    functionName: 'getXLPChains',
    args: address ? [address] : undefined,
  })

  const position = useMemo<XLPPosition | null>(() => {
    if (!stakeData || !chainsData) return null
    return xlpStakeFromTuple(
      stakeData as XLPStakeTuple,
      chainsData as readonly bigint[],
    )
  }, [stakeData, chainsData])

  return { position }
}

export function useXLPRegistration(stakeManagerAddress: Address | undefined) {
  const [status, setStatus] = useState<StakeStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const {
    write: writeContract,
    hash,
    isPending,
    error: writeError,
    isConfirming,
    isSuccess,
  } = useTypedWriteContract()

  useEffect(() => {
    if (writeError) {
      setStatus('idle')
      setError(writeError.message)
    } else if (isPending) setStatus('pending')
    else if (isSuccess) setStatus('complete')
  }, [isPending, isSuccess, writeError])

  const register = useCallback(
    async (chains: number[], stakeAmount: bigint) => {
      if (!stakeManagerAddress) {
        setError('Stake manager not configured')
        return
      }

      setStatus('pending')
      setError(null)

      writeContract({
        address: stakeManagerAddress,
        abi: L1_STAKE_MANAGER_ABI,
        functionName: 'register',
        args: [chains.map((c) => BigInt(c))],
        value: stakeAmount,
      })
    },
    [stakeManagerAddress, writeContract],
  )

  const addStake = useCallback(
    async (amount: bigint) => {
      if (!stakeManagerAddress) {
        setError('Stake manager not configured')
        return
      }

      writeContract({
        address: stakeManagerAddress,
        abi: L1_STAKE_MANAGER_ABI,
        functionName: 'addStake',
        args: [],
        value: amount,
      })
    },
    [stakeManagerAddress, writeContract],
  )

  const startUnbonding = useCallback(
    async (amount: bigint) => {
      if (!stakeManagerAddress) {
        setError('Stake manager not configured')
        return
      }

      writeContract({
        address: stakeManagerAddress,
        abi: L1_STAKE_MANAGER_ABI,
        functionName: 'startUnbonding',
        args: [amount],
      })
    },
    [stakeManagerAddress, writeContract],
  )

  const completeUnbonding = useCallback(async () => {
    if (!stakeManagerAddress) {
      setError('Stake manager not configured')
      return
    }

    writeContract({
      address: stakeManagerAddress,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'completeUnbonding',
      args: [],
    })
  }, [stakeManagerAddress, writeContract])

  return {
    register,
    addStake,
    startUnbonding,
    completeUnbonding,
    status,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}

export function useXLPLiquidity(paymasterAddress: Address | undefined) {
  const { address } = useAccount()
  const [status, setStatus] = useState<StakeStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isApproving, setIsApproving] = useState(false)

  const {
    write: writeContract,
    writeAsync,
    hash,
    isPending,
    error: writeError,
    isConfirming,
    isSuccess,
  } = useTypedWriteContract()

  const { data: ethBalance } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'getXLPETH',
    args: address ? [address] : undefined,
  })

  useEffect(() => {
    if (writeError) {
      setStatus('idle')
      setError(writeError.message)
      setIsApproving(false)
    } else if (isPending) setStatus('pending')
    else if (isSuccess) {
      setStatus('complete')
      setIsApproving(false)
    }
  }, [isPending, isSuccess, writeError])

  const depositETH = useCallback(
    async (amount: bigint) => {
      if (!paymasterAddress) return

      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'depositETH',
        args: [],
        value: amount,
      })
    },
    [paymasterAddress, writeContract],
  )

  const withdrawETH = useCallback(
    async (amount: bigint) => {
      if (!paymasterAddress) return

      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'withdrawETH',
        args: [amount],
      })
    },
    [paymasterAddress, writeContract],
  )

  /**
   * Approve a token for deposit with the paymaster contract
   */
  const approveToken = useCallback(
    async (token: Address, amount: bigint) => {
      if (!paymasterAddress) return

      setIsApproving(true)
      setError(null)

      await writeAsync({
        address: token,
        abi: IERC20_ABI,
        functionName: 'approve',
        args: [paymasterAddress, amount],
      })
      setIsApproving(false)
    },
    [paymasterAddress, writeAsync],
  )

  /**
   * Deposit a token after approval
   * Call approveToken first if needed
   */
  const depositToken = useCallback(
    async (token: Address, amount: bigint) => {
      if (!paymasterAddress) return

      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'depositLiquidity',
        args: [token, amount],
      })
    },
    [paymasterAddress, writeContract],
  )

  /**
   * Approve and deposit in one flow
   */
  const approveAndDepositToken = useCallback(
    async (token: Address, amount: bigint) => {
      if (!paymasterAddress) return

      setIsApproving(true)
      setError(null)

      // First approve the token
      await writeAsync({
        address: token,
        abi: IERC20_ABI,
        functionName: 'approve',
        args: [paymasterAddress, amount],
      })

      setIsApproving(false)

      // Then deposit
      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'depositLiquidity',
        args: [token, amount],
      })
    },
    [paymasterAddress, writeContract, writeAsync],
  )

  const withdrawToken = useCallback(
    async (token: Address, amount: bigint) => {
      if (!paymasterAddress) return

      writeContract({
        address: paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'withdrawLiquidity',
        args: [token, amount],
      })
    },
    [paymasterAddress, writeContract],
  )

  return {
    ethBalance,
    depositETH,
    withdrawETH,
    approveToken,
    depositToken,
    approveAndDepositToken,
    withdrawToken,
    status,
    error,
    isApproving,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}

/**
 * Hook to check token allowance for a spender
 */
export function useTokenAllowance(
  tokenAddress: Address | undefined,
  ownerAddress: Address | undefined,
  spenderAddress: Address | undefined,
) {
  const { data: allowance, refetch } = useReadContract({
    address: tokenAddress,
    abi: IERC20_ABI,
    functionName: 'allowance',
    args:
      ownerAddress && spenderAddress
        ? [ownerAddress, spenderAddress]
        : undefined,
  })

  return {
    allowance: allowance as bigint | undefined,
    refetch,
    needsApproval: (amount: bigint) => {
      if (!allowance) return true
      return (allowance as bigint) < amount
    },
  }
}

export function useAppTokenPreference(preferenceAddress: Address | undefined) {
  const {
    write: writeContract,
    hash,
    isPending,
    error,
    isConfirming,
    isSuccess,
  } = useTypedWriteContract()

  const registerApp = useCallback(
    async (
      appAddress: Address,
      preferredToken: Address,
      allowFallback: boolean,
      minBalance: bigint,
    ) => {
      if (!preferenceAddress) return

      writeContract({
        address: preferenceAddress,
        abi: APP_TOKEN_PREFERENCE_ABI,
        functionName: 'registerApp',
        args: [appAddress, preferredToken, allowFallback, minBalance],
      })
    },
    [preferenceAddress, writeContract],
  )

  const updatePreferredToken = useCallback(
    async (appAddress: Address, newPreferredToken: Address) => {
      if (!preferenceAddress) return

      writeContract({
        address: preferenceAddress,
        abi: APP_TOKEN_PREFERENCE_ABI,
        functionName: 'updatePreferredToken',
        args: [appAddress, newPreferredToken],
      })
    },
    [preferenceAddress, writeContract],
  )

  const setFallbackTokens = useCallback(
    async (appAddress: Address, tokens: Address[]) => {
      if (!preferenceAddress) return

      writeContract({
        address: preferenceAddress,
        abi: APP_TOKEN_PREFERENCE_ABI,
        functionName: 'setFallbackTokens',
        args: [appAddress, tokens],
      })
    },
    [preferenceAddress, writeContract],
  )

  return {
    registerApp,
    updatePreferredToken,
    setFallbackTokens,
    isLoading: isPending || isConfirming,
    isSuccess,
    error: error?.message ?? null,
    hash,
  }
}

export function useAppPreference(
  preferenceAddress: Address | undefined,
  appAddress: Address | undefined,
) {
  const { data: preferenceData } = useReadContract({
    address: preferenceAddress,
    abi: APP_TOKEN_PREFERENCE_ABI,
    functionName: 'getAppPreference',
    args: appAddress ? [appAddress] : undefined,
  })

  const { data: fallbackTokens } = useReadContract({
    address: preferenceAddress,
    abi: APP_TOKEN_PREFERENCE_ABI,
    functionName: 'getAppFallbackTokens',
    args: appAddress ? [appAddress] : undefined,
  })

  const preference: AppPreference | null = preferenceData
    ? appPreferenceFromTuple(preferenceData as AppPreferenceTuple)
    : null

  return {
    preference,
    fallbackTokens: fallbackTokens
      ? (fallbackTokens as readonly Address[])
      : [],
  }
}

// ABI returns: (bestToken, tokenCost, reason)
type BestPaymentTokenTuple = readonly [Address, bigint, string]

export function useBestGasToken(
  paymasterAddress: Address | undefined,
  appAddress: Address | undefined,
  user: Address | undefined,
  gasCostETH: bigint,
  userTokens: Address[],
  userBalances: bigint[],
) {
  const { data: result } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'getBestPaymentTokenForApp',
    args:
      appAddress && user
        ? [appAddress, user, gasCostETH, userTokens, userBalances]
        : undefined,
  })

  const typedResult = result as BestPaymentTokenTuple | undefined

  return {
    bestToken: typedResult?.[0],
    tokenCost: typedResult?.[1],
    reason: typedResult?.[2],
  }
}

/**
 * Hook to get fee estimates for cross-chain swaps.
 *
 * Fee Structure:
 * - XLP Fee: 0.05% (5 bps) - paid to XLP providers
 * - Network Fee: Estimated gas cost on destination chain
 *
 * Time Estimates based on chain finality:
 * - Same L2 -> L2: ~2-5 minutes
 * - L1 -> L2: ~10-15 minutes
 * - L2 -> L1: ~15-30 minutes (includes withdrawal period)
 */
export function useSwapFeeEstimate(
  sourceChainId: number,
  destinationChainId: number,
  amount: bigint,
) {
  // XLP fee is a protocol constant: 0.05% (5 basis points)
  const XLP_FEE_BPS = 5n
  const xlpFee = (amount * XLP_FEE_BPS) / 10000n

  // Estimate time based on chain types
  // L1 chains: 1 (Ethereum), 11155111 (Sepolia)
  // L2 chains: 42161 (Arbitrum), 10 (Optimism), 8453 (Base), 420691/420690 (Jeju)
  const L1_CHAINS = [1, 11155111]
  const sourceIsL1 = L1_CHAINS.includes(sourceChainId)
  const destIsL1 = L1_CHAINS.includes(destinationChainId)

  let estimatedTimeSeconds: number
  if (sourceIsL1 && destIsL1) {
    // L1 to L1 - not typically supported, but estimate 30 min
    estimatedTimeSeconds = 30 * 60
  } else if (sourceIsL1) {
    // L1 to L2 - ~10-15 minutes for message finality
    estimatedTimeSeconds = 12 * 60
  } else if (destIsL1) {
    // L2 to L1 - ~15-30 minutes including challenge period
    estimatedTimeSeconds = 20 * 60
  } else {
    // L2 to L2 - fastest, ~2-5 minutes
    estimatedTimeSeconds = 3 * 60
  }

  // Network fee estimate (gas for destination execution)
  // Rough estimate: 150k gas * ~20 gwei = ~0.003 ETH
  // This should eventually be fetched from an oracle
  const networkFeeEstimate = parseEther('0.003')

  return {
    networkFee: networkFeeEstimate,
    xlpFee,
    totalFee: xlpFee + networkFeeEstimate,
    estimatedTimeSeconds,
    estimatedTimeFormatted: formatEstimatedTime(estimatedTimeSeconds),
    isLoading: false,
    /** Fee is calculated, not fetched from oracle */
    isEstimate: true,
  }
}

function formatEstimatedTime(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds} seconds`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `~${minutes} minutes`
  }
  const hours = Math.round(minutes / 60)
  return `~${hours} hour${hours > 1 ? 's' : ''}`
}
