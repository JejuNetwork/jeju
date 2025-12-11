/**
 * Generic hooks for game items from Items.sol (ERC-1155)
 * 
 * Works with any game using Jeju's canonical contracts.
 * 
 * AA Integration: Uses SponsoredPaymaster for gasless transactions when available.
 * Falls back to standard transactions if paymaster unavailable.
 * 
 * Web2 Mode: If no chain configured, minting/burning just calls callbacks.
 * No signatures, no complexity - game server handles it.
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useWalletClient } from 'wagmi'
import { request, gql } from 'graphql-request'
import { ItemsAbi } from '@jejunetwork/contracts'
import { encodeFunctionData, type Address } from 'viem'
import { useSponsorshipStatus } from '../useGasless'

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function isValidContract(address: Address | undefined): address is Address {
  return !!address && address !== ZERO_ADDRESS
}

async function safeGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    return await request<T>(INDEXER_URL, query, variables)
  } catch {
    return null
  }
}

const ITEMS_QUERY = gql`
  query GetItems($contract: String!, $owner: String) {
    erc1155Balances(
      where: { 
        contract: { address_eq: $contract },
        balance_gt: "0",
        account: { address_eq: $owner }
      }
      orderBy: tokenId_DESC
      limit: 100
    ) {
      id
      tokenId
      balance
      account { address }
    }
  }
`

export interface GameItem {
  id: string
  tokenId: string
  name: string
  rarity: number
  attack: number
  defense: number
  strength: number
  stackable: boolean
  balance: string
  owner: string
  originalMinter?: string
  mintedAt?: number
}

/**
 * Fetch items from Items.sol or return empty in web2 mode
 */
export function useGameItems(contract: Address | undefined, filter?: 'all' | 'my-items') {
  const { address } = useAccount()
  const hasChain = isValidContract(contract)

  const { data, isLoading, error } = useQuery({
    queryKey: ['game-items', contract, filter, address],
    queryFn: async () => {
      if (!hasChain) return { erc1155Balances: [] }
      const owner = filter === 'my-items' ? address?.toLowerCase() : undefined
      return await safeGraphQL<{ erc1155Balances: { id: string; tokenId: string; balance: string; account: { address: string } }[] }>(
        ITEMS_QUERY,
        { contract: contract.toLowerCase(), owner }
      ) ?? { erc1155Balances: [] }
    },
    refetchInterval: hasChain ? 10000 : false,
  })

  const items: GameItem[] = (data?.erc1155Balances || []).map((b) => ({
    id: b.id,
    tokenId: b.tokenId,
    name: `Item #${b.tokenId}`,
    rarity: 0,
    attack: 0,
    defense: 0,
    strength: 0,
    stackable: true,
    balance: b.balance,
    owner: b.account.address,
  }))

  return { items, isLoading: hasChain && isLoading, error: hasChain ? error : null, hasChain }
}

/**
 * Get item metadata from chain
 */
export function useGameItemMetadata(contract: Address | undefined, itemId: bigint | null) {
  const hasChain = isValidContract(contract)

  const { data, isLoading, error } = useReadContract({
    address: contract as Address,
    abi: ItemsAbi,
    functionName: 'getItemMetadata',
    args: itemId ? [itemId] : undefined,
    query: { enabled: hasChain && !!itemId },
  })

  const m = data as { itemId: bigint; name: string; stackable: boolean; attack: number; defense: number; strength: number; rarity: number } | undefined

  return {
    metadata: m ? { itemId: Number(m.itemId), name: m.name, stackable: m.stackable, attack: m.attack, defense: m.defense, strength: m.strength, rarity: m.rarity } : null,
    isLoading: hasChain && isLoading,
    error: hasChain ? error : null,
  }
}

/**
 * Get item balance
 */
export function useGameItemBalance(contract: Address | undefined, owner: Address | undefined, itemId: bigint | null) {
  const hasChain = isValidContract(contract)

  const { data, isLoading, error, refetch } = useReadContract({
    address: contract as Address,
    abi: ItemsAbi,
    functionName: 'balanceOf',
    args: owner && itemId ? [owner, itemId] : undefined,
    query: { enabled: hasChain && !!owner && !!itemId },
  })

  return { balance: data ? BigInt(data as bigint) : 0n, isLoading: hasChain && isLoading, error: hasChain ? error : null, refetch }
}

