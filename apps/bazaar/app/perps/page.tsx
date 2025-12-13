'use client'

import { useState, useEffect } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { formatEther, parseEther, type Address, type Hash } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import {
  usePerpsConfig,
  usePerpsMarkets,
  usePerpsMarket,
  usePositions,
  useCollateral,
  useOpenPosition,
  useClosePosition,
  useDepositCollateral,
  formatPrice,
  formatSize,
  formatPnL,
  formatFundingRate,
  PositionSide,
  MARKET_IDS,
  type Market,
  type PositionWithPnL,
} from '@/hooks/perps'

// Market selector component
function MarketSelector({
  markets,
  selectedMarket,
  onSelect
}: {
  markets: Market[]
  selectedMarket: Hash | undefined
  onSelect: (marketId: Hash) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {markets.map(market => (
        <button
          key={market.marketId}
          onClick={() => onSelect(market.marketId)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
            selectedMarket === market.marketId
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {market.symbol}
        </button>
      ))}
    </div>
  )
}

// Market info panel
function MarketInfo({
  market,
  markPrice,
  indexPrice,
  fundingRate,
  longOI,
  shortOI
}: {
  market: Market | undefined
  markPrice: bigint | undefined
  indexPrice: bigint | undefined
  fundingRate: bigint | undefined
  longOI: bigint | undefined
  shortOI: bigint | undefined
}) {
  if (!market) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-16 bg-gray-800 rounded"></div>
          <div className="h-16 bg-gray-800 rounded"></div>
        </div>
      </div>
    )
  }

  const fundingIsPositive = fundingRate ? fundingRate >= 0n : true

  return (
    <div className="bg-gray-900 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">{market.symbol}</h2>
        <span className={`px-3 py-1 rounded-full text-sm ${
          market.isActive ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
        }`}>
          {market.isActive ? 'Active' : 'Paused'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">Mark Price</p>
          <p className="text-xl font-bold text-white">
            ${markPrice ? formatPrice(markPrice) : '-'}
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">Index Price</p>
          <p className="text-xl font-bold text-white">
            ${indexPrice ? formatPrice(indexPrice) : '-'}
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">8h Funding</p>
          <p className={`text-xl font-bold ${fundingIsPositive ? 'text-green-400' : 'text-red-400'}`}>
            {fundingRate !== undefined ? formatFundingRate(fundingRate) : '-'}
          </p>
          <p className="text-xs text-gray-500">
            {fundingIsPositive ? 'Longs pay Shorts' : 'Shorts pay Longs'}
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">Max Leverage</p>
          <p className="text-xl font-bold text-white">{market.maxLeverage.toString()}x</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">Long Open Interest</p>
          <p className="text-lg font-semibold text-green-400">
            {longOI ? formatSize(longOI) : '0'} {market.symbol.split('-')[0]}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-gray-400 text-sm">Short Open Interest</p>
          <p className="text-lg font-semibold text-red-400">
            {shortOI ? formatSize(shortOI) : '0'} {market.symbol.split('-')[0]}
          </p>
        </div>
      </div>
    </div>
  )
}

