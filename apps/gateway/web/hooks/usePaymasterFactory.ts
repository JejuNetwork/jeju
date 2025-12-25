import { ZERO_ADDRESS } from '@jejunetwork/types'
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
  feeMargin: number
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
    allDeployments: allDeployments ? [...allDeployments] : [],
    deployPaymaster,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchDeployments,
  }
}

const GET_DEPLOYMENT_ABI = [
  {
    type: 'function',
    name: 'getDeployment',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'deployment',
        type: 'tuple',
        components: [
          { name: 'paymaster', type: 'address' },
          { name: 'vault', type: 'address' },
          { name: 'distributor', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'deployedAt', type: 'uint256' },
          { name: 'feeMargin', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

interface DeploymentResult {
  paymaster: Address
  vault: Address
  distributor: Address
  token: Address
  operator: Address
  deployedAt: bigint
  feeMargin: bigint
}

export function usePaymasterDeployment(
  tokenAddress: `0x${string}` | undefined,
): UsePaymasterDeploymentResult {
  const factoryAddress = CONTRACTS.paymasterFactory as Address | undefined

  const { data: deploymentData, refetch } = useReadContract({
    address: factoryAddress,
    abi: GET_DEPLOYMENT_ABI,
    functionName: 'getDeployment',
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  const deployment: PaymasterDeployment | null =
    deploymentData &&
    (deploymentData as DeploymentResult).paymaster !== ZERO_ADDRESS
      ? {
          paymaster: (deploymentData as DeploymentResult).paymaster,
          vault: (deploymentData as DeploymentResult).vault,
          oracle: ZERO_ADDRESS, // Oracle not in contract response
          feeMargin: Number((deploymentData as DeploymentResult).feeMargin),
        }
      : null

  return {
    deployment,
    refetch,
  }
}
