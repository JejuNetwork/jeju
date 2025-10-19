import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { LIQUIDITY_VAULT_ABI } from '../lib/contracts';

export function useLiquidityVault(vaultAddress: `0x${string}` | undefined) {
  const { address: userAddress } = useAccount();

  // Read LP position
  const { data: lpPosition, refetch: refetchPosition } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'getLPPosition',
    args: userAddress ? [userAddress] : undefined,
  });

  // Write: Add ETH liquidity
  const { writeContract: addETH, data: addHash, isPending: isAddingETH } = useWriteContract();
  const { isLoading: isConfirmingAdd, isSuccess: isAddSuccess } = useWaitForTransactionReceipt({ hash: addHash });

  const addETHLiquidity = async (amount: bigint) => {
    if (!vaultAddress) return;
    // Note: addETHLiquidity has no inputs per the ABI
    addETH({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'addETHLiquidity',
      value: amount,
    });
  };

  // Write: Remove ETH liquidity
  const { writeContract: removeETH, data: removeHash, isPending: isRemovingETH } = useWriteContract();
  const { isLoading: isConfirmingRemove, isSuccess: isRemoveSuccess } = useWaitForTransactionReceipt({ hash: removeHash });

  const removeETHLiquidity = async (shares: bigint) => {
    if (!vaultAddress) return;
    removeETH({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'removeETHLiquidity',
      args: [shares],
    });
  };

  // Write: Claim fees
  const { writeContract: claim, data: claimHash, isPending: isClaiming } = useWriteContract();
  const { isLoading: isConfirmingClaim, isSuccess: isClaimSuccess } = useWaitForTransactionReceipt({ hash: claimHash });

  const claimFees = async () => {
    if (!vaultAddress) return;
    claim({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'claimFees',
    });
  };

  const position = lpPosition as [bigint, bigint, bigint, bigint, bigint] | undefined;

  return {
    lpPosition: position ? {
      ethShares: position[0],
      ethValue: position[1],
      tokenShares: position[2],
      tokenValue: position[3],
      pendingFees: position[4],
    } : null,
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

