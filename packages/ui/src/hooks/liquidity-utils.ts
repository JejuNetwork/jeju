import { formatEther } from 'viem'

export interface LPPosition {
  ethShares: bigint
  ethValue: bigint
  tokenShares: bigint
  tokenValue: bigint
  pendingFees: bigint
  lpTokenBalance: string
  sharePercent: number
}

export type RawPositionTuple = readonly [bigint, bigint, bigint, bigint, bigint]

export function calculateSharePercent(
  shares: bigint,
  totalSupply: bigint,
): number {
  if (totalSupply <= 0n) {
    return 0
  }
  return Number((shares * 10000n) / totalSupply) / 100
}

export function parsePositionFromTuple(
  position: RawPositionTuple,
  totalSupply: bigint,
): LPPosition {
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

export function parsePositionFromBalance(
  balance: bigint,
  totalSupply: bigint,
): LPPosition {
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

export function parseLPPosition(
  position: RawPositionTuple | undefined,
  balance: bigint | undefined,
  totalSupply: bigint | undefined,
): LPPosition | null {
  if (position && totalSupply !== undefined) {
    return parsePositionFromTuple(position, totalSupply)
  }

  if (balance !== undefined && totalSupply !== undefined && totalSupply > 0n) {
    return parsePositionFromBalance(balance, totalSupply)
  }

  return null
}
