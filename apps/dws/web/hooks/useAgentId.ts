import { useAccount, useReadContract } from 'wagmi'
import { CONTRACTS } from '../config'

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'tokenOfOwnerByIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'agentExists',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'getMetadata',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const

export function useAgentId() {
  const { address, isConnected } = useAccount()

  const { data: balance } = useReadContract({
    address: CONTRACTS.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled:
        isConnected &&
        !!address &&
        CONTRACTS.identityRegistry !==
          '0x0000000000000000000000000000000000000000',
    },
  })

  const hasAgent = balance !== undefined && balance > 0n

  const { data: agentId, isLoading } = useReadContract({
    address: CONTRACTS.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenOfOwnerByIndex',
    args: address ? [address, 0n] : undefined,
    query: {
      enabled: hasAgent,
    },
  })

  const { data: tokenURI } = useReadContract({
    address: CONTRACTS.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: agentId !== undefined ? [agentId] : undefined,
    query: {
      enabled: agentId !== undefined,
    },
  })

  return {
    hasAgent,
    agentId: agentId !== undefined ? Number(agentId) : null,
    tokenURI,
    isLoading,
  }
}
