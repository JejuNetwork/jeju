import {
  AddressSchema,
  expect,
  expectPositive,
  expectTrue,
  ZERO_ADDRESS,
} from '@jejunetwork/types'
import { useCallback, useMemo, useState } from 'react'
import type { Address, Hash } from 'viem'
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS } from '../../config'

export {
  calculateCurrentLeverage,
  calculateFee,
  calculateLiquidationPrice,
  calculateNotional,
  calculateRequiredMargin,
  calculateUnrealizedPnL,
  DEFAULT_TAKER_FEE_BPS,
  FUNDING_RATE_DECIMALS,
  FUNDING_RATE_SCALE,
  formatFundingRate,
  formatLeverage,
  formatPnL,
  formatPrice,
  formatSize,
  getBaseAsset,
  getTradeButtonText,
  isAtLiquidationRisk,
  isTradeButtonDisabled,
  LEVERAGE_DECIMALS,
  LEVERAGE_SCALE,
  leverageToBigInt,
  leverageToNumber,
  MAINTENANCE_MARGIN_FACTOR,
  MARKET_IDS,
  MAX_LEVERAGE,
  PNL_DECIMALS,
  PNL_SCALE,
  PositionSide,
  PRICE_DECIMALS,
  PRICE_SCALE,
  priceToBigInt,
  priceToNumber,
  SIZE_DECIMALS,
  SIZE_SCALE,
  sizeToBigInt,
  sizeToNumber,
  validateMargin,
  validatePositionParams,
} from '../../lib/perps'

export type {
  FormattedPnL,
  OpenInterest,
  OpenPositionParams,
  PerpsMarket as Market,
  PerpsPosition as Position,
  PositionValidationResult,
  PositionWithPnL,
  PriceData,
  TradeResult,
} from '../../schemas/perps'

import type {
  PerpsMarket as Market,
  OpenPositionParams,
  PerpsPosition as Position,
  PositionWithPnL,
} from '../../schemas/perps'

