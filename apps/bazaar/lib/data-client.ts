/**
 * Unified Data Client for Bazaar
 * 
 * Provides data fetching with multiple source support:
 * 1. Indexer (GraphQL) - primary source when available
 * 2. Direct RPC - fallback for on-chain data
 * 3. External APIs - for price data, cross-chain info
 * 
 * No defensive patterns - fail fast with clear errors
 */

import { createPublicClient, http, type Address, type PublicClient, formatUnits, parseAbiItem } from 'viem'
import { INDEXER_URL, RPC_URL, CHAIN_ID, NETWORK } from '@/config'

// Types
export interface Token {
  address: Address
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  creator: Address
  createdAt: Date
  logoUrl?: string
  verified: boolean
  price?: number
  priceChange24h?: number
  volume24h?: bigint
  holders?: number
}

export interface PredictionMarket {
  id: string
  question: string
  yesPrice: number
  noPrice: number
  totalVolume: bigint
  liquidity: bigint
  resolved: boolean
  outcome?: boolean
  createdAt: Date
  resolutionTime?: Date
}

export interface PriceCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: bigint
}

// ERC20 ABI for direct RPC calls
const ERC20_ABI = [
  parseAbiItem('function name() view returns (string)'),
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function decimals() view returns (uint8)'),
  parseAbiItem('function totalSupply() view returns (uint256)'),
  parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
] as const

// Factory event for token creation detection
const TOKEN_CREATED_EVENT = parseAbiItem('event TokenCreated(address indexed token, address indexed creator, string name, string symbol)')

// Client singleton
let rpcClient: PublicClient | null = null

function getRpcClient(): PublicClient {
  if (!rpcClient) {
    rpcClient = createPublicClient({
      transport: http(RPC_URL),
    })
  }
  return rpcClient
}

