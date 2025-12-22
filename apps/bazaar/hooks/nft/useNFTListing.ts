import { AddressSchema } from '@jejunetwork/types'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS } from '@/config'
import NFTMarketplaceABI from '@/lib/abis/NFTMarketplace.json'
import { expectPositive, expectTrue } from '@/lib/validation'

const MARKETPLACE_ADDRESS = CONTRACTS.nftMarketplace

const ERC721_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getApproved',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export function useNFTListing(nftContract: `0x${string}`, tokenId: bigint) {
  const validatedContract = AddressSchema.parse(nftContract)
  expectPositive(tokenId, 'Token ID must be positive')
  const validatedMarketplace = AddressSchema.parse(MARKETPLACE_ADDRESS)

  const { address } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })
  const [isOwner, setIsOwner] = useState(false)
  const [isApproved, setIsApproved] = useState(false)

  const { data: owner, refetch: refetchOwner } = useReadContract({
    address: validatedContract,
    abi: ERC721_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
    query: { enabled: true },
  })

  const { data: approved, refetch: refetchApproval } = useReadContract({
    address: validatedContract,
    abi: ERC721_ABI,
    functionName: 'getApproved',
    args: [tokenId],
    query: { enabled: true },
  })

  useEffect(() => {
    if (owner && address) {
      setIsOwner(owner.toLowerCase() === address.toLowerCase())
    }
  }, [owner, address])

  useEffect(() => {
    if (approved) {
      setIsApproved(
        approved.toLowerCase() === validatedMarketplace.toLowerCase(),
      )
    }
  }, [approved, validatedMarketplace])

  const approveNFT = () => {
    expectTrue(isOwner, 'You do not own this NFT')

    writeContract({
      address: validatedContract,
      abi: ERC721_ABI,
      functionName: 'approve',
      args: [validatedMarketplace, tokenId],
    })
    toast.success('Approval submitted - waiting for confirmation...')
    setTimeout(() => refetchApproval(), 3000)
  }

  const createListing = (priceETH: string, durationDays: number) => {
    expectTrue(isOwner, 'You do not own this NFT')
    expectTrue(isApproved, 'NFT not approved for marketplace')

    const priceNum = parseFloat(priceETH)
    expectTrue(priceNum >= 0.001, 'Minimum listing price is 0.001 ETH')
    expectTrue(durationDays > 0, 'Duration must be positive')

    const price = parseEther(priceETH)
    const duration = BigInt(durationDays * 24 * 60 * 60)

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'createListing',
      args: [validatedContract, tokenId, price, duration],
    })
    toast.success('Listing submitted - waiting for confirmation...')
  }

  const cancelListing = (listingId: bigint) => {
    expectTrue(isOwner, 'You do not own this NFT')
    expectPositive(listingId, 'Listing ID must be positive')

    writeContract({
      address: validatedMarketplace,
      abi: NFTMarketplaceABI,
      functionName: 'cancelListing',
      args: [listingId],
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
    refetchApproval,
  }
}
