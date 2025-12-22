'use client'

import { useCallback } from 'react'
import type { Address } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'

// TFMM Fee Controller ABI
const FEE_CONTROLLER_ABI = [
  {
    name: 'getPoolFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [
      { name: 'swapFee', type: 'uint256' },
      { name: 'protocolFee', type: 'uint256' },
      { name: 'strategyFee', type: 'uint256' },
      { name: 'managementFee', type: 'uint256' },
    ],
  },
  {
    name: 'setSwapFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'newFee', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'setProtocolFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'newFee', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'setGuardRails',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'maxWeightChangeBps', type: 'uint256' },
      { name: 'minUpdateInterval', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'pause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [],
  },
  {
    name: 'unpause',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [],
  },
  {
    name: 'isGovernor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'isGovernor', type: 'bool' }],
  },
] as const

export interface PoolFees {
  swapFee: number
  protocolFee: number
  strategyFee: number
  managementFee: number
}

export interface GuardRails {
  maxWeightChangeBps: number
  minUpdateInterval: number
  maxSlippageBps: number
}

export function useTFMMGovernance(feeControllerAddress: Address | null) {
  const { address: userAddress } = useAccount()

  // Check if user is governor
  const { data: isGovernor } = useReadContract({
    address: feeControllerAddress ?? undefined,
    abi: FEE_CONTROLLER_ABI,
    functionName: 'isGovernor',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!feeControllerAddress && !!userAddress,
    },
  })

  return {
    isGovernor: isGovernor ?? false,
    isLoading: false,
  }
}

export function usePoolFees(
  feeControllerAddress: Address | null,
  poolAddress: Address | null,
) {
  const { data, isLoading, refetch } = useReadContract({
    address: feeControllerAddress ?? undefined,
    abi: FEE_CONTROLLER_ABI,
    functionName: 'getPoolFees',
    args: poolAddress ? [poolAddress] : undefined,
    query: {
      enabled: !!feeControllerAddress && !!poolAddress,
    },
  })

  const fees: PoolFees | null = data
    ? {
        swapFee: Number(data[0]),
        protocolFee: Number(data[1]),
        strategyFee: Number(data[2]),
        managementFee: Number(data[3]),
      }
    : null

  return {
    fees,
    isLoading,
    refetch,
  }
}

export function useSetSwapFee(feeControllerAddress: Address | null) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const setSwapFee = useCallback(
    async (poolAddress: Address, newFee: bigint) => {
      if (!feeControllerAddress) return

      writeContract({
        address: feeControllerAddress,
        abi: FEE_CONTROLLER_ABI,
        functionName: 'setSwapFee',
        args: [poolAddress, newFee],
      })
    },
    [feeControllerAddress, writeContract],
  )

  return {
    setSwapFee,
    isLoading: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  }
}

export function useSetGuardRails(feeControllerAddress: Address | null) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const setGuardRails = useCallback(
    async (
      poolAddress: Address,
      maxWeightChangeBps: bigint,
      minUpdateInterval: bigint,
    ) => {
      if (!feeControllerAddress) return

      writeContract({
        address: feeControllerAddress,
        abi: FEE_CONTROLLER_ABI,
        functionName: 'setGuardRails',
        args: [poolAddress, maxWeightChangeBps, minUpdateInterval],
      })
    },
    [feeControllerAddress, writeContract],
  )

  return {
    setGuardRails,
    isLoading: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  }
}

export function usePausePool(feeControllerAddress: Address | null) {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const pause = useCallback(
    async (poolAddress: Address) => {
      if (!feeControllerAddress) return

      writeContract({
        address: feeControllerAddress,
        abi: FEE_CONTROLLER_ABI,
        functionName: 'pause',
        args: [poolAddress],
      })
    },
    [feeControllerAddress, writeContract],
  )

  const unpause = useCallback(
    async (poolAddress: Address) => {
      if (!feeControllerAddress) return

      writeContract({
        address: feeControllerAddress,
        abi: FEE_CONTROLLER_ABI,
        functionName: 'unpause',
        args: [poolAddress],
      })
    },
    [feeControllerAddress, writeContract],
  )

  return {
    pause,
    unpause,
    isLoading: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  }
}

export function formatFee(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function formatInterval(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} days`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} hours`
  if (seconds >= 60) return `${Math.floor(seconds / 60)} minutes`
  return `${seconds} seconds`
}
