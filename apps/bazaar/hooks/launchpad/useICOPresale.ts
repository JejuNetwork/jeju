import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther, type Address } from 'viem'
import { AddressSchema } from '@jejunetwork/types/contracts'
import { expect } from '@/lib/validation'
import { ICOPresaleAbi } from '@jejunetwork/contracts'

export interface PresaleStatus {
  raised: bigint
  participants: bigint
  progress: number  // 0-10000 (basis points)
  timeRemaining: bigint
  isActive: boolean
  isFinalized: boolean
  isFailed: boolean
}

export interface UserContribution {
  ethAmount: bigint
  tokenAllocation: bigint
  claimedTokens: bigint
  claimable: bigint
  isRefunded: boolean
}

/**
 * Hook to interact with an ICO presale
 */
export function useICOPresale(presaleAddress: Address | null) {
  const { address, isConnected } = useAccount()
  const enabled = !!presaleAddress

  // Write contract hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset,
  } = useWriteContract()

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Read status
  const { data: status, refetch: refetchStatus } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'getStatus',
    query: { 
      enabled,
      refetchInterval: 10000, // Refresh every 10 seconds
    },
  })

  // Read token address
  const { data: tokenAddress } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'token',
    query: { enabled },
  })

  // Read creator address
  const { data: creator } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'creator',
    query: { enabled },
  })

  // Read config
  const { data: config } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'config',
    query: { enabled },
  })

  // Read user contribution
  const { data: contribution, refetch: refetchContribution } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'getContribution',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  // Read presale times
  const { data: presaleStart } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'presaleStart',
    query: { enabled },
  })

  const { data: presaleEnd } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'presaleEnd',
    query: { enabled },
  })

  // Read buyer claim start
  const { data: buyerClaimStart } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'buyerClaimStart',
    query: { enabled },
  })

  // Read LP pair
  const { data: lpPair } = useReadContract({
    address: presaleAddress ?? undefined,
    abi: ICOPresaleAbi,
    functionName: 'lpPair',
    query: { enabled },
  })

  // Parse status
  const parsedStatus: PresaleStatus | undefined = status ? {
    raised: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[0],
    participants: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[1],
    progress: Number((status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[2]),
    timeRemaining: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[3],
    isActive: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[4],
    isFinalized: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[5],
    isFailed: (status as [bigint, bigint, bigint, bigint, boolean, boolean, boolean])[6],
  } : undefined

  // Parse user contribution
  const parsedContribution: UserContribution | undefined = contribution ? {
    ethAmount: (contribution as [bigint, bigint, bigint, bigint, boolean])[0],
    tokenAllocation: (contribution as [bigint, bigint, bigint, bigint, boolean])[1],
    claimedTokens: (contribution as [bigint, bigint, bigint, bigint, boolean])[2],
    claimable: (contribution as [bigint, bigint, bigint, bigint, boolean])[3],
    isRefunded: (contribution as [bigint, bigint, bigint, bigint, boolean])[4],
  } : undefined

  /**
   * Start the presale (creator only)
   */
  const startPresale = () => {
    const validatedAddress = expect(presaleAddress, 'No presale address');
    AddressSchema.parse(validatedAddress);

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'startPresale',
      args: [],
    })
  }

  /**
   * Contribute ETH to the presale
   */
  const contribute = (ethAmount: string) => {
    const validatedAddress = expect(presaleAddress, 'No presale address');
    AddressSchema.parse(validatedAddress);
    expect(ethAmount, 'ETH amount is required');
    expect(parseFloat(ethAmount) > 0, 'ETH amount must be positive');

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'contribute',
      args: [],
      value: parseEther(ethAmount),
    })
  }

  /**
   * Finalize the presale (anyone can call after end time)
   */
  const finalize = () => {
    const validatedAddress = expect(presaleAddress, 'No presale address');
    AddressSchema.parse(validatedAddress);

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'finalize',
      args: [],
    })
  }

  /**
   * Claim tokens (after successful presale + lock period)
   */
  const claim = () => {
    const validatedAddress = expect(presaleAddress, 'No presale address');
    AddressSchema.parse(validatedAddress);

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'claim',
      args: [],
    })
  }

  /**
   * Get refund (after failed presale)
   */
  const refund = () => {
    const validatedAddress = expect(presaleAddress, 'No presale address');
    AddressSchema.parse(validatedAddress);

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'refund',
      args: [],
    })
  }

  // Check if user can claim
  const canClaim: boolean = Boolean(
    parsedStatus?.isFinalized &&
    !parsedStatus?.isFailed &&
    parsedContribution &&
    parsedContribution.claimable > 0n &&
    buyerClaimStart &&
    BigInt(Math.floor(Date.now() / 1000)) >= (buyerClaimStart as bigint)
  )

  // Check if user can refund
  const canRefund: boolean = Boolean(
    parsedStatus?.isFinalized &&
    parsedStatus?.isFailed &&
    parsedContribution &&
    parsedContribution.ethAmount > 0n &&
    !parsedContribution.isRefunded
  )

  return {
    // State
    isConnected,
    presaleAddress,
    tokenAddress: tokenAddress ? (tokenAddress as Address) : undefined,
    creator: creator ? (creator as Address) : undefined,
    status: parsedStatus,
    contribution: parsedContribution as UserContribution | undefined,
    config: config as {
      presaleAllocationBps: bigint
      presalePrice: bigint
      lpFundingBps: bigint
      lpLockDuration: bigint
      buyerLockDuration: bigint
      softCap: bigint
      hardCap: bigint
      presaleDuration: bigint
    } | undefined,
    presaleStart: presaleStart as bigint | undefined,
    presaleEnd: presaleEnd as bigint | undefined,
    buyerClaimStart: buyerClaimStart as bigint | undefined,
    lpPair: lpPair as Address | undefined,
    canClaim,
    canRefund,
    
    // Transaction state
    txHash,
    isPending: isWritePending || isConfirming,
    isSuccess,
    receipt,
    error: writeError,
    
    // Actions
    startPresale,
    contribute,
    finalize,
    claim,
    refund,
    refetchStatus,
    refetchContribution,
    reset,
  }
}

/**
 * Format presale progress
 */
export function formatPresaleProgress(progressBps: number): string {
  return (progressBps / 100).toFixed(2) + '%'
}

/**
 * Format time remaining
 */
export function formatTimeRemaining(seconds: bigint): string {
  const secs = Number(seconds)
  if (secs <= 0) return 'Ended'
  
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

