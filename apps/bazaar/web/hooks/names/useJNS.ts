/**
 * JNS (Jeju Name Service) Hooks for Bazaar
 *
 * Provides hooks for:
 * - Listing names for sale
 * - Buying listed names
 * - Name discovery and search
 */

import {
  AddressSchema,
  expect,
  expectPositive,
  expectTrue,
  expectValid,
} from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import { type Address, type Hash, parseEther } from 'viem'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { JNSListingsGraphQLResponseSchema } from '../../../lib/validation'
import { CONTRACTS } from '../../config'
import {
  computeNameIdentifiers,
  listingDurationToSeconds,
  validateListingInput,
} from '../../lib/jns'

// Contract addresses from centralized config
const JNS_REGISTRAR = CONTRACTS.jnsRegistrar
const BAZAAR = CONTRACTS.bazaar

// JNS Registrar is an ERC-721, so names can be listed on Bazaar
const JNS_REGISTRAR_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'isApprovedForAll',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getName',
    type: 'function',
    inputs: [{ name: 'labelhash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'nameExpires',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tokenURI',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const

const BAZAAR_ABI = [
  {
    name: 'createListing',
    type: 'function',
    inputs: [
      { name: 'assetType', type: 'uint8' },
      { name: 'assetContract', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint8' },
      { name: 'customCurrencyAddress', type: 'address' },
      { name: 'price', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'listingId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'buyListing',
    type: 'function',
    inputs: [{ name: 'listingId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'cancelListing',
    type: 'function',
    inputs: [{ name: 'listingId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getListing',
    type: 'function',
    inputs: [{ name: 'listingId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'listingId', type: 'uint256' },
          { name: 'seller', type: 'address' },
          { name: 'assetType', type: 'uint8' },
          { name: 'assetContract', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'currency', type: 'uint8' },
          { name: 'customCurrencyAddress', type: 'address' },
          { name: 'price', type: 'uint256' },
          { name: 'listingType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
export interface JNSNameListing {
  listingId: bigint
  name: string
  labelhash: `0x${string}`
  seller: Address
  price: bigint
  currency: 'ETH' | 'HG' | 'USDC'
  expiresAt: number
  nameExpiresAt: number
  status: 'active' | 'sold' | 'cancelled'
}

export interface JNSOwnedName {
  name: string
  labelhash: `0x${string}`
  expiresAt: number
  isListed: boolean
  listingId?: bigint
}
/**
 * Hook for listing JNS names on Bazaar
 */
export function useJNSList() {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listName = useCallback(
    async (
      name: string,
      priceInEth: string,
      durationDays: number = 30,
    ): Promise<Hash> => {
      const validatedWalletClient = expect(walletClient, 'Wallet not connected')
      const validatedAddress = expect(address, 'Wallet not connected')
      AddressSchema.parse(validatedAddress)
      const validatedPublicClient = expect(
        publicClient,
        'Public client not available',
      )

      // Validate input using lib schema
      const validation = validateListingInput({
        name,
        priceEth: priceInEth,
        durationDays,
      })
      expectTrue(validation.valid, validation.valid ? '' : validation.error)

      setLoading(true)
      setError(null)

      // Compute labelhash and tokenId using lib function
      const { tokenId } = computeNameIdentifiers(name)

      // Check if approved
      const isApproved = await validatedPublicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'isApprovedForAll',
        args: [validatedAddress, BAZAAR],
      })

      // Approve if needed
      if (!isApproved) {
        const approveHash = await validatedWalletClient.writeContract({
          address: JNS_REGISTRAR,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'setApprovalForAll',
          args: [BAZAAR, true],
        })
        // Wait for approval
        await validatedPublicClient.waitForTransactionReceipt({
          hash: approveHash,
        })
      }

      // Create listing
      // AssetType: 0 = ERC721
      // Currency: 0 = ETH
      const price = parseEther(priceInEth)
      const duration = listingDurationToSeconds(durationDays)

      const hash = await validatedWalletClient.writeContract({
        address: BAZAAR,
        abi: BAZAAR_ABI,
        functionName: 'createListing',
        args: [
          0, // ERC721
          JNS_REGISTRAR,
          tokenId,
          1n, // amount = 1 for ERC721
          0, // ETH
          '0x0000000000000000000000000000000000000000' as Address,
          price,
          duration,
        ],
      })

      setLoading(false)
      return hash
    },
    [walletClient, address, publicClient],
  )

  const cancelListing = useCallback(
    async (listingId: bigint): Promise<Hash> => {
      if (!walletClient) {
        throw new Error('Wallet not connected')
      }

      setLoading(true)

      const hash = await walletClient.writeContract({
        address: BAZAAR,
        abi: BAZAAR_ABI,
        functionName: 'cancelListing',
        args: [listingId],
      })

      setLoading(false)
      return hash
    },
    [walletClient],
  )

  return {
    listName,
    cancelListing,
    loading,
    error,
  }
}

/**
 * Hook for buying JNS names from Bazaar
 */
export function useJNSBuy() {
  usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buyName = useCallback(
    async (listingId: bigint, price: bigint): Promise<Hash> => {
      const validatedWalletClient = expect(walletClient, 'Wallet not connected')
      const validatedAddress = expect(address, 'Wallet not connected')
      AddressSchema.parse(validatedAddress)
      expectPositive(listingId, 'Listing ID must be positive')
      expectPositive(price, 'Price must be positive')

      setLoading(true)
      setError(null)

      const hash = await validatedWalletClient.writeContract({
        address: BAZAAR,
        abi: BAZAAR_ABI,
        functionName: 'buyListing',
        args: [listingId],
        value: price,
      })

      setLoading(false)
      return hash
    },
    [walletClient, address],
  )

  return {
    buyName,
    loading,
    error,
  }
}

/**
 * Hook for fetching JNS name listings from Bazaar
 */
export function useJNSListings() {
  const publicClient = usePublicClient()
  const [listings, setListings] = useState<JNSNameListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchListings = useCallback(async () => {
    if (!publicClient) return

    setLoading(true)
    setError(null)

    try {
      // Query the indexer GraphQL API for active JNS listings
      const indexerUrl =
        process.env.PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql'

      const query = `
        query GetActiveJNSListings {
          jnsListings(where: { status_eq: ACTIVE }, orderBy: createdAt_DESC, limit: 50) {
            id
            price
            currency
            status
            expiresAt
            name {
              id
              name
              labelhash
              expiresAt
            }
            seller {
              id
            }
          }
        }
      `

      const validatedIndexerUrl = expect(
        indexerUrl,
        'Indexer URL not configured',
      )
      const response = await fetch(validatedIndexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      expectTrue(response.ok, `Indexer error: ${response.status}`)

      const json: unknown = await response.json()
      const validated = expectValid(
        JNSListingsGraphQLResponseSchema,
        json,
        'JNS listings response',
      )

      const fetchedListings: JNSNameListing[] = validated.data.jnsListings.map(
        (
          listing: {
            id: string
            price: string
            currency: string
            status: string
            expiresAt: string
            name: {
              id: string
              name: string
              labelhash: string
              expiresAt: string
            }
            seller: { id: string }
          },
          index: number,
        ) => ({
          listingId: BigInt(index + 1),
          name: listing.name.name,
          labelhash: listing.name.labelhash as `0x${string}`,
          seller: listing.seller.id as Address,
          price: BigInt(listing.price),
          currency: listing.currency as 'ETH' | 'USDC',
          expiresAt: Math.floor(new Date(listing.expiresAt).getTime() / 1000),
          nameExpiresAt: Math.floor(
            new Date(listing.name.expiresAt).getTime() / 1000,
          ),
          status: listing.status.toLowerCase() as
            | 'active'
            | 'sold'
            | 'cancelled',
        }),
      )

      setListings(fetchedListings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch listings')
      setListings([])
    } finally {
      setLoading(false)
    }
  }, [publicClient])

  useEffect(() => {
    fetchListings()
  }, [fetchListings])

  return {
    listings,
    loading,
    error,
    refetch: fetchListings,
  }
}

/**
 * Hook for fetching owned JNS names
 */
export function useOwnedJNSNames() {
  const publicClient = usePublicClient()
  const { address } = useAccount()
  const [names, setNames] = useState<JNSOwnedName[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNames = useCallback(async () => {
    if (!publicClient || !address) return

    setLoading(true)
    setError(null)

    // In production, query the indexer for Transfer events to this address
    // For now, return empty array
    setNames([])
    setLoading(false)
  }, [publicClient, address])

  useEffect(() => {
    fetchNames()
  }, [fetchNames])

  return {
    names,
    loading,
    error,
    refetch: fetchNames,
  }
}
