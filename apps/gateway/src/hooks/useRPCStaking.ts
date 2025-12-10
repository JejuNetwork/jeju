import { useState, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { parseEther, formatEther, formatUnits, type Address } from 'viem';
import { CONTRACTS, RPC_GATEWAY_URL } from '../config';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const STAKING = CONTRACTS.rpcStaking;
const TOKEN = CONTRACTS.jeju;
const isConfigured = STAKING !== ZERO;

const STAKING_ABI = [
  { name: 'stake', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'startUnbonding', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'completeUnstaking', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'getPosition', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [
    { name: 'stakedAmount', type: 'uint256' }, { name: 'stakedAt', type: 'uint256' }, { name: 'unbondingAmount', type: 'uint256' },
    { name: 'unbondingStartTime', type: 'uint256' }, { name: 'agentId', type: 'uint256' }, { name: 'isActive', type: 'bool' }, { name: 'isFrozen', type: 'bool' },
  ]}]},
  { name: 'getTier', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'getRateLimit', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getStakeUsdValue', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getJejuPrice', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getReputationDiscount', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

export type RateTier = 'FREE' | 'BASIC' | 'PRO' | 'UNLIMITED';
export interface TierInfo { minUsd: number; rateLimit: number; description: string; jejuNeeded: number; }
export interface StakingPosition { stakedAmount: bigint; stakedAt: bigint; unbondingAmount: bigint; unbondingStartTime: bigint; agentId: bigint; isActive: boolean; isFrozen: boolean; }
export interface ApiKey { id: string; name: string; tier: RateTier; createdAt: number; lastUsedAt: number; requestCount: number; isActive: boolean; }

export const TIER_CONFIG: Record<RateTier, TierInfo> = {
  FREE: { minUsd: 0, rateLimit: 10, description: '10 req/min', jejuNeeded: 0 },
  BASIC: { minUsd: 10, rateLimit: 100, description: '100 req/min', jejuNeeded: 100 },
  PRO: { minUsd: 100, rateLimit: 1000, description: '1k req/min', jejuNeeded: 1000 },
  UNLIMITED: { minUsd: 1000, rateLimit: 0, description: 'Unlimited', jejuNeeded: 10000 },
};

export function useRPCStaking() {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const { writeContractAsync } = useWriteContract();
  const enabled = isConfigured && !!address;

  const positionArgs = enabled && address ? [address] as const : undefined;
  const { data: positionData, refetch: refetchPosition } = useReadContract({ address: enabled ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getPosition', args: positionArgs, query: { enabled } });
  const { data: tierData, refetch: refetchTier } = useReadContract({ address: enabled ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getTier', args: positionArgs, query: { enabled } });
  const { data: rateLimitData } = useReadContract({ address: enabled ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getRateLimit', args: positionArgs, query: { enabled } });
  const { data: discountData } = useReadContract({ address: enabled ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getReputationDiscount', args: positionArgs, query: { enabled } });
  const { data: stakeUsdData } = useReadContract({ address: enabled ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getStakeUsdValue', args: positionArgs, query: { enabled } });
  const { data: priceData } = useReadContract({ address: isConfigured ? STAKING : undefined, abi: STAKING_ABI, functionName: 'getJejuPrice', query: { enabled: isConfigured } });
  const tokenEnabled = TOKEN !== ZERO && !!address;
  const balanceArgs = tokenEnabled && address ? [address] as const : undefined;
  const { data: balanceData } = useReadContract({ address: tokenEnabled ? TOKEN : undefined, abi: ERC20_ABI, functionName: 'balanceOf', args: balanceArgs, query: { enabled: tokenEnabled } });
  const allowanceEnabled = TOKEN !== ZERO && enabled;
  const allowanceArgs = allowanceEnabled && address ? [address, STAKING] as const : undefined;
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({ address: allowanceEnabled ? TOKEN : undefined, abi: ERC20_ABI, functionName: 'allowance', args: allowanceArgs, query: { enabled: allowanceEnabled } });

  const position = useMemo((): StakingPosition | null => positionData ? { ...positionData } : null, [positionData]);
  const tier = useMemo((): RateTier => (['FREE', 'BASIC', 'PRO', 'UNLIMITED'] as const)[Number(tierData ?? 0)] ?? 'FREE', [tierData]);
  const jejuPrice = priceData ? Number(formatUnits(priceData, 8)) : 0.10;
  const tierRequirements = useMemo((): Record<RateTier, TierInfo> => jejuPrice <= 0 ? TIER_CONFIG : {
    FREE: { ...TIER_CONFIG.FREE, jejuNeeded: 0 },
    BASIC: { ...TIER_CONFIG.BASIC, jejuNeeded: Math.ceil(10 / jejuPrice) },
    PRO: { ...TIER_CONFIG.PRO, jejuNeeded: Math.ceil(100 / jejuPrice) },
    UNLIMITED: { ...TIER_CONFIG.UNLIMITED, jejuNeeded: Math.ceil(1000 / jejuPrice) },
  }, [jejuPrice]);

  const approve = useCallback(async (amount: string) => {
    if (!address || !isConfigured) return null;
    setLoading(true); setError(null);
    const hash = await writeContractAsync({ address: TOKEN, abi: ERC20_ABI, functionName: 'approve', args: [STAKING, parseEther(amount)] });
    setLoading(false); await refetchAllowance();
    return hash;
  }, [address, writeContractAsync, refetchAllowance]);

  const stake = useCallback(async (amount: string) => {
    if (!address || !isConfigured) return null;
    if ((allowanceData ?? 0n) < parseEther(amount)) { setError('Insufficient allowance'); return null; }
    setLoading(true); setError(null);
    const hash = await writeContractAsync({ address: STAKING, abi: STAKING_ABI, functionName: 'stake', args: [parseEther(amount)] });
    await Promise.all([refetchPosition(), refetchTier()]);
    setLoading(false);
    return hash;
  }, [address, allowanceData, writeContractAsync, refetchPosition, refetchTier]);

  const startUnbonding = useCallback(async (amount: string) => {
    if (!address || !isConfigured) return null;
    setLoading(true); setError(null);
    const hash = await writeContractAsync({ address: STAKING, abi: STAKING_ABI, functionName: 'startUnbonding', args: [parseEther(amount)] });
    await Promise.all([refetchPosition(), refetchTier()]);
    setLoading(false);
    return hash;
  }, [address, writeContractAsync, refetchPosition, refetchTier]);

  const completeUnstaking = useCallback(async () => {
    if (!address || !isConfigured) return null;
    setLoading(true); setError(null);
    const hash = await writeContractAsync({ address: STAKING, abi: STAKING_ABI, functionName: 'completeUnstaking' });
    await Promise.all([refetchPosition(), refetchTier()]);
    setLoading(false);
    return hash;
  }, [address, writeContractAsync, refetchPosition, refetchTier]);

  const fetchApiKeys = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`${RPC_GATEWAY_URL}/v1/keys`, { headers: { 'X-Wallet-Address': address } });
    if (res.ok) setApiKeys((await res.json()).keys || []);
  }, [address]);

  const createApiKey = useCallback(async (name: string): Promise<string | null> => {
    if (!address) return null;
    setLoading(true); setError(null);
    const res = await fetch(`${RPC_GATEWAY_URL}/v1/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': address }, body: JSON.stringify({ name }) });
    setLoading(false);
    if (!res.ok) { setError((await res.json()).error || 'Failed'); return null; }
    const data = await res.json();
    await fetchApiKeys();
    return data.key;
  }, [address, fetchApiKeys]);

  const revokeApiKey = useCallback(async (keyId: string) => {
    if (!address) return false;
    const ok = (await fetch(`${RPC_GATEWAY_URL}/v1/keys/${keyId}`, { method: 'DELETE', headers: { 'X-Wallet-Address': address } })).ok;
    if (ok) await fetchApiKeys();
    return ok;
  }, [address, fetchApiKeys]);

  return {
    isConnected, isContractConfigured: isConfigured, loading, error, position, tier,
    rateLimit: Number(rateLimitData ?? 10), reputationDiscount: Number(discountData ?? 0),
    jejuBalance: balanceData ? formatEther(balanceData) : '0', allowance: allowanceData ?? 0n,
    jejuPrice, stakeUsdValue: stakeUsdData ? Number(formatUnits(stakeUsdData, 8)) : 0, tierRequirements, apiKeys,
    approve, stake, startUnbonding, completeUnstaking, fetchApiKeys, createApiKey, revokeApiKey, refetchPosition, refetchTier,
  };
}