export const PERPETUAL_MARKET_ABI = [
  {
    name: 'openPosition',
    type: 'function',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'marginToken', type: 'address' },
      { name: 'marginAmount', type: 'uint256' },
      { name: 'size', type: 'uint256' },
      { name: 'side', type: 'uint8' },
      { name: 'leverage', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'decreasePosition',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'sizeDecrease', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'executionPrice', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'realizedPnl', type: 'int256' },
          { name: 'fundingPaid', type: 'int256' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'addMargin',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'removeMargin',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'liquidate',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'liquidatorReward', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getPosition',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      {
        name: 'position',
        type: 'tuple',
        components: [
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
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getTraderPositions',
    type: 'function',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ name: 'positionIds', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getMarket',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      {
        name: 'market',
        type: 'tuple',
        components: [
          { name: 'marketId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseAsset', type: 'address' },
          { name: 'maxLeverage', type: 'uint256' },
          { name: 'maintenanceMarginBps', type: 'uint256' },
          { name: 'takerFeeBps', type: 'uint256' },
          { name: 'makerFeeBps', type: 'uint256' },
          { name: 'maxOpenInterest', type: 'uint256' },
          { name: 'currentOpenInterest', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getAllMarkets',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'marketIds', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getMarkPrice',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'markPrice', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getIndexPrice',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'indexPrice', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getPositionPnl',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'fundingPnl', type: 'int256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getPositionLeverage',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'leverage', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getLiquidationPrice',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'liquidationPrice', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'isLiquidatable',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'canLiquidate', type: 'bool' },
      { name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getFundingRate',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'rate', type: 'int256' }],
    stateMutability: 'view',
  },
  {
    name: 'getMarketOpenInterest',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'longOI', type: 'uint256' },
      { name: 'shortOI', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

// ABI-inferred types - these match what wagmi returns from the typed ABI
// For tuples with named components, wagmi returns objects with those property names
type PositionTuple = {
  positionId: `0x${string}`
  trader: `0x${string}`
  marketId: `0x${string}`
  side: number
  marginType: number
  size: bigint
  margin: bigint
  marginToken: `0x${string}`
  entryPrice: bigint
  entryFundingIndex: bigint
  lastUpdateTime: bigint
  isOpen: boolean
}

type MarketTuple = {
  marketId: `0x${string}`
  symbol: string
  baseAsset: `0x${string}`
  maxLeverage: bigint
  maintenanceMarginBps: bigint
  takerFeeBps: bigint
  makerFeeBps: bigint
  maxOpenInterest: bigint
  currentOpenInterest: bigint
  isActive: boolean
}

// Converter functions for ABI tuples to domain types
function positionFromTuple(tuple: PositionTuple): Position {
  return {
    positionId: tuple.positionId as Hash,
    trader: tuple.trader as Address,
    marketId: tuple.marketId as Hash,
    side: tuple.side as 0 | 1,
    marginType: tuple.marginType,
    size: tuple.size,
    margin: tuple.margin,
    marginToken: tuple.marginToken as Address,
    entryPrice: tuple.entryPrice,
    entryFundingIndex: tuple.entryFundingIndex,
    lastUpdateTime: tuple.lastUpdateTime,
    isOpen: tuple.isOpen,
  }
}

function marketFromTuple(tuple: MarketTuple): Market {
  return {
    marketId: tuple.marketId as Hash,
    symbol: tuple.symbol,
    baseAsset: tuple.baseAsset as Address,
    maxLeverage: tuple.maxLeverage,
    maintenanceMarginBps: tuple.maintenanceMarginBps,
    takerFeeBps: tuple.takerFeeBps,
    makerFeeBps: tuple.makerFeeBps,
    maxOpenInterest: tuple.maxOpenInterest,
    currentOpenInterest: tuple.currentOpenInterest,
    isActive: tuple.isActive,
  }
}

export const MARGIN_MANAGER_ABI = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getCollateralBalance',
    type: 'function',
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getTotalCollateralValue',
    type: 'function',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ name: 'totalValueUSD', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAvailableCollateral',
    type: 'function',
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: 'available', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAcceptedTokens',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'tokens', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

function getPerpsConfig() {
  return {
    perpetualMarket: CONTRACTS.perpetualMarket,
    marginManager: CONTRACTS.marginManager,
    insuranceFund: CONTRACTS.insuranceFund,
    liquidationEngine: CONTRACTS.liquidationEngine,
  }
}

export function usePerpsConfig() {
  const config = getPerpsConfig()
  const isAvailable = config.perpetualMarket !== ZERO_ADDRESS
  return {
    isAvailable,
    perpetualMarket: isAvailable ? config.perpetualMarket : undefined,
    marginManager: isAvailable ? config.marginManager : undefined,
    insuranceFund: isAvailable ? config.insuranceFund : undefined,
    liquidationEngine: isAvailable ? config.liquidationEngine : undefined,
  }
}

export function usePerpsMarkets(perpetualMarketAddress: Address | undefined) {
  const { data: marketIds } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getAllMarkets',
    query: { enabled: Boolean(perpetualMarketAddress) },
  })

  const marketContracts = useMemo(() => {
    if (!marketIds || !perpetualMarketAddress) return []
    return marketIds.map((marketId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getMarket' as const,
      args: [marketId] as const,
    }))
  }, [marketIds, perpetualMarketAddress])

  const { data: marketsData } = useReadContracts({
    contracts: marketContracts,
    query: { enabled: marketContracts.length > 0 },
  })

  const markets: Market[] = useMemo(() => {
    if (!marketsData) return []
    return marketsData
      .filter(
        (
          result,
        ): result is typeof result & {
          status: 'success'
          result: MarketTuple
        } => result.status === 'success' && result.result !== undefined,
      )
      .map((result) => marketFromTuple(result.result))
  }, [marketsData])

  return { markets, marketIds: marketIds ?? undefined }
}

export function usePerpsMarket(
  perpetualMarketAddress: Address | undefined,
  marketId: Hash | undefined,
) {
  const { data: marketData } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarket',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) },
  })

  const { data: markPrice } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarkPrice',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) },
  })

  const { data: indexPrice } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getIndexPrice',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) },
  })

  const { data: fundingRate } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getFundingRate',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) },
  })

  const { data: openInterest } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarketOpenInterest',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) },
  })

  // Convert tuple to domain type if data exists
  const market = marketData
    ? marketFromTuple(marketData as MarketTuple)
    : undefined

  return {
    market,
    markPrice,
    indexPrice,
    fundingRate,
    longOpenInterest: openInterest?.[0],
    shortOpenInterest: openInterest?.[1],
  }
}

