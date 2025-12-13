'use client'

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { useState, useCallback, useMemo } from 'react'
import { type Address, type Hash } from 'viem'
import { CONTRACTS } from '@/config'


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
      { name: 'leverage', type: 'uint256' }
    ],
    outputs: [
      { name: 'result', type: 'tuple', components: [
        { name: 'positionId', type: 'bytes32' },
        { name: 'executionPrice', type: 'uint256' },
        { name: 'fee', type: 'uint256' },
        { name: 'realizedPnl', type: 'int256' },
        { name: 'fundingPaid', type: 'int256' }
      ]}
    ],
    stateMutability: 'nonpayable'
  },
  {
    name: 'decreasePosition',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'sizeDecrease', type: 'uint256' }
    ],
    outputs: [
      { name: 'result', type: 'tuple', components: [
        { name: 'positionId', type: 'bytes32' },
        { name: 'executionPrice', type: 'uint256' },
        { name: 'fee', type: 'uint256' },
        { name: 'realizedPnl', type: 'int256' },
        { name: 'fundingPaid', type: 'int256' }
      ]}
    ],
    stateMutability: 'nonpayable'
  },
  {
    name: 'addMargin',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'removeMargin',
    type: 'function',
    inputs: [
      { name: 'positionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'liquidate',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'liquidatorReward', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'getPosition',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'position', type: 'tuple', components: [
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
        { name: 'isOpen', type: 'bool' }
      ]}
    ],
    stateMutability: 'view'
  },
  {
    name: 'getTraderPositions',
    type: 'function',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ name: 'positionIds', type: 'bytes32[]' }],
    stateMutability: 'view'
  },
  {
    name: 'getMarket',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'market', type: 'tuple', components: [
        { name: 'marketId', type: 'bytes32' },
        { name: 'symbol', type: 'string' },
        { name: 'baseAsset', type: 'address' },
        { name: 'maxLeverage', type: 'uint256' },
        { name: 'maintenanceMarginBps', type: 'uint256' },
        { name: 'takerFeeBps', type: 'uint256' },
        { name: 'makerFeeBps', type: 'uint256' },
        { name: 'maxOpenInterest', type: 'uint256' },
        { name: 'currentOpenInterest', type: 'uint256' },
        { name: 'isActive', type: 'bool' }
      ]}
    ],
    stateMutability: 'view'
  },
  {
    name: 'getAllMarkets',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'marketIds', type: 'bytes32[]' }],
    stateMutability: 'view'
  },
  {
    name: 'getMarkPrice',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'markPrice', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getIndexPrice',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'indexPrice', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getPositionPnl',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'fundingPnl', type: 'int256' }
    ],
    stateMutability: 'view'
  },
  {
    name: 'getPositionLeverage',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'leverage', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getLiquidationPrice',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'liquidationPrice', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'isLiquidatable',
    type: 'function',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'canLiquidate', type: 'bool' },
      { name: 'healthFactor', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    name: 'getFundingRate',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'rate', type: 'int256' }],
    stateMutability: 'view'
  },
  {
    name: 'getMarketOpenInterest',
    type: 'function',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'longOI', type: 'uint256' },
      { name: 'shortOI', type: 'uint256' }
    ],
    stateMutability: 'view'
  }
] as const

export const MARGIN_MANAGER_ABI = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    name: 'getCollateralBalance',
    type: 'function',
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'token', type: 'address' }
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getTotalCollateralValue',
    type: 'function',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ name: 'totalValueUSD', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getAvailableCollateral',
    type: 'function',
    inputs: [
      { name: 'trader', type: 'address' },
      { name: 'token', type: 'address' }
    ],
    outputs: [{ name: 'available', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'getAcceptedTokens',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'tokens', type: 'address[]' }],
    stateMutability: 'view'
  }
] as const


export enum PositionSide {
  Long = 0,
  Short = 1
}

export interface Position {
  positionId: Hash
  trader: Address
  marketId: Hash
  side: PositionSide
  marginType: number
  size: bigint
  margin: bigint
  marginToken: Address
  entryPrice: bigint
  entryFundingIndex: bigint
  lastUpdateTime: bigint
  isOpen: boolean
}

export interface Market {
  marketId: Hash
  symbol: string
  baseAsset: Address
  maxLeverage: bigint
  maintenanceMarginBps: bigint
  takerFeeBps: bigint
  makerFeeBps: bigint
  maxOpenInterest: bigint
  currentOpenInterest: bigint
  isActive: boolean
}

export interface TradeResult {
  positionId: Hash
  executionPrice: bigint
  fee: bigint
  realizedPnl: bigint
  fundingPaid: bigint
}

export interface OpenPositionParams {
  marketId: Hash
  marginToken: Address
  marginAmount: bigint
  size: bigint
  side: PositionSide
  leverage: number
}

