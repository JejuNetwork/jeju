import { ZERO_ADDRESS } from '@jejunetwork/types'
import { useState } from 'react'
import type { Address } from 'viem'
import { useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import { CONTRACTS } from '../../lib/config'
import { IERC20_ABI } from '../lib/constants'
import { useTypedWriteContract } from './useTypedWriteContract'

export const IDENTITY_REGISTRY_ADDRESS = CONTRACTS.identityRegistry
const REGISTRY_ADDRESS = IDENTITY_REGISTRY_ADDRESS

/**
 * Stake tiers matching IdentityRegistry.sol
 * NONE=0, SMALL=1, MEDIUM=2, HIGH=3
 */
export const StakeTier = {
  NONE: 0,
  SMALL: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const
export type StakeTierValue = (typeof StakeTier)[keyof typeof StakeTier]

const IDENTITY_REGISTRY_ABI = [
  // Register without staking
  {
    inputs: [{ internalType: 'string', name: 'tokenURI_', type: 'string' }],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Register with metadata (no staking)
  {
    inputs: [
      { internalType: 'string', name: 'tokenURI_', type: 'string' },
      {
        components: [
          { internalType: 'string', name: 'key', type: 'string' },
          { internalType: 'bytes', name: 'value', type: 'bytes' },
        ],
        internalType: 'struct IIdentityRegistry.MetadataEntry[]',
        name: 'metadata',
        type: 'tuple[]',
      },
    ],
    name: 'register',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Register with staking (tier-based)
  {
    inputs: [
      { internalType: 'string', name: 'tokenURI_', type: 'string' },
      {
        components: [
          { internalType: 'string', name: 'key', type: 'string' },
          { internalType: 'bytes', name: 'value', type: 'bytes' },
        ],
        internalType: 'struct IIdentityRegistry.MetadataEntry[]',
        name: 'metadata',
        type: 'tuple[]',
      },
      { internalType: 'uint8', name: 'tier_', type: 'uint8' },
      { internalType: 'address', name: 'stakeToken_', type: 'address' },
    ],
    name: 'registerWithStake',
    outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'withdrawStake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Get stake amount for a tier
  {
    inputs: [{ internalType: 'uint8', name: 'tier', type: 'uint8' }],
    name: 'getStakeAmount',
    outputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'tag', type: 'string' }],
    name: 'getAgentsByTag',
    outputs: [
      { internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'key', type: 'string' },
    ],
    name: 'getMetadata',
    outputs: [{ internalType: 'bytes', name: 'value', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getAgentTags',
    outputs: [{ internalType: 'string[]', name: 'tags', type: 'string[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'getAllAgents',
    outputs: [
      { internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getA2AEndpoint',
    outputs: [{ internalType: 'string', name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getMCPEndpoint',
    outputs: [{ internalType: 'string', name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getServiceType',
    outputs: [{ internalType: 'string', name: 'serviceType', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getCategory',
    outputs: [{ internalType: 'string', name: 'category', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getX402Support',
    outputs: [{ internalType: 'bool', name: 'supported', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Auto-generated getter for public `agents` mapping
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'agents',
    outputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'uint8', name: 'tier', type: 'uint8' },
      { internalType: 'address', name: 'stakedToken', type: 'address' },
      { internalType: 'uint256', name: 'stakedAmount', type: 'uint256' },
      { internalType: 'uint256', name: 'registeredAt', type: 'uint256' },
      { internalType: 'uint256', name: 'lastActivityAt', type: 'uint256' },
      { internalType: 'bool', name: 'isBanned', type: 'bool' },
      { internalType: 'bool', name: 'isSlashed', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }],
    name: 'getMarketplaceInfo',
    outputs: [
      { internalType: 'string', name: 'a2aEndpoint', type: 'string' },
      { internalType: 'string', name: 'mcpEndpoint', type: 'string' },
      { internalType: 'string', name: 'serviceType', type: 'string' },
      { internalType: 'string', name: 'category', type: 'string' },
      { internalType: 'bool', name: 'x402Supported', type: 'bool' },
      { internalType: 'uint8', name: 'tier', type: 'uint8' },
      { internalType: 'bool', name: 'banned', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'getActiveAgents',
    outputs: [
      { internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'endpoint', type: 'string' },
    ],
    name: 'setA2AEndpoint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'endpoint', type: 'string' },
    ],
    name: 'setMCPEndpoint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'a2aEndpoint', type: 'string' },
      { internalType: 'string', name: 'mcpEndpoint', type: 'string' },
    ],
    name: 'setEndpoints',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'serviceType', type: 'string' },
    ],
    name: 'setServiceType',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'string', name: 'category', type: 'string' },
    ],
    name: 'setCategory',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      { internalType: 'bool', name: 'supported', type: 'bool' },
    ],
    name: 'setX402Support',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Supported tokens
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'isSupportedStakeToken',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface RegisterAppParams {
  tokenURI: string
  a2aEndpoint: string
  tier: StakeTierValue
  stakeToken: Address
  stakeAmount: bigint
}

/** Encode a string as ABI bytes for MetadataEntry */
function encodeStringMetadata(value: string): `0x${string}` {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function useRegistry() {
  const [lastTx, setLastTx] = useState<`0x${string}` | undefined>()
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: lastTx })
  const { writeAsync } = useTypedWriteContract()

  async function registerApp(
    params: RegisterAppParams,
  ): Promise<{ success: boolean; error?: string; agentId?: bigint }> {
    const { tokenURI, a2aEndpoint, tier, stakeToken, stakeAmount } = params

    // Build metadata entries for the a2a endpoint
    const metadata: { key: string; value: `0x${string}` }[] = []
    if (a2aEndpoint) {
      metadata.push({
        key: 'a2aEndpoint',
        value: encodeStringMetadata(a2aEndpoint),
      })
    }

    if (tier === StakeTier.NONE) {
      // Free registration (no staking)
      const hash = await writeAsync({
        address: REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [tokenURI, metadata],
      })
      setLastTx(hash)
    } else {
      // Registration with staking
      if (stakeToken !== ZERO_ADDRESS) {
        await writeAsync({
          address: stakeToken,
          abi: IERC20_ABI,
          functionName: 'approve',
          args: [REGISTRY_ADDRESS, stakeAmount],
        })
      }

      const hash = await writeAsync({
        address: REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'registerWithStake',
        args: [tokenURI, metadata, tier, stakeToken],
        value: stakeToken === ZERO_ADDRESS ? stakeAmount : 0n,
      })
      setLastTx(hash)
    }

    return { success: true }
  }

  async function withdrawStake(
    agentId: bigint,
  ): Promise<{ success: boolean; error?: string }> {
    const hash = await writeAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'withdrawStake',
      args: [agentId],
    })
    setLastTx(hash)
    return { success: true }
  }

  return { registerApp, withdrawStake, lastTransaction: txReceipt }
}

export function useStakeAmount(tier: StakeTierValue) {
  const { data } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getStakeAmount',
    args: [tier],
  })
  return data as bigint | undefined
}

export function useIsSupportedStakeToken(token: Address | undefined) {
  const { data } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'isSupportedStakeToken',
    args: token ? [token] : undefined,
  })
  return data as boolean | undefined
}

interface MarketplaceInfo {
  a2aEndpoint: string
  mcpEndpoint: string
  serviceType: string
  category: string
  x402Supported: boolean
  tier: number
  banned: boolean
}

export function useActiveAgents(offset = 0n, limit = 100n) {
  const { data, refetch, isLoading, error } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getActiveAgents',
    args: [offset, limit],
  })

  return { agentIds: data as bigint[] | undefined, isLoading, error, refetch }
}

export function useMarketplaceInfo(agentId: bigint | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getMarketplaceInfo',
    args: agentId !== undefined ? [agentId] : undefined,
  })

  const info: MarketplaceInfo | undefined = data
    ? {
        a2aEndpoint: (
          data as [string, string, string, string, boolean, number, boolean]
        )[0],
        mcpEndpoint: (
          data as [string, string, string, string, boolean, number, boolean]
        )[1],
        serviceType: (
          data as [string, string, string, string, boolean, number, boolean]
        )[2],
        category: (
          data as [string, string, string, string, boolean, number, boolean]
        )[3],
        x402Supported: (
          data as [string, string, string, string, boolean, number, boolean]
        )[4],
        tier: (
          data as [string, string, string, string, boolean, number, boolean]
        )[5],
        banned: (
          data as [string, string, string, string, boolean, number, boolean]
        )[6],
      }
    : undefined

  return { info, isLoading, error }
}

interface RegisteredApp {
  agentId: bigint
  name: string
  description?: string
  owner: string
  tags: string[]
  a2aEndpoint?: string
  mcpEndpoint?: string
  serviceType?: string
  category?: string
  x402Support?: boolean
  stakeToken: string
  stakeAmount: string
  depositedAt: bigint
}

/** Stake info returned from the agents mapping */
interface StakeInfoData {
  token: string
  amount: bigint
  depositedAt: bigint
  withdrawn: boolean
}

// JEJU token address - used to display "JEJU" instead of raw address
const JEJU_TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

function resolveTokenName(tokenAddr: string): string {
  if (!tokenAddr || tokenAddr === ZERO_ADDRESS) return 'None'
  if (tokenAddr.toLowerCase() === JEJU_TOKEN.toLowerCase()) return 'JEJU'
  return `${tokenAddr.slice(0, 6)}...${tokenAddr.slice(-4)}`
}

export function useRegistryAppDetails(agentId: bigint) {
  const { data: owner, refetch: refetchOwner } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [agentId],
  })

  const { data: tokenURI, refetch: refetchTokenURI } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [agentId],
  })

  const { data: agentData, refetch: refetchAgent } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'agents',
    args: [agentId],
  })

  const { data: tags, refetch: refetchTags } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentTags',
    args: [agentId],
  })

  const { data: a2aEndpoint, refetch: refetchEndpoint } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getA2AEndpoint',
    args: [agentId],
  })

  const isLoading = !owner

  // Parse tokenURI for name/description
  let parsedName = `Agent #${agentId}`
  let parsedDescription: string | undefined
  if (tokenURI) {
    try {
      const parsed = JSON.parse(tokenURI)
      if (parsed.name) parsedName = parsed.name
      if (parsed.description) parsedDescription = parsed.description
    } catch { /* not JSON */ }
  }

  // Extract stake info from agents mapping result
  // agentData is a tuple: [agentId, owner, tier, stakedToken, stakedAmount, registeredAt, lastActivityAt, isBanned, isSlashed]
  const tier = agentData ? Number((agentData as readonly unknown[])[2]) : 0
  const stakedToken = agentData ? String((agentData as readonly unknown[])[3]) : ZERO_ADDRESS
  const stakedAmount = agentData ? BigInt(String((agentData as readonly unknown[])[4])) : 0n
  const registeredAt = agentData ? BigInt(String((agentData as readonly unknown[])[5])) : 0n
  const stakeAmountFormatted = stakedAmount > 0n ? (Number(stakedAmount) / 1e18).toString() : '0'

  const app: RegisteredApp | null = owner
    ? {
        agentId,
        name: parsedName,
        description: parsedDescription,
        owner,
        tags: tags ? [...tags] : [],
        a2aEndpoint,
        stakeToken: resolveTokenName(stakedToken),
        stakeAmount: stakeAmountFormatted,
        stakeTier: tier,
        depositedAt: registeredAt,
      }
    : null

  const refetch = async () => {
    await Promise.all([refetchOwner(), refetchTokenURI(), refetchAgent(), refetchTags(), refetchEndpoint()])
  }

  return {
    app,
    isLoading,
    refetch,
  }
}

export function useRegistryMarketplaceActions() {
  const [lastTx, setLastTx] = useState<`0x${string}` | undefined>()
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: lastTx })
  const { writeAsync } = useTypedWriteContract()

  async function setEndpoints(
    agentId: bigint,
    a2aEndpoint: string,
    mcpEndpoint: string,
  ): Promise<{ success: boolean; error?: string }> {
    const hash = await writeAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setEndpoints',
      args: [agentId, a2aEndpoint, mcpEndpoint],
    })
    setLastTx(hash)
    return { success: true }
  }

  async function setCategory(
    agentId: bigint,
    category: string,
  ): Promise<{ success: boolean; error?: string }> {
    const hash = await writeAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setCategory',
      args: [agentId, category],
    })
    setLastTx(hash)
    return { success: true }
  }

  async function setX402Support(
    agentId: bigint,
    supported: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    const hash = await writeAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setX402Support',
      args: [agentId, supported],
    })
    setLastTx(hash)
    return { success: true }
  }

  return {
    setEndpoints,
    setCategory,
    setX402Support,
    lastTransaction: txReceipt,
  }
}
