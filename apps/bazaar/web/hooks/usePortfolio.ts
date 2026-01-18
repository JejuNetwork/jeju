/**
 * Portfolio Hook
 *
 * Fetches real token balances and NFT holdings from chain/indexer.
 */

import { useQuery } from '@tanstack/react-query'
import { type Address, formatEther, formatUnits } from 'viem'
import { useAccount, useBalance } from 'wagmi'
import { CHAIN_ID, INDEXER_URL } from '../../config'
import { checkIndexerHealth, type Token } from '../../lib/data-client'

export interface TokenBalance {
  token: Token
  balance: bigint
  balanceFormatted: string
  valueUSD: number
}

export interface NFTItem {
  contractAddress: Address
  tokenId: bigint
  name: string
  symbol: string
  tokenURI: string
}

export interface PortfolioData {
  totalValueUSD: number
  totalChange24h: number
  tokens: TokenBalance[]
  nfts: NFTItem[]
  totalTokens: number
  totalNFTs: number
}

interface IndexerTokenBalanceRaw {
  token: {
    address: string
    chainId: number
    name: string
    symbol: string
    decimals: number
    totalSupply: string
    priceUSD: string | null
    priceChange24h: number | null
    verified: boolean
    logoUrl: string | null
  }
  balance: string
}

interface IndexerNFTRaw {
  contract: {
    address: string
    name: string
    symbol: string
  }
  tokenId: string
  tokenURI: string | null
}

async function fetchTokenBalancesFromIndexer(
  address: Address,
): Promise<TokenBalance[]> {
  const response = await fetch(INDEXER_URL || '/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetBalances($owner: String!, $chainId: Int!) {
          tokenBalances(
            where: { owner_eq: $owner, balance_gt: "0", token: { chainId_eq: $chainId } }
            orderBy: balanceUSD_DESC
            limit: 100
          ) {
            token {
              address chainId name symbol decimals totalSupply
              priceUSD priceChange24h verified logoUrl
            }
            balance
          }
        }
      `,
      variables: { owner: address.toLowerCase(), chainId: CHAIN_ID },
    }),
  })

  const json = (await response.json()) as {
    data?: { tokenBalances: IndexerTokenBalanceRaw[] }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(json.errors[0].message)

  const tokenBalances: TokenBalance[] = (json.data?.tokenBalances ?? []).map(
    (tb) => {
      const decimals = tb.token.decimals
      const balance = BigInt(tb.balance)
      const balanceFormatted = formatUnits(balance, decimals)
      const priceUSD = tb.token.priceUSD ? parseFloat(tb.token.priceUSD) : 0
      const valueUSD = parseFloat(balanceFormatted) * priceUSD

      return {
        token: {
          address: tb.token.address as Address,
          chainId: tb.token.chainId,
          name: tb.token.name,
          symbol: tb.token.symbol,
          decimals: tb.token.decimals,
          totalSupply: BigInt(tb.token.totalSupply),
          creator: '0x0000000000000000000000000000000000000000' as Address,
          createdAt: new Date(),
          verified: tb.token.verified,
          logoUrl: tb.token.logoUrl ?? undefined,
          priceUSD: priceUSD > 0 ? priceUSD : undefined,
          priceChange24h: tb.token.priceChange24h ?? undefined,
        },
        balance,
        balanceFormatted,
        valueUSD,
      }
    },
  )

  return tokenBalances
}

async function fetchNFTsFromIndexer(address: Address): Promise<NFTItem[]> {
  const response = await fetch(INDEXER_URL || '/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetNFTs($owner: String!) {
          nftTokens(
            where: { owner: { address_eq: $owner } }
            limit: 100
          ) {
            contract { address name symbol }
            tokenId
            tokenURI
          }
        }
      `,
      variables: { owner: address.toLowerCase() },
    }),
  })

  const json = (await response.json()) as {
    data?: { nftTokens: IndexerNFTRaw[] }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(json.errors[0].message)

  return (json.data?.nftTokens ?? []).map((nft) => ({
    contractAddress: nft.contract.address as Address,
    tokenId: BigInt(nft.tokenId),
    name: nft.contract.name,
    symbol: nft.contract.symbol,
    tokenURI: nft.tokenURI ?? '',
  }))
}

