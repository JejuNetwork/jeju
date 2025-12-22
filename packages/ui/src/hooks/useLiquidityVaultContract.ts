/**
 * Liquidity Vault Contract Hook
 * Consolidated from gateway and bazaar
 */

import { useCallback } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import type { Address } from 'viem';
import { formatEther, parseEther } from 'viem';
import { LIQUIDITY_VAULT_ABI } from '../contracts';

export interface LPPosition {
  ethShares: bigint;
  ethValue: bigint;
  tokenShares: bigint;
  tokenValue: bigint;
  pendingFees: bigint;
  lpTokenBalance: string;
  sharePercent: number;
}

export function useLiquidityVault(vaultAddress: Address | undefined) {
  const { address: userAddress } = useAccount();

  // Read LP position (tuple format)
  const { data: lpPosition, refetch: refetchPosition } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'getLPPosition',
    args: userAddress ? [userAddress] : undefined,
  });

  // Read LP token balance (ERC20 format)
  const { data: lpBalance } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
  });

  // Read total supply for share calculation
  const { data: totalSupply } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'totalSupply',
  });

  // Write: Add ETH liquidity
  const { writeContract: addETHWrite, data: addHash, isPending: isAddingETH } = useWriteContract();
  const { isLoading: isConfirmingAdd, isSuccess: isAddSuccess } = useWaitForTransactionReceipt({ hash: addHash });

  // Write: Remove ETH liquidity  
  const { writeContract: removeETHWrite, data: removeHash, isPending: isRemovingETH } = useWriteContract();
  const { isLoading: isConfirmingRemove, isSuccess: isRemoveSuccess } = useWaitForTransactionReceipt({ hash: removeHash });

  // Write: Claim fees
  const { writeContract: claimWrite, data: claimHash, isPending: isClaiming } = useWriteContract();
  const { isLoading: isConfirmingClaim, isSuccess: isClaimSuccess } = useWaitForTransactionReceipt({ hash: claimHash });

  const addETHLiquidity = useCallback(async (amount: bigint | string) => {
    if (!vaultAddress) {
      throw new Error('Vault address not configured');
    }
    const value = typeof amount === 'string' ? parseEther(amount) : amount;
    addETHWrite({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'addETHLiquidity',
      value,
    });
  }, [vaultAddress, addETHWrite]);

  const removeETHLiquidity = useCallback(async (shares: bigint | string) => {
    if (!vaultAddress) {
      throw new Error('Vault address not configured');
    }
    const amount = typeof shares === 'string' ? parseEther(shares) : shares;
    removeETHWrite({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'removeETHLiquidity',
      args: [amount],
    });
  }, [vaultAddress, removeETHWrite]);

  const claimFees = useCallback(async () => {
    if (!vaultAddress) {
      throw new Error('Vault address not configured');
    }
    claimWrite({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'claimFees',
    });
  }, [vaultAddress, claimWrite]);

  // Parse position from tuple or ERC20 balance
  const position = lpPosition as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const balance = lpBalance as bigint | undefined;
  const supply = totalSupply as bigint | undefined;

  const parsedPosition: LPPosition | null = position ? {
    ethShares: position[0],
    ethValue: position[1],
    tokenShares: position[2],
    tokenValue: position[3],
    pendingFees: position[4],
    lpTokenBalance: formatEther(position[0]),
    sharePercent: supply && supply > 0n ? Number((position[0] * 10000n) / supply) / 100 : 0,
  } : balance && supply ? {
    ethShares: balance,
    ethValue: balance,
    tokenShares: 0n,
    tokenValue: 0n,
    pendingFees: 0n,
    lpTokenBalance: formatEther(balance),
    sharePercent: supply > 0n ? Number((balance * 10000n) / supply) / 100 : 0,
  } : null;

  return {
    lpPosition: parsedPosition,
    addETHLiquidity,
    removeETHLiquidity,
    claimFees,
    isLoading: isAddingETH || isConfirmingAdd || isRemovingETH || isConfirmingRemove || isClaiming || isConfirmingClaim,
    isAddSuccess,
    isRemoveSuccess,
    isClaimSuccess,
    refetchPosition,
  };
}
