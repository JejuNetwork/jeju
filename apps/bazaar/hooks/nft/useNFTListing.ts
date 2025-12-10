import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount } from 'wagmi'
import { parseEther } from 'viem'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import NFTMarketplaceABI from '@/lib/abis/NFTMarketplace.json'
import { CONTRACTS } from '@/config'

const MARKETPLACE_ADDRESS = CONTRACTS.nftMarketplace

const ERC721_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'getApproved',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' }
    ],
    outputs: []
  }
] as const

export function useNFTListing(nftContract: `0x${string}`, tokenId: bigint) {
  const { address } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const [isOwner, setIsOwner] = useState(false)
  const [isApproved, setIsApproved] = useState(false)

  const { data: owner, refetch: refetchOwner } = useReadContract({
    address: nftContract,
    abi: ERC721_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
    query: { enabled: !!nftContract && tokenId > 0n }
  })

  const { data: approved, refetch: refetchApproval } = useReadContract({
    address: nftContract,
    abi: ERC721_ABI,
    functionName: 'getApproved',
    args: [tokenId],
    query: { enabled: !!nftContract && tokenId > 0n }
  })

  useEffect(() => {
    if (owner && address) {
      setIsOwner(owner.toLowerCase() === address.toLowerCase())
    }
  }, [owner, address])

  useEffect(() => {
    if (approved && MARKETPLACE_ADDRESS) {
      setIsApproved(approved.toLowerCase() === MARKETPLACE_ADDRESS.toLowerCase())
    }
  }, [approved])

  const approveNFT = () => {
    if (MARKETPLACE_ADDRESS === '0x0') {
      toast.error('Marketplace not deployed')
      return
    }

    if (!isOwner) {
      toast.error('You do not own this NFT')
      return
    }

    writeContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: 'approve',
      args: [MARKETPLACE_ADDRESS, tokenId]
    })
    toast.success('Approval submitted - waiting for confirmation...')
    setTimeout(() => refetchApproval(), 3000)
  }

  const createListing = (priceETH: string, durationDays: number) => {
    if (MARKETPLACE_ADDRESS === '0x0') {
      toast.error('Marketplace not deployed')
      return
    }

    if (!isOwner) {
      toast.error('You do not own this NFT')
      return
    }

    if (!isApproved) {
      toast.error('NFT not approved for marketplace', {
        action: { label: 'Approve', onClick: approveNFT }
      })
      return
    }

    const priceNum = parseFloat(priceETH)
    if (priceNum < 0.001) {
      toast.error('Minimum listing price is 0.001 ETH')
      return
    }

    const price = parseEther(priceETH)
    const duration = BigInt(durationDays * 24 * 60 * 60)

    writeContract({
      address: MARKETPLACE_ADDRESS,
      abi: NFTMarketplaceABI,
      functionName: 'createListing',
      args: [nftContract, tokenId, price, duration]
    })
    toast.success('Listing submitted - waiting for confirmation...')
  }

  const cancelListing = (listingId: bigint) => {
    if (!isOwner) {
      toast.error('You do not own this NFT')
      return
    }

    writeContract({
      address: MARKETPLACE_ADDRESS,
      abi: NFTMarketplaceABI,
      functionName: 'cancelListing',
      args: [listingId]
    })
    toast.success('Listing cancellation submitted...')
  }

  return {
    approveNFT,
    createListing,
    cancelListing,
    isPending: isPending || isConfirming,
    isSuccess,
    isOwner,
    isApproved,
    needsApproval: isOwner && !isApproved,
    refetchOwner,
    refetchApproval
  }
}
