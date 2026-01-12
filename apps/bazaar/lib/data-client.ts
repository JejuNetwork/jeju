import {
  AddressSchema,
  expect,
  expectTrue,
  type JsonValue,
  JsonValueSchema,
} from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  type PublicClient,
} from 'viem'
import { z } from 'zod'
import {
  INDEXER_URL as CONFIG_INDEXER_URL,
  PREDICTION_MARKET_ADDRESS,
  RPC_URL,
} from '../config'

// Minimal ABI for reading PredictionMarket contract directly
const predictionMarketAbi = [
  {
    inputs: [],
    name: 'getMarketCount',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'getMarketIdAt',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    name: 'markets',
    outputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'question', type: 'string' },
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
      { name: 'liquidityParameter', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'resolved', type: 'bool' },
      { name: 'outcome', type: 'bool' },
      { name: 'gameType', type: 'uint8' },
      { name: 'gameContract', type: 'address' },
      { name: 'category', type: 'uint8' },
      { name: 'usesTWAP', type: 'bool' },
      { name: 'twapStartTime', type: 'uint256' },
      { name: 'twapEndTime', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const INDEXER_URL =
  typeof window !== 'undefined' ? '/api/graphql' : CONFIG_INDEXER_URL

const GraphQLResponseSchema = z.object({
  data: JsonValueSchema.optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
      }),
    )
    .optional(),
})
type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> }

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
  /** TEE-backed oracle information */
  tee?: {
    /** Whether market uses TEE oracle */
    enabled: boolean
    /** Oracle provider address */
    oracleAddress: string
    /** TEE platform type */
    platform?:
      | 'intel_tdx'
      | 'intel_sgx'
      | 'amd_sev_snp'
      | 'phala'
      | 'aws_nitro'
      | 'gcp_confidential'
    /** Attestation status */
    status: 'valid' | 'expired' | 'unverified' | 'pending'
    /** mrEnclave measurement */
    mrEnclave?: string
    /** mrSigner measurement */
    mrSigner?: string
    /** When attestation expires */
    expiresAt?: number
  }
}

export interface PriceCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: bigint
}

let rpcClient: PublicClient | null = null
const getRpcClient = (): PublicClient => {
  if (!rpcClient) {
    const rpcUrl = typeof window !== 'undefined' ? '/api/rpc' : RPC_URL
    rpcClient = createPublicClient({ transport: http(rpcUrl) })
  }
  return rpcClient
}

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 50

function sanitizeLimit(
  limit: number | undefined,
  defaultVal: number = DEFAULT_LIMIT,
): number {
  if (limit === undefined || limit <= 0) return defaultVal
  return Math.min(limit, MAX_LIMIT)
}

let indexerHealthy: boolean | null = null
let healthCheckTime = 0
const HEALTH_CACHE_MS = 30000

export async function checkIndexerHealth(): Promise<boolean> {
  if (
    indexerHealthy !== null &&
    Date.now() - healthCheckTime < HEALTH_CACHE_MS
  ) {
    return indexerHealthy
  }

  if (!INDEXER_URL) {
    indexerHealthy = false
    healthCheckTime = Date.now()
    return false
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    indexerHealthy = response.ok
    healthCheckTime = Date.now()
    return indexerHealthy
  } catch {
    clearTimeout(timeoutId)
    indexerHealthy = false
    healthCheckTime = Date.now()
    return false
  }
}

