import { createPublicClient, http, type Address, type PublicClient, parseAbiItem } from 'viem'
import { AddressSchema } from '@jejunetwork/types/contracts'
import { expect, expectTrue } from '@/lib/validation'
import { INDEXER_URL, RPC_URL } from '@/config'

/** Token data from indexer/RPC - simplified for data fetching */
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

const ERC20_ABI = [
  parseAbiItem('function name() view returns (string)'),
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function decimals() view returns (uint8)'),
  parseAbiItem('function totalSupply() view returns (uint256)'),
] as const

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

const mapToken = (c: {
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
}): Token => {
  if (!c.name) throw new Error(`Token ${c.address}: name is required`)
  if (!c.symbol) throw new Error(`Token ${c.address}: symbol is required`)
  if (c.decimals === undefined || c.decimals === null) throw new Error(`Token ${c.address}: decimals is required`)
  if (!c.totalSupply) throw new Error(`Token ${c.address}: totalSupply is required`)
  
  return {
    address: c.address as Address,
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    totalSupply: BigInt(c.totalSupply),
    creator: c.creator.address as Address,
    createdAt: new Date(c.firstSeenAt),
    verified: c.verified,
    volume24h: c.totalVolume ? BigInt(c.totalVolume) : undefined,
    holders: c.holderCount,
  }
}

const ORDER_BY_MAP = {
  volume: 'totalVolume_DESC',
  recent: 'firstSeenAt_DESC', 
  holders: 'holderCount_DESC',
} as const

export async function fetchTokens(options: {
  limit?: number
  offset?: number
  verified?: boolean
  orderBy?: 'volume' | 'recent' | 'holders'
}): Promise<Token[]> {
  const { limit = 50, offset = 0, orderBy = 'recent' } = options

  if (await checkIndexerHealth()) {
    const data = await gql<{ contracts: Array<Parameters<typeof mapToken>[0]> }>(`
      query($limit: Int!, $offset: Int!, $orderBy: [ContractOrderByInput!]) {
        contracts(where: { isERC20_eq: true }, limit: $limit, offset: $offset, orderBy: $orderBy) {
          address name symbol decimals totalSupply
          creator { address } firstSeenAt verified totalVolume holderCount
        }
      }
    `, { limit, offset, orderBy: [ORDER_BY_MAP[orderBy]] })
    return data.contracts.map(mapToken)
  }

  // Fallback: return ETH placeholder
  return offset === 0 ? [{
    address: '0x0000000000000000000000000000000000000000' as Address,
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
    client.readContract({ address: validatedAddress, abi: ERC20_ABI, functionName: 'name' }),
    client.readContract({ address: validatedAddress, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address: validatedAddress, abi: ERC20_ABI, functionName: 'decimals' }),
    client.readContract({ address: validatedAddress, abi: ERC20_ABI, functionName: 'totalSupply' }),
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

  const data = await gql<{ priceCandles: Array<{
    timestamp: string; open: string; high: string; low: string; close: string; volume: string
  }> }>(`
    query($token: String!, $interval: String!, $limit: Int!) {
      priceCandles(where: { token_eq: $token, interval_eq: $interval }, limit: $limit, orderBy: timestamp_DESC) {
        timestamp open high low close volume
      }
    }
  `, { token: validatedAddress.toLowerCase(), interval, limit })

  if (!data.priceCandles?.length) {
    return [] // No data available for this token
  }

  return data.priceCandles.map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: parseFloat(c.open), high: parseFloat(c.high),
    low: parseFloat(c.low), close: parseFloat(c.close),
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

  const data = await gql<{ tokenStats: {
    volume24h: string; trades24h: number; priceChange24h: number; high24h: string; low24h: string
  } | null }>(`
    query($address: String!) {
      tokenStats(token: $address) { volume24h trades24h priceChange24h high24h low24h }
    }
  `, { address: validatedAddress.toLowerCase() })

  if (!data.tokenStats) {
    throw new Error(`No stats found for token ${validatedAddress}`)
  }
  
  return {
    volume: BigInt(data.tokenStats.volume24h),
    trades: data.tokenStats.trades24h,
    priceChange: data.tokenStats.priceChange24h,
    high: parseFloat(data.tokenStats.high24h),
    low: parseFloat(data.tokenStats.low24h),
  }
}