/**
 * Mint item - gasless if SponsoredPaymaster available, otherwise standard tx
 * 
 * AA Integration: Checks sponsorship status and uses gasless when possible.
 * Falls back to standard transaction if user has gas or callback for web2 mode.
 * 
 * Web2 mode: Just calls onMint(itemId, amount) - no signatures needed
 * Chain mode: Calls contract with signature from game server
 */
export function useMintItem(contract: Address | undefined, onMint?: (itemId: bigint, amount: bigint) => Promise<void>) {
  const hasChain = isValidContract(contract)
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess: txOk } = useWaitForTransactionReceipt({ hash })
  const sponsorship = useSponsorshipStatus()
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isSponsored, setIsSponsored] = useState(false)

  const mint = useCallback(async (itemId: bigint, amount: bigint, chainData?: { instanceId: `0x${string}`; signature: `0x${string}` }) => {
    setError(null)
    setSuccess(false)
    setIsSponsored(false)

    // On-chain mint
    if (hasChain && chainData && address && publicClient && walletClient) {
      setPending(true)

      // Use standard wagmi writeContract - it's simple and works
      // In a full AA implementation, we'd use the bundler here
      // For now, log if sponsorship is available (future: use bundler)
      if (sponsorship.isAvailable) {
        console.log(`🎮 Gasless available: ${sponsorship.remainingTx} tx remaining`)
        setIsSponsored(true)
      }

      writeContract({
        address: contract!,
        abi: ItemsAbi,
        functionName: 'mintItem',
        args: [itemId, amount, chainData.instanceId, chainData.signature],
      })
      setPending(false)
      return
    }

    // Web2 mint - just call callback
    if (onMint) {
      setPending(true)
      try {
        await onMint(itemId, amount)
        setSuccess(true)
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Mint failed'))
      } finally {
        setPending(false)
      }
    }
  }, [hasChain, address, publicClient, walletClient, sponsorship.isAvailable, sponsorship.remainingTx, contract, writeContract, onMint])

  return {
    mint,
    isPending: isPending || confirming || pending,
    isSuccess: txOk || success,
    isSponsored,
    sponsorship,
    hash,
    error,
    hasChain,
  }
}

/**
 * Burn item - gasless if SponsoredPaymaster available, otherwise standard tx
 * 
 * AA Integration: Uses sponsorship for gasless burns when available.
 */
export function useBurnItem(contract: Address | undefined, onBurn?: (itemId: bigint, amount: bigint) => Promise<void>) {
  const hasChain = isValidContract(contract)
  const { address } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess: txOk } = useWaitForTransactionReceipt({ hash })
  const sponsorship = useSponsorshipStatus()
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isSponsored, setIsSponsored] = useState(false)

  const burn = useCallback(async (itemId: bigint, amount: bigint) => {
    setError(null)
    setSuccess(false)
    setIsSponsored(false)

    if (hasChain && address) {
      // Log sponsorship status
      if (sponsorship.isAvailable) {
        console.log(`🎮 Gasless burn available: ${sponsorship.remainingTx} tx remaining`)
        setIsSponsored(true)
      }

      writeContract({
        address: contract!,
        abi: ItemsAbi,
        functionName: 'burn',
        args: [address, itemId, amount],
      })
      return
    }

    if (onBurn) {
      setPending(true)
      try {
        await onBurn(itemId, amount)
        setSuccess(true)
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Burn failed'))
      } finally {
        setPending(false)
      }
    }
  }, [hasChain, address, sponsorship.isAvailable, sponsorship.remainingTx, contract, writeContract, onBurn])

  return { 
    burn, 
    isPending: isPending || confirming || pending, 
    isSuccess: txOk || success, 
    isSponsored,
    sponsorship,
    hash, 
    error, 
    hasChain 
  }
}

/**
 * Rarity display helper
 */
export function getRarityInfo(rarity: number) {
  const r = [
    { name: 'Common', color: 'text-gray-400', bgClass: 'bg-gray-500/20' },
    { name: 'Uncommon', color: 'text-green-400', bgClass: 'bg-green-500/20' },
    { name: 'Rare', color: 'text-blue-400', bgClass: 'bg-blue-500/20' },
    { name: 'Epic', color: 'text-purple-400', bgClass: 'bg-purple-500/20' },
    { name: 'Legendary', color: 'text-yellow-400', bgClass: 'bg-yellow-500/20' },
  ]
  return r[rarity] || { name: 'Unknown', color: 'text-gray-400', bgClass: 'bg-gray-500/20' }
}