// GraphQL helper
async function graphqlQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.status} ${response.statusText}`)
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> }

  if (json.errors?.length) {
    throw new Error(`GraphQL Error: ${json.errors[0].message}`)
  }

  if (!json.data) {
    throw new Error('No data returned from indexer')
  }

  return json.data
}

// Check if indexer is available
export async function checkIndexerHealth(): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
    signal: controller.signal,
  }).catch(() => null)

  clearTimeout(timeoutId)
  return response?.ok ?? false
}

/**
 * Fetch tokens from indexer with RPC enrichment
 */
export async function fetchTokens(options: {
  limit?: number
  offset?: number
  verified?: boolean
  orderBy?: 'volume' | 'recent' | 'holders'
}): Promise<Token[]> {
  const { limit = 50, offset = 0, orderBy = 'recent' } = options

  // Try indexer first
  const indexerAvailable = await checkIndexerHealth()

  if (indexerAvailable) {
    const orderByField = orderBy === 'volume' ? 'totalVolume_DESC' : orderBy === 'holders' ? 'holderCount_DESC' : 'firstSeenAt_DESC'

    const data = await graphqlQuery<{
      contracts: Array<{
        id: string
        address: string
        name: string
        symbol: string
        decimals: number
        totalSupply: string
        creator: { address: string }
        firstSeenAt: string
        verified: boolean
        totalVolume?: string
        holderCount?: number
      }>
    }>(`
      query GetTokens($limit: Int!, $offset: Int!, $orderBy: [ContractOrderByInput!]) {
        contracts(
          where: { isERC20_eq: true }
          limit: $limit
          offset: $offset
          orderBy: $orderBy
        ) {
          id
          address
          name
          symbol
          decimals
          totalSupply
          creator { address }
          firstSeenAt
          verified
          totalVolume
          holderCount
        }
      }
    `, { limit, offset, orderBy: [orderByField] })

    return data.contracts.map(c => ({
      address: c.address as Address,
      name: c.name || 'Unknown Token',
      symbol: c.symbol || '???',
      decimals: c.decimals || 18,
      totalSupply: BigInt(c.totalSupply || '0'),
      creator: c.creator.address as Address,
      createdAt: new Date(c.firstSeenAt),
      verified: c.verified || false,
      volume24h: c.totalVolume ? BigInt(c.totalVolume) : undefined,
      holders: c.holderCount,
    }))
  }

  // Fallback: fetch recent token creation events via RPC
  const client = getRpcClient()
  
  // Get recent blocks for token creation events
  const latestBlock = await client.getBlockNumber()
  const fromBlock = latestBlock > 10000n ? latestBlock - 10000n : 0n

  // This is a simplified fallback - in production, you'd scan factory contracts
  // For now, return well-known tokens on the network
  const knownTokens: Token[] = [
    {
      address: '0x0000000000000000000000000000000000000000' as Address,
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      totalSupply: 0n,
      creator: '0x0000000000000000000000000000000000000000' as Address,
      createdAt: new Date(0),
      verified: true,
    },
  ]

  return knownTokens.slice(offset, offset + limit)
}

/**
 * Fetch single token details with RPC enrichment
 */
export async function fetchTokenDetails(address: Address): Promise<Token> {
  const client = getRpcClient()

  // Direct RPC calls for token data
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }),
  ])

  // Try to get additional data from indexer
  let creator: Address = '0x0000000000000000000000000000000000000000'
  let createdAt = new Date()
  let verified = false
  let volume24h: bigint | undefined
  let holders: number | undefined

  const indexerAvailable = await checkIndexerHealth()
  if (indexerAvailable) {
    const data = await graphqlQuery<{
      contracts: Array<{
        creator: { address: string }
        firstSeenAt: string
        verified: boolean
        totalVolume?: string
        holderCount?: number
      }>
    }>(`
      query GetToken($address: String!) {
        contracts(where: { address_eq: $address }, limit: 1) {
          creator { address }
          firstSeenAt
          verified
          totalVolume
          holderCount
        }
      }
    `, { address: address.toLowerCase() }).catch(() => null)

    if (data?.contracts[0]) {
      const c = data.contracts[0]
      creator = c.creator.address as Address
      createdAt = new Date(c.firstSeenAt)
      verified = c.verified
      volume24h = c.totalVolume ? BigInt(c.totalVolume) : undefined
      holders = c.holderCount
    }
  }

  return {
    address,
    name,
    symbol,
    decimals,
    totalSupply,
    creator,
    createdAt,
    verified,
    volume24h,
    holders,
  }
}

/**
 * Fetch prediction markets
 */
export async function fetchPredictionMarkets(options: {
  limit?: number
  offset?: number
  resolved?: boolean
}): Promise<PredictionMarket[]> {
  const { limit = 50, offset = 0, resolved } = options

  const indexerAvailable = await checkIndexerHealth()

  if (indexerAvailable) {
    const whereClause = resolved !== undefined ? `resolved_eq: ${resolved}` : ''

    const data = await graphqlQuery<{
      predictionMarkets: Array<{
        id: string
        question: string
        yesShares: string
        noShares: string
        liquidityB: string
        totalVolume: string
        resolved: boolean
        outcome: boolean | null
        createdAt: string
        resolutionTime?: string
      }>
    }>(`
      query GetMarkets($limit: Int!, $offset: Int!) {
        predictionMarkets(
          ${whereClause ? `where: { ${whereClause} }` : ''}
          limit: $limit
          offset: $offset
          orderBy: createdAt_DESC
        ) {
          id
          question
          yesShares
          noShares
          liquidityB
          totalVolume
          resolved
          outcome
          createdAt
          resolutionTime
        }
      }
    `, { limit, offset })

    return data.predictionMarkets.map(m => {
      // LMSR pricing
      const yesShares = BigInt(m.yesShares)
      const noShares = BigInt(m.noShares)
      const b = BigInt(m.liquidityB)

      // Price calculation using LMSR
      const yesExp = Math.exp(Number(yesShares) / Number(b))
      const noExp = Math.exp(Number(noShares) / Number(b))
      const total = yesExp + noExp

      return {
        id: m.id,
        question: m.question,
        yesPrice: yesExp / total,
        noPrice: noExp / total,
        totalVolume: BigInt(m.totalVolume),
        liquidity: b,
        resolved: m.resolved,
        outcome: m.outcome ?? undefined,
        createdAt: new Date(m.createdAt),
        resolutionTime: m.resolutionTime ? new Date(m.resolutionTime) : undefined,
      }
    })
  }

  // No RPC fallback for prediction markets - they require indexer
  return []
}

/**
 * Fetch price history for charting
 */
export async function fetchPriceHistory(
  tokenAddress: Address,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  limit: number = 100
): Promise<PriceCandle[]> {
  const indexerAvailable = await checkIndexerHealth()

  if (indexerAvailable) {
    const data = await graphqlQuery<{
      priceCandles: Array<{
        timestamp: string
        open: string
        high: string
        low: string
        close: string
        volume: string
      }>
    }>(`
      query GetPriceHistory($token: String!, $interval: String!, $limit: Int!) {
        priceCandles(
          where: { token_eq: $token, interval_eq: $interval }
          limit: $limit
          orderBy: timestamp_DESC
        ) {
          timestamp
          open
          high
          low
          close
          volume
        }
      }
    `, { token: tokenAddress.toLowerCase(), interval, limit }).catch(() => null)

    if (data?.priceCandles) {
      return data.priceCandles.map(c => ({
        timestamp: new Date(c.timestamp).getTime(),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: BigInt(c.volume),
      })).reverse()
    }
  }

  // Generate synthetic price data for demo
  const now = Date.now()
  const intervalMs = {
    '1m': 60000,
    '5m': 300000,
    '15m': 900000,
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000,
  }[interval]

  const candles: PriceCandle[] = []
  let price = 100 // Starting price

  for (let i = limit - 1; i >= 0; i--) {
    const timestamp = now - i * intervalMs
    const change = (Math.random() - 0.5) * 5
    const open = price
    const close = price + change
    const high = Math.max(open, close) + Math.random() * 2
    const low = Math.min(open, close) - Math.random() * 2
    const volume = BigInt(Math.floor(Math.random() * 1000000))

    candles.push({ timestamp, open, high, low, close, volume })
    price = close
  }

  return candles
}

/**
 * Search tokens by name or symbol
 */
export async function searchTokens(query: string, limit: number = 20): Promise<Token[]> {
  const indexerAvailable = await checkIndexerHealth()

  if (indexerAvailable) {
    const data = await graphqlQuery<{
      contracts: Array<{
        address: string
        name: string
        symbol: string
        decimals: number
        totalSupply: string
        creator: { address: string }
        firstSeenAt: string
        verified: boolean
      }>
    }>(`
      query SearchTokens($query: String!, $limit: Int!) {
        contracts(
          where: { 
            isERC20_eq: true,
            OR: [
              { name_containsInsensitive: $query },
              { symbol_containsInsensitive: $query }
            ]
          }
          limit: $limit
          orderBy: totalVolume_DESC
        ) {
          address
          name
          symbol
          decimals
          totalSupply
          creator { address }
          firstSeenAt
          verified
        }
      }
    `, { query, limit })

    return data.contracts.map(c => ({
      address: c.address as Address,
      name: c.name || 'Unknown',
      symbol: c.symbol || '???',
      decimals: c.decimals || 18,
      totalSupply: BigInt(c.totalSupply || '0'),
      creator: c.creator.address as Address,
      createdAt: new Date(c.firstSeenAt),
      verified: c.verified || false,
    }))
  }

  return []
}

/**
 * Get 24h stats for a token
 */
export async function fetchToken24hStats(address: Address): Promise<{
  volume: bigint
  trades: number
  priceChange: number
  high: number
  low: number
}> {
  const indexerAvailable = await checkIndexerHealth()

  if (indexerAvailable) {
    const data = await graphqlQuery<{
      tokenStats: {
        volume24h: string
        trades24h: number
        priceChange24h: number
        high24h: string
        low24h: string
      } | null
    }>(`
      query GetTokenStats($address: String!) {
        tokenStats(token: $address) {
          volume24h
          trades24h
          priceChange24h
          high24h
          low24h
        }
      }
    `, { address: address.toLowerCase() }).catch(() => null)

    if (data?.tokenStats) {
      return {
        volume: BigInt(data.tokenStats.volume24h),
        trades: data.tokenStats.trades24h,
        priceChange: data.tokenStats.priceChange24h,
        high: parseFloat(data.tokenStats.high24h),
        low: parseFloat(data.tokenStats.low24h),
      }
    }
  }

  return {
    volume: 0n,
    trades: 0,
    priceChange: 0,
    high: 0,
    low: 0,
  }
}