async function gql<T>(
  query: string,
  variables?: Record<string, JsonValue>,
): Promise<T> {
  const validatedIndexerUrl = expect(INDEXER_URL, 'INDEXER_URL not configured')
  const response = await fetch(validatedIndexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  expectTrue(response.ok, `Indexer: ${response.status} ${response.statusText}`)

  const rawJson: unknown = await response.json()
  const parsed = GraphQLResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid GraphQL response: ${parsed.error.message}`)
  }
  const json = parsed.data as GraphQLResponse<T>
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
  if (c.decimals === undefined || c.decimals === null)
    throw new Error(`Token ${c.address}: decimals is required`)
  if (!c.totalSupply)
    throw new Error(`Token ${c.address}: totalSupply is required`)

  return {
    address: AddressSchema.parse(c.address),
    chainId: c.chainId ?? 420691, // Default to Jeju
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    totalSupply: BigInt(c.totalSupply),
    creator: AddressSchema.parse(
      c.creator?.address ?? '0x0000000000000000000000000000000000000000',
    ),
    createdAt: new Date(c.createdAt ?? c.firstSeenAt ?? Date.now()),
    verified: c.verified,
    logoUrl: c.logoUrl,
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

const TOKEN_ORDER_BY_MAP = {
  volume: 'volume24h_DESC',
  recent: 'createdAt_DESC',
  holders: 'holderCount_DESC',
  price: 'priceUSD_DESC',
  liquidity: 'liquidityUSD_DESC',
  trending: 'txCount24h_DESC',
} as const

export type TokenOrderBy = keyof typeof TOKEN_ORDER_BY_MAP

export async function fetchTokensWithMarketData(options: {
  limit?: number
  offset?: number
  chainId?: number
  verified?: boolean
  orderBy?: TokenOrderBy
  minLiquidity?: number
}): Promise<Token[]> {
  const { offset = 0, chainId, orderBy = 'volume', minLiquidity } = options
  const limit = sanitizeLimit(options.limit)

  expectTrue(await checkIndexerHealth(), 'Indexer unavailable')

  const whereConditions: string[] = []
  if (chainId) whereConditions.push(`chainId_eq: ${chainId}`)
  if (options.verified !== undefined)
    whereConditions.push(`verified_eq: ${options.verified}`)
  if (minLiquidity) whereConditions.push(`liquidityUSD_gte: "${minLiquidity}"`)

  const whereClause =
    whereConditions.length > 0 ? `where: { ${whereConditions.join(', ')} }` : ''

  const data = await gql<{ tokens: RawTokenData[] }>(
    `
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
  `,
    { limit, offset, orderBy: [TOKEN_ORDER_BY_MAP[orderBy]] },
  )

  return data.tokens.map(mapToken)
}

export async function fetchTokenDetails(address: Address): Promise<Token> {
  const validatedAddress = AddressSchema.parse(address)
  const client = getRpcClient()
  expect(client, 'RPC client not initialized')

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({
      address: validatedAddress,
      abi: erc20Abi,
      functionName: 'name',
    }),
    client.readContract({
      address: validatedAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    }),
    client.readContract({
      address: validatedAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
    client.readContract({
      address: validatedAddress,
      abi: erc20Abi,
      functionName: 'totalSupply',
    }),
  ])

  expect(name, 'Token name not found')
  expect(symbol, 'Token symbol not found')
  expect(
    decimals !== undefined && decimals !== null,
    'Token decimals not found',
  )
  expect(
    totalSupply !== undefined && totalSupply !== null,
    'Token totalSupply not found',
  )

  let creator: Address = '0x0000000000000000000000000000000000000000'
  let createdAt = new Date()
  let verified = false
  let volume24h: bigint | undefined
  let holders: number | undefined

  if (await checkIndexerHealth()) {
    // Try to get token data first (has volume/holders), fall back to contract if not found
    try {
      const tokenData = await gql<{
        tokens: Array<{
          creator: { address: string }
          createdAt: string
          verified: boolean
          volume24h: string
          holderCount: number
        }>
      }>(
        `
        query($address: String!) {
          tokens(where: { address_eq: $address }, limit: 1) {
            creator { address } createdAt verified volume24h holderCount
          }
        }
      `,
        { address: address.toLowerCase() },
      )

      if (tokenData.tokens[0]) {
        const t = tokenData.tokens[0]
        creator = AddressSchema.parse(t.creator.address)
        createdAt = new Date(t.createdAt)
        verified = t.verified
        volume24h = BigInt(t.volume24h)
        holders = t.holderCount
      }
    } catch {
      // Token not found, try contract (no volume/holders data)
      const data = await gql<{
        contracts: Array<{
          creator: { address: string }
          firstSeenAt: string
          verified: boolean
        }>
      }>(
        `
        query($address: String!) {
          contracts(where: { address_eq: $address }, limit: 1) {
            creator { address } firstSeenAt verified
          }
        }
      `,
        { address: address.toLowerCase() },
      )

      if (data.contracts[0]) {
        const c = data.contracts[0]
        creator = AddressSchema.parse(c.creator.address)
        createdAt = new Date(c.firstSeenAt)
        verified = c.verified
        // volume24h and holders remain undefined for contracts
      }
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
    holders,
  }
}

async function fetchPredictionMarketsFromRPC(options: {
  limit?: number
  offset?: number
  resolved?: boolean
}): Promise<PredictionMarket[]> {
  const { offset = 0, resolved } = options
  const limit = sanitizeLimit(options.limit)

  if (
    !PREDICTION_MARKET_ADDRESS ||
    PREDICTION_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000'
  ) {
    console.log('[data-client] No prediction market address configured')
    return []
  }

  const client = getRpcClient()
  const markets: PredictionMarket[] = []

  const marketCount = (await client.readContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: predictionMarketAbi,
    functionName: 'getMarketCount',
  })) as bigint

  const totalCount = Number(marketCount)
  if (totalCount === 0) return []

  const startIndex = Math.max(0, totalCount - offset - limit)
  const endIndex = Math.max(0, totalCount - offset)

  const marketIds: `0x${string}`[] = []
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const sessionId = (await client.readContract({
      address: PREDICTION_MARKET_ADDRESS,
      abi: predictionMarketAbi,
      functionName: 'getMarketIdAt',
      args: [BigInt(i)],
    })) as `0x${string}`
    marketIds.push(sessionId)
  }

  for (const sessionId of marketIds) {
    const marketData = (await client.readContract({
      address: PREDICTION_MARKET_ADDRESS,
      abi: predictionMarketAbi,
      functionName: 'markets',
      args: [sessionId],
    })) as readonly [
      `0x${string}`, // sessionId
      string, // question
      bigint, // yesShares
      bigint, // noShares
      bigint, // liquidityParameter
      bigint, // totalVolume
      bigint, // createdAt
      boolean, // resolved
      boolean, // outcome
      number, // gameType
      Address, // gameContract
      number, // category
      boolean, // usesTWAP
      bigint, // twapStartTime
      bigint, // twapEndTime
    ]

    const isResolved = marketData[7]
    if (resolved !== undefined && isResolved !== resolved) {
      continue
    }

    const yesShares = Number(marketData[2])
    const noShares = Number(marketData[3])
    const b = Number(marketData[4]) || 1

    const yesExp = Math.exp(yesShares / b)
    const noExp = Math.exp(noShares / b)
    const total = yesExp + noExp

    markets.push({
      id: sessionId,
      question: marketData[1],
      yesPrice: yesExp / total,
      noPrice: noExp / total,
      totalVolume: marketData[5],
      liquidity: marketData[4],
      resolved: isResolved,
      outcome: isResolved ? marketData[8] : undefined,
      createdAt: new Date(Number(marketData[6]) * 1000),
      resolutionTime: undefined,
    })
  }

  return markets
}

export async function fetchPredictionMarkets(options: {
  limit?: number
  offset?: number
  resolved?: boolean
}): Promise<PredictionMarket[]> {
  const { offset = 0, resolved } = options
  const limit = sanitizeLimit(options.limit)

  const indexerHealthy = await checkIndexerHealth()

  if (indexerHealthy) {
    const whereClause =
      resolved !== undefined ? `where: { resolved_eq: ${resolved} }` : ''

    try {
      const data = await gql<{
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
      }>(
        `
        query($limit: Int!, $offset: Int!) {
          predictionMarkets(${whereClause} limit: $limit offset: $offset orderBy: createdAt_DESC) {
            id question yesShares noShares liquidityB totalVolume resolved outcome createdAt resolutionTime
          }
        }
      `,
        { limit, offset },
      )

      if (data.predictionMarkets && data.predictionMarkets.length > 0) {
        return data.predictionMarkets.map((m) => {
          const b = Number(m.liquidityB) || 1
          const yesExp = Math.exp(Number(m.yesShares) / b)
          const noExp = Math.exp(Number(m.noShares) / b)
          const total = yesExp + noExp
          return {
            id: m.id,
            question: m.question,
            yesPrice: yesExp / total,
            noPrice: noExp / total,
            totalVolume: BigInt(m.totalVolume),
            liquidity: BigInt(m.liquidityB),
            resolved: m.resolved,
            outcome: m.outcome ?? undefined,
            createdAt: new Date(m.createdAt),
            resolutionTime: m.resolutionTime
              ? new Date(m.resolutionTime)
              : undefined,
          }
        })
      }
    } catch (indexerError) {
      console.log(
        '[data-client] Indexer query failed, trying RPC fallback:',
        indexerError,
      )
    }
  }

  console.log('[data-client] Using RPC fallback for prediction markets')
  return fetchPredictionMarketsFromRPC(options)
}

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
  requestedLimit = 100,
): Promise<PriceCandle[]> {
  const validatedAddress = AddressSchema.parse(tokenAddress)
  const limit = sanitizeLimit(requestedLimit, 100)
  expect(
    ['1m', '5m', '15m', '1h', '4h', '1d'].includes(interval),
    `Invalid interval: ${interval}`,
  )

  if (!(await checkIndexerHealth())) {
    throw new Error('Price history unavailable: indexer offline')
  }

  const chainId = 420691 // Default to Jeju
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`
  const graphqlInterval = INTERVAL_MAP[interval]

  const data = await gql<{
    tokenCandles: Array<{
      periodStart: string
      open: string
      high: string
      low: string
      close: string
      volume: string
      volumeUSD: string
      txCount: number
    }>
  }>(
    `
    query($tokenId: String!, $interval: CandleInterval!, $limit: Int!) {
      tokenCandles(
        where: { token: { id_eq: $tokenId }, interval_eq: $interval }
        limit: $limit
        orderBy: periodStart_DESC
      ) {
        periodStart open high low close volume volumeUSD txCount
      }
    }
  `,
    { tokenId, interval: graphqlInterval, limit },
  )

  if (!data.tokenCandles.length) {
    return []
  }

  return data.tokenCandles
    .map((c) => ({
      timestamp: new Date(c.periodStart).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: BigInt(c.volume),
    }))
    .reverse()
}

export async function searchTokens(
  query: string,
  requestedLimit = 20,
): Promise<Token[]> {
  expect(query, 'Search query is required')
  expect(query.length > 0, 'Search query cannot be empty')
  const limit = sanitizeLimit(requestedLimit, 20)

  if (!(await checkIndexerHealth())) return []

  // Query Token entities (Contract doesn't have name/symbol fields for search)
  // If no Token entities exist (e.g., on localnet without DEX activity), return empty
  try {
    const tokenData = await gql<{
      tokens: Array<Parameters<typeof mapToken>[0]>
    }>(
      `
      query($query: String!, $limit: Int!) {
        tokens(
          where: { OR: [{ name_containsInsensitive: $query }, { symbol_containsInsensitive: $query }] }
          limit: $limit orderBy: volume24h_DESC
        ) {
          address chainId name symbol decimals totalSupply
          creator { address } createdAt verified
        }
      }
    `,
      { query, limit },
    )
    return tokenData.tokens.map(mapToken)
  } catch (error) {
    // Tokens query failed or no tokens found - return empty array
    // Contract entities don't have name/symbol fields, so we can't search them
    console.warn('[searchTokens] Token search failed:', error)
    return []
  }
}

export async function fetchToken24hStats(address: Address): Promise<{
  volume: bigint
  trades: number
  priceChange: number
  high: number
  low: number
}> {
  const validatedAddress = AddressSchema.parse(address)

  if (!(await checkIndexerHealth())) {
    throw new Error('Token 24h stats unavailable: indexer offline')
  }

  const chainId = 420691 // Default to Jeju
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`

  const tokenData = await gql<{
    tokens: Array<{
      volume24h: string
      txCount24h: number
      priceChange24h: number
    }>
  }>(
    `
    query($tokenId: String!) {
      tokens(where: { id_eq: $tokenId }, limit: 1) {
        volume24h txCount24h priceChange24h
      }
    }
  `,
    { tokenId },
  )

  if (tokenData.tokens[0]) {
    const t = tokenData.tokens[0]
    const candleData = await gql<{
      tokenCandles: Array<{ high: string; low: string }>
    }>(
      `
      query($tokenId: String!) {
        tokenCandles(where: { token: { id_eq: $tokenId }, interval_eq: DAY_1 }, limit: 1, orderBy: periodStart_DESC) {
          high low
        }
      }
    `,
      { tokenId },
    )

    const candle = candleData.tokenCandles[0]
    return {
      volume: BigInt(t.volume24h ?? '0'),
      trades: t.txCount24h ?? 0,
      priceChange: t.priceChange24h ?? 0,
      high: candle ? parseFloat(candle.high) : 0,
      low: candle ? parseFloat(candle.low) : 0,
    }
  }

  return { volume: 0n, trades: 0, priceChange: 0, high: 0, low: 0 }
}

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

export async function fetchTopGainers(options: {
  limit?: number
  chainId?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const whereConditions = ['priceChange24h_gt: 0', 'liquidityUSD_gte: "1000"']
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(
    `
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: priceChange24h_DESC) {
        address chainId name symbol decimals totalSupply
        priceUSD priceChange24h volume24h liquidityUSD
        verified logoUrl createdAt
      }
    }
  `,
    { limit: options.limit ?? 10 },
  )

  return data.tokens.map(mapToken)
}

export async function fetchTopLosers(options: {
  limit?: number
  chainId?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const whereConditions = ['priceChange24h_lt: 0', 'liquidityUSD_gte: "1000"']
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(
    `
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: priceChange24h_ASC) {
        address chainId name symbol decimals totalSupply
        priceUSD priceChange24h volume24h liquidityUSD
        verified logoUrl createdAt
      }
    }
  `,
    { limit: options.limit ?? 10 },
  )

  return data.tokens.map(mapToken)
}

export async function fetchNewTokens(options: {
  limit?: number
  chainId?: number
  hours?: number
}): Promise<Token[]> {
  if (!(await checkIndexerHealth())) return []

  const since = new Date(
    Date.now() - (options.hours ?? 24) * 60 * 60 * 1000,
  ).toISOString()
  const whereConditions = [`createdAt_gte: "${since}"`]
  if (options.chainId) whereConditions.push(`chainId_eq: ${options.chainId}`)

  const data = await gql<{ tokens: RawTokenData[] }>(
    `
    query($limit: Int!) {
      tokens(where: { ${whereConditions.join(', ')} }, limit: $limit, orderBy: createdAt_DESC) {
        address chainId name symbol decimals totalSupply
        priceUSD volume24h liquidityUSD poolCount
        verified logoUrl createdAt
      }
    }
  `,
    { limit: options.limit ?? 20 },
  )

  return data.tokens.map(mapToken)
}

export async function fetchTokenPools(
  tokenAddress: Address,
  options?: {
    limit?: number
    chainId?: number
  },
): Promise<
  Array<{
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
  }>
> {
  const validatedAddress = AddressSchema.parse(tokenAddress)
  if (!(await checkIndexerHealth())) return []

  const chainId = options?.chainId ?? 420691
  const tokenId = `${chainId}-${validatedAddress.toLowerCase()}`

  const data = await gql<{
    dexPools: Array<{
      id: string
      address: string
      dex: { name: string }
      token0: { address: string; symbol: string }
      token1: { address: string; symbol: string }
      reserve0: string
      reserve1: string
      liquidityUSD: string
      volumeUSD: string
      fee: number
    }>
  }>(
    `
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
  `,
    { tokenId, limit: options?.limit ?? 20 },
  )

  return data.dexPools.map((p) => ({
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
  }))
}

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
      totalTokens: 0,
      activeTokens24h: 0,
      totalPools: 0,
      totalVolumeUSD24h: 0,
      totalLiquidityUSD: 0,
      totalSwaps24h: 0,
    }
  }

  const whereClause = chainId ? `where: { chainId_eq: ${chainId} }` : ''

  const data = await gql<{
    tokenMarketStats: Array<{
      totalTokens: number
      activeTokens24h: number
      totalPools: number
      totalVolumeUSD24h: string
      totalLiquidityUSD: string
      totalSwaps24h: number
    }>
  }>(`
    query {
      tokenMarketStats(${whereClause} limit: 1, orderBy: lastUpdated_DESC) {
        totalTokens activeTokens24h totalPools
        totalVolumeUSD24h totalLiquidityUSD totalSwaps24h
      }
    }
  `)

  const stats = data.tokenMarketStats[0]
  if (!stats) {
    return {
      totalTokens: 0,
      activeTokens24h: 0,
      totalPools: 0,
      totalVolumeUSD24h: 0,
      totalLiquidityUSD: 0,
      totalSwaps24h: 0,
    }
  }

  return {
    totalTokens: stats.totalTokens,
    activeTokens24h: stats.activeTokens24h,
    totalPools: stats.totalPools,
    totalVolumeUSD24h: parseFloat(stats.totalVolumeUSD24h),
    totalLiquidityUSD: parseFloat(stats.totalLiquidityUSD),
    totalSwaps24h: stats.totalSwaps24h,
  }
}
