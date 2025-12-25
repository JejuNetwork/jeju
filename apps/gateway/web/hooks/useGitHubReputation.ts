import { ZERO_ADDRESS } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useSignMessage,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { CHAIN_ID, CONTRACTS, LEADERBOARD_API_URL } from '../../lib/config'
import { useTypedWriteContract } from './useTypedWriteContract'

const LEADERBOARD_API = LEADERBOARD_API_URL
// Use CAIP-2 format for chain ID
const LEADERBOARD_CHAIN_ID = `eip155:${CHAIN_ID}`

// Contract address - queries will be skipped if not configured
const GITHUB_REPUTATION_PROVIDER_ADDRESS = CONTRACTS.githubReputationProvider

// Check if on-chain queries are enabled (not zero address)
const isOnChainEnabled = GITHUB_REPUTATION_PROVIDER_ADDRESS !== ZERO_ADDRESS

const GITHUB_REPUTATION_PROVIDER_ABI = [
  {
    name: 'submitAttestation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'score', type: 'uint8' },
      { name: 'totalScore', type: 'uint256' },
      { name: 'mergedPrs', type: 'uint256' },
      { name: 'totalCommits', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getAgentReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'score', type: 'uint8' },
      { name: 'isValid', type: 'bool' },
      { name: 'lastUpdated', type: 'uint256' },
    ],
  },
  {
    name: 'getStakeDiscount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: 'discountBps', type: 'uint256' }],
  },
  {
    name: 'hasReputationBoost',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      { name: 'hasBoost', type: 'bool' },
      { name: 'score', type: 'uint8' },
    ],
  },
  {
    name: 'getProfile',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'username', type: 'string' },
          { name: 'currentScore', type: 'uint8' },
          { name: 'lastUpdated', type: 'uint256' },
          { name: 'attestationCount', type: 'uint256' },
          { name: 'isLinked', type: 'bool' },
        ],
      },
    ],
  },
] as const

export interface LeaderboardReputation {
  username: string
  avatarUrl: string
  wallet: {
    address: string
    chainId: string
    isVerified: boolean
    verifiedAt: string | null
  } | null
  reputation: {
    totalScore: number
    normalizedScore: number
    prScore: number
    issueScore: number
    reviewScore: number
    commitScore: number
    mergedPrCount: number
    totalPrCount: number
    totalCommits: number
  }
  attestation: {
    hash: string
    signature: string | null
    normalizedScore: number
    calculatedAt: string
    attestedAt: string | null
    agentId: number | null
    txHash: string | null
  } | null
}

export interface OnChainReputation {
  score: number
  isValid: boolean
  lastUpdated: bigint
  hasBoost: boolean
  stakeDiscount: number
}

async function fetchLeaderboardReputationApi(
  walletAddress: string,
): Promise<LeaderboardReputation> {
  const response = await fetch(
    `${LEADERBOARD_API}/api/attestation?wallet=${walletAddress}&chainId=${LEADERBOARD_CHAIN_ID}`,
  )
  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to fetch reputation')
  }
  return response.json()
}

