/**
 * ERC-8004 Registry and Reputation Integration for Predimarket
 * User ban checking and reputation verification for prediction markets
 */

import { Address, createPublicClient, http, parseAbi } from 'viem';

// Use Jeju L3 chain
const JEJU_CHAIN = {
  id: 1337,
  name: 'Jeju L3',
  network: 'jeju',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
  },
};

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function getAgentId(address agentAddress) external view returns (uint256)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool)',
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function getBanReason(uint256 agentId) external view returns (string memory)',
  'function getBanExpiry(uint256 agentId) external view returns (uint256)',
]);

const REPUTATION_MANAGER_ABI = parseAbi([
  'function getReputation(uint256 agentId) external view returns (uint256)',
  'function hasMinimumReputation(uint256 agentId, uint256 minScore) external view returns (bool)',
]);

const IDENTITY_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const BAN_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const REPUTATION_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_REPUTATION_MANAGER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const PREDIMARKET_APP_ID = '0x' + Buffer.from('predimarket').toString('hex').padEnd(64, '0');

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  bannedUntil?: number;
}

export interface ReputationCheck {
  score: number;
  meetsMinimum: boolean;
}

function getPublicClient() {
  return createPublicClient({
    chain: JEJU_CHAIN,
    transport: http(),
  });
}

export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  if (BAN_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return { allowed: true };
  }

  try {
    const client = getPublicClient();
    
    let agentId: bigint;
    try {
      agentId = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentId',
        args: [userAddress],
      });
    } catch (error) {
      return { allowed: true };
    }

    const isBanned = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isBanned',
      args: [agentId],
    });

    if (isBanned) {
      const [reason, expiry] = await Promise.all([
        client.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'getBanReason',
          args: [agentId],
        }),
        client.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'getBanExpiry',
          args: [agentId],
        }),
      ]);

      return {
        allowed: false,
        reason: reason as string,
        bannedUntil: Number(expiry),
      };
    }

    const isAllowed = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAccessAllowed',
      args: [agentId, PREDIMARKET_APP_ID as `0x${string}`],
    });

    if (!isAllowed) {
      return {
        allowed: false,
        reason: 'Access denied for Predimarket',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('[ERC-8004] Error checking ban status:', error);
    return { allowed: true };
  }
}

export async function getUserReputation(userAddress: Address): Promise<ReputationCheck> {
  if (REPUTATION_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return { score: 0, meetsMinimum: true };
  }

  try {
    const client = getPublicClient();
    
    let agentId: bigint;
    try {
      agentId = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentId',
        args: [userAddress],
      });
    } catch (error) {
      return { score: 0, meetsMinimum: true };
    }

    const score = await client.readContract({
      address: REPUTATION_MANAGER_ADDRESS,
      abi: REPUTATION_MANAGER_ABI,
      functionName: 'getReputation',
      args: [agentId],
    });

    const minThreshold = BigInt(50);
    const meetsMinimum = await client.readContract({
      address: REPUTATION_MANAGER_ADDRESS,
      abi: REPUTATION_MANAGER_ABI,
      functionName: 'hasMinimumReputation',
      args: [agentId, minThreshold],
    });

    return {
      score: Number(score),
      meetsMinimum: Boolean(meetsMinimum),
    };
  } catch (error) {
    console.error('[ERC-8004] Error checking reputation:', error);
    return { score: 0, meetsMinimum: true };
  }
}

export async function verifyUserForTrading(userAddress: Address): Promise<{
  allowed: boolean;
  reputation: ReputationCheck;
  banStatus: BanCheckResult;
}> {
  const [reputation, banStatus] = await Promise.all([
    getUserReputation(userAddress),
    checkUserBan(userAddress),
  ]);

  return {
    allowed: banStatus.allowed && reputation.meetsMinimum,
    reputation,
    banStatus,
  };
}

