import {
  type ChainId,
  getBazaarMarketplace,
  ZERO_ADDRESS,
} from '@jejunetwork/contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import {
  type Address,
  erc20Abi,
  erc721Abi,
  erc1155Abi,
  formatEther,
} from 'viem'
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWalletClient,
  useWriteContract,
} from 'wagmi'
import marketplaceABI from '../../api/abis/NFTMarketplace.json'
import { JEJU_CHAIN_ID } from '../config/chains'

export const AssetType = {
  ERC721: 0,
  ERC1155: 1,
  ERC20: 2,
} as const

export const Currency = {
  ETH: 0,
  HG: 1,
  USDC: 2,
  CUSTOM_ERC20: 3,
} as const

export const ListingStatus = {
  ACTIVE: 0,
  SOLD: 1,
  CANCELLED: 2,
} as const

export type AssetTypeValue = (typeof AssetType)[keyof typeof AssetType]
export type CurrencyValue = (typeof Currency)[keyof typeof Currency]
export type ListingStatusValue =
  (typeof ListingStatus)[keyof typeof ListingStatus]

export interface Listing {
  listingId: bigint
  seller: Address
  assetType: AssetTypeValue
  assetContract: Address
  tokenId: bigint
  amount: bigint
  currency: CurrencyValue
  customCurrencyAddress: Address
  price: bigint
  listingType: number
  status: ListingStatusValue
  createdAt: bigint
  expiresAt: bigint
}

export interface FormattedListing {
  id: string
  listingId: bigint
  seller: Address
  assetType: 'ERC721' | 'ERC1155' | 'ERC20'
  assetContract: Address
  tokenId: string
  amount: string
  currency: 'ETH' | 'HG' | 'USDC' | 'CUSTOM'
  currencyAddress: Address
  price: bigint
  priceFormatted: string
  status: 'active' | 'sold' | 'cancelled'
  createdAt: Date
  expiresAt: Date | null
  isExpired: boolean
}

function formatListing(listing: Listing): FormattedListing {
  const now = Date.now()
  const expiresAt =
    listing.expiresAt > 0n ? new Date(Number(listing.expiresAt) * 1000) : null
  const isExpired = expiresAt ? expiresAt.getTime() < now : false

  const assetTypeMap: Record<number, 'ERC721' | 'ERC1155' | 'ERC20'> = {
    0: 'ERC721',
    1: 'ERC1155',
    2: 'ERC20',
  }

  const currencyMap: Record<number, 'ETH' | 'HG' | 'USDC' | 'CUSTOM'> = {
    0: 'ETH',
    1: 'HG',
    2: 'USDC',
    3: 'CUSTOM',
  }

  const statusMap: Record<number, 'active' | 'sold' | 'cancelled'> = {
    0: 'active',
    1: 'sold',
    2: 'cancelled',
  }

  return {
    id: `${listing.assetContract}-${listing.tokenId}-${listing.listingId}`,
    listingId: listing.listingId,
    seller: listing.seller,
    assetType: assetTypeMap[listing.assetType] ?? 'ERC721',
    assetContract: listing.assetContract,
    tokenId: listing.tokenId.toString(),
    amount: listing.amount.toString(),
    currency: currencyMap[listing.currency] ?? 'ETH',
    currencyAddress: listing.customCurrencyAddress,
    price: listing.price,
    priceFormatted: formatEther(listing.price),
    status: statusMap[listing.status] ?? 'active',
    createdAt: new Date(Number(listing.createdAt) * 1000),
    expiresAt,
    isExpired,
  }
}

export function useMarketplaceAddress() {
  return useQuery({
    queryKey: ['marketplace-address', JEJU_CHAIN_ID],
    queryFn: () => {
      const addr = getBazaarMarketplace(JEJU_CHAIN_ID as ChainId)
      return addr as Address | undefined
    },
    staleTime: 60000,
  })
}

export function useListing(listingId: bigint | undefined) {
  const marketplaceAddress = getBazaarMarketplace(JEJU_CHAIN_ID as ChainId)

  return useReadContract({
    address: marketplaceAddress as Address,
    abi: marketplaceABI,
    functionName: 'getListing',
    args: listingId !== undefined ? [listingId] : undefined,
    query: {
      enabled: !!marketplaceAddress && listingId !== undefined,
      select: (data) => formatListing(data as Listing),
    },
  })
}

