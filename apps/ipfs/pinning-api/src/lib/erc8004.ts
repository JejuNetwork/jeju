/**
 * ERC-8004 Registry Integration for IPFS Service
 * User ban checking for file storage access
 */

import { Address, createPublicClient, http, parseAbi } from 'viem';

const JEJU_CHAIN = {
  id: 1337,
  name: 'Jeju L3',
  network: 'jeju',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'http://localhost:9545'] },
    public: { http: [process.env.RPC_URL || 'http://localhost:9545'] },
  },
};

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function getAgentId(address agentAddress) external view returns (uint256)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function getBanReason(uint256 agentId) external view returns (string memory)',
  'function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool)',
]);

const IDENTITY_REGISTRY_ADDRESS = (process.env.IDENTITY_REGISTRY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const BAN_MANAGER_ADDRESS = (process.env.BAN_MANAGER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const IPFS_APP_ID = '0x' + Buffer.from('jeju-ipfs').toString('hex').padEnd(64, '0');

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
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
    
    const agentId = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentId',
      args: [userAddress],
    });

    const isBanned = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isBanned',
      args: [agentId],
    });

    if (isBanned) {
      const reason = await client.readContract({
        address: BAN_MANAGER_ADDRESS,
        abi: BAN_MANAGER_ABI,
        functionName: 'getBanReason',
        args: [agentId],
      });

      return {
        allowed: false,
        reason: reason as string,
      };
    }

    const isAllowed = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAccessAllowed',
      args: [agentId, IPFS_APP_ID as `0x${string}`],
    });

    if (!isAllowed) {
      return {
        allowed: false,
        reason: 'Access denied for IPFS service',
      };
    }

    return { allowed: true };
  } catch (error) {
    return { allowed: true };
  }
}

