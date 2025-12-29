import { type ChainId, getSimpleCollectible } from '@jejunetwork/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { type Address, formatEther } from 'viem'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract,
} from 'wagmi'
import simpleCollectibleABI from '../../api/abis/SimpleCollectible.json'
import { JEJU_CHAIN_ID } from '../config/chains'

function getCollectibleAddress(): Address | undefined {
  return getSimpleCollectible(JEJU_CHAIN_ID as ChainId) as Address | undefined
}

export function useCollectibleAddress() {
  return useQuery({
    queryKey: ['collectible-address', JEJU_CHAIN_ID],
    queryFn: () => getCollectibleAddress(),
    staleTime: 60000,
  })
}

export function useMintFee() {
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'mintFee',
    query: {
      enabled: !!collectibleAddress,
      select: (data) => {
        const fee = data as bigint
        return {
          wei: fee,
          eth: formatEther(fee),
          isFree: fee === 0n,
        }
      },
    },
  })
}

export function useNextTokenId() {
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'nextTokenId',
    query: {
      enabled: !!collectibleAddress,
      select: (data) => (data as bigint).toString(),
    },
  })
}

export function useTotalSupply() {
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'totalSupply',
    query: {
      enabled: !!collectibleAddress,
      select: (data) => (data as bigint).toString(),
    },
  })
}

export function useMaxSupply() {
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'maxSupply',
    query: {
      enabled: !!collectibleAddress,
      select: (data) => {
        const max = data as bigint
        return max === 0n ? 'unlimited' : max.toString()
      },
    },
  })
}

export function useUserMintCount() {
  const { address } = useAccount()
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'mintCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!collectibleAddress && !!address,
      select: (data) => (data as bigint).toString(),
    },
  })
}

export function useMaxPerAddress() {
  const collectibleAddress = getCollectibleAddress()

  return useReadContract({
    address: collectibleAddress,
    abi: simpleCollectibleABI,
    functionName: 'maxPerAddress',
    query: {
      enabled: !!collectibleAddress,
      select: (data) => {
        const max = data as bigint
        return max === 0n ? 'unlimited' : max.toString()
      },
    },
  })
}

export interface MintParams {
  tokenURI: string
}

export function useMintItem() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const collectibleAddress = getCollectibleAddress()
  const { data: mintFee } = useMintFee()

  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const mint = useCallback(
    async (
      params: MintParams,
    ): Promise<{ hash: `0x${string}`; tokenId: string }> => {
      if (!address || !walletClient || !publicClient || !collectibleAddress) {
        throw new Error(
          'Wallet not connected or collectible contract not available',
        )
      }

      const value = mintFee?.wei ?? 0n

      const hash = await writeContractAsync({
        address: collectibleAddress,
        abi: simpleCollectibleABI,
        functionName: 'mint',
        args: [params.tokenURI],
        value,
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Get tokenId from the Transfer event
      let tokenId = '0'
      for (const log of receipt.logs) {
        // Transfer event has tokenId as the third indexed topic
        if (log.topics.length === 4) {
          tokenId = BigInt(log.topics[3]).toString()
          break
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['nfts'] })
      queryClient.invalidateQueries({ queryKey: ['collectible'] })

      return { hash, tokenId }
    },
    [
      address,
      walletClient,
      publicClient,
      collectibleAddress,
      mintFee,
      writeContractAsync,
      queryClient,
    ],
  )

  return {
    mint,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
    collectibleAddress,
  }
}

export function useMint() {
  const { address, isConnected } = useAccount()
  const { data: collectibleAddress, isLoading: isLoadingAddress } =
    useCollectibleAddress()
  const { data: mintFee, isLoading: isLoadingFee } = useMintFee()
  const { data: nextTokenId } = useNextTokenId()
  const { data: totalSupply } = useTotalSupply()
  const { data: maxSupply } = useMaxSupply()
  const { data: userMintCount } = useUserMintCount()
  const { data: maxPerAddress } = useMaxPerAddress()
  const mintItem = useMintItem()

  const canMint = (() => {
    if (!isConnected || !collectibleAddress) return false
    if (
      maxPerAddress &&
      maxPerAddress !== 'unlimited' &&
      userMintCount !== undefined
    ) {
      if (parseInt(userMintCount, 10) >= parseInt(maxPerAddress, 10))
        return false
    }
    if (maxSupply && maxSupply !== 'unlimited' && totalSupply !== undefined) {
      if (parseInt(totalSupply, 10) >= parseInt(maxSupply, 10)) return false
    }
    return true
  })()

  return {
    // State
    isConnected,
    address,
    collectibleAddress,
    isReady: !!collectibleAddress && !isLoadingAddress,
    isLoading: isLoadingAddress || isLoadingFee,

    // Contract info
    mintFee,
    nextTokenId,
    totalSupply,
    maxSupply,
    userMintCount,
    maxPerAddress,

    // Computed
    canMint,

    // Actions
    mint: mintItem.mint,
    isPending: mintItem.isLoading,
    isSuccess: mintItem.isSuccess,
    pendingTxHash: mintItem.pendingTxHash,
  }
}
