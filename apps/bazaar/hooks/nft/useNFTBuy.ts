import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { toast } from 'sonner'
import NFTMarketplaceABI from '@/lib/abis/NFTMarketplace.json'
import { CONTRACTS } from '@/config'

const MARKETPLACE_ADDRESS = CONTRACTS.nftMarketplace

interface ListingData {
  seller: string
  nftContract: string
  tokenId: bigint
  price: bigint
  active: boolean
  endTime: bigint
}

export function useNFTBuy(listingId: bigint) {
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const { data: listing, refetch } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: NFTMarketplaceABI,
    functionName: 'getListing',
    args: [listingId],
    query: { enabled: listingId > 0n && MARKETPLACE_ADDRESS !== '0x0' }
  })

  const buyNFT = (maxPrice?: bigint) => {
    if (MARKETPLACE_ADDRESS === '0x0') {
      toast.error('Marketplace not deployed')
      return
    }

    if (!listing) {
      toast.error('Listing not found')
      return
    }

    const [, , , price, active, endTime] = listing as [string, string, bigint, bigint, boolean, bigint]

    if (!active) {
      toast.error('Listing is not active')
      return
    }

    const now = Math.floor(Date.now() / 1000)
    if (endTime && Number(endTime) < now) {
      toast.error('Listing has expired')
      return
    }

    if (maxPrice && price > maxPrice) {
      toast.error('Price increased beyond max')
      return
    }

    writeContract({
      address: MARKETPLACE_ADDRESS,
      abi: NFTMarketplaceABI,
      functionName: 'buyListing',
      args: [listingId],
      value: price
    })
    toast.success('Purchase submitted')
    setTimeout(() => refetch(), 5000)
  }

  return {
    buyNFT,
    listing,
    isPending: isPending || isConfirming,
    isSuccess,
    refetch
  }
}
