import { Address, createPublicClient, http, parseAbi } from 'viem';
import { jeju } from '@/config/chains';
import { CONTRACTS } from '@/config';

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const IDENTITY_REGISTRY_ADDRESS = CONTRACTS.identityRegistry || ZERO_ADDRESS;
const BAN_MANAGER_ADDRESS = CONTRACTS.banManager || ZERO_ADDRESS;
const REPUTATION_MANAGER_ADDRESS = CONTRACTS.reputationLabelManager || ZERO_ADDRESS;

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  bannedUntil?: number;
}

export interface ReputationCheck {
  score: number;
  meetsMinimum: boolean;
}

const publicClient = createPublicClient({
  chain: jeju,
  transport: http(),
});

export async function checkUserBan(userAddress: Address, appId?: string): Promise<BanCheckResult> {
  if (BAN_MANAGER_ADDRESS === ZERO_ADDRESS) return { allowed: true };

  const agentId = await publicClient.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentId',
    args: [userAddress],
  });

  if (!agentId || agentId === 0n) return { allowed: true };

  const isBanned = await publicClient.readContract({
    address: BAN_MANAGER_ADDRESS,
    abi: BAN_MANAGER_ABI,
    functionName: 'isBanned',
    args: [agentId],
  });

  if (isBanned) {
    const [reason, expiry] = await Promise.all([
      publicClient.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'getBanReason',
        args: [agentId],
      }),
      publicClient.readContract({
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

  if (appId) {
    const appIdBytes = `0x${Buffer.from(appId).toString('hex').padEnd(64, '0')}` as `0x${string}`;
    const isAllowed = await publicClient.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAccessAllowed',
      args: [agentId, appIdBytes],
    });

    if (!isAllowed) {
      return { allowed: false, reason: `Access denied for ${appId}` };
    }
  }

  return { allowed: true };
}

export async function getUserReputation(userAddress: Address): Promise<ReputationCheck> {
  if (REPUTATION_MANAGER_ADDRESS === ZERO_ADDRESS) return { score: 0, meetsMinimum: true };

  const agentId = await publicClient.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentId',
    args: [userAddress],
  });

  if (!agentId || agentId === 0n) return { score: 0, meetsMinimum: true };

  const [score, meetsMinimum] = await Promise.all([
    publicClient.readContract({
      address: REPUTATION_MANAGER_ADDRESS,
      abi: REPUTATION_MANAGER_ABI,
      functionName: 'getReputation',
      args: [agentId],
    }),
    publicClient.readContract({
      address: REPUTATION_MANAGER_ADDRESS,
      abi: REPUTATION_MANAGER_ABI,
      functionName: 'hasMinimumReputation',
      args: [agentId, 50n],
    }),
  ]);

  return { score: Number(score), meetsMinimum: Boolean(meetsMinimum) };
}

export async function verifyUserForTrading(userAddress: Address, appId?: string): Promise<{
  allowed: boolean;
  reputation: ReputationCheck;
  banStatus: BanCheckResult;
}> {
  const [reputation, banStatus] = await Promise.all([
    getUserReputation(userAddress),
    checkUserBan(userAddress, appId),
  ]);

  return {
    allowed: banStatus.allowed && reputation.meetsMinimum,
    reputation,
    banStatus,
  };
}



