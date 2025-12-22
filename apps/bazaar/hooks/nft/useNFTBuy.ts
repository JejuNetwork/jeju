import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { toast } from 'sonner'
import { AddressSchema } from '@jejunetwork/types'
import { expect, expectPositive, expectTrue } from '@/lib/validation'
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
  expectPositive(listingId, 'Listing ID must be positive');
  const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
  
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const { data: listing, refetch } = useReadContract({
    address: validatedMarketplace,
    abi: NFTMarketplaceABI,
    functionName: 'getListing',
    args: [listingId],
    query: { enabled: listingId > 0n }
  })

  const buyNFT = (maxPrice?: bigint) => {
    const validatedListing = expect(listing, 'Listing not found');
    const [, , , price, active, endTime] = validatedListing as [string, string, bigint, bigint, boolean, bigint]

    expect(active, 'Listing is not active');

    const now = Math.floor(Date.now() / 1000)
    if (endTime && Number(endTime) < now) {
      expectTrue(false, 'Listing has expired');
    }

    if (maxPrice && price > maxPrice) {
      expectTrue(false, `Price increased beyond max: ${price} > ${maxPrice}`);
    }

    writeContract({
      address: validatedMarketplace,
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
