import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { parseEther, formatEther } from 'viem'
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
    const reservePrice = parseEther(reservePriceETH)
    const duration = BigInt(durationDays * 24 * 60 * 60)
    const buyoutPrice = buyoutPriceETH ? parseEther(buyoutPriceETH) : 0n

    writeContract({
      address: MARKETPLACE_ADDRESS,
      abi: NFTMarketplaceABI,
      functionName: 'createAuction',
      args: [nftContract, tokenId, reservePrice, duration, buyoutPrice]
    })
    toast.success('Auction created')
  }

  const placeBid = (auctionId: bigint, bidAmountETH: string) => {
    const bidAmount = parseEther(bidAmountETH)

    if (auction) {
      const [, , , reservePrice, highestBid, highestBidder, endTime, settled] = auction as AuctionData

      const now = Math.floor(Date.now() / 1000)
      if (Number(endTime) < now) {
        toast.error('Auction has ended')
        return
      }

      if (settled) {
        toast.error('Auction already settled')
        return
      }

      const minBid = highestBid > 0n 
        ? highestBid + (highestBid / BigInt(20))
        : reservePrice

      if (bidAmount < minBid) {
        toast.error(`Minimum bid: ${formatEther(minBid)} ETH`)
        return
      }

      if (highestBidder && highestBidder.toLowerCase() === address?.toLowerCase()) {
        toast.error('You already have the highest bid')
        return
      }
    }

    writeContract({
      address: MARKETPLACE_ADDRESS,
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
    if (auction) {
      const [, , , , , , endTime, settled] = auction as AuctionData

      const now = Math.floor(Date.now() / 1000)
      if (Number(endTime) >= now) {
        toast.error(`Auction ends in ${Math.floor((Number(endTime) - now) / 60)} minutes`)
        return
      }

      if (settled) {
        toast.error('Auction already settled')
        return
      }
    }

    writeContract({
      address: MARKETPLACE_ADDRESS,
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
