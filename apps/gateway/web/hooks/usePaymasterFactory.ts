import { useCallback } from 'react'
import type { Address } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS } from '../../lib/config'
import { PAYMASTER_FACTORY_ABI } from '../lib/constants'

type DeploymentTuple = readonly [Address, Address, Address]

export interface PaymasterDeployment {
  paymaster: Address
  vault: Address
  oracle: Address
}

export interface UsePaymasterFactoryResult {
  allDeployments: Address[]
  deployPaymaster: (
    tokenAddress: Address,
    feeMargin: number,
    operator: Address,
  ) => Promise<void>
  isPending: boolean
  isSuccess: boolean
  refetchDeployments: () => void
}

export interface UsePaymasterDeploymentResult {
  deployment: PaymasterDeployment | null
  refetch: () => void
}

export function usePaymasterFactory(): UsePaymasterFactoryResult {
  const factoryAddress = CONTRACTS.paymasterFactory as Address | undefined

  const { data: allDeployments, refetch: refetchDeployments } = useReadContract(
    {
      address: factoryAddress,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getAllDeployments' as const,
    },
  )

  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const deployPaymaster = useCallback(
    async (tokenAddress: Address, feeMargin: number, operator: Address) => {
      if (!factoryAddress) {
        throw new Error('Factory address not configured')
      }
      writeContract({
        address: factoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'deployPaymaster' as const,
        args: [tokenAddress, BigInt(feeMargin), operator],
      })
    },
    [factoryAddress, writeContract],
  )

  return {
    allDeployments: allDeployments ? (allDeployments as Address[]) : [],
    deployPaymaster,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchDeployments,
  }
}

export function usePaymasterDeployment(
  tokenAddress: `0x${string}` | undefined,
): UsePaymasterDeploymentResult {
  const factoryAddress = CONTRACTS.paymasterFactory as Address | undefined

  const { data: deployment, refetch } = useReadContract({
    address: factoryAddress,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getDeployment' as const,
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  const parsedDeployment: PaymasterDeployment | null = (() => {
    if (!deployment) return null
    const tuple = deployment as DeploymentTuple
    return {
      paymaster: tuple[0],
      vault: tuple[1],
      oracle: tuple[2],
    }
  })()

  return {
    deployment: parsedDeployment,
    refetch,
  }
}
