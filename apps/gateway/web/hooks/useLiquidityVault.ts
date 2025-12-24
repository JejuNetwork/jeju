import { useCallback } from 'react'
import type { Address } from 'viem'
import { formatEther, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { LIQUIDITY_VAULT_ABI } from '../lib/constants'

export interface LPPosition {
  ethShares: bigint
  ethValue: bigint
  tokenShares: bigint
  tokenValue: bigint
  pendingFees: bigint
  lpTokenBalance: string
  sharePercent: number
}

type RawPositionTuple = readonly [bigint, bigint, bigint, bigint, bigint]

function calculateSharePercent(shares: bigint, totalSupply: bigint): number {
  if (totalSupply <= 0n) return 0
  return Number((shares * 10000n) / totalSupply) / 100
}

function parseLPPosition(
  position: RawPositionTuple | undefined,
  balance: bigint | undefined,
  totalSupply: bigint | undefined,
): LPPosition | null {
  if (position && totalSupply !== undefined) {
    const [ethShares, ethValue, tokenShares, tokenValue, pendingFees] = position
    return {
      ethShares,
      ethValue,
      tokenShares,
      tokenValue,
      pendingFees,
      lpTokenBalance: formatEther(ethShares),
      sharePercent: calculateSharePercent(ethShares, totalSupply),
    }
  }

  if (balance !== undefined && totalSupply !== undefined && totalSupply > 0n) {
    return {
      ethShares: balance,
      ethValue: balance,
      tokenShares: 0n,
      tokenValue: 0n,
      pendingFees: 0n,
      lpTokenBalance: formatEther(balance),
      sharePercent: calculateSharePercent(balance, totalSupply),
    }
  }

  return null
}

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

  const { data: lpPosition, refetch: refetchPosition } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'getPosition',
    args: userAddress ? [userAddress] : undefined,
  })

  const { data: lpBalance } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
  })

  const { data: totalSupply } = useReadContract({
    address: vaultAddress,
    abi: LIQUIDITY_VAULT_ABI,
    functionName: 'totalSupply',
  })

  const {
    writeContract: _addETHWrite,
    data: addHash,
    isPending: isAddingETH,
  } = useWriteContract()
  const addETHWrite = createTypedWriteContract(_addETHWrite)
  const { isLoading: isConfirmingAdd, isSuccess: isAddSuccess } =
    useWaitForTransactionReceipt({ hash: addHash })

  const {
    writeContract: _removeETHWrite,
    data: removeHash,
    isPending: isRemovingETH,
  } = useWriteContract()
  const removeETHWrite = createTypedWriteContract(_removeETHWrite)
  const { isLoading: isConfirmingRemove, isSuccess: isRemoveSuccess } =
    useWaitForTransactionReceipt({ hash: removeHash })

  const {
    // claimWrite unused but may be needed for future claim functionality
    data: claimHash,
    isPending: isClaiming,
  } = useWriteContract()
  const { isLoading: isConfirmingClaim, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimHash })

  const addETHLiquidity = useCallback(
    async (amount: bigint | string) => {
      if (!vaultAddress || !userAddress)
        throw new Error('Vault or user address not configured')
      const value = typeof amount === 'string' ? parseEther(amount) : amount
      addETHWrite({
        address: vaultAddress,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'deposit',
        args: [value, userAddress],
      })
    },
    [vaultAddress, userAddress, addETHWrite],
  )

  const removeETHLiquidity = useCallback(
    async (shares: bigint | string) => {
      if (!vaultAddress || !userAddress)
        throw new Error('Vault or user address not configured')
      const amount = typeof shares === 'string' ? parseEther(shares) : shares
      removeETHWrite({
        address: vaultAddress,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'withdraw',
        args: [amount, userAddress],
      })
    },
    [vaultAddress, userAddress, removeETHWrite],
  )

  const claimFees = useCallback(async () => {
    // Note: claimFees not available in ERC4626 vault - rewards are auto-compounded
    console.warn('claimFees: Not supported in this vault implementation')
  }, [])

  const position = lpPosition as unknown as RawPositionTuple | undefined
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
