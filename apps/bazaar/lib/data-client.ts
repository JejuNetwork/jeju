import { createPublicClient, http, type Address, type PublicClient, erc20Abi } from 'viem'
import { AddressSchema } from '@jejunetwork/types'
import { expect, expectTrue } from '@/lib/validation'
import { INDEXER_URL, RPC_URL } from '@/config'

/** Token data from indexer/RPC - full market data */
export interface Token {
  address: Address
  chainId: number
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  creator: Address
  createdAt: Date
  logoUrl?: string
  verified: boolean
  // Market data
  priceUSD?: number
  priceETH?: number
  priceChange1h?: number
  priceChange24h?: number
  priceChange7d?: number
  volume24h?: bigint
  volumeUSD24h?: number
  liquidity?: bigint
  liquidityUSD?: number
  holders?: number
  poolCount?: number
  txCount24h?: number
  lastSwapAt?: Date
}

/** Prediction market data from indexer */
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

/** OHLCV price candle data */
export interface PriceCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: bigint
}

let rpcClient: PublicClient | null = null
const getRpcClient = (): PublicClient => 
  rpcClient ??= createPublicClient({ transport: http(RPC_URL) })

let indexerHealthy: boolean | null = null
let healthCheckTime = 0
const HEALTH_CACHE_MS = 30000