export function useGitHubReputation() {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const { signMessageAsync } = useSignMessage()
  const { writeAsync: writeContractAsync } = useTypedWriteContract()
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: txHash })

  // Query on-chain reputation (only if contract is configured)
  const { data: agentReputation, refetch: refetchAgentReputation } =
    useReadContract({
      address: isOnChainEnabled
        ? GITHUB_REPUTATION_PROVIDER_ADDRESS
        : undefined,
      abi: GITHUB_REPUTATION_PROVIDER_ABI,
      functionName: 'hasReputationBoost',
      args: address ? [address] : undefined,
      query: { enabled: isOnChainEnabled && !!address },
    })

  const { data: stakeDiscount, refetch: refetchStakeDiscount } =
    useReadContract({
      address: isOnChainEnabled
        ? GITHUB_REPUTATION_PROVIDER_ADDRESS
        : undefined,
      abi: GITHUB_REPUTATION_PROVIDER_ABI,
      functionName: 'getStakeDiscount',
      args: address ? [address] : undefined,
      query: { enabled: isOnChainEnabled && !!address },
    })

  const { data: onChainProfile } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'getProfile',
    args: address ? [address] : undefined,
    query: { enabled: isOnChainEnabled && !!address },
  })

  // React Query for leaderboard reputation
  const {
    data: leaderboardData = null,
    isLoading: reputationLoading,
    error: reputationError,
    refetch: refetchLeaderboardReputation,
  } = useQuery({
    queryKey: ['leaderboard-reputation', address],
    queryFn: () => fetchLeaderboardReputationApi(address ?? ''),
    enabled: !!address,
  })

  const fetchLeaderboardReputation = async (walletAddress?: string) => {
    const targetAddress = walletAddress || address
    if (!targetAddress) return null
    if (targetAddress === address) {
      await refetchLeaderboardReputation()
      return leaderboardData
    }
    return fetchLeaderboardReputationApi(targetAddress)
  }

  // Mutation for wallet verification
  const verifyWalletMutation = useMutation({
    mutationFn: async ({
      username,
      githubToken,
    }: {
      username: string
      githubToken: string
    }) => {
      if (!address) throw new Error('No wallet connected')
      if (!githubToken) throw new Error('GitHub authentication required')

      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${githubToken}`,
      }

      // Get verification message with timestamp
      const messageResponse = await fetch(
        `${LEADERBOARD_API}/api/wallet/verify?username=${username}&wallet=${address}`,
        { headers: authHeaders },
      )

      if (!messageResponse.ok) {
        const errorData = await messageResponse.json()
        throw new Error(errorData.error || 'Failed to get verification message')
      }

      const { message, timestamp } = await messageResponse.json()

      // Sign the message
      const signature = await signMessageAsync({ message, account: address })

      // Submit verification with timestamp for replay protection
      const verifyResponse = await fetch(
        `${LEADERBOARD_API}/api/wallet/verify`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            username,
            walletAddress: address,
            signature,
            message,
            timestamp,
            chainId: LEADERBOARD_CHAIN_ID,
          }),
        },
      )

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json()
        throw new Error(errorData.error || 'Verification failed')
      }

      return true
    },
  })

  const verifyWallet = async (username: string, githubToken: string) => {
    const result = await verifyWalletMutation.mutateAsync({
      username,
      githubToken,
    })
    return result
  }

  // Mutation for requesting attestation
  const requestAttestationMutation = useMutation({
    mutationFn: async ({
      username,
      githubToken,
      agentId,
    }: {
      username: string
      githubToken: string
      agentId?: number
    }) => {
      if (!address) throw new Error('No wallet connected')
      if (!githubToken) throw new Error('GitHub authentication required')

      const response = await fetch(`${LEADERBOARD_API}/api/attestation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${githubToken}`,
        },
        body: JSON.stringify({
          username,
          walletAddress: address,
          chainId: LEADERBOARD_CHAIN_ID,
          agentId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to request attestation')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['leaderboard-reputation', address],
      })
    },
  })

  const requestAttestation = async (
    username: string,
    githubToken: string,
    agentId?: number,
  ) => {
    return requestAttestationMutation.mutateAsync({
      username,
      githubToken,
      agentId,
    })
  }

  // Mutation for on-chain attestation submission
  const submitAttestationMutation = useMutation({
    mutationFn: async ({
      agentId,
      score,
      totalScore,
      mergedPrs,
      totalCommits,
      timestamp,
      oracleSignature,
      attestationHash,
      githubToken,
    }: {
      agentId: bigint
      score: number
      totalScore: number
      mergedPrs: number
      totalCommits: number
      timestamp: number
      oracleSignature: string
      attestationHash: string
      githubToken: string
    }) => {
      if (!isOnChainEnabled || !GITHUB_REPUTATION_PROVIDER_ADDRESS) {
        throw new Error('GitHubReputationProvider contract not configured')
      }
      if (!oracleSignature || oracleSignature === '0x') {
        throw new Error('Missing oracle signature - attestation not signed')
      }
      if (!address) throw new Error('No wallet connected')
      if (!githubToken) throw new Error('GitHub authentication required')

      const hash = await writeContractAsync({
        address: GITHUB_REPUTATION_PROVIDER_ADDRESS,
        abi: GITHUB_REPUTATION_PROVIDER_ABI,
        functionName: 'submitAttestation',
        account: address,
        args: [
          agentId,
          score,
          BigInt(totalScore),
          BigInt(mergedPrs),
          BigInt(totalCommits),
          BigInt(timestamp),
          oracleSignature as `0x${string}`,
        ],
      })

      setTxHash(hash)

      // Confirm submission to leaderboard API
      await fetch(`${LEADERBOARD_API}/api/attestation/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${githubToken}`,
        },
        body: JSON.stringify({
          attestationHash,
          txHash: hash,
          walletAddress: address,
          chainId: LEADERBOARD_CHAIN_ID,
        }),
      })

      return hash
    },
    onSuccess: () => {
      refetchAgentReputation()
      refetchStakeDiscount()
      queryClient.invalidateQueries({
        queryKey: ['leaderboard-reputation', address],
      })
    },
  })

  const submitAttestationOnChain = async (
    agentId: bigint,
    score: number,
    totalScore: number,
    mergedPrs: number,
    totalCommits: number,
    timestamp: number,
    oracleSignature: string,
    attestationHash: string,
    githubToken: string,
  ) => {
    return submitAttestationMutation.mutateAsync({
      agentId,
      score,
      totalScore,
      mergedPrs,
      totalCommits,
      timestamp,
      oracleSignature,
      attestationHash,
      githubToken,
    })
  }

  // Mutation for linking agent to GitHub
  const linkAgentMutation = useMutation({
    mutationFn: async ({
      username,
      agentId,
      registryAddress,
      githubToken,
    }: {
      username: string
      agentId: number
      registryAddress: string
      githubToken: string
    }) => {
      if (!address) throw new Error('No wallet connected')
      if (!githubToken) throw new Error('GitHub authentication required')

      const response = await fetch(`${LEADERBOARD_API}/api/agent/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${githubToken}`,
        },
        body: JSON.stringify({
          username,
          walletAddress: address,
          agentId,
          registryAddress,
          chainId: LEADERBOARD_CHAIN_ID,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to link agent')
      }

      return true
    },
  })

  const linkAgentToGitHub = async (
    username: string,
    agentId: number,
    registryAddress: string,
    githubToken: string,
  ) => {
    return linkAgentMutation.mutateAsync({
      username,
      agentId,
      registryAddress,
      githubToken,
    })
  }

  // Parse on-chain data - memoized to prevent recomputation
  const onChainReputation = useMemo<OnChainReputation | null>(() => {
    if (!agentReputation) return null
    const [hasBoost, score] = agentReputation as [boolean, number]
    return {
      score,
      isValid: true,
      lastUpdated: 0n,
      hasBoost,
      stakeDiscount: stakeDiscount ? Number(stakeDiscount) / 100 : 0,
    }
  }, [agentReputation, stakeDiscount])

  const gitHubProfile = useMemo(() => {
    if (!onChainProfile) return null
    return {
      username: (onChainProfile as { username: string }).username,
      currentScore: (onChainProfile as { currentScore: number }).currentScore,
      lastUpdated: (onChainProfile as { lastUpdated: bigint }).lastUpdated,
      attestationCount: (onChainProfile as { attestationCount: bigint })
        .attestationCount,
      isLinked: (onChainProfile as { isLinked: boolean }).isLinked,
    }
  }, [onChainProfile])

  // Aggregate loading and error states from all mutations
  const loading =
    reputationLoading ||
    verifyWalletMutation.isPending ||
    requestAttestationMutation.isPending ||
    submitAttestationMutation.isPending ||
    linkAgentMutation.isPending

  const error =
    reputationError?.message ??
    verifyWalletMutation.error?.message ??
    requestAttestationMutation.error?.message ??
    submitAttestationMutation.error?.message ??
    linkAgentMutation.error?.message ??
    null

  return {
    // State
    loading,
    error,
    leaderboardData,
    onChainReputation,
    gitHubProfile,
    txHash,
    txReceipt,

    // Actions
    fetchLeaderboardReputation,
    verifyWallet,
    requestAttestation,
    submitAttestationOnChain,
    linkAgentToGitHub,

    // Refetch helpers
    refetchOnChain: async () => {
      await Promise.all([refetchAgentReputation(), refetchStakeDiscount()])
    },
  }
}

export function useAgentReputation(agentId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'getAgentReputation',
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: isOnChainEnabled && agentId !== undefined },
  })

  const reputation = data
    ? {
        score: (data as [number, boolean, bigint])[0],
        isValid: (data as [number, boolean, bigint])[1],
        lastUpdated: (data as [number, boolean, bigint])[2],
      }
    : null

  return {
    reputation,
    isLoading,
    error,
    refetch,
    isConfigured: isOnChainEnabled,
  }
}
