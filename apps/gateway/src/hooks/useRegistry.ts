/**
 * @fileoverview Hook for interacting with IdentityRegistry contract
 * @module gateway/hooks/useRegistry
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useState } from 'react';
import { Address, parseEther } from 'viem';
import { IERC20_ABI } from '../lib/contracts';

const REGISTRY_ADDRESS = (import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address;

const IDENTITY_REGISTRY_ABI = [
  {
    "inputs": [
      {"internalType": "string", "name": "tokenURI_", "type": "string"},
      {"internalType": "string[]", "name": "tags_", "type": "string[]"},
      {"internalType": "string", "name": "a2aEndpoint_", "type": "string"},
      {"internalType": "address", "name": "stakeToken_", "type": "address"}
    ],
    "name": "registerWithStake",
    "outputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "withdrawStake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "token", "type": "address"}],
    "name": "calculateRequiredStake",
    "outputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "string", "name": "tag", "type": "string"}],
    "name": "getAgentsByTag",
    "outputs": [{"internalType": "uint256[]", "name": "agentIds", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "agentId", "type": "uint256"},
      {"internalType": "string", "name": "key", "type": "string"}
    ],
    "name": "getMetadata",
    "outputs": [{"internalType": "bytes", "name": "value", "type": "bytes"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "ownerOf",
    "outputs": [{"internalType": "address", "name": "owner", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "tokenURI",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "getStakeInfo",
    "outputs": [
      {
        "components": [
          {"internalType": "address", "name": "token", "type": "address"},
          {"internalType": "uint256", "name": "amount", "type": "uint256"},
          {"internalType": "uint256", "name": "depositedAt", "type": "uint256"},
          {"internalType": "bool", "name": "withdrawn", "type": "bool"}
        ],
        "internalType": "struct IdentityRegistryWithStaking.StakeInfo",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "getAgentTags",
    "outputs": [{"internalType": "string[]", "name": "tags", "type": "string[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "offset", "type": "uint256"},
      {"internalType": "uint256", "name": "limit", "type": "uint256"}
    ],
    "name": "getAllAgents",
    "outputs": [{"internalType": "uint256[]", "name": "agentIds", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

interface RegisteredApp {
  agentId: bigint;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  a2aEndpoint?: string;
  stakeToken: string;
  stakeAmount: string;
  depositedAt: bigint;
}

export interface RegisterAppParams {
  tokenURI: string;
  tags: string[];
  a2aEndpoint: string;
  stakeToken: Address;
  stakeAmount: bigint;
}

export function useRegistry() {
  const [lastTx, setLastTx] = useState<`0x${string}` | undefined>();

  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: lastTx });

  const { writeContractAsync } = useWriteContract();

  async function registerApp(params: RegisterAppParams): Promise<{ success: boolean; error?: string; agentId?: bigint }> {
    const { tokenURI, tags, a2aEndpoint, stakeToken, stakeAmount } = params;

    // Approve ERC20 if not ETH
    if (stakeToken !== '0x0000000000000000000000000000000000000000') {
      const approvalHash = await writeContractAsync({
        address: stakeToken,
        abi: IERC20_ABI,
        functionName: 'approve',
        args: [REGISTRY_ADDRESS, stakeAmount],
      });

      // Wait for approval
      // (You might want to add useWaitForTransactionReceipt here)
    }

    // Register with stake
    const hash = await writeContractAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'registerWithStake',
      args: [tokenURI, tags, a2aEndpoint, stakeToken],
      value: stakeToken === '0x0000000000000000000000000000000000000000' ? stakeAmount : 0n,
    });

    setLastTx(hash);

    return { success: true };
  }

  async function withdrawStake(agentId: bigint): Promise<{ success: boolean; error?: string }> {
    const hash = await writeContractAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'withdrawStake',
      args: [agentId],
    });

    setLastTx(hash);

    return { success: true };
  }

  function getRequiredStake(token: Address): bigint | null {
    const { data } = useReadContract({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'calculateRequiredStake',
      args: [token],
    });

    return data ? (data as bigint) : null;
  }

  return {
    registerApp,
    withdrawStake,
    getRequiredStake,
    lastTransaction: txReceipt,
  };
}

export function useRegisteredApps(tag?: string) {
  const { data: agentIds, refetch, isLoading } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: tag ? 'getAgentsByTag' : 'getAllAgents',
    args: tag ? [tag] : [0n, 100n], // Get first 100 apps
  });

  // For each agentId, fetch details (you'd typically batch this)
  const [apps, setApps] = useState<RegisteredApp[]>([]);

  // TODO: Fetch app details for each agentId
  // This would ideally use multicall or GraphQL from indexer

  return {
    apps,
    isLoading,
    refetch,
  };
}

export function useRegistryAppDetails(agentId: bigint) {
  const [app, setApp] = useState<RegisteredApp | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // TODO: Fetch app details from contract or indexer GraphQL

  return {
    app,
    isLoading,
    refetch: async () => {},
  };
}


