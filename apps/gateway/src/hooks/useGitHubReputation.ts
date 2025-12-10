import { useState, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import { CONTRACTS, LEADERBOARD_API_URL } from '../config';

const LEADERBOARD_API = LEADERBOARD_API_URL;

// Contract address - queries will be skipped if not configured
const GITHUB_REPUTATION_PROVIDER_ADDRESS = CONTRACTS.githubReputationProvider;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// Check if on-chain queries are enabled (not zero address)
const isOnChainEnabled = GITHUB_REPUTATION_PROVIDER_ADDRESS !== ZERO_ADDRESS;

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
] as const;

export interface LeaderboardReputation {
  username: string;
  avatarUrl: string;
  wallet: {
    address: string;
    chainId: string;
    isVerified: boolean;
    verifiedAt: string | null;
  } | null;
  reputation: {
    totalScore: number;
    normalizedScore: number;
    prScore: number;
    issueScore: number;
    reviewScore: number;
    commitScore: number;
    mergedPrCount: number;
    totalPrCount: number;
    totalCommits: number;
  };
  attestation: {
    hash: string;
    signature: string | null;
    normalizedScore: number;
    calculatedAt: string;
    attestedAt: string | null;
    agentId: number | null;
    txHash: string | null;
  } | null;
}

export interface OnChainReputation {
  score: number;
  isValid: boolean;
  lastUpdated: bigint;
  hasBoost: boolean;
  stakeDiscount: number;
}

