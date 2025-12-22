import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import { AddressSchema } from '@jejunetwork/types'
import { expect, expectPositive, expectTrue } from '@/lib/validation'
import { NonEmptyStringSchema } from '@/schemas/common'
import { toast } from 'sonner'
import NFTMarketplaceABI from '@/lib/abis/NFTMarketplace.json'
import { CONTRACTS } from '@/config'

const MARKETPLACE_ADDRESS = CONTRACTS.nftMarketplace

export function useNFTOffer() {
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const makeOffer = (
    nftContract: `0x${string}`,
    tokenId: bigint,
    offerPriceETH: string
  ) => {
    const validatedNftContract = AddressSchema.parse(nftContract);
    expectPositive(tokenId, 'Token ID must be positive');
    const validatedOfferPriceETH = NonEmptyStringSchema.parse(offerPriceETH);
    const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
    expectTrue(validatedMarketplace !== '0x0000000000000000000000000000000000000000', 'Marketplace not deployed');

    const price = parseEther(validatedOfferPriceETH)

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'makeOffer',
      args: [validatedNftContract, tokenId, price],
      value: price
    })
    toast.success('Offer submitted')
  }

  const acceptOffer = (offerId: bigint) => {
    expectPositive(offerId, 'Offer ID must be positive');
    const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'acceptOffer',
      args: [offerId]
    })
    toast.success('Offer accepted')
  }

  return {
    makeOffer,
    acceptOffer,
    isPending: isPending || isConfirming,
    isSuccess
  }
}