export function useTokenListing(
  assetContract: Address | undefined,
  tokenId: bigint | undefined,
) {
  const marketplaceAddress = getBazaarMarketplace(JEJU_CHAIN_ID as ChainId)

  const { data: listingId } = useReadContract({
    address: marketplaceAddress as Address,
    abi: marketplaceABI,
    functionName: 'getTokenListing',
    args:
      assetContract && tokenId !== undefined
        ? [assetContract, tokenId]
        : undefined,
    query: {
      enabled: !!marketplaceAddress && !!assetContract && tokenId !== undefined,
    },
  })

  return useListing(listingId as bigint | undefined)
}

export function usePlatformFee() {
  const marketplaceAddress = getBazaarMarketplace(JEJU_CHAIN_ID as ChainId)

  return useReadContract({
    address: marketplaceAddress as Address,
    abi: marketplaceABI,
    functionName: 'getEffectivePlatformFee',
    query: {
      enabled: !!marketplaceAddress,
      select: (data) => {
        const feeBps = data as bigint
        return {
          bps: Number(feeBps),
          percent: Number(feeBps) / 100,
        }
      },
    },
  })
}

export interface CreateListingParams {
  assetType: AssetTypeValue
  assetContract: Address
  tokenId: bigint
  amount: bigint
  currency: CurrencyValue
  customCurrencyAddress?: Address
  price: bigint
  durationSeconds: bigint
}

export function useCreateListing() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const marketplaceAddress = getBazaarMarketplace(
    JEJU_CHAIN_ID as ChainId,
  ) as Address

  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const createListing = useCallback(
    async (params: CreateListingParams) => {
      if (!address || !walletClient || !publicClient || !marketplaceAddress) {
        throw new Error('Wallet not connected or marketplace not available')
      }

      // Check if already approved
      let needsApproval = false
      if (params.assetType === AssetType.ERC721) {
        const approved = await publicClient.readContract({
          address: params.assetContract,
          abi: erc721Abi,
          functionName: 'getApproved',
          args: [params.tokenId],
        })
        const isApprovedForAll = await publicClient.readContract({
          address: params.assetContract,
          abi: erc721Abi,
          functionName: 'isApprovedForAll',
          args: [address, marketplaceAddress],
        })
        needsApproval = approved !== marketplaceAddress && !isApprovedForAll
      } else if (params.assetType === AssetType.ERC1155) {
        const isApprovedForAll = await publicClient.readContract({
          address: params.assetContract,
          abi: erc1155Abi,
          functionName: 'isApprovedForAll',
          args: [address, marketplaceAddress],
        })
        needsApproval = !isApprovedForAll
      }

      // Approve if needed
      if (needsApproval) {
        if (params.assetType === AssetType.ERC721) {
          const approveTx = await writeContractAsync({
            address: params.assetContract,
            abi: erc721Abi,
            functionName: 'setApprovalForAll',
            args: [marketplaceAddress, true],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
        } else if (params.assetType === AssetType.ERC1155) {
          const approveTx = await writeContractAsync({
            address: params.assetContract,
            abi: erc1155Abi,
            functionName: 'setApprovalForAll',
            args: [marketplaceAddress, true],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
        }
      }

      // Create listing
      const hash = await writeContractAsync({
        address: marketplaceAddress,
        abi: marketplaceABI,
        functionName: 'createListing',
        args: [
          params.assetType,
          params.assetContract,
          params.tokenId,
          params.amount,
          params.currency,
          params.customCurrencyAddress ?? ZERO_ADDRESS,
          params.price,
          params.durationSeconds,
        ],
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['marketplace-listings'] })
      queryClient.invalidateQueries({ queryKey: ['nfts'] })

      return { hash, receipt }
    },
    [
      address,
      walletClient,
      publicClient,
      marketplaceAddress,
      writeContractAsync,
      queryClient,
    ],
  )

  return {
    createListing,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
  }
}

export function useBuyListing() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const marketplaceAddress = getBazaarMarketplace(
    JEJU_CHAIN_ID as ChainId,
  ) as Address

  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const buyListing = useCallback(
    async (listingId: bigint, listing: FormattedListing) => {
      if (!address || !walletClient || !publicClient || !marketplaceAddress) {
        throw new Error('Wallet not connected or marketplace not available')
      }

      let value = 0n

      // Handle payment based on currency
      if (listing.currency === 'ETH') {
        value = listing.price
      } else {
        // For ERC20 payments, need to approve token first
        const tokenAddress =
          listing.currency === 'HG'
            ? await publicClient.readContract({
                address: marketplaceAddress,
                abi: marketplaceABI,
                functionName: 'gameGold',
              })
            : listing.currency === 'USDC'
              ? await publicClient.readContract({
                  address: marketplaceAddress,
                  abi: marketplaceABI,
                  functionName: 'usdc',
                })
              : listing.currencyAddress

        // Check allowance
        const allowance = await publicClient.readContract({
          address: tokenAddress as Address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, marketplaceAddress],
        })

        if (allowance < listing.price) {
          const approveTx = await writeContractAsync({
            address: tokenAddress as Address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [marketplaceAddress, listing.price],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveTx })
        }
      }

      // Execute purchase
      const hash = await writeContractAsync({
        address: marketplaceAddress,
        abi: marketplaceABI,
        functionName: 'buyListing',
        args: [listingId],
        value,
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['marketplace-listings'] })
      queryClient.invalidateQueries({ queryKey: ['nfts'] })

      return { hash, receipt }
    },
    [
      address,
      walletClient,
      publicClient,
      marketplaceAddress,
      writeContractAsync,
      queryClient,
    ],
  )

  return {
    buyListing,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
  }
}

export function useCancelListing() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const marketplaceAddress = getBazaarMarketplace(
    JEJU_CHAIN_ID as ChainId,
  ) as Address

  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const cancelListing = useCallback(
    async (listingId: bigint) => {
      if (!address || !publicClient || !marketplaceAddress) {
        throw new Error('Wallet not connected or marketplace not available')
      }

      const hash = await writeContractAsync({
        address: marketplaceAddress,
        abi: marketplaceABI,
        functionName: 'cancelListing',
        args: [listingId],
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['marketplace-listings'] })
      queryClient.invalidateQueries({ queryKey: ['nfts'] })

      return { hash, receipt }
    },
    [
      address,
      publicClient,
      marketplaceAddress,
      writeContractAsync,
      queryClient,
    ],
  )

  return {
    cancelListing,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
  }
}

