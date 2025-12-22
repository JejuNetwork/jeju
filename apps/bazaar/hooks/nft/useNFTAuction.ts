import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { AddressSchema } from '@jejunetwork/types/contracts'
import { expect, expectPositive, expectTrue } from '@/lib/validation'
import { NonEmptyStringSchema } from '@/schemas/common'
import { toast } from 'sonner'
import NFTMarketplaceABI from '@/lib/abis/NFTMarketplace.json'
import { CONTRACTS } from '@/config'

const MARKETPLACE_ADDRESS = CONTRACTS.nftMarketplace

type AuctionData = [string, string, bigint, bigint, bigint, string, bigint, boolean]

export function useNFTAuction(auctionId?: bigint) {
  const { address } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  const { data: auction, refetch: refetchAuction } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: NFTMarketplaceABI,
    functionName: 'getAuction',
    args: auctionId ? [auctionId] : undefined,
    query: { enabled: !!auctionId && auctionId > 0n && MARKETPLACE_ADDRESS !== '0x0' }
  })

  const { data: bids, refetch: refetchBids } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: NFTMarketplaceABI,
    functionName: 'getBids',
    args: auctionId ? [auctionId] : undefined,
    query: { enabled: !!auctionId && auctionId > 0n && MARKETPLACE_ADDRESS !== '0x0' }
  })

  const createAuction = (
    nftContract: `0x${string}`,
    tokenId: bigint,
    reservePriceETH: string,
    durationDays: number,
    buyoutPriceETH?: string
  ) => {
    const validatedNftContract = AddressSchema.parse(nftContract);
    expectPositive(tokenId, 'Token ID must be positive');
    const validatedReservePriceETH = NonEmptyStringSchema.parse(reservePriceETH);
    expectPositive(durationDays, 'Duration must be positive');
    const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
    
    const reservePrice = parseEther(validatedReservePriceETH)
    const duration = BigInt(durationDays * 24 * 60 * 60)
    const buyoutPrice = buyoutPriceETH ? parseEther(NonEmptyStringSchema.parse(buyoutPriceETH)) : 0n

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'createAuction',
      args: [validatedNftContract, tokenId, reservePrice, duration, buyoutPrice]
    })
    toast.success('Auction created')
  }

  const placeBid = (auctionId: bigint, bidAmountETH: string) => {
    expectPositive(auctionId, 'Auction ID must be positive');
    const validatedBidAmountETH = NonEmptyStringSchema.parse(bidAmountETH);
    const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
    const validatedAuction = expect(auction, 'Auction not found');
    const bidAmount = parseEther(validatedBidAmountETH)

    const [, , , reservePrice, highestBid, highestBidder, endTime, settled] = validatedAuction as AuctionData

    const now = Math.floor(Date.now() / 1000)
    expectTrue(Number(endTime) >= now, 'Auction has ended');
    expectTrue(!settled, 'Auction already settled');

    const minBid = highestBid > 0n 
      ? highestBid + (highestBid / BigInt(20))
      : reservePrice

    expectTrue(bidAmount >= minBid, `Minimum bid: ${formatEther(minBid)} ETH`);

    if (highestBidder && highestBidder.toLowerCase() === address?.toLowerCase()) {
      expectTrue(false, 'You already have the highest bid');
    }

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'placeBid',
      args: [auctionId],
      value: bidAmount
    })
    toast.success('Bid placed')
    
    setTimeout(() => {
      refetchAuction()
      refetchBids()
    }, 5000)
  }

  const settleAuction = (auctionId: bigint) => {
    expectPositive(auctionId, 'Auction ID must be positive');
    const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS);
    const validatedAuction = expect(auction, 'Auction not found');
    
    if (validatedAuction) {
      const [, , , , , , endTime, settled] = validatedAuction as AuctionData

      const now = Math.floor(Date.now() / 1000)
      expectTrue(Number(endTime) < now, `Auction ends in ${Math.floor((Number(endTime) - now) / 60)} minutes`);
      expectTrue(!settled, 'Auction already settled');
    }

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'settleAuction',
      args: [auctionId]
    })
    toast.success('Auction settlement submitted')
    setTimeout(() => refetchAuction(), 5000)
  }

  return {
    createAuction,
    placeBid,
    settleAuction,
    auction,
    bids,
    isPending: isPending || isConfirming,
    refetchAuction,
    refetchBids
  }
}
