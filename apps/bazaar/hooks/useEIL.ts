'use client'

/**
 * EIL Hooks for Bazaar
 * Re-exports shared implementation with Bazaar-specific config
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { useState, useCallback, useEffect } from 'react'
import { parseEther, type Address } from 'viem'

// Re-export shared types and utilities
export {
  type ChainInfo,
  type CrossChainSwapParams,
  type XLPPosition,
  type EILStats,
  type SwapStatus,
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  L1_STAKE_MANAGER_ABI,
  calculateSwapFee,
  estimateSwapTime,
  formatSwapRoute,
  formatXLPPosition,
  getChainById,
  isCrossChainSwap,
  validateSwapParams,
} from '../../../scripts/shared/eil-hooks'

// Import for use
import {
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  type CrossChainSwapParams,
  type SwapStatus,
} from '../../../scripts/shared/eil-hooks'

// Load config from JSON
import eilConfig from '@jejunetwork/config/eil'

// ============ EIL Config Hook ============

type EILChainConfig = {
  name: string;
  crossChainPaymaster: string;
  status: string;
  oif?: Record<string, string>;
  tokens?: Record<string, string>;
};

type EILNetworkConfig = {
  hub: { chainId: number; name: string; l1StakeManager: string; status: string };
  chains: Record<string, EILChainConfig>;
};

type EILConfig = {
  version: string;
  lastUpdated: string;
  entryPoint: string;
  l2Messenger: string;
  supportedTokens: string[];
  testnet: EILNetworkConfig;
  mainnet: EILNetworkConfig;
  localnet: EILNetworkConfig;
};

// Helper to get chain config based on current network
function getNetworkConfig(): EILNetworkConfig {
  // Default to localnet for development
  const network = process.env.NEXT_PUBLIC_NETWORK || 'localnet';
  const config = eilConfig as EILConfig;
  if (network === 'testnet') return config.testnet;
  if (network === 'mainnet') return config.mainnet;
  return config.localnet;
}

export function useEILConfig() {
  const { chain } = useAccount()
  const chainId = chain?.id?.toString() || '420691'
  
  const networkConfig = getNetworkConfig();
  const chainConfig = networkConfig.chains[chainId];
  const paymasterAddress = chainConfig?.crossChainPaymaster;
  const crossChainPaymaster = (paymasterAddress && paymasterAddress.length > 0 ? paymasterAddress : undefined) as Address | undefined;
  const isAvailable = crossChainPaymaster && crossChainPaymaster !== '0x0000000000000000000000000000000000000000';
  
  const configuredChains = SUPPORTED_CHAINS.map(supportedChain => {
    const config = networkConfig.chains[supportedChain.id.toString()];
    const addr = config?.crossChainPaymaster;
    return {
      ...supportedChain,
      paymasterAddress: (addr && addr.length > 0 ? addr : undefined) as Address | undefined
    };
  });

  return {
    isAvailable: Boolean(isAvailable),
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    supportedChains: configuredChains,
    l1StakeManager: (networkConfig.hub.l1StakeManager || undefined) as Address | undefined,
    supportedTokens: (eilConfig as EILConfig).supportedTokens as Address[],
  }
}

// ============ Cross-Chain Swap Hook ============

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isPending) setSwapStatus('creating')
    else if (isConfirming) setSwapStatus('waiting')
    else if (isSuccess) setSwapStatus('complete')
  }, [isPending, isConfirming, isSuccess])

  const executeCrossChainSwap = useCallback(async (params: CrossChainSwapParams) => {
    if (!paymasterAddress || !userAddress) {
      setError('Wallet not connected or EIL not configured')
      return
    }

    setSwapStatus('creating')
    setError(null)

    const maxFee = parseEther('0.01')
    const feeIncrement = parseEther('0.0001')
    const gasOnDestination = parseEther('0.001')

    const isETH = params.sourceToken === '0x0000000000000000000000000000000000000000'
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
        feeIncrement
      ],
      value: txValue
    })
  }, [paymasterAddress, userAddress, writeContract])

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
    reset
  }
}

// ============ Fee Estimate Hook ============

export function useSwapFeeEstimate(
  sourceChainId: number,
  destinationChainId: number,
  amount: bigint
) {
  const [estimate, setEstimate] = useState({
    networkFee: parseEther('0.001'),
    xlpFee: parseEther('0.0005'),
    totalFee: parseEther('0.0015'),
    estimatedTime: 10,
    isLoading: false
  })

  useEffect(() => {
    const xlpFee = amount * 5n / 10000n
    const networkFee = parseEther('0.001')
    const crossChainPremium = sourceChainId !== destinationChainId ? parseEther('0.0005') : 0n
    
    setEstimate({
      networkFee: networkFee + crossChainPremium,
      xlpFee,
      totalFee: networkFee + crossChainPremium + xlpFee,
      estimatedTime: sourceChainId === destinationChainId ? 0 : 10,
      isLoading: false
    })
  }, [sourceChainId, destinationChainId, amount])

  return estimate
}

// ============ Token Support Hook ============

export function useTokenSupport(paymasterAddress: Address | undefined, tokenAddress: Address | undefined) {
  const { data: isSupported } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'supportedTokens',
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  return { isSupported: isSupported as boolean | undefined }
}