export function useMarketplaceAccess(targetSeller?: Address) {
  const { address } = useAccount()
  const marketplaceAddress = getBazaarMarketplace(JEJU_CHAIN_ID as ChainId)

  const { data: isBanned } = useReadContract({
    address: marketplaceAddress as Address,
    abi: marketplaceABI,
    functionName: 'isUserBanned',
    args: address ? [address] : undefined,
    query: {
      enabled: !!marketplaceAddress && !!address,
    },
  })

  const { data: isBlocked } = useReadContract({
    address: marketplaceAddress as Address,
    abi: marketplaceABI,
    functionName: 'isUserBlocked',
    args: address && targetSeller ? [address, targetSeller] : undefined,
    query: {
      enabled: !!marketplaceAddress && !!address && !!targetSeller,
    },
  })

  return {
    isBanned: isBanned as boolean | undefined,
    isBlocked: isBlocked as boolean | undefined,
    canTrade: !isBanned && !isBlocked,
  }
}

export function useMarketplace() {
  const { address, isConnected } = useAccount()
  const { data: marketplaceAddress, isLoading: isLoadingAddress } =
    useMarketplaceAddress()
  const { data: platformFee, isLoading: isLoadingFee } = usePlatformFee()
  const createListing = useCreateListing()
  const buyListing = useBuyListing()
  const cancelListing = useCancelListing()
  const access = useMarketplaceAccess()

  return {
    // State
    isConnected,
    address,
    marketplaceAddress,
    platformFee,
    isReady: !!marketplaceAddress && !isLoadingAddress,
    isLoading: isLoadingAddress || isLoadingFee,

    // Access control
    isBanned: access.isBanned,
    canTrade: access.canTrade,

    // Actions
    createListing: createListing.createListing,
    buyListing: buyListing.buyListing,
    cancelListing: cancelListing.cancelListing,

    // Transaction states
    isPendingCreate: createListing.isLoading,
    isPendingBuy: buyListing.isLoading,
    isPendingCancel: cancelListing.isLoading,
  }
}
