import { useCallback } from 'react'
import type { Address } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { PAYMASTER_FACTORY_ABI } from '../contracts'

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

export function usePaymasterFactory(
  factoryAddress: Address | undefined,
): UsePaymasterFactoryResult {
  // Read all deployments
  const { data: allDeployments, refetch: refetchDeployments } = useReadContract(
    {
      address: factoryAddress,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getAllDeployments',
    },
  )

  // Write: Deploy paymaster
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
        functionName: 'deployPaymaster',
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
  factoryAddress: Address | undefined,
  tokenAddress: Address | undefined,
): UsePaymasterDeploymentResult {
  const { data: deployment, refetch } = useReadContract({
    address: factoryAddress,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getDeployment',
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
