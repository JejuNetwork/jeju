/**
 * ERC-8004 Registry Integration for Indexer
 */

import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { inferChainFromRpcUrl } from './chain-utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readContract<T>(client: ReturnType<typeof createPublicClient>, params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).readContract(params) as Promise<T>;
}

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function getAgentId(address agentAddress) external view returns (uint256)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function getBanReason(uint256 agentId) external view returns (string memory)',
]);

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
}

function getPublicClient() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error('RPC_URL environment variable is required');
  const chain = inferChainFromRpcUrl(rpcUrl);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function checkUserBan(userAddress: string): Promise<BanCheckResult> {
  const banManagerAddress = process.env.BAN_MANAGER_ADDRESS;
  const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
  
  if (!banManagerAddress || !identityRegistryAddress) {
    return { allowed: true };
  }

  const publicClient = getPublicClient();
  
  const agentId = await readContract<bigint>(publicClient, {
    address: identityRegistryAddress as Address,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentId',
    args: [userAddress as Address],
  });
  
  const isBanned = await readContract<boolean>(publicClient, {
    address: banManagerAddress as Address,
    abi: BAN_MANAGER_ABI,
    functionName: 'isBanned',
    args: [agentId],
  });

  if (isBanned) {
    const reason = await readContract<string>(publicClient, {
      address: banManagerAddress as Address,
      abi: BAN_MANAGER_ABI,
      functionName: 'getBanReason',
      args: [agentId],
    });
    return { allowed: false, reason };
  }

  return { allowed: true };
}
