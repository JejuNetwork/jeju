import { ICOPresaleAbi } from '@jejunetwork/contracts'
import { AddressSchema, expect } from '@jejunetwork/types'
import { type Address, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {
  canClaimRefund,
  canClaimTokens,
  type PresaleStatus,
  parsePresaleStatus,
  parseUserContribution,
  type UserContribution,
} from '../../lib/launchpad'

export type { PresaleStatus, UserContribution }

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
  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({
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

  // Parse status using typed parser
  const parsedStatus: PresaleStatus | undefined = status
    ? parsePresaleStatus(
        status as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
          boolean,
        ],
      )
    : undefined

  // Parse user contribution using typed parser
  const parsedContribution: UserContribution | undefined = contribution
    ? parseUserContribution(
        contribution as readonly [bigint, bigint, bigint, bigint, boolean],
      )
    : undefined

  /**
   * Start the presale (creator only)
   */
  const startPresale = () => {
    const validatedAddress = expect(presaleAddress, 'No presale address')
    AddressSchema.parse(validatedAddress)

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
    const validatedAddress = expect(presaleAddress, 'No presale address')
    AddressSchema.parse(validatedAddress)
    expect(ethAmount, 'ETH amount is required')
    expect(parseFloat(ethAmount) > 0, 'ETH amount must be positive')

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
    const validatedAddress = expect(presaleAddress, 'No presale address')
    AddressSchema.parse(validatedAddress)

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
    const validatedAddress = expect(presaleAddress, 'No presale address')
    AddressSchema.parse(validatedAddress)

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
    const validatedAddress = expect(presaleAddress, 'No presale address')
    AddressSchema.parse(validatedAddress)

    reset()
    writeContract({
      address: validatedAddress,
      abi: ICOPresaleAbi,
      functionName: 'refund',
      args: [],
    })
  }

  // Check if user can claim using lib function
  const canClaim: boolean =
    parsedStatus && parsedContribution && buyerClaimStart
      ? canClaimTokens(
          parsedStatus,
          parsedContribution,
          buyerClaimStart as bigint,
          BigInt(Math.floor(Date.now() / 1000)),
        )
      : false

  // Check if user can refund using lib function
  const canRefundTokens: boolean =
    parsedStatus && parsedContribution
      ? canClaimRefund(parsedStatus, parsedContribution)
      : false

  return {
    // State
    isConnected,
    presaleAddress,
    tokenAddress: tokenAddress ? (tokenAddress as Address) : undefined,
    creator: creator ? (creator as Address) : undefined,
    status: parsedStatus,
    contribution: parsedContribution as UserContribution | undefined,
    config: config as
      | {
          presaleAllocationBps: bigint
          presalePrice: bigint
          lpFundingBps: bigint
          lpLockDuration: bigint
          buyerLockDuration: bigint
          softCap: bigint
          hardCap: bigint
          presaleDuration: bigint
        }
      | undefined,
    presaleStart: presaleStart as bigint | undefined,
    presaleEnd: presaleEnd as bigint | undefined,
    buyerClaimStart: buyerClaimStart as bigint | undefined,
    lpPair: lpPair as Address | undefined,
    canClaim,
    canRefund: canRefundTokens,

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