export async function checkIndexerHealth(): Promise<boolean> {
  if (indexerHealthy !== null && Date.now() - healthCheckTime < HEALTH_CACHE_MS) {
    return indexerHealthy
  }
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)
  
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
    signal: controller.signal,
  }).catch(() => null)
  
  clearTimeout(timeoutId)
  indexerHealthy = response?.ok ?? false
  healthCheckTime = Date.now()
  return indexerHealthy
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const validatedIndexerUrl = expect(INDEXER_URL, 'INDEXER_URL not configured');
  const response = await fetch(validatedIndexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  expectTrue(response.ok, `Indexer: ${response.status} ${response.statusText}`)

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`)
  const data = expect(json.data, 'No data from indexer')
  return data
}

interface RawTokenData {
  address: string
  chainId?: number
  name: string
  symbol: string
  decimals: number
  totalSupply: string
  creator?: { address: string }
  createdAt?: string
  firstSeenAt?: string
  verified: boolean
  priceUSD?: string
  priceETH?: string
  priceChange1h?: number
  priceChange24h?: number
  priceChange7d?: number
  volume24h?: string
  volumeUSD24h?: string
  liquidity?: string
  liquidityUSD?: string
  holderCount?: number
  poolCount?: number
  txCount24h?: number
  lastSwapAt?: string
  logoUrl?: string
}

const mapToken = (c: RawTokenData): Token => {
  if (!c.name) throw new Error(`Token ${c.address}: name is required`)
  if (!c.symbol) throw new Error(`Token ${c.address}: symbol is required`)
  if (c.decimals === undefined || c.decimals === null) throw new Error(`Token ${c.address}: decimals is required`)
  if (!c.totalSupply) throw new Error(`Token ${c.address}: totalSupply is required`)
  
  return {
    address: c.address as Address,
    chainId: c.chainId ?? 420691, // Default to Jeju
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    totalSupply: BigInt(c.totalSupply),
    creator: (c.creator?.address ?? '0x0000000000000000000000000000000000000000') as Address,
    createdAt: new Date(c.createdAt ?? c.firstSeenAt ?? Date.now()),
    verified: c.verified,
    logoUrl: c.logoUrl,
    // Market data
    priceUSD: c.priceUSD ? parseFloat(c.priceUSD) : undefined,
    priceETH: c.priceETH ? parseFloat(c.priceETH) : undefined,
    priceChange1h: c.priceChange1h,
    priceChange24h: c.priceChange24h,
    priceChange7d: c.priceChange7d,
    volume24h: c.volume24h ? BigInt(c.volume24h) : undefined,
    volumeUSD24h: c.volumeUSD24h ? parseFloat(c.volumeUSD24h) : undefined,
    liquidity: c.liquidity ? BigInt(c.liquidity) : undefined,
    liquidityUSD: c.liquidityUSD ? parseFloat(c.liquidityUSD) : undefined,
    holders: c.holderCount,
    poolCount: c.poolCount,
    txCount24h: c.txCount24h,
    lastSwapAt: c.lastSwapAt ? new Date(c.lastSwapAt) : undefined,
  }
}

// Map legacy contract data to Token
const mapContractToToken = (c: {
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
}): Token => mapToken({
  ...c,
  createdAt: c.firstSeenAt,
  volume24h: c.totalVolume,
})

const TOKEN_ORDER_BY_MAP = {
  volume: 'volume24h_DESC',
  recent: 'createdAt_DESC', 
  holders: 'holderCount_DESC',
  price: 'priceUSD_DESC',
  liquidity: 'liquidityUSD_DESC',
  trending: 'txCount24h_DESC',
} as const

const LEGACY_ORDER_BY_MAP = {
  volume: 'totalVolume_DESC',
  recent: 'firstSeenAt_DESC', 
  holders: 'holderCount_DESC',
  price: 'firstSeenAt_DESC',
  liquidity: 'totalVolume_DESC',
  trending: 'firstSeenAt_DESC',
} as const

export type TokenOrderBy = keyof typeof TOKEN_ORDER_BY_MAP

/**
 * Fetch tokens with full market data from the Token entity
 * Uses DEX-indexed price/volume data
 */
export async function fetchTokensWithMarketData(options: {
  limit?: number
  offset?: number
  chainId?: number
  verified?: boolean
  orderBy?: TokenOrderBy
  minLiquidity?: number
}): Promise<Token[]> {
  const { limit = 50, offset = 0, chainId, orderBy = 'volume', minLiquidity } = options

  if (!(await checkIndexerHealth())) {
    return fetchTokensFallback(offset)
  }

  // Build where clause
  const whereConditions: string[] = []
  if (chainId) whereConditions.push(`chainId_eq: ${chainId}`)
  if (options.verified !== undefined) whereConditions.push(`verified_eq: ${options.verified}`)
  if (minLiquidity) whereConditions.push(`liquidityUSD_gte: "${minLiquidity}"`)
  
  const whereClause = whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : ''

  const data = await gql<{ tokens: RawTokenData[] }>(`
    query($limit: Int!, $offset: Int!, $orderBy: [TokenOrderByInput!]) {
      tokens(${whereClause} limit: $limit, offset: $offset, orderBy: $orderBy) {
        address chainId name symbol decimals totalSupply
        priceUSD priceETH priceChange1h priceChange24h priceChange7d
        volume24h volumeUSD24h liquidity liquidityUSD
        holderCount poolCount txCount24h
        verified logoUrl createdAt lastSwapAt
        creator { address }
      }
    }
  `, { limit, offset, orderBy: [TOKEN_ORDER_BY_MAP[orderBy]] }).catch(() => null)

  if (data?.tokens?.length) {
    return data.tokens.map(mapToken)
  }

  // Fallback to legacy Contract-based query
  return fetchTokens({ limit, offset, orderBy: orderBy as 'volume' | 'recent' | 'holders' })
}

/**
 * Legacy token fetch from Contract entity (fallback)
 */
export async function fetchTokens(options: {
  limit?: number
  offset?: number
  verified?: boolean
  orderBy?: 'volume' | 'recent' | 'holders'
}): Promise<Token[]> {
  const { limit = 50, offset = 0, orderBy = 'recent' } = options

  if (await checkIndexerHealth()) {
    const data = await gql<{ contracts: Array<{
      address: string; name: string; symbol: string; decimals: number; totalSupply: string
      creator: { address: string }; firstSeenAt: string; verified: boolean
      totalVolume?: string; holderCount?: number
    }> }>(`
      query($limit: Int!, $offset: Int!, $orderBy: [ContractOrderByInput!]) {
        contracts(where: { isERC20_eq: true }, limit: $limit, offset: $offset, orderBy: $orderBy) {
          address name symbol decimals totalSupply
          creator { address } firstSeenAt verified totalVolume holderCount
        }
      }
    `, { limit, offset, orderBy: [LEGACY_ORDER_BY_MAP[orderBy]] })
    return data.contracts.map(mapContractToToken)
  }

  return fetchTokensFallback(offset)
}

function fetchTokensFallback(offset: number): Token[] {
  return offset === 0 ? [{
    address: '0x0000000000000000000000000000000000000000' as Address,
    chainId: 420691,
    name: 'Ether', symbol: 'ETH', decimals: 18, totalSupply: 0n,
    creator: '0x0000000000000000000000000000000000000000' as Address,
    createdAt: new Date(0), verified: true,
  }] : []
}

export async function fetchTokenDetails(address: Address): Promise<Token> {
  const validatedAddress = AddressSchema.parse(address);
  const client = getRpcClient();
  expect(client, 'RPC client not initialized');
  
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address: validatedAddress, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: validatedAddress, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: validatedAddress, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: validatedAddress, abi: erc20Abi, functionName: 'totalSupply' }),
  ])
  
  expect(name, 'Token name not found');
  expect(symbol, 'Token symbol not found');
  expect(decimals !== undefined && decimals !== null, 'Token decimals not found');
  expect(totalSupply !== undefined && totalSupply !== null, 'Token totalSupply not found');

  let creator: Address = '0x0000000000000000000000000000000000000000'
  let createdAt = new Date()
  let verified = false
  let volume24h: bigint | undefined
  let holders: number | undefined

  if (await checkIndexerHealth()) {
    const data = await gql<{ contracts: Array<{
      creator: { address: string }; firstSeenAt: string; verified: boolean
      totalVolume?: string; holderCount?: number
    }> }>(`
      query($address: String!) {
        contracts(where: { address_eq: $address }, limit: 1) {
          creator { address } firstSeenAt verified totalVolume holderCount
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
    address: validatedAddress,
    chainId: 420691, // Default to Jeju
    name: String(name), 
    symbol: String(symbol), 
    decimals: Number(decimals), 
    totalSupply: BigInt(totalSupply), 
    creator, 
    createdAt, 
    verified, 
    volume24h, 
    holders 
  }
}

export async function fetchPredictionMarkets(options: {
  limit?: number
  offset?: number
  resolved?: boolean
}): Promise<PredictionMarket[]> {
  const { limit = 50, offset = 0, resolved } = options
  if (!(await checkIndexerHealth())) return []

  const whereClause = resolved !== undefined ? `where: { resolved_eq: ${resolved} }` : ''
  const data = await gql<{ predictionMarkets: Array<{
    id: string; question: string; yesShares: string; noShares: string
    liquidityB: string; totalVolume: string; resolved: boolean
    outcome: boolean | null; createdAt: string; resolutionTime?: string
  }> }>(`
    query($limit: Int!, $offset: Int!) {
      predictionMarkets(${whereClause} limit: $limit offset: $offset orderBy: createdAt_DESC) {
        id question yesShares noShares liquidityB totalVolume resolved outcome createdAt resolutionTime
      }
    }
  `, { limit, offset })

  return data.predictionMarkets.map(m => {
    const b = Number(m.liquidityB) || 1
    const yesExp = Math.exp(Number(m.yesShares) / b)
    const noExp = Math.exp(Number(m.noShares) / b)
    const total = yesExp + noExp
    return {
      id: m.id, question: m.question,
      yesPrice: yesExp / total, noPrice: noExp / total,
      totalVolume: BigInt(m.totalVolume), liquidity: BigInt(m.liquidityB),
      resolved: m.resolved, outcome: m.outcome ?? undefined,
      createdAt: new Date(m.createdAt),
      resolutionTime: m.resolutionTime ? new Date(m.resolutionTime) : undefined,
    }
  })
}

// Map interval string to GraphQL enum
const INTERVAL_MAP: Record<string, string> = {
  '1m': 'MINUTE_1',
  '5m': 'MINUTE_5',
  '15m': 'MINUTE_15',
  '1h': 'HOUR_1',
  '4h': 'HOUR_4',
  '1d': 'DAY_1',
  '1w': 'WEEK_1',
}

export async function fetchPriceHistory(
  tokenAddress: Address,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  limit = 100
): Promise<PriceCandle[]> {
  const validatedAddress = AddressSchema.parse(tokenAddress);
  expect(limit > 0, 'Limit must be positive');
  expect(['1m', '5m', '15m', '1h', '4h', '1d'].includes(interval), `Invalid interval: ${interval}`);
  
  if (!(await checkIndexerHealth())) {
    throw new Error('Price history unavailable: indexer offline')
  }

  const chainId = 420691 // Default to Jeju
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`
  const graphqlInterval = INTERVAL_MAP[interval]

  // Try new TokenCandle entity first
  const data = await gql<{ tokenCandles: Array<{
    periodStart: string; open: string; high: string; low: string; close: string
    volume: string; volumeUSD: string; txCount: number
  }> }>(`
    query($tokenId: String!, $interval: CandleInterval!, $limit: Int!) {
      tokenCandles(
        where: { token: { id_eq: $tokenId }, interval_eq: $interval }
        limit: $limit
        orderBy: periodStart_DESC
      ) {
        periodStart open high low close volume volumeUSD txCount
      }
    }
  `, { tokenId, interval: graphqlInterval, limit }).catch(() => null)

  if (data?.tokenCandles?.length) {
    return data.tokenCandles.map(c => ({
      timestamp: new Date(c.periodStart).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: BigInt(c.volume),
    })).reverse()
  }

  // Fallback to legacy priceCandles query
  const legacyData = await gql<{ priceCandles: Array<{
    timestamp: string; open: string; high: string; low: string; close: string; volume: string
  }> }>(`
    query($token: String!, $interval: String!, $limit: Int!) {
      priceCandles(where: { token_eq: $token, interval_eq: $interval }, limit: $limit, orderBy: timestamp_DESC) {
        timestamp open high low close volume
      }
    }
  `, { token: validatedAddress.toLowerCase(), interval, limit }).catch(() => null)

  if (!legacyData?.priceCandles?.length) {
    return [] // No data available for this token
  }

  return legacyData.priceCandles.map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: BigInt(c.volume),
  })).reverse()
}

export async function searchTokens(query: string, limit = 20): Promise<Token[]> {
  expect(query, 'Search query is required');
  expect(query.length > 0, 'Search query cannot be empty');
  expect(limit > 0, 'Limit must be positive');
  
  if (!(await checkIndexerHealth())) return []

  const data = await gql<{ contracts: Array<Parameters<typeof mapToken>[0]> }>(`
    query($query: String!, $limit: Int!) {
      contracts(
        where: { isERC20_eq: true, OR: [{ name_containsInsensitive: $query }, { symbol_containsInsensitive: $query }] }
        limit: $limit orderBy: totalVolume_DESC
      ) {
        address name symbol decimals totalSupply
        creator { address } firstSeenAt verified
      }
    }
  `, { query, limit })
  return data.contracts.map(mapToken)
}

export async function fetchToken24hStats(address: Address): Promise<{
  volume: bigint; trades: number; priceChange: number; high: number; low: number
}> {
  const validatedAddress = AddressSchema.parse(address);
  
  if (!(await checkIndexerHealth())) {
    throw new Error('Token 24h stats unavailable: indexer offline')
  }

  const chainId = 420691 // Default to Jeju
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`

  // Try new Token entity first
  const tokenData = await gql<{ tokens: Array<{
    volume24h: string; txCount24h: number; priceChange24h: number
  }> }>(`
    query($tokenId: String!) {
      tokens(where: { id_eq: $tokenId }, limit: 1) {
        volume24h txCount24h priceChange24h
      }
    }
  `, { tokenId }).catch(() => null)

  if (tokenData?.tokens?.[0]) {
    const t = tokenData.tokens[0]
    // Get high/low from daily candle
    const candleData = await gql<{ tokenCandles: Array<{ high: string; low: string }> }>(`
      query($tokenId: String!) {
        tokenCandles(where: { token: { id_eq: $tokenId }, interval_eq: DAY_1 }, limit: 1, orderBy: periodStart_DESC) {
          high low
        }
      }
    `, { tokenId }).catch(() => null)

    const candle = candleData?.tokenCandles?.[0]
    return {
      volume: BigInt(t.volume24h || '0'),
      trades: t.txCount24h || 0,
      priceChange: t.priceChange24h || 0,
      high: candle ? parseFloat(candle.high) : 0,
      low: candle ? parseFloat(candle.low) : 0,
    }
  }

  // Fallback to legacy tokenStats
  const data = await gql<{ tokenStats: {
    volume24h: string; trades24h: number; priceChange24h: number; high24h: string; low24h: string
  } | null }>(`
    query($address: String!) {
      tokenStats(token: $address) { volume24h trades24h priceChange24h high24h low24h }
    }
  `, { address: validatedAddress.toLowerCase() }).catch(() => null)

  if (!data?.tokenStats) {
    return { volume: 0n, trades: 0, priceChange: 0, high: 0, low: 0 }
  }
  
  return {
    volume: BigInt(data.tokenStats.volume24h),
    trades: data.tokenStats.trades24h,
    priceChange: data.tokenStats.priceChange24h,
    high: parseFloat(data.tokenStats.high24h),
    low: parseFloat(data.tokenStats.low24h),
  }
}

/**
 * Get trending tokens by volume and transaction count
 */
export async function fetchTrendingTokens(options: {
  limit?: number
  chainId?: number
}): Promise<Token[]> {
  const { limit = 20, chainId } = options
  
  return fetchTokensWithMarketData({
    limit,
    chainId,
    orderBy: 'trending',
    minLiquidity: 1000, // Minimum $1k liquidity
  })
}

/**
 * Get top gainers (tokens with highest 24h price increase)
 */
export async function fetchTopGainers(options: {
  limit?: number
  chainId?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const whereConditions = ['priceChange24h_gt: 0', 'liquidityUSD_gte: "1000"']
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(`
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: priceChange24h_DESC) {
        address chainId name symbol decimals totalSupply
        priceUSD priceChange24h volume24h liquidityUSD
        verified logoUrl createdAt
      }
    }
  `, { limit: options.limit ?? 10 }).catch(() => null)

  return data?.tokens?.map(mapToken) ?? []
}

/**
 * Get top losers (tokens with highest 24h price decrease)
 */
export async function fetchTopLosers(options: {
  limit?: number
  chainId?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const whereConditions = ['priceChange24h_lt: 0', 'liquidityUSD_gte: "1000"']
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(`
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: priceChange24h_ASC) {
        address chainId name symbol decimals totalSupply
        priceUSD priceChange24h volume24h liquidityUSD
        verified logoUrl createdAt
      }
    }
  `, { limit: options.limit ?? 10 }).catch(() => null)

  return data?.tokens?.map(mapToken) ?? []
}

/**
 * Get recently listed tokens
 */
export async function fetchNewTokens(options: {
  limit?: number
  chainId?: number
  hours?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const since = new Date(Date.now() - (options.hours ?? 24) * 60 * 60 * 1000).toISOString()
  const whereConditions = [`createdAt_gte: "${since}"`]
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(`
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: createdAt_DESC) {
        address chainId name symbol decimals totalSupply
        priceUSD volume24h liquidityUSD poolCount
        verified logoUrl createdAt
      }
    }
  `, { limit: options.limit ?? 20 }).catch(() => null)

  return data?.tokens?.map(mapToken) ?? []
}

/**
 * Get DEX pools for a token
 */
export async function fetchTokenPools(tokenAddress: Address, options?: {
  limit?: number
  chainId?: number
}): Promise<Array<{
  id: string
  address: string
  dex: string
  token0: { address: string; symbol: string }
  token1: { address: string; symbol: string }
  reserve0: bigint
  reserve1: bigint
  liquidityUSD: number
  volumeUSD: number
  fee: number
}>> {
  const validatedAddress = AddressSchema.parse(tokenAddress);
  if (!(await checkIndexerHealth())) return []

  const chainId = options?.chainId ?? 420691
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`

  const data = await gql<{ dexPools: Array<{
    id: string; address: string
    dex: { name: string }
    token0: { address: string; symbol: string }
    token1: { address: string; symbol: string }
    reserve0: string; reserve1: string
    liquidityUSD: string; volumeUSD: string; fee: number
  }> }>(`
    query($tokenId: String!, $limit: Int!) {
      dexPools(
        where: { OR: [{ token0: { id_eq: $tokenId } }, { token1: { id_eq: $tokenId } }] }
        limit: $limit
        orderBy: liquidityUSD_DESC
      ) {
        id address
        dex { name }
        token0 { address symbol }
        token1 { address symbol }
        reserve0 reserve1 liquidityUSD volumeUSD fee
      }
    }
  `, { tokenId, limit: options?.limit ?? 20 }).catch(() => null)

  return data?.dexPools?.map(p => ({
    id: p.id,
    address: p.address,
    dex: p.dex.name,
    token0: p.token0,
    token1: p.token1,
    reserve0: BigInt(p.reserve0),
    reserve1: BigInt(p.reserve1),
    liquidityUSD: parseFloat(p.liquidityUSD),
    volumeUSD: parseFloat(p.volumeUSD),
    fee: p.fee,
  })) ?? []
}

/**
 * Get global market stats
 */
export async function fetchMarketStats(chainId?: number): Promise<{
  totalTokens: number
  activeTokens24h: number
  totalPools: number
  totalVolumeUSD24h: number
  totalLiquidityUSD: number
  totalSwaps24h: number
}> {
  if (!(await checkIndexerHealth())) {
    return {
      totalTokens: 0, activeTokens24h: 0, totalPools: 0,
      totalVolumeUSD24h: 0, totalLiquidityUSD: 0, totalSwaps24h: 0,
    }
  }

  const whereClause = chainId ? `where: { chainId_eq: ${chainId} }` : ''

  const data = await gql<{ tokenMarketStats: Array<{
    totalTokens: number; activeTokens24h: number; totalPools: number
    totalVolumeUSD24h: string; totalLiquidityUSD: string; totalSwaps24h: number
  }> }>(`
    query {
      tokenMarketStats(${whereClause} limit: 1, orderBy: lastUpdated_DESC) {
        totalTokens activeTokens24h totalPools
        totalVolumeUSD24h totalLiquidityUSD totalSwaps24h
      }
    }
  `).catch(() => null)

  const stats = data?.tokenMarketStats?.[0]
  return {
    totalTokens: stats?.totalTokens ?? 0,
    activeTokens24h: stats?.activeTokens24h ?? 0,
    totalPools: stats?.totalPools ?? 0,
    totalVolumeUSD24h: stats ? parseFloat(stats.totalVolumeUSD24h) : 0,
    totalLiquidityUSD: stats ? parseFloat(stats.totalLiquidityUSD) : 0,
    totalSwaps24h: stats?.totalSwaps24h ?? 0,
  }
}
