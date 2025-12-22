'use client'

/**
 * Paymaster Factory Hook
 * For managing paymaster deployments
 */

import { useReadContract } from 'wagmi'
import { type Address } from 'viem'

const PAYMASTER_FACTORY_ABI = [
  {
    name: 'getDeployment',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'paymaster', type: 'address' },
      { name: 'vault', type: 'address' },
      { name: 'oracle', type: 'address' },
    ],
  },
] as const

// Factory address - should come from config
const PAYMASTER_FACTORY_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export interface PaymasterDeployment {
  paymaster: Address
  vault: Address
  oracle: Address
}

export function usePaymasterDeployment(tokenAddress: Address | undefined) {
  const { data: deployment } = useReadContract({
    address: PAYMASTER_FACTORY_ADDRESS,
    abi: PAYMASTER_FACTORY_ABI,
    functionName: 'getDeployment',
    args: tokenAddress ? [tokenAddress] : undefined,
  })

  const deploymentData: PaymasterDeployment | null = deployment ? {
    paymaster: deployment[0],
    vault: deployment[1],
    oracle: deployment[2],
  } : null

  return {
    deployment: deploymentData,
  }
}

export function usePaymasterFactory() {
  // This would read from the factory contract to get all deployments
  // For now, return empty array as placeholder
  return {
    allDeployments: [] as Address[],
  }
}