export function useGitHubReputation() {
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardReputation | null>(null);
  
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: txHash });

  // Query on-chain reputation (only if contract is configured)
  const { data: agentReputation, refetch: refetchAgentReputation } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'hasReputationBoost',
    args: address ? [address] : undefined,
    query: { enabled: isOnChainEnabled && !!address },
  });

  const { data: stakeDiscount, refetch: refetchStakeDiscount } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'getStakeDiscount',
    args: address ? [address] : undefined,
    query: { enabled: isOnChainEnabled && !!address },
  });

  const { data: onChainProfile } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'getProfile',
    args: address ? [address] : undefined,
    query: { enabled: isOnChainEnabled && !!address },
  });

  /**
   * Fetch reputation from leaderboard API
   */
  const fetchLeaderboardReputation = useCallback(async (walletAddress?: string) => {
    const targetAddress = walletAddress || address;
    if (!targetAddress) {
      setError('No wallet address');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${LEADERBOARD_API}/api/attestation?wallet=${targetAddress}&chainId=eip155:1`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch reputation');
      }

      const data: LeaderboardReputation = await response.json();
      setLeaderboardData(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * Verify wallet ownership by signing a message
   */
  const verifyWallet = useCallback(async (username: string) => {
    if (!address) {
      setError('No wallet connected');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      // Get verification message with timestamp
      const messageResponse = await fetch(
        `${LEADERBOARD_API}/api/wallet/verify?username=${username}&wallet=${address}`
      );

      if (!messageResponse.ok) {
        const errorData = await messageResponse.json();
        throw new Error(errorData.error || 'Failed to get verification message');
      }

      const { message, timestamp } = await messageResponse.json();

      // Sign the message
      const signature = await signMessageAsync({ message });

      // Submit verification with timestamp for replay protection
      const verifyResponse = await fetch(`${LEADERBOARD_API}/api/wallet/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          walletAddress: address,
          signature,
          message,
          timestamp,
          chainId: 'eip155:1',
        }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.error || 'Verification failed');
      }

      return true;
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Verification failed';
      setError(errMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [address, signMessageAsync]);

  /**
   * Request a new attestation from the leaderboard
   */
  const requestAttestation = useCallback(async (username: string, agentId?: number) => {
    if (!address) {
      setError('No wallet connected');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${LEADERBOARD_API}/api/attestation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          walletAddress: address,
          chainId: 'eip155:1',
          agentId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to request attestation');
      }

      const data = await response.json();
      
      // Refresh leaderboard data
      await fetchLeaderboardReputation();
      
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Attestation request failed';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, fetchLeaderboardReputation]);

  /**
   * Submit attestation on-chain
   */
  const submitAttestationOnChain = useCallback(async (
    agentId: bigint,
    score: number,
    totalScore: number,
    mergedPrs: number,
    totalCommits: number,
    timestamp: number,
    oracleSignature: string,
    attestationHash: string
  ) => {
    if (!isOnChainEnabled || !GITHUB_REPUTATION_PROVIDER_ADDRESS) {
      setError('GitHubReputationProvider contract not configured');
      return null;
    }

    if (!oracleSignature || oracleSignature === '0x') {
      setError('Missing oracle signature - attestation not signed');
      return null;
    }

    if (!address) {
      setError('No wallet connected');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const hash = await writeContractAsync({
        address: GITHUB_REPUTATION_PROVIDER_ADDRESS,
        abi: GITHUB_REPUTATION_PROVIDER_ABI,
        functionName: 'submitAttestation',
        args: [
          agentId,
          score,
          BigInt(totalScore),
          BigInt(mergedPrs),
          BigInt(totalCommits),
          BigInt(timestamp),
          oracleSignature as `0x${string}`,
        ],
      });

      setTxHash(hash);

      // Confirm submission to leaderboard API
      await fetch(`${LEADERBOARD_API}/api/attestation/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attestationHash,
          txHash: hash,
          walletAddress: address,
          chainId: 'eip155:1',
        }),
      });

      // Refresh on-chain and off-chain data
      await Promise.all([
        refetchAgentReputation(),
        refetchStakeDiscount(),
        fetchLeaderboardReputation(),
      ]);

      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'On-chain submission failed';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, writeContractAsync, refetchAgentReputation, refetchStakeDiscount, fetchLeaderboardReputation]);

  /**
   * Link agent to GitHub account
   */
  const linkAgentToGitHub = useCallback(async (username: string, agentId: number, registryAddress: string) => {
    if (!address) {
      setError('No wallet connected');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${LEADERBOARD_API}/api/agent/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          walletAddress: address,
          agentId,
          registryAddress,
          chainId: 'eip155:1',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to link agent');
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent linking failed';
      setError(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Parse on-chain data - memoized to prevent recomputation
  const onChainReputation = useMemo<OnChainReputation | null>(() => {
    if (!agentReputation) return null;
    return {
      score: (agentReputation as [boolean, number])[1],
      isValid: true,
      lastUpdated: 0n,
      hasBoost: (agentReputation as [boolean, number])[0],
      stakeDiscount: Number(stakeDiscount || 0n) / 100,
    };
  }, [agentReputation, stakeDiscount]);

  const gitHubProfile = useMemo(() => {
    if (!onChainProfile) return null;
    return {
      username: (onChainProfile as { username: string }).username,
      currentScore: (onChainProfile as { currentScore: number }).currentScore,
      lastUpdated: (onChainProfile as { lastUpdated: bigint }).lastUpdated,
      attestationCount: (onChainProfile as { attestationCount: bigint }).attestationCount,
      isLinked: (onChainProfile as { isLinked: boolean }).isLinked,
    };
  }, [onChainProfile]);

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
      await Promise.all([refetchAgentReputation(), refetchStakeDiscount()]);
    },
  };
}

export function useAgentReputation(agentId: bigint | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: isOnChainEnabled ? GITHUB_REPUTATION_PROVIDER_ADDRESS : undefined,
    abi: GITHUB_REPUTATION_PROVIDER_ABI,
    functionName: 'getAgentReputation',
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: isOnChainEnabled && agentId !== undefined },
  });

  const reputation = data ? {
    score: (data as [number, boolean, bigint])[0],
    isValid: (data as [number, boolean, bigint])[1],
    lastUpdated: (data as [number, boolean, bigint])[2],
  } : null;

  return { reputation, isLoading, error, refetch, isConfigured: isOnChainEnabled };
}