export function usePortfolio() {
  const { address } = useAccount()

  // Get native ETH balance
  const { data: ethBalance } = useBalance({
    address,
  })

  return useQuery({
    queryKey: ['portfolio', address],
    queryFn: async (): Promise<PortfolioData> => {
      if (!address) {
        return {
          totalValueUSD: 0,
          totalChange24h: 0,
          tokens: [],
          nfts: [],
          totalTokens: 0,
          totalNFTs: 0,
        }
      }

      const isIndexerUp = await checkIndexerHealth()
      let tokens: TokenBalance[] = []
      let nfts: NFTItem[] = []

      if (isIndexerUp) {
        // Use indexer for complete portfolio data
        try {
          ;[tokens, nfts] = await Promise.all([
            fetchTokenBalancesFromIndexer(address),
            fetchNFTsFromIndexer(address),
          ])
        } catch (e) {
          console.error('[usePortfolio] Indexer fetch failed:', e)
        }
      }

      // Always add native ETH balance
      if (ethBalance && ethBalance.value > 0n) {
        // Fetch ETH price from oracle (handled in the component that calls this)
        // The price will be injected via the ethPriceUSD parameter
        tokens.unshift({
          token: {
            address: '0x0000000000000000000000000000000000000000' as Address,
            chainId: CHAIN_ID,
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
            totalSupply: 0n,
            creator: '0x0000000000000000000000000000000000000000' as Address,
            createdAt: new Date(),
            verified: true,
            // Price will be set when rendering
          },
          balance: ethBalance.value,
          balanceFormatted: formatEther(ethBalance.value),
          valueUSD: 0, // Will be calculated with real price in component
        })
      }

      // Calculate totals
      const totalValueUSD = tokens.reduce((sum, t) => sum + t.valueUSD, 0)
      const weightedChange = tokens.reduce((sum, t) => {
        if (t.valueUSD > 0 && t.token.priceChange24h) {
          return sum + t.token.priceChange24h * t.valueUSD
        }
        return sum
      }, 0)
      const totalChange24h =
        totalValueUSD > 0 ? weightedChange / totalValueUSD : 0

      return {
        totalValueUSD,
        totalChange24h,
        tokens,
        nfts,
        totalTokens: tokens.length,
        totalNFTs: nfts.length,
      }
    },
    enabled: !!address,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  })
}

export interface ActivityTx {
  id: string
  type: 'send' | 'receive'
  from: Address
  to: Address
  value: bigint
  valueFormatted: string
  timestamp: Date
  txHash: `0x${string}`
  token: {
    address: Address
    name: string
    symbol: string
    decimals: number
  }
}

export function useRecentActivity() {
  const { address } = useAccount()

  return useQuery({
    queryKey: ['activity', address],
    queryFn: async (): Promise<ActivityTx[]> => {
      if (!address) return []

      const isIndexerUp = await checkIndexerHealth()
      if (!isIndexerUp) return []

      const response = await fetch(INDEXER_URL || '/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query GetActivity($address: String!) {
              transfers(
                where: { OR: [{ from_eq: $address }, { to_eq: $address }] }
                orderBy: timestamp_DESC
                limit: 20
              ) {
                id
                from
                to
                value
                timestamp
                txHash
                token { address name symbol decimals }
              }
            }
          `,
          variables: { address: address.toLowerCase() },
        }),
      })

      interface TransferRaw {
        id: string
        from: string
        to: string
        value: string
        timestamp: string
        txHash: string
        token: {
          address: string
          name: string
          symbol: string
          decimals: number
        }
      }

      const json = (await response.json()) as {
        data?: { transfers: TransferRaw[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) throw new Error(json.errors[0].message)

      return (json.data?.transfers ?? []).map((tx) => ({
        id: tx.id,
        type: (tx.from.toLowerCase() === address.toLowerCase()
          ? 'send'
          : 'receive') as 'send' | 'receive',
        from: tx.from as Address,
        to: tx.to as Address,
        value: BigInt(tx.value),
        valueFormatted: formatUnits(BigInt(tx.value), tx.token.decimals),
        timestamp: new Date(tx.timestamp),
        txHash: tx.txHash as `0x${string}`,
        token: {
          address: tx.token.address as Address,
          name: tx.token.name,
          symbol: tx.token.symbol,
          decimals: tx.token.decimals,
        },
      }))
    },
    enabled: !!address,
    staleTime: 60000,
  })
}
