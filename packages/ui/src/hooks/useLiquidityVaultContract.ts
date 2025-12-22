/**
 * Liquidity Vault Contract Hook
 */

import { useCallback } from 'react'
import type { Address } from 'viem'
import { parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { LIQUIDITY_VAULT_ABI } from '../contracts'
import type { LPPosition } from './liquidity-utils'
import { parseLPPosition, type RawPositionTuple } from './liquidity-utils'

export type { LPPosition } from './liquidity-utils'

export interface UseLiquidityVaultResult {
  lpPosition: LPPosition | null
  addETHLiquidity: (amount: bigint | string) => Promise<void>
  removeETHLiquidity: (shares: bigint | string) => Promise<void>
  claimFees: () => Promise<void>
  isLoading: boolean
  isAddSuccess: boolean
  isRemoveSuccess: boolean
  isClaimSuccess: boolean
  refetchPosition: () => void
}

export function useLiquidityVault(
  vaultAddress: Address | undefined,
): UseLiquidityVaultResult {
  const { address: userAddress } = useAccount()

  // Read LP position (tuple format)
  const { data: lpPosition, refetch: refetchPosition } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'getLPPosition',
    args: userAddress ? [userAddress] : undefined,
  })

  // Read LP token balance (ERC20 format)
  const { data: lpBalance } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
  })

  // Read total supply for share calculation
  const { data: totalSupply } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'totalSupply',
  })

  // Write: Add ETH liquidity
  const {
    writeContract: addETHWrite,
    data: addHash,
    isPending: isAddingETH,
  } = useWriteContract()
  const { isLoading: isConfirmingAdd, isSuccess: isAddSuccess } =
    useWaitForTransactionReceipt({ hash: addHash })

  // Write: Remove ETH liquidity
  const {
    writeContract: removeETHWrite,
    data: removeHash,
    isPending: isRemovingETH,
  } = useWriteContract()
  const { isLoading: isConfirmingRemove, isSuccess: isRemoveSuccess } =
    useWaitForTransactionReceipt({ hash: removeHash })

  // Write: Claim fees
  const {
    writeContract: claimWrite,
    data: claimHash,
    isPending: isClaiming,
  } = useWriteContract()
  const { isLoading: isConfirmingClaim, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimHash })

  const addETHLiquidity = useCallback(
    async (amount: bigint | string) => {
      if (!vaultAddress) {
        throw new Error('Vault address not configured')
      }
      const value = typeof amount === 'string' ? parseEther(amount) : amount
      addETHWrite({
        address: vaultAddress,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'addETHLiquidity',
        value,
      })
    },
    [vaultAddress, addETHWrite],
  )

  const removeETHLiquidity = useCallback(
    async (shares: bigint | string) => {
      if (!vaultAddress) {
        throw new Error('Vault address not configured')
      }
      const amount = typeof shares === 'string' ? parseEther(shares) : shares
      removeETHWrite({
        address: vaultAddress,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'removeETHLiquidity',
        args: [amount],
      })
    },
    [vaultAddress, removeETHWrite],
  )

  const claimFees = useCallback(async () => {
    if (!vaultAddress) {
      throw new Error('Vault address not configured')
    }
    claimWrite({
      address: vaultAddress,
      abi: LIQUIDITY_VAULT_ABI,
      functionName: 'claimFees',
    })
  }, [vaultAddress, claimWrite])

  // Type assertions required: wagmi's useReadContract returns a generic type
  // that depends on ABI inference. Our ABIs are defined with `as const` but
  // wagmi doesn't fully propagate the return types.
  const position = lpPosition as RawPositionTuple | undefined
  const balance = lpBalance as bigint | undefined
  const supply = totalSupply as bigint | undefined

  const parsedPosition = parseLPPosition(position, balance, supply)

  return {
    lpPosition: parsedPosition,
    addETHLiquidity,
    removeETHLiquidity,
    claimFees,
    isLoading:
      isAddingETH ||
      isConfirmingAdd ||
      isRemovingETH ||
      isConfirmingRemove ||
      isClaiming ||
      isConfirmingClaim,
    isAddSuccess,
    isRemoveSuccess,
    isClaimSuccess,
    refetchPosition,
  }
}
