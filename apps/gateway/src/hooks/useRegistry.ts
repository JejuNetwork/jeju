import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useState } from 'react';
import { Address } from 'viem';
import { IERC20_ABI, ZERO_ADDRESS } from '../lib/contracts';
import { CONTRACTS } from '../config';

export const IDENTITY_REGISTRY_ADDRESS = CONTRACTS.identityRegistry;
const REGISTRY_ADDRESS = IDENTITY_REGISTRY_ADDRESS;

const IDENTITY_REGISTRY_ABI = [
  { inputs: [{ internalType: 'string', name: 'tokenURI_', type: 'string' }, { internalType: 'string[]', name: 'tags_', type: 'string[]' }, { internalType: 'string', name: 'a2aEndpoint_', type: 'string' }, { internalType: 'address', name: 'stakeToken_', type: 'address' }], name: 'registerWithStake', outputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'withdrawStake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }], name: 'calculateRequiredStake', outputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'string', name: 'tag', type: 'string' }], name: 'getAgentsByTag', outputs: [{ internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'key', type: 'string' }], name: 'getMetadata', outputs: [{ internalType: 'bytes', name: 'value', type: 'bytes' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'ownerOf', outputs: [{ internalType: 'address', name: 'owner', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'tokenURI', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getStakeInfo', outputs: [{ components: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }, { internalType: 'uint256', name: 'depositedAt', type: 'uint256' }, { internalType: 'bool', name: 'withdrawn', type: 'bool' }], internalType: 'struct IdentityRegistryWithStaking.StakeInfo', name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getAgentTags', outputs: [{ internalType: 'string[]', name: 'tags', type: 'string[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'offset', type: 'uint256' }, { internalType: 'uint256', name: 'limit', type: 'uint256' }], name: 'getAllAgents', outputs: [{ internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getA2AEndpoint', outputs: [{ internalType: 'string', name: 'endpoint', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getMCPEndpoint', outputs: [{ internalType: 'string', name: 'endpoint', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getServiceType', outputs: [{ internalType: 'string', name: 'serviceType', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getCategory', outputs: [{ internalType: 'string', name: 'category', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getX402Support', outputs: [{ internalType: 'bool', name: 'supported', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getMarketplaceInfo', outputs: [{ internalType: 'string', name: 'a2aEndpoint', type: 'string' }, { internalType: 'string', name: 'mcpEndpoint', type: 'string' }, { internalType: 'string', name: 'serviceType', type: 'string' }, { internalType: 'string', name: 'category', type: 'string' }, { internalType: 'bool', name: 'x402Supported', type: 'bool' }, { internalType: 'uint8', name: 'tier', type: 'uint8' }, { internalType: 'bool', name: 'banned', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'offset', type: 'uint256' }, { internalType: 'uint256', name: 'limit', type: 'uint256' }], name: 'getActiveAgents', outputs: [{ internalType: 'uint256[]', name: 'agentIds', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'endpoint', type: 'string' }], name: 'setA2AEndpoint', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'endpoint', type: 'string' }], name: 'setMCPEndpoint', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'a2aEndpoint', type: 'string' }, { internalType: 'string', name: 'mcpEndpoint', type: 'string' }], name: 'setEndpoints', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'serviceType', type: 'string' }], name: 'setServiceType', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'string', name: 'category', type: 'string' }], name: 'setCategory', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }, { internalType: 'bool', name: 'supported', type: 'bool' }], name: 'setX402Support', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

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

    if (stakeToken !== ZERO_ADDRESS) {
      await writeContractAsync({ address: stakeToken, abi: IERC20_ABI, functionName: 'approve', args: [REGISTRY_ADDRESS, stakeAmount] });
    }

    const hash = await writeContractAsync({
      address: REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'registerWithStake',
      args: [tokenURI, tags, a2aEndpoint, stakeToken],
      value: stakeToken === ZERO_ADDRESS ? stakeAmount : 0n,
    });

    setLastTx(hash);
    return { success: true };
  }

  async function withdrawStake(agentId: bigint): Promise<{ success: boolean; error?: string }> {
    const hash = await writeContractAsync({ address: REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: 'withdrawStake', args: [agentId] });
    setLastTx(hash);
    return { success: true };
  }

  return { registerApp, withdrawStake, lastTransaction: txReceipt };
}

