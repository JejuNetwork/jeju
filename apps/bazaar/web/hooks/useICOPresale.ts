/**
 * ICO Presale Hook
 *
 * Provides real contract integration for ICO presale functionality.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type Address, parseAbi, parseEther, zeroAddress } from 'viem'
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CHAIN_ID, CONTRACTS } from '../../config'

// ICOPresale contract ABI
const ICO_PRESALE_ABI = parseAbi([
  // Read functions
  'function getStatus() external view returns (uint256 raised, uint256 participants, uint256 progress, uint256 timeRemaining, bool isActive, bool isFinalized, bool isFailed)',
  'function getContribution(address contributor) external view returns (uint256 ethAmount, uint256 tokenAllocation, uint256 claimedTokens, uint256 claimable, bool isRefunded)',
  'function config() external view returns (uint256 presaleAllocationBps, uint256 presalePrice, uint256 lpFundingBps, uint256 lpLockDuration, uint256 buyerLockDuration, uint256 softCap, uint256 hardCap, uint256 presaleDuration)',
  'function token() external view returns (address)',
  'function presaleStart() external view returns (uint256)',
  'function presaleEnd() external view returns (uint256)',
  'function totalRaised() external view returns (uint256)',
  'function totalParticipants() external view returns (uint256)',
  'function tokensForPresale() external view returns (uint256)',
  'function finalized() external view returns (bool)',
  'function failed() external view returns (bool)',
  'function buyerClaimStart() external view returns (uint256)',
  // Write functions
  'function contribute() external payable',
  'function claim() external',
  'function refund() external',
])

export interface ICOStatus {
  raised: bigint
  participants: bigint
  progress: bigint // bps (0-10000)
  timeRemaining: bigint
  isActive: boolean
  isFinalized: boolean
  isFailed: boolean
}

export interface ICOConfig {
  presaleAllocationBps: bigint
  presalePrice: bigint
  lpFundingBps: bigint
  lpLockDuration: bigint
  buyerLockDuration: bigint
  softCap: bigint
  hardCap: bigint
  presaleDuration: bigint
}

export interface UserContribution {
  ethAmount: bigint
  tokenAllocation: bigint
  claimedTokens: bigint
  claimable: bigint
  isRefunded: boolean
}

export function useICOPresale(presaleAddress: Address | undefined) {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  // Invalidate queries on successful transaction
  useEffect(() => {
    if (isSuccess && pendingTxHash) {
      queryClient.invalidateQueries({
        queryKey: ['ico-status', presaleAddress],
      })
      queryClient.invalidateQueries({
        queryKey: ['ico-contribution', presaleAddress, address],
      })
      setPendingTxHash(undefined)
      toast.success('Transaction confirmed!')
    }
  }, [isSuccess, pendingTxHash, queryClient, presaleAddress, address])

  // Fetch ICO status
  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
  } = useQuery({
    queryKey: ['ico-status', presaleAddress],
    queryFn: async (): Promise<ICOStatus | null> => {
      if (!presaleAddress || presaleAddress === zeroAddress || !publicClient) {
        return null
      }

      const result = await publicClient.readContract({
        address: presaleAddress,
        abi: ICO_PRESALE_ABI,
        functionName: 'getStatus',
      })

      const [
        raised,
        participants,
        progress,
        timeRemaining,
        isActive,
        isFinalized,
        isFailed,
      ] = result

      return {
        raised,
        participants,
        progress,
        timeRemaining,
        isActive,
        isFinalized,
        isFailed,
      }
    },
    enabled:
      !!presaleAddress && presaleAddress !== zeroAddress && !!publicClient,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  // Fetch ICO config
  const { data: config } = useQuery({
    queryKey: ['ico-config', presaleAddress],
    queryFn: async (): Promise<ICOConfig | null> => {
      if (!presaleAddress || presaleAddress === zeroAddress || !publicClient) {
        return null
      }

      const result = await publicClient.readContract({
        address: presaleAddress,
        abi: ICO_PRESALE_ABI,
        functionName: 'config',
      })

      const [
        presaleAllocationBps,
        presalePrice,
        lpFundingBps,
        lpLockDuration,
        buyerLockDuration,
        softCap,
        hardCap,
        presaleDuration,
      ] = result

      return {
        presaleAllocationBps,
        presalePrice,
        lpFundingBps,
        lpLockDuration,
        buyerLockDuration,
        softCap,
        hardCap,
        presaleDuration,
      }
    },
    enabled:
      !!presaleAddress && presaleAddress !== zeroAddress && !!publicClient,
    staleTime: 60000, // Config rarely changes
  })

  // Fetch user contribution
  const { data: contribution } = useQuery({
    queryKey: ['ico-contribution', presaleAddress, address],
    queryFn: async (): Promise<UserContribution | null> => {
      if (
        !presaleAddress ||
        presaleAddress === zeroAddress ||
        !address ||
        !publicClient
      ) {
        return null
      }

      const result = await publicClient.readContract({
        address: presaleAddress,
        abi: ICO_PRESALE_ABI,
        functionName: 'getContribution',
        args: [address],
      })

      const [ethAmount, tokenAllocation, claimedTokens, claimable, isRefunded] =
        result

      return {
        ethAmount,
        tokenAllocation,
        claimedTokens,
        claimable,
        isRefunded,
      }
    },
    enabled:
      !!presaleAddress &&
      presaleAddress !== zeroAddress &&
      !!address &&
      !!publicClient,
    refetchInterval: 10000,
  })

  // Contribute ETH
  const contribute = useCallback(
    async (amount: string) => {
      if (!presaleAddress || presaleAddress === zeroAddress) {
        toast.error('ICO presale not available')
        return
      }

      const amountWei = parseEther(amount)
      if (amountWei <= 0n) {
        toast.error('Enter a valid amount')
        return
      }

      const hash = await writeContractAsync({
        address: presaleAddress,
        abi: ICO_PRESALE_ABI,
        functionName: 'contribute',
        value: amountWei,
      })

      setPendingTxHash(hash)
      toast.info('Transaction submitted...')
    },
    [presaleAddress, writeContractAsync],
  )

  // Claim tokens
  const claim = useCallback(async () => {
    if (!presaleAddress || presaleAddress === zeroAddress) {
      toast.error('ICO presale not available')
      return
    }

    const hash = await writeContractAsync({
      address: presaleAddress,
      abi: ICO_PRESALE_ABI,
      functionName: 'claim',
    })

    setPendingTxHash(hash)
    toast.info('Claiming tokens...')
  }, [presaleAddress, writeContractAsync])

  // Refund (if failed)
  const refund = useCallback(async () => {
    if (!presaleAddress || presaleAddress === zeroAddress) {
      toast.error('ICO presale not available')
      return
    }

    const hash = await writeContractAsync({
      address: presaleAddress,
      abi: ICO_PRESALE_ABI,
      functionName: 'refund',
    })

    setPendingTxHash(hash)
    toast.info('Requesting refund...')
  }, [presaleAddress, writeContractAsync])

  return {
    status,
    config,
    contribution,
    isLoading: statusLoading,
    error: statusError,
    isPending: isConfirming,
    contribute,
    claim,
    refund,
  }
}

/**
 * Get the JEJU ICO presale address from config
 * This could be stored in the contracts config or as a separate address
 */
export function useJejuICOAddress(): Address | undefined {
  // Check if there's a dedicated ICO address in config
  // For now, return undefined if not deployed
  // In production, this would come from the contracts config
  const icoAddress = (CONTRACTS as Record<string, Address>).jejuICO

  return icoAddress && icoAddress !== zeroAddress ? icoAddress : undefined
}