export interface PositionWithPnL extends Position {
  unrealizedPnl: bigint
  fundingPnl: bigint
  liquidationPrice: bigint
  currentLeverage: bigint
  healthFactor: bigint
  canLiquidate: boolean
}


const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

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
    query: { enabled: Boolean(perpetualMarketAddress) }
  })

  const marketContracts = useMemo(() => {
    if (!marketIds || !perpetualMarketAddress) return []
    return (marketIds as Hash[]).map(marketId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getMarket',
      args: [marketId]
    }))
  }, [marketIds, perpetualMarketAddress])

  const { data: marketsData } = useReadContracts({
    contracts: marketContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'getMarket'
      args: [Hash]
    }>,
    query: { enabled: marketContracts.length > 0 }
  })

  const markets: Market[] = useMemo(() => {
    if (!marketsData) return []
    return marketsData
      .filter(result => result.status === 'success')
      .map(result => result.result as unknown as Market)
  }, [marketsData])

  return { markets, marketIds: marketIds as Hash[] | undefined }
}

export function usePerpsMarket(perpetualMarketAddress: Address | undefined, marketId: Hash | undefined) {
  const { data: market } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarket',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) }
  })

  const { data: markPrice } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarkPrice',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) }
  })

  const { data: indexPrice } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getIndexPrice',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) }
  })

  const { data: fundingRate } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getFundingRate',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) }
  })

  const { data: openInterest } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getMarketOpenInterest',
    args: marketId ? [marketId] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && marketId) }
  })

  return {
    market: market as Market | undefined,
    markPrice: markPrice as bigint | undefined,
    indexPrice: indexPrice as bigint | undefined,
    fundingRate: fundingRate as bigint | undefined,
    longOpenInterest: openInterest?.[0] as bigint | undefined,
    shortOpenInterest: openInterest?.[1] as bigint | undefined,
  }
}