export function usePositions(perpetualMarketAddress: Address | undefined) {
  const { address: userAddress } = useAccount()

  const { data: positionIds, refetch: refetchPositionIds } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getTraderPositions',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && userAddress) },
  })

  const positionContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return positionIds.map((positionId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPosition' as const,
      args: [positionId] as const,
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: positionsData, refetch: refetchPositions } = useReadContracts({
    contracts: positionContracts,
    query: { enabled: positionContracts.length > 0 },
  })

  // Fetch PnL data
  const pnlContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return positionIds.map((positionId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPositionPnl' as const,
      args: [positionId] as const,
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: pnlData } = useReadContracts({
    contracts: pnlContracts,
    query: { enabled: pnlContracts.length > 0 },
  })

  // Fetch liquidation prices
  const liqPriceContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return positionIds.map((positionId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getLiquidationPrice' as const,
      args: [positionId] as const,
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: liqPriceData } = useReadContracts({
    contracts: liqPriceContracts,
    query: { enabled: liqPriceContracts.length > 0 },
  })

  // Fetch leverage
  const leverageContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return positionIds.map((positionId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPositionLeverage' as const,
      args: [positionId] as const,
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: leverageData } = useReadContracts({
    contracts: leverageContracts,
    query: { enabled: leverageContracts.length > 0 },
  })

  // Fetch liquidation status
  const liqStatusContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return positionIds.map((positionId) => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'isLiquidatable' as const,
      args: [positionId] as const,
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: liqStatusData } = useReadContracts({
    contracts: liqStatusContracts,
    query: { enabled: liqStatusContracts.length > 0 },
  })

  const positions: PositionWithPnL[] = useMemo(() => {
    if (!positionsData) return []
    return positionsData
      .map((result, index) => {
        if (result.status !== 'success' || !result.result) return null
        const position = positionFromTuple(result.result as PositionTuple)
        if (!position.isOpen) return null

        // PnL returns [unrealizedPnl, fundingPnl]
        const pnlResult = pnlData?.[index]
        const pnl: readonly [bigint, bigint] =
          pnlResult?.status === 'success' && pnlResult.result
            ? (pnlResult.result as readonly [bigint, bigint])
            : [0n, 0n]

        // Liquidation price is a single bigint
        const liqPriceResult = liqPriceData?.[index]
        const liqPrice: bigint =
          liqPriceResult?.status === 'success' &&
          liqPriceResult.result !== undefined
            ? (liqPriceResult.result as bigint)
            : 0n

        // Leverage is a single bigint
        const leverageResult = leverageData?.[index]
        const leverage: bigint =
          leverageResult?.status === 'success' &&
          leverageResult.result !== undefined
            ? (leverageResult.result as bigint)
            : 0n

        // isLiquidatable returns [canLiquidate, healthFactor]
        const liqStatusResult = liqStatusData?.[index]
        const liqStatus: readonly [boolean, bigint] =
          liqStatusResult?.status === 'success' && liqStatusResult.result
            ? (liqStatusResult.result as readonly [boolean, bigint])
            : [false, 0n]

        return {
          ...position,
          unrealizedPnl: pnl[0],
          fundingPnl: pnl[1],
          liquidationPrice: liqPrice,
          currentLeverage: leverage,
          healthFactor: liqStatus[1],
          canLiquidate: liqStatus[0],
        }
      })
      .filter((p): p is PositionWithPnL => p !== null)
  }, [positionsData, pnlData, liqPriceData, leverageData, liqStatusData])

  const refetch = useCallback(() => {
    refetchPositionIds()
    refetchPositions()
  }, [refetchPositionIds, refetchPositions])

  return { positions, positionIds: positionIds ?? undefined, refetch }
}

export function useCollateral(marginManagerAddress: Address | undefined) {
  const { address: userAddress } = useAccount()

  const { data: totalValue, refetch: refetchTotal } = useReadContract({
    address: marginManagerAddress,
    abi: MARGIN_MANAGER_ABI,
    functionName: 'getTotalCollateralValue',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(marginManagerAddress && userAddress) },
  })

  const { data: acceptedTokens } = useReadContract({
    address: marginManagerAddress,
    abi: MARGIN_MANAGER_ABI,
    functionName: 'getAcceptedTokens',
    query: { enabled: Boolean(marginManagerAddress) },
  })

  return {
    totalValueUSD: totalValue,
    acceptedTokens: acceptedTokens as Address[] | undefined,
    refetch: refetchTotal,
  }
}

export function useOpenPosition(perpetualMarketAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const openPosition = useCallback(
    async (params: OpenPositionParams) => {
      const validatedMarketAddress = expect(
        perpetualMarketAddress,
        'Perpetual market address not configured',
      )
      AddressSchema.parse(validatedMarketAddress)
      const validatedUserAddress = expect(userAddress, 'Wallet not connected')
      AddressSchema.parse(validatedUserAddress)

      AddressSchema.parse(params.marginToken)
      expectPositive(params.marginAmount, 'Margin amount must be positive')
      expectPositive(params.size, 'Position size must be positive')
      expectTrue(
        params.leverage > 0 && params.leverage <= 100,
        'Leverage must be between 1 and 100',
      )

      setError(null)
      writeContract({
        address: validatedMarketAddress,
        abi: PERPETUAL_MARKET_ABI,
        functionName: 'openPosition',
        args: [
          params.marketId,
          params.marginToken,
          params.marginAmount,
          params.size,
          params.side,
          BigInt(params.leverage),
        ],
      })
    },
    [perpetualMarketAddress, userAddress, writeContract],
  )

  return {
    openPosition,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
    reset: () => setError(null),
  }
}

export function useClosePosition(perpetualMarketAddress: Address | undefined) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const closePosition = useCallback(
    async (positionId: Hash, sizeDecrease?: bigint) => {
      const validatedMarketAddress = expect(
        perpetualMarketAddress,
        'Market address not configured',
      )
      AddressSchema.parse(validatedMarketAddress)
      expect(positionId, 'Position ID is required')

      setError(null)
      const decreaseAmount =
        sizeDecrease ??
        BigInt(
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        )
      writeContract({
        address: validatedMarketAddress,
        abi: PERPETUAL_MARKET_ABI,
        functionName: 'decreasePosition',
        args: [positionId, decreaseAmount],
      })
    },
    [perpetualMarketAddress, writeContract],
  )

  return {
    closePosition,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}

export function useDepositCollateral(
  marginManagerAddress: Address | undefined,
) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const deposit = useCallback(
    async (token: Address, amount: bigint) => {
      const validatedManagerAddress = expect(
        marginManagerAddress,
        'Margin manager address not configured',
      )
      AddressSchema.parse(validatedManagerAddress)
      AddressSchema.parse(token)
      expectPositive(amount, 'Deposit amount must be positive')

      setError(null)
      writeContract({
        address: validatedManagerAddress,
        abi: MARGIN_MANAGER_ABI,
        functionName: 'deposit',
        args: [token, amount],
      })
    },
    [marginManagerAddress, writeContract],
  )

  return {
    deposit,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}

export function useWithdrawCollateral(
  marginManagerAddress: Address | undefined,
) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const withdraw = useCallback(
    async (token: Address, amount: bigint) => {
      const validatedManagerAddress = expect(
        marginManagerAddress,
        'Margin manager address not configured',
      )
      AddressSchema.parse(validatedManagerAddress)
      AddressSchema.parse(token)
      expectPositive(amount, 'Withdraw amount must be positive')

      setError(null)
      writeContract({
        address: validatedManagerAddress,
        abi: MARGIN_MANAGER_ABI,
        functionName: 'withdraw',
        args: [token, amount],
      })
    },
    [marginManagerAddress, writeContract],
  )

  return {
    withdraw,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
  }
}