export function useRequiredStake(token: Address | undefined) {
  const { data } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'calculateRequiredStake',
    args: token ? [token] : undefined,
  });
  return data ? (data as bigint) : null;
}

interface MarketplaceInfo {
  a2aEndpoint: string;
  mcpEndpoint: string;
  serviceType: string;
  category: string;
  x402Supported: boolean;
  tier: number;
  banned: boolean;
}

export function useActiveAgents(offset = 0n, limit = 100n) {
  const { data, refetch, isLoading, error } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getActiveAgents',
    args: [offset, limit],
  });

  return { agentIds: data as bigint[] | undefined, isLoading, error, refetch };
}

export function useMarketplaceInfo(agentId: bigint | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getMarketplaceInfo',
    args: agentId !== undefined ? [agentId] : undefined,
  });

  const info: MarketplaceInfo | undefined = data ? {
    a2aEndpoint: (data as [string, string, string, string, boolean, number, boolean])[0],
    mcpEndpoint: (data as [string, string, string, string, boolean, number, boolean])[1],
    serviceType: (data as [string, string, string, string, boolean, number, boolean])[2],
    category: (data as [string, string, string, string, boolean, number, boolean])[3],
    x402Supported: (data as [string, string, string, string, boolean, number, boolean])[4],
    tier: (data as [string, string, string, string, boolean, number, boolean])[5],
    banned: (data as [string, string, string, string, boolean, number, boolean])[6],
  } : undefined;

  return { info, isLoading, error };
}

interface RegisteredApp {
  agentId: bigint;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  serviceType?: string;
  category?: string;
  x402Support?: boolean;
  stakeToken: string;
  stakeAmount: string;
  depositedAt: bigint;
}

export function useRegistryAppDetails(agentId: bigint) {
  const { data: owner } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [agentId],
  });

  const { data: stakeInfo } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getStakeInfo',
    args: [agentId],
  });

  const { data: tags } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getAgentTags',
    args: [agentId],
  });

  const { data: a2aEndpoint } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getA2AEndpoint',
    args: [agentId],
  });

  const isLoading = !owner;

  const app: RegisteredApp | null = owner ? {
    agentId,
    name: `Agent #${agentId}`,
    owner: owner as string,
    tags: (tags as string[]) || [],
    a2aEndpoint: a2aEndpoint as string | undefined,
    stakeToken: (stakeInfo as { token: string; amount: bigint; depositedAt: bigint } | undefined)?.token || 'ETH',
    stakeAmount: ((stakeInfo as { token: string; amount: bigint; depositedAt: bigint } | undefined)?.amount || 0n).toString(),
    depositedAt: (stakeInfo as { token: string; amount: bigint; depositedAt: bigint } | undefined)?.depositedAt || 0n,
  } : null;

  return { app, isLoading, refetch: async () => {} };
}

export function useRegistryMarketplaceActions() {
  const [lastTx, setLastTx] = useState<`0x${string}` | undefined>();
  const { data: txReceipt } = useWaitForTransactionReceipt({ hash: lastTx });
  const { writeContractAsync } = useWriteContract();

  async function setEndpoints(agentId: bigint, a2aEndpoint: string, mcpEndpoint: string): Promise<{ success: boolean; error?: string }> {
    const hash = await writeContractAsync({ address: REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: 'setEndpoints', args: [agentId, a2aEndpoint, mcpEndpoint] });
    setLastTx(hash);
    return { success: true };
  }

  async function setCategory(agentId: bigint, category: string): Promise<{ success: boolean; error?: string }> {
    const hash = await writeContractAsync({ address: REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: 'setCategory', args: [agentId, category] });
    setLastTx(hash);
    return { success: true };
  }

  async function setX402Support(agentId: bigint, supported: boolean): Promise<{ success: boolean; error?: string }> {
    const hash = await writeContractAsync({ address: REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: 'setX402Support', args: [agentId, supported] });
    setLastTx(hash);
    return { success: true };
  }

  return { setEndpoints, setCategory, setX402Support, lastTransaction: txReceipt };
}
