import {
  APP_TOKEN_PREFERENCE_ABI,
  type AppPreference,
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  L1_STAKE_MANAGER_ABI,
  SUPPORTED_CHAINS,
  type SwapStatus,
  type XLPPosition,
} from '@jejunetwork/deployment/scripts/shared/eil-hooks'

/** Stake status - local type definition */
type StakeStatus = 'idle' | 'pending' | 'complete' | 'error'
import { ZERO_ADDRESS } from '@jejunetwork/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { NETWORK } from '../config'

// ABI-inferred tuple types for getXLPStake return value
// Returns: (stakedAmount, unbondingAmount, unbondingStartTime, slashedAmount, isActive, registeredAt)
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

import contractsConfig from '@jejunetwork/config/contracts'
// Load and validate config from JSON
import eilConfigRaw from '@jejunetwork/config/eil'
import {
  type EILJsonConfig,
  EILJsonConfigSchema,
  type EILNetworkConfig,
  expectValid,
} from '../lib/validation'

// Validate the EIL config at module load time - fail fast if config is invalid
const typedConfig: EILJsonConfig = expectValid(
  EILJsonConfigSchema,
  eilConfigRaw,
  'EIL config',
)

// Contracts config type (simplified for liquidity)
interface ContractsNetworkConfig {
  liquidity?: {
    riskSleeve?: string
    liquidityRouter?: string
    multiServiceStakeManager?: string
    liquidityVault?: string
    federatedLiquidity?: string
  }
}

// Get liquidity contracts for current network
function getLiquidityContracts(): ContractsNetworkConfig['liquidity'] {
  const config = contractsConfig as {
    localnet?: ContractsNetworkConfig
    testnet?: ContractsNetworkConfig
    mainnet?: ContractsNetworkConfig
  }
  if (NETWORK === 'testnet') return config.testnet?.liquidity
  if (NETWORK === 'mainnet') return config.mainnet?.liquidity
  return config.localnet?.liquidity
}

// Helper to get chain config based on current network
function getNetworkConfig(): EILNetworkConfig {
  if (NETWORK === 'testnet') return typedConfig.testnet
  if (NETWORK === 'mainnet') return typedConfig.mainnet
  return typedConfig.localnet
}

export function useEILConfig() {
  const { chain } = useAccount()
  if (!chain?.id) {
    return {
      isAvailable: false,
      crossChainPaymaster: undefined,
      appTokenPreference: undefined,
      supportedChains: [],
      l1StakeManager: undefined,
      supportedTokens: [],
      riskSleeve: undefined,
      liquidityRouter: undefined,
      multiServiceStakeManager: undefined,
    }
  }
  const chainId = chain.id.toString()

  const networkConfig = getNetworkConfig()
  const chainConfig = networkConfig.chains[chainId]
  const paymasterAddress = chainConfig?.crossChainPaymaster
  const crossChainPaymaster = (
    paymasterAddress && paymasterAddress.length > 0
      ? paymasterAddress
      : undefined
  ) as Address | undefined
  const isAvailable =
    crossChainPaymaster && crossChainPaymaster !== ZERO_ADDRESS

  const configuredChains = SUPPORTED_CHAINS.map((supportedChain) => {
    const config = networkConfig.chains[supportedChain.id.toString()]
    const addr = config?.crossChainPaymaster
    return {
      ...supportedChain,
      paymasterAddress: (addr && addr.length > 0 ? addr : undefined) as
        | Address
        | undefined,
    }
  })

  // Get appTokenPreference address from chain config if available
  const appTokenPreferenceAddr = chainConfig?.tokens?.appTokenPreference as
    | Address
    | undefined

  // Get liquidity contracts from contracts.json
  const liquidityContracts = getLiquidityContracts()
  const riskSleeveAddr = liquidityContracts?.riskSleeve
  const liquidityRouterAddr = liquidityContracts?.liquidityRouter
  const multiServiceStakeManagerAddr =
    liquidityContracts?.multiServiceStakeManager

  // Helper to convert empty string to undefined
  const toAddress = (addr: string | undefined): Address | undefined =>
    addr && addr.length > 0 ? (addr as Address) : undefined

  return {
    isAvailable: Boolean(isAvailable),
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    appTokenPreference: appTokenPreferenceAddr || undefined,
    supportedChains: configuredChains,
    l1StakeManager: (networkConfig.hub.l1StakeManager || undefined) as
      | Address
      | undefined,
    supportedTokens:
      typedConfig.supportedTokens as readonly string[] as Address[],
    riskSleeve: toAddress(riskSleeveAddr),
    liquidityRouter: toAddress(liquidityRouterAddr),
    multiServiceStakeManager: toAddress(multiServiceStakeManagerAddr),
  }
}

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

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
    writeContract,
    data: hash,
    isPending,
    error: writeError,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

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

  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

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
    } else if (isPending) setStatus('pending')
    else if (isSuccess) setStatus('complete')
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
    depositToken,
    withdrawToken,
    status,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}

export function useAppTokenPreference(preferenceAddress: Address | undefined) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

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

export function useSwapFeeEstimate(
  _sourceChainId: number,
  _destinationChainId: number,
  amount: bigint,
) {
  const xlpFee = (amount * 5n) / 10000n

  return {
    networkFee: 0n,
    xlpFee,
    totalFee: xlpFee,
    estimatedTime: 0,
    isLoading: false,
    isEstimate: true,
  }
}
