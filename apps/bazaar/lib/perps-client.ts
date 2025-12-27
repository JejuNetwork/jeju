/**
 * Perpetuals Trading Data Client
 *
 * Fetches perpetual market and position data from the blockchain
 */

import { type Address, createPublicClient, http, type PublicClient } from 'viem'
import { getL2RpcUrl, PERPETUAL_MARKET_ADDRESS } from '../config'

// Minimal ABI for reading PerpetualMarket contract
const perpetualMarketAbi = [
  {
    inputs: [],
    name: 'getAllMarkets',
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'markets',
    outputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'symbol', type: 'string' },
      { name: 'baseAsset', type: 'address' },
      { name: 'quoteAsset', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'maxLeverage', type: 'uint256' },
      { name: 'maintenanceMarginBps', type: 'uint256' },
      { name: 'initialMarginBps', type: 'uint256' },
      { name: 'takerFeeBps', type: 'uint256' },
      { name: 'makerFeeBps', type: 'uint256' },
      { name: 'maxOpenInterest', type: 'uint256' },
      { name: 'fundingInterval', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getMarkPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getIndexPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getFundingRate',
    outputs: [{ type: 'int256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    name: 'getMarketOpenInterest',
    outputs: [
      { name: 'longOI', type: 'uint256' },
      { name: 'shortOI', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'trader', type: 'address' }],
    name: 'getTraderPositions',
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    name: 'positions',
    outputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'trader', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'side', type: 'uint8' },
      { name: 'marginType', type: 'uint8' },
      { name: 'size', type: 'uint256' },
      { name: 'margin', type: 'uint256' },
      { name: 'marginToken', type: 'address' },
      { name: 'entryPrice', type: 'uint256' },
      { name: 'entryFundingIndex', type: 'int256' },
      { name: 'lastUpdateTime', type: 'uint256' },
      { name: 'isOpen', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    name: 'getPositionPnl',
    outputs: [
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'fundingPnl', type: 'int256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    name: 'getLiquidationPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface PerpsMarket {
  marketId: `0x${string}`
  symbol: string
  baseAsset: Address
  quoteAsset: Address
  maxLeverage: number
  maintenanceMarginBps: number
  initialMarginBps: number
  takerFeeBps: number
  makerFeeBps: number
  isActive: boolean
  markPrice: bigint
  indexPrice: bigint
  fundingRate: bigint
  longOI: bigint
  shortOI: bigint
}

export interface PerpsPosition {
  positionId: `0x${string}`
  trader: Address
  marketId: `0x${string}`
  symbol: string
  side: number // 0 = Long, 1 = Short
  size: bigint
  margin: bigint
  marginToken: Address
  entryPrice: bigint
  isOpen: boolean
  unrealizedPnl: bigint
  fundingPnl: bigint
  liquidationPrice: bigint
}

// RPC client singleton
let rpcClient: PublicClient | null = null
const getRpcClient = (): PublicClient => {
  if (!rpcClient) {
    // In browser, use the proxy endpoint to avoid CORS issues
    const rpcUrl = typeof window !== 'undefined' ? '/api/rpc' : getL2RpcUrl()
    rpcClient = createPublicClient({ transport: http(rpcUrl) })
  }
  return rpcClient
}

/**
 * Fetch all perpetual markets from the blockchain
 */
export async function fetchPerpsMarkets(): Promise<PerpsMarket[]> {
  // Skip if no contract address configured
  if (
    !PERPETUAL_MARKET_ADDRESS ||
    PERPETUAL_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000'
  ) {
    console.log('[perps-client] No perpetual market address configured')
    return []
  }

  const client = getRpcClient()
  const markets: PerpsMarket[] = []

  // Get all market IDs
  const marketIds = (await client.readContract({
    address: PERPETUAL_MARKET_ADDRESS,
    abi: perpetualMarketAbi,
    functionName: 'getAllMarkets',
  })) as `0x${string}`[]

  if (!marketIds || marketIds.length === 0) {
    return []
  }

  // Fetch details for each market
  for (const marketId of marketIds) {
    const marketData = (await client.readContract({
      address: PERPETUAL_MARKET_ADDRESS,
      abi: perpetualMarketAbi,
      functionName: 'markets',
      args: [marketId],
    })) as readonly [
      `0x${string}`, // marketId
      string, // symbol
      Address, // baseAsset
      Address, // quoteAsset
      Address, // oracle
      bigint, // maxLeverage
      bigint, // maintenanceMarginBps
      bigint, // initialMarginBps
      bigint, // takerFeeBps
      bigint, // makerFeeBps
      bigint, // maxOpenInterest
      bigint, // fundingInterval
      boolean, // isActive
    ]

    if (!marketData[12]) continue // Skip inactive markets

    // Get prices and OI
    const [markPrice, indexPrice, fundingRate, openInterest] =
      await Promise.all([
        client.readContract({
          address: PERPETUAL_MARKET_ADDRESS,
          abi: perpetualMarketAbi,
          functionName: 'getMarkPrice',
          args: [marketId],
        }) as Promise<bigint>,
        client.readContract({
          address: PERPETUAL_MARKET_ADDRESS,
          abi: perpetualMarketAbi,
          functionName: 'getIndexPrice',
          args: [marketId],
        }) as Promise<bigint>,
        client.readContract({
          address: PERPETUAL_MARKET_ADDRESS,
          abi: perpetualMarketAbi,
          functionName: 'getFundingRate',
          args: [marketId],
        }) as Promise<bigint>,
        client.readContract({
          address: PERPETUAL_MARKET_ADDRESS,
          abi: perpetualMarketAbi,
          functionName: 'getMarketOpenInterest',
          args: [marketId],
        }) as Promise<readonly [bigint, bigint]>,
      ])

    markets.push({
      marketId,
      symbol: marketData[1],
      baseAsset: marketData[2],
      quoteAsset: marketData[3],
      maxLeverage: Number(marketData[5]),
      maintenanceMarginBps: Number(marketData[6]),
      initialMarginBps: Number(marketData[7]),
      takerFeeBps: Number(marketData[8]),
      makerFeeBps: Number(marketData[9]),
      isActive: marketData[12],
      markPrice,
      indexPrice,
      fundingRate,
      longOI: openInterest[0],
      shortOI: openInterest[1],
    })
  }

  return markets
}

/**
 * Fetch trader's open positions
 */
export async function fetchTraderPositions(
  trader: Address,
): Promise<PerpsPosition[]> {
  // Skip if no contract address configured
  if (
    !PERPETUAL_MARKET_ADDRESS ||
    PERPETUAL_MARKET_ADDRESS === '0x0000000000000000000000000000000000000000'
  ) {
    return []
  }

  const client = getRpcClient()
  const positions: PerpsPosition[] = []

  // Get position IDs for trader
  const positionIds = (await client.readContract({
    address: PERPETUAL_MARKET_ADDRESS,
    abi: perpetualMarketAbi,
    functionName: 'getTraderPositions',
    args: [trader],
  })) as `0x${string}`[]

  if (!positionIds || positionIds.length === 0) {
    return []
  }

  // Fetch details for each position
  for (const positionId of positionIds) {
    const positionData = (await client.readContract({
      address: PERPETUAL_MARKET_ADDRESS,
      abi: perpetualMarketAbi,
      functionName: 'positions',
      args: [positionId],
    })) as readonly [
      `0x${string}`, // positionId
      Address, // trader
      `0x${string}`, // marketId
      number, // side
      number, // marginType
      bigint, // size
      bigint, // margin
      Address, // marginToken
      bigint, // entryPrice
      bigint, // entryFundingIndex
      bigint, // lastUpdateTime
      boolean, // isOpen
    ]

    if (!positionData[11]) continue // Skip closed positions

    // Get PnL and liquidation price
    const [pnlData, liquidationPrice] = await Promise.all([
      client.readContract({
        address: PERPETUAL_MARKET_ADDRESS,
        abi: perpetualMarketAbi,
        functionName: 'getPositionPnl',
        args: [positionId],
      }) as Promise<readonly [bigint, bigint]>,
      client.readContract({
        address: PERPETUAL_MARKET_ADDRESS,
        abi: perpetualMarketAbi,
        functionName: 'getLiquidationPrice',
        args: [positionId],
      }) as Promise<bigint>,
    ])

    // Get market symbol
    const marketData = (await client.readContract({
      address: PERPETUAL_MARKET_ADDRESS,
      abi: perpetualMarketAbi,
      functionName: 'markets',
      args: [positionData[2]],
    })) as readonly [
      `0x${string}`,
      string,
      Address,
      Address,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
    ]

    positions.push({
      positionId,
      trader: positionData[1],
      marketId: positionData[2],
      symbol: marketData[1],
      side: positionData[3],
      size: positionData[5],
      margin: positionData[6],
      marginToken: positionData[7],
      entryPrice: positionData[8],
      isOpen: positionData[11],
      unrealizedPnl: pnlData[0],
      fundingPnl: pnlData[1],
      liquidationPrice,
    })
  }

  return positions
}