// Trading form
function TradingForm({
  market,
  perpetualMarketAddress,
  onTradeSuccess
}: {
  market: Market | undefined
  perpetualMarketAddress: Address | undefined
  onTradeSuccess: () => void
}) {
  const { address } = useAccount()
  const [side, setSide] = useState<PositionSide>(PositionSide.Long)
  const [marginAmount, setMarginAmount] = useState('')
  const [leverage, setLeverage] = useState(5)
  const [size, setSize] = useState('')

  const { openPosition, isLoading, isSuccess, error, reset } = useOpenPosition(perpetualMarketAddress)

  // Reset form on success
  useEffect(() => {
    if (isSuccess) {
      setMarginAmount('')
      setSize('')
      reset()
      onTradeSuccess()
    }
  }, [isSuccess, reset, onTradeSuccess])

  const maxLeverage = market ? Number(market.maxLeverage) : 20

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!market || !marginAmount || !size) return

    // Using a mock USDC address - would come from config
    const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address

    await openPosition({
      marketId: market.marketId,
      marginToken: usdcAddress,
      marginAmount: parseEther(marginAmount),
      size: BigInt(Math.floor(parseFloat(size) * 1e8)), // Size in 8 decimals
      side,
      leverage
    })
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6">
      <h3 className="text-xl font-bold mb-4">Open Position</h3>

      {/* Side Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setSide(PositionSide.Long)}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            side === PositionSide.Long
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide(PositionSide.Short)}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            side === PositionSide.Short
              ? 'bg-red-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Short
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Margin Input */}
        <div>
          <label className="block text-gray-400 text-sm mb-2">Margin (USDC)</label>
          <input
            type="number"
            value={marginAmount}
            onChange={(e) => setMarginAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <label className="text-gray-400">Leverage</label>
            <span className="text-white font-semibold">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max={maxLeverage}
            value={leverage}
            onChange={(e) => setLeverage(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1x</span>
            <span>{maxLeverage}x</span>
          </div>
        </div>

        {/* Size Input */}
        <div>
          <label className="block text-gray-400 text-sm mb-2">
            Size ({market?.symbol.split('-')[0] || 'Asset'})
          </label>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="0.00"
            step="0.0001"
            min="0"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Trade Summary */}
        {marginAmount && size && (
          <div className="bg-gray-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Notional Value</span>
              <span className="text-white">
                ~${(parseFloat(marginAmount) * leverage).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Est. Fee</span>
              <span className="text-white">
                ~${(parseFloat(marginAmount) * leverage * 0.0005).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !marginAmount || !size || !address}
          className={`w-full py-4 rounded-lg font-bold text-lg transition-colors ${
            side === PositionSide.Long
              ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-900'
              : 'bg-red-600 hover:bg-red-700 disabled:bg-red-900'
          } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isLoading ? 'Opening...' : `Open ${side === PositionSide.Long ? 'Long' : 'Short'}`}
        </button>
      </form>
    </div>
  )
}

// Position card
function PositionCard({
  position,
  marketSymbol,
  perpetualMarketAddress,
  onClose
}: {
  position: PositionWithPnL
  marketSymbol: string
  perpetualMarketAddress: Address | undefined
  onClose: () => void
}) {
  const { closePosition, isLoading } = useClosePosition(perpetualMarketAddress)
  const pnl = formatPnL(position.unrealizedPnl)

  const handleClose = async () => {
    await closePosition(position.positionId)
    onClose()
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-semibold ${
            position.side === PositionSide.Long
              ? 'bg-green-900 text-green-400'
              : 'bg-red-900 text-red-400'
          }`}>
            {position.side === PositionSide.Long ? 'LONG' : 'SHORT'}
          </span>
          <span className="font-semibold">{marketSymbol}</span>
        </div>
        <span className={`font-bold ${pnl.isProfit ? 'text-green-400' : 'text-red-400'}`}>
          {pnl.value}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <p className="text-gray-500">Size</p>
          <p className="text-white">{formatSize(position.size)}</p>
        </div>
        <div>
          <p className="text-gray-500">Entry Price</p>
          <p className="text-white">${formatPrice(position.entryPrice)}</p>
        </div>
        <div>
          <p className="text-gray-500">Margin</p>
          <p className="text-white">${Number(formatEther(position.margin)).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-gray-500">Funding PnL</p>
          <p className={position.fundingPnl >= 0n ? 'text-green-400' : 'text-red-400'}>
            {formatPnL(position.fundingPnl).value}
          </p>
        </div>
      </div>

      <button
        onClick={handleClose}
        disabled={isLoading}
        className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {isLoading ? 'Closing...' : 'Close Position'}
      </button>
    </div>
  )
}

// Positions list
function PositionsList({
  positions,
  markets,
  perpetualMarketAddress,
  onPositionClosed
}: {
  positions: PositionWithPnL[]
  markets: Market[]
  perpetualMarketAddress: Address | undefined
  onPositionClosed: () => void
}) {
  const getMarketSymbol = (marketId: Hash) => {
    const market = markets.find(m => m.marketId === marketId)
    return market?.symbol || 'Unknown'
  }

  if (positions.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-500">
        <p>No open positions</p>
        <p className="text-sm mt-2">Open a position to start trading</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6">
      <h3 className="text-xl font-bold mb-4">Your Positions ({positions.length})</h3>
      <div className="space-y-3">
        {positions.map(position => (
          <PositionCard
            key={position.positionId}
            position={position}
            marketSymbol={getMarketSymbol(position.marketId)}
            perpetualMarketAddress={perpetualMarketAddress}
            onClose={onPositionClosed}
          />
        ))}
      </div>
    </div>
  )
}

// Main page component
export default function PerpsPage() {
  const { address, isConnected } = useAccount()
  const { isAvailable, perpetualMarket, marginManager } = usePerpsConfig()
  const [selectedMarketId, setSelectedMarketId] = useState<Hash | undefined>(MARKET_IDS.BTC_PERP)

  const { markets } = usePerpsMarkets(perpetualMarket)
  const { 
    market, 
    markPrice, 
    indexPrice, 
    fundingRate, 
    longOpenInterest, 
    shortOpenInterest 
  } = usePerpsMarket(perpetualMarket, selectedMarketId)
  const { positions, refetch: refetchPositions } = usePositions(perpetualMarket)
  const { totalValueUSD } = useCollateral(marginManager)

  // Set default market when markets load
  useEffect(() => {
    if (markets.length > 0 && !selectedMarketId) {
      setSelectedMarketId(markets[0].marketId)
    }
  }, [markets, selectedMarketId])

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-bold text-white">
              Jeju
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              <Link href="/swap" className="text-gray-400 hover:text-white">Swap</Link>
              <Link href="/pools" className="text-gray-400 hover:text-white">Pools</Link>
              <Link href="/markets" className="text-gray-400 hover:text-white">Markets</Link>
              <Link href="/perps" className="text-blue-400">Perps</Link>
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {!isAvailable ? (
          <div className="text-center py-20">
            <h1 className="text-3xl font-bold mb-4">Perpetuals Coming Soon</h1>
            <p className="text-gray-400">
              The Jeju Perpetual Futures DEX is currently being deployed.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Market Selector */}
            <MarketSelector
              markets={markets}
              selectedMarket={selectedMarketId}
              onSelect={setSelectedMarketId}
            />

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Market Info - Full width on mobile, 2 cols on desktop */}
              <div className="lg:col-span-2">
                <MarketInfo
                  market={market}
                  markPrice={markPrice}
                  indexPrice={indexPrice}
                  fundingRate={fundingRate}
                  longOI={longOpenInterest}
                  shortOI={shortOpenInterest}
                />
              </div>

              {/* Trading Form */}
              <div>
                <TradingForm
                  market={market}
                  perpetualMarketAddress={perpetualMarket}
                  onTradeSuccess={refetchPositions}
                />
              </div>
            </div>

            {/* Collateral Summary */}
            {isConnected && (
              <div className="bg-gray-900 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Total Collateral</p>
                  <p className="text-xl font-bold">
                    ${totalValueUSD ? Number(formatEther(totalValueUSD)).toLocaleString() : '0.00'}
                  </p>
                </div>
                <Link 
                  href="/perps/collateral" 
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
                >
                  Manage Collateral
                </Link>
              </div>
            )}

            {/* Positions List */}
            {isConnected && (
              <PositionsList
                positions={positions}
                markets={markets}
                perpetualMarketAddress={perpetualMarket}
                onPositionClosed={refetchPositions}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
