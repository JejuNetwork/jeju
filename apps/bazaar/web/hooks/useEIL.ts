import {
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  SUPPORTED_CHAINS,
  type SwapStatus,
} from '@jejunetwork/shared'
import {
  AddressSchema,
  expect,
  expectPositive,
  parseOptionalAddress,
} from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import { type Address, parseEther } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

export type ChainInfo = (typeof SUPPORTED_CHAINS)[number]

/** Check if a swap is cross-chain based on source and destination chain IDs */
export function isCrossChainSwap(
  sourceChainId: number,
  destinationChainId: number,
): boolean {
  return sourceChainId !== destinationChainId
}

type EILChainConfig = {
  name: string
  crossChainPaymaster: string
  status: string
  oif?: Record<string, string>
  tokens?: Record<string, string>
}

type EILNetworkConfig = {
  hub: { chainId: number; name: string; l1StakeManager: string; status: string }
  chains: Record<string, EILChainConfig>
}

type EILConfig = {
  version: string
  lastUpdated: string
  entryPoint: string
  l2Messenger: string
  supportedTokens: string[]
  testnet: EILNetworkConfig
  mainnet: EILNetworkConfig
  localnet: EILNetworkConfig
}

const emptyChains: Record<string, EILChainConfig> = {}

const eilConfig: EILConfig = {
  version: '1.0.0',
  lastUpdated: '2024-12-01',
  entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  l2Messenger: '0x4200000000000000000000000000000000000007',
  supportedTokens: ['ETH', 'WETH', 'USDC', 'JEJU'],
  testnet: {
    hub: {
      chainId: 420690,
      name: 'Jeju Testnet',
      l1StakeManager: '',
      status: 'active',
    },
    chains: emptyChains,
  },
  mainnet: {
    hub: {
      chainId: 420691,
      name: 'Jeju Mainnet',
      l1StakeManager: '',
      status: 'planned',
    },
    chains: emptyChains,
  },
  localnet: {
    hub: {
      chainId: 31337,
      name: 'Jeju Localnet',
      l1StakeManager: '',
      status: 'active',
    },
    chains: emptyChains,
  },
}

import { NETWORK } from '../config'

function getNetworkConfig(): EILNetworkConfig {
  if (NETWORK === 'testnet') return eilConfig.testnet
  if (NETWORK === 'mainnet') return eilConfig.mainnet
  return eilConfig.localnet
}

export function useEILConfig() {
  const { chain } = useAccount()
  const chainId = chain?.id?.toString() ?? '420691'

  const networkConfig = getNetworkConfig()
  const chainConfig = networkConfig.chains[chainId]

  const paymasterAddress = chainConfig?.crossChainPaymaster
  const crossChainPaymaster = parseOptionalAddress(paymasterAddress)
  const isAvailable =
    crossChainPaymaster &&
    crossChainPaymaster !== '0x0000000000000000000000000000000000000000'

  const configuredChains = SUPPORTED_CHAINS.map((supportedChain) => {
    const config = networkConfig.chains[supportedChain.id.toString()]
    const addr = config?.crossChainPaymaster
    return {
      ...supportedChain,
      paymasterAddress: parseOptionalAddress(addr),
    }
  })

  const appTokenPreferenceAddr = parseOptionalAddress(
    chainConfig?.tokens?.appTokenPreference,
  )

  return {
    isAvailable: Boolean(isAvailable),
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    appTokenPreference: appTokenPreferenceAddr,
    supportedChains: configuredChains,
    l1StakeManager: parseOptionalAddress(networkConfig.hub.l1StakeManager),
    supportedTokens: eilConfig.supportedTokens,
  }
}

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (isPending) setSwapStatus('creating')
    else if (isConfirming) setSwapStatus('waiting')
    else if (isSuccess) setSwapStatus('complete')
  }, [isPending, isConfirming, isSuccess])

  const executeCrossChainSwap = useCallback(
    async (params: CrossChainSwapParams) => {
      const validatedPaymasterAddress = expect(
        paymasterAddress,
        'EIL paymaster not configured',
      )
      const validatedUserAddress = expect(userAddress, 'Wallet not connected')
      AddressSchema.parse(validatedPaymasterAddress)
      AddressSchema.parse(validatedUserAddress)

      setSwapStatus('creating')
      setError(null)

      const maxFee = parseEther('0.01')
      const feeIncrement = parseEther('0.0001')
      const gasOnDestination = parseEther('0.001')

      const isETH =
        params.sourceToken === '0x0000000000000000000000000000000000000000'
      const txValue = isETH ? params.amount + maxFee : maxFee

      AddressSchema.parse(params.sourceToken)
      AddressSchema.parse(params.destinationToken)
      expectPositive(params.amount, 'Amount must be positive')

      writeContract({
        address: validatedPaymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'createVoucherRequest',
        args: [
          params.sourceToken,
          params.amount,
          params.destinationToken,
          BigInt(params.destinationChainId),
          params.recipient || validatedUserAddress,
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

export function useSwapFeeEstimate(
  sourceChainId: number,
  destinationChainId: number,
  amount: bigint,
) {
  const [estimate, setEstimate] = useState({
    networkFee: parseEther('0.001'),
    xlpFee: parseEther('0.0005'),
    totalFee: parseEther('0.0015'),
    estimatedTime: 10,
    isLoading: false,
  })

  useEffect(() => {
    const xlpFee = (amount * 5n) / 10000n
    const networkFee = parseEther('0.001')
    const crossChainPremium =
      sourceChainId !== destinationChainId ? parseEther('0.0005') : 0n

    setEstimate({
      networkFee: networkFee + crossChainPremium,
      xlpFee,
      totalFee: networkFee + crossChainPremium + xlpFee,
      estimatedTime: sourceChainId === destinationChainId ? 0 : 10,
      isLoading: false,
    })
  }, [sourceChainId, destinationChainId, amount])

  return estimate
}