export function usePositions(perpetualMarketAddress: Address | undefined) {
  const { address: userAddress } = useAccount()

  const { data: positionIds, refetch: refetchPositionIds } = useReadContract({
    address: perpetualMarketAddress,
    abi: PERPETUAL_MARKET_ABI,
    functionName: 'getTraderPositions',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(perpetualMarketAddress && userAddress) }
  })

  const positionContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return (positionIds as Hash[]).map(positionId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPosition',
      args: [positionId]
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: positionsData, refetch: refetchPositions } = useReadContracts({
    contracts: positionContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'getPosition'
      args: [Hash]
    }>,
    query: { enabled: positionContracts.length > 0 }
  })

  // Fetch PnL data
  const pnlContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return (positionIds as Hash[]).map(positionId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPositionPnl',
      args: [positionId]
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: pnlData } = useReadContracts({
    contracts: pnlContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'getPositionPnl'
      args: [Hash]
    }>,
    query: { enabled: pnlContracts.length > 0 }
  })

  // Fetch liquidation prices
  const liqPriceContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return (positionIds as Hash[]).map(positionId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getLiquidationPrice',
      args: [positionId]
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: liqPriceData } = useReadContracts({
    contracts: liqPriceContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'getLiquidationPrice'
      args: [Hash]
    }>,
    query: { enabled: liqPriceContracts.length > 0 }
  })

  // Fetch leverage
  const leverageContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return (positionIds as Hash[]).map(positionId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'getPositionLeverage',
      args: [positionId]
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: leverageData } = useReadContracts({
    contracts: leverageContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'getPositionLeverage'
      args: [Hash]
    }>,
    query: { enabled: leverageContracts.length > 0 }
  })

  // Fetch liquidation status
  const liqStatusContracts = useMemo(() => {
    if (!positionIds || !perpetualMarketAddress) return []
    return (positionIds as Hash[]).map(positionId => ({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'isLiquidatable',
      args: [positionId]
    }))
  }, [positionIds, perpetualMarketAddress])

  const { data: liqStatusData } = useReadContracts({
    contracts: liqStatusContracts as Array<{
      address: Address
      abi: typeof PERPETUAL_MARKET_ABI
      functionName: 'isLiquidatable'
      args: [Hash]
    }>,
    query: { enabled: liqStatusContracts.length > 0 }
  })

  const positions: PositionWithPnL[] = useMemo(() => {
    if (!positionsData) return []
    return positionsData
      .map((result, index) => {
        if (result.status !== 'success') return null
        const position = result.result as unknown as Position
        if (!position.isOpen) return null
        
        const pnl = pnlData?.[index]?.status === 'success' 
          ? pnlData[index].result as [bigint, bigint]
          : [0n, 0n]
        const liqPrice = liqPriceData?.[index]?.status === 'success'
          ? liqPriceData[index].result as bigint
          : 0n
        const leverage = leverageData?.[index]?.status === 'success'
          ? leverageData[index].result as bigint
          : 0n
        const liqStatus = liqStatusData?.[index]?.status === 'success'
          ? liqStatusData[index].result as [boolean, bigint]
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

  return { positions, positionIds: positionIds as Hash[] | undefined, refetch }
}

export function useCollateral(marginManagerAddress: Address | undefined) {
  const { address: userAddress } = useAccount()

  const { data: totalValue, refetch: refetchTotal } = useReadContract({
    address: marginManagerAddress,
    abi: MARGIN_MANAGER_ABI,
    functionName: 'getTotalCollateralValue',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(marginManagerAddress && userAddress) }
  })

  const { data: acceptedTokens } = useReadContract({
    address: marginManagerAddress,
    abi: MARGIN_MANAGER_ABI,
    functionName: 'getAcceptedTokens',
    query: { enabled: Boolean(marginManagerAddress) }
  })

  return {
    totalValueUSD: totalValue as bigint | undefined,
    acceptedTokens: acceptedTokens as Address[] | undefined,
    refetch: refetchTotal
  }
}

export function useOpenPosition(perpetualMarketAddress: Address | undefined) {
  const { address: userAddress } = useAccount()
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const openPosition = useCallback(async (params: OpenPositionParams) => {
    if (!perpetualMarketAddress || !userAddress) {
      setError('Wallet not connected')
      return
    }
    setError(null)
    writeContract({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'openPosition',
      args: [params.marketId, params.marginToken, params.marginAmount, params.size, params.side, BigInt(params.leverage)]
    })
  }, [perpetualMarketAddress, userAddress, writeContract])

  return { openPosition, error, isLoading: isPending || isConfirming, isSuccess, hash, reset: () => setError(null) }
}

export function useClosePosition(perpetualMarketAddress: Address | undefined) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const closePosition = useCallback(async (positionId: Hash, sizeDecrease?: bigint) => {
    if (!perpetualMarketAddress) {
      setError('Not configured')
      return
    }
    setError(null)
    const decreaseAmount = sizeDecrease ?? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    writeContract({
      address: perpetualMarketAddress,
      abi: PERPETUAL_MARKET_ABI,
      functionName: 'decreasePosition',
      args: [positionId, decreaseAmount]
    })
  }, [perpetualMarketAddress, writeContract])

  return { closePosition, error, isLoading: isPending || isConfirming, isSuccess, hash }
}

export function useDepositCollateral(marginManagerAddress: Address | undefined) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const deposit = useCallback(async (token: Address, amount: bigint) => {
    if (!marginManagerAddress) {
      setError('Not configured')
      return
    }
    setError(null)
    writeContract({
      address: marginManagerAddress,
      abi: MARGIN_MANAGER_ABI,
      functionName: 'deposit',
      args: [token, amount]
    })
  }, [marginManagerAddress, writeContract])

  return { deposit, error, isLoading: isPending || isConfirming, isSuccess, hash }
}

export function useWithdrawCollateral(marginManagerAddress: Address | undefined) {
  const [error, setError] = useState<string | null>(null)
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const withdraw = useCallback(async (token: Address, amount: bigint) => {
    if (!marginManagerAddress) {
      setError('Not configured')
      return
    }
    setError(null)
    writeContract({
      address: marginManagerAddress,
      abi: MARGIN_MANAGER_ABI,
      functionName: 'withdraw',
      args: [token, amount]
    })
  }, [marginManagerAddress, writeContract])

  return { withdraw, error, isLoading: isPending || isConfirming, isSuccess, hash }
}

export function formatPrice(price: bigint, decimals = 2): string {
  const priceNumber = Number(price) / 1e8
  return priceNumber.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatSize(size: bigint, decimals = 4): string {
  const sizeNumber = Number(size) / 1e8
  return sizeNumber.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatPnL(pnl: bigint): { value: string; isProfit: boolean } {
  const pnlNumber = Number(pnl) / 1e18
  const isProfit = pnl >= 0n
  return {
    value: `${isProfit ? '+' : ''}$${Math.abs(pnlNumber).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    isProfit
  }
}

export function formatFundingRate(rate: bigint): string {
  const rateNumber = Number(rate) / 1e16
  return `${rateNumber >= 0 ? '+' : ''}${rateNumber.toFixed(4)}%`
}

export const MARKET_IDS = {
  BTC_PERP: '0xa3fa5377b11d5955c4ed83f7ace1c7822b5361de56c000486ef1e91146897315' as Hash,
  ETH_PERP: '0x4554482d504552500000000000000000000000000000000000000000000000000' as Hash,
}
