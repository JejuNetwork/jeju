/**
 * JNS (Network Name Service) Hooks for Bazaar
 * 
 * Provides hooks for:
 * - Listing names for sale
 * - Buying listed names
 * - Name discovery and search
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { type Address, type Hash, formatEther, parseEther, namehash, keccak256, toBytes } from 'viem';
import { CONTRACTS } from '@/config';

// Contract addresses from centralized config
const JNS_REGISTRAR = CONTRACTS.jnsRegistrar;
const BAZAAR = CONTRACTS.bazaar;

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
] as const;

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
] as const;

// ============ Types ============

export interface JNSNameListing {
  listingId: bigint;
  name: string;
  labelhash: `0x${string}`;
  seller: Address;
  price: bigint;
  currency: 'ETH' | 'HG' | 'USDC';
  expiresAt: number;
  nameExpiresAt: number;
  status: 'active' | 'sold' | 'cancelled';
}

export interface JNSOwnedName {
  name: string;
  labelhash: `0x${string}`;
  expiresAt: number;
  isListed: boolean;
  listingId?: bigint;
}

// ============ Hooks ============

/**
 * Hook for listing JNS names on Bazaar
 */
export function useJNSList() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listName = useCallback(async (
    name: string,
    priceInEth: string,
    durationDays: number = 30
  ): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    // Compute labelhash (tokenId)
    const labelhash = keccak256(toBytes(name));
    const tokenId = BigInt(labelhash);

    // Check if approved
    const isApproved = await publicClient?.readContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'isApprovedForAll',
      args: [address, BAZAAR],
    });

    // Approve if needed
    if (!isApproved) {
      const approveHash = await walletClient.writeContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'setApprovalForAll',
        args: [BAZAAR, true],
      });
      // Wait for approval
      await publicClient?.waitForTransactionReceipt({ hash: approveHash });
    }

    // Create listing
    // AssetType: 0 = ERC721
    // Currency: 0 = ETH
    const price = parseEther(priceInEth);
    const duration = BigInt(durationDays * 24 * 60 * 60);

    const hash = await walletClient.writeContract({
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
    });

    setLoading(false);
    return hash;
  }, [walletClient, address, publicClient]);

  const cancelListing = useCallback(async (listingId: bigint): Promise<Hash> => {
    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);

    const hash = await walletClient.writeContract({
      address: BAZAAR,
      abi: BAZAAR_ABI,
      functionName: 'cancelListing',
      args: [listingId],
    });

    setLoading(false);
    return hash;
  }, [walletClient]);

  return {
    listName,
    cancelListing,
    loading,
    error,
  };
}

/**
 * Hook for buying JNS names from Bazaar
 */
export function useJNSBuy() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyName = useCallback(async (listingId: bigint, price: bigint): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    const hash = await walletClient.writeContract({
      address: BAZAAR,
      abi: BAZAAR_ABI,
      functionName: 'buyListing',
      args: [listingId],
      value: price,
    });

    setLoading(false);
    return hash;
  }, [walletClient, address]);

  return {
    buyName,
    loading,
    error,
  };
}

/**
 * Hook for fetching JNS name listings from Bazaar
 */
export function useJNSListings() {
  const publicClient = usePublicClient();
  const [listings, setListings] = useState<JNSNameListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    if (!publicClient) return;

    setLoading(true);
    setError(null);

    try {
      // Query the indexer GraphQL API for active JNS listings
      const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';
      
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
      `;

      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Indexer error: ${response.status}`);
      }

      const { data } = await response.json() as {
        data: {
          jnsListings: Array<{
            id: string;
            price: string;
            currency: string;
            status: string;
            expiresAt: string;
            name: { id: string; name: string; labelhash: string; expiresAt: string };
            seller: { id: string };
          }>;
        };
      };

      const fetchedListings: JNSNameListing[] = data.jnsListings.map((listing, index) => ({
        listingId: BigInt(index + 1),
        name: listing.name.name,
        labelhash: listing.name.labelhash as `0x${string}`,
        seller: listing.seller.id as Address,
        price: BigInt(listing.price),
        currency: listing.currency as 'ETH' | 'USDC',
        expiresAt: Math.floor(new Date(listing.expiresAt).getTime() / 1000),
        nameExpiresAt: Math.floor(new Date(listing.name.expiresAt).getTime() / 1000),
        status: listing.status.toLowerCase() as 'active' | 'sold' | 'cancelled',
      }));

      setListings(fetchedListings);
    } catch (err) {
      console.error('Failed to fetch JNS listings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return {
    listings,
    loading,
    error,
    refetch: fetchListings,
  };
}

/**
 * Hook for fetching owned JNS names
 */
export function useOwnedJNSNames() {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [names, setNames] = useState<JNSOwnedName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNames = useCallback(async () => {
    if (!publicClient || !address) return;

    setLoading(true);
    setError(null);

    // In production, query the indexer for Transfer events to this address
    // For now, return empty array
    setNames([]);
    setLoading(false);
  }, [publicClient, address]);

  useEffect(() => {
    fetchNames();
  }, [fetchNames]);

  return {
    names,
    loading,
    error,
    refetch: fetchNames,
  };
}

// ============ Utilities ============

export function computeLabelhash(name: string): `0x${string}` {
  // Simple implementation - use viem's keccak256 in production
  return `0x${'0'.repeat(64)}` as `0x${string}`;
}

export function formatNamePrice(price: bigint): string {
  return `${formatEther(price)} ETH`;
}

export function getTimeRemaining(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;

  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (24 * 60 * 60));
  if (days > 30) return `${Math.floor(days / 30)} months`;
  if (days > 0) return `${days} days`;

  const hours = Math.floor(diff / (60 * 60));
  if (hours > 0) return `${hours} hours`;

  return `${Math.floor(diff / 60)} minutes`;
}


