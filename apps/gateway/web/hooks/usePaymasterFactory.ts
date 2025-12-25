import { useCallback } from 'react'
import type { Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { CONTRACTS } from '../../lib/config'
import { PAYMASTER_FACTORY_ABI } from '../lib/constants'
import { useTypedWriteContract } from './useTypedWriteContract'

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

export interface PaymasterDeployment {
  paymaster: Address
  vault: Address
  oracle: Address
}

export interface UsePaymasterDeploymentResult {
  deployment: PaymasterDeployment | null
  refetch: () => void
}

export function usePaymasterFactory(): UsePaymasterFactoryResult {
  const factoryAddress = CONTRACTS.paymasterFactory as Address | undefined
  const { address: ownerAddress } = useAccount()

  const { data: allDeployments, refetch: refetchDeployments } = useReadContract(
    {
      address: factoryAddress,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getDeployedPaymasters' as const,
      args: ownerAddress ? [ownerAddress] : undefined,
    },
  )

  const {
    write: writeContract,
    isPending,
    isConfirming,
    isSuccess,
  } = useTypedWriteContract()

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

export function usePaymasterDeployment(
  tokenAddress: `0x${string}` | undefined,
): UsePaymasterDeploymentResult {
  const factoryAddress = CONTRACTS.paymasterFactory as Address | undefined
  const { address: ownerAddress } = useAccount()

  const { data: paymasterAddress, refetch } = useReadContract({
    address: factoryAddress,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getPaymaster' as const,
    args:
      ownerAddress && tokenAddress ? [ownerAddress, tokenAddress] : undefined,
  })

  // Note: ABI only returns paymaster address, vault and oracle need separate queries
  const deployment: PaymasterDeployment | null = paymasterAddress
    ? {
        paymaster: paymasterAddress as Address,
        vault: paymasterAddress as Address, // Use paymaster as vault for now
        oracle: ZERO_ADDRESS,
      }
    : null

  return {
    deployment,
    refetch,
  }
}
