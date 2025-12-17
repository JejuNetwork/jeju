'use client'

import { useState, useEffect } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { formatUnits, parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { Header } from '@/components/Header'
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
import { SUPPORTED_CHAINS, useEILConfig } from '@/hooks/useEIL'
import { LoadingSpinner } from '@/components/LoadingSpinner'

const IS_DEMO_MODE = true

// Sample markets for development UI
const SAMPLE_MARKETS: Market[] = [
  {
    marketId: MARKET_IDS.BTC_PERP,
    symbol: 'BTC-PERP',
    baseAsset: '0x0000000000000000000000000000000000000001' as Address,
    maxLeverage: 50n,
    maintenanceMarginBps: 50n,
    takerFeeBps: 5n,
    makerFeeBps: 2n,
    maxOpenInterest: parseUnits('1000000', 8),
    currentOpenInterest: parseUnits('250000', 8),
    isActive: true,
  },
  {
    marketId: MARKET_IDS.ETH_PERP,
    symbol: 'ETH-PERP',
    baseAsset: '0x0000000000000000000000000000000000000002' as Address,
    maxLeverage: 50n,
    maintenanceMarginBps: 50n,
    takerFeeBps: 5n,
    makerFeeBps: 2n,
    maxOpenInterest: parseUnits('500000', 8),
    currentOpenInterest: parseUnits('125000', 8),
    isActive: true,
  },
]

// Sample prices for development UI
const SAMPLE_PRICES: Record<string, { mark: bigint; index: bigint; funding: bigint }> = {
  'BTC-PERP': { mark: parseUnits('97500', 8), index: parseUnits('97480', 8), funding: 10000n },
  'ETH-PERP': { mark: parseUnits('3450', 8), index: parseUnits('3448', 8), funding: 8500n },
}

function MarketSelector({ 
  markets, 
  selected, 
  onSelect 
}: { 
  markets: Market[]
  selected: string
  onSelect: (symbol: string) => void 
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {markets.map((m) => (
        <button
          key={m.symbol}
          onClick={() => onSelect(m.symbol)}
          className={`px-4 py-2 rounded-xl font-semibold whitespace-nowrap transition-all ${
            selected === m.symbol
              ? 'bg-bazaar-primary text-white'
              : ''
          }`}
          style={selected !== m.symbol ? {
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)'
          } : undefined}
        >
          {m.symbol}
        </button>
      ))}
    </div>
  )
}

function PriceDisplay({ symbol }: { symbol: string }) {
  const prices = SAMPLE_PRICES[symbol]
  if (!prices) return null

  const markPrice = Number(prices.mark) / 1e8
  const indexPrice = Number(prices.index) / 1e8
  const fundingRate = Number(prices.funding) / 1e6

  return (
    <div className="grid grid-cols-3 gap-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Mark Price</div>
        <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          ${markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Index Price</div>
        <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          ${indexPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      <div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Funding (1h)</div>
        <div className={`text-lg font-semibold ${fundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {fundingRate >= 0 ? '+' : ''}{fundingRate.toFixed(4)}%
        </div>
      </div>
    </div>
  )
}

function TradingPanel({ 
  symbol, 
  isConnected,
  onTrade
}: { 
  symbol: string
  isConnected: boolean
  onTrade: (side: 'long' | 'short', size: string, leverage: number) => void
}) {
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)
  const [margin, setMargin] = useState('')

  const prices = SAMPLE_PRICES[symbol]
  const markPrice = prices ? Number(prices.mark) / 1e8 : 0

  // Calculate margin from size and leverage
  useEffect(() => {
    if (size && markPrice > 0) {
      const sizeNum = parseFloat(size) || 0
      const notional = sizeNum * markPrice
      const requiredMargin = notional / leverage
      setMargin(requiredMargin.toFixed(2))
    } else {
      setMargin('')
    }
  }, [size, leverage, markPrice])

  const handleTrade = () => {
    if (!size || parseFloat(size) <= 0) {
      toast.error('Enter a valid size')
      return
    }
    onTrade(side, size, leverage)
  }

  return (
    <div className="card p-5">
      {/* Side Toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide('long')}
          className={`py-3 rounded-xl font-bold transition-all ${
            side === 'long'
              ? 'bg-green-500 text-white'
              : ''
          }`}
          style={side !== 'long' ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : undefined}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`py-3 rounded-xl font-bold transition-all ${
            side === 'short'
              ? 'bg-red-500 text-white'
              : ''
          }`}
          style={side !== 'short' ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : undefined}
        >
          Short
        </button>
      </div>

      {/* Size Input */}
      <div className="mb-4">
        <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
          Size ({symbol.split('-')[0]})
        </label>
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="0.00"
          className="input text-lg"
        />
      </div>

      {/* Leverage Slider */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span style={{ color: 'var(--text-tertiary)' }}>Leverage</span>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{leverage}x</span>
        </div>
        <input
          type="range"
          min="1"
          max="50"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full accent-bazaar-primary"
        />
        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          <span>1x</span>
          <span>25x</span>
          <span>50x</span>
        </div>
      </div>

      {/* Order Summary */}
      {size && parseFloat(size) > 0 && (
        <div className="p-3 rounded-xl mb-4 text-sm space-y-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-tertiary)' }}>Entry Price</span>
            <span style={{ color: 'var(--text-primary)' }}>${markPrice.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-tertiary)' }}>Required Margin</span>
            <span style={{ color: 'var(--text-primary)' }}>${margin}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-tertiary)' }}>Est. Liq. Price</span>
            <span className="text-red-400">
              ${(side === 'long' 
                ? markPrice * (1 - 1/leverage * 0.95)
                : markPrice * (1 + 1/leverage * 0.95)
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-tertiary)' }}>Fee (0.05%)</span>
            <span style={{ color: 'var(--text-primary)' }}>
              ${((parseFloat(size) * markPrice * 0.0005) || 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Trade Button */}
      <button
        onClick={handleTrade}
        disabled={!isConnected || !size || parseFloat(size) <= 0}
        className={`w-full py-4 rounded-xl font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed ${
          side === 'long' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
        }`}
      >
        {!isConnected 
          ? 'Connect Wallet'
          : `${side === 'long' ? 'Long' : 'Short'} ${symbol.split('-')[0]}`
        }
      </button>
    </div>
  )
}

function PositionsPanel({ positions }: { positions: PositionWithPnL[] }) {
  if (positions.length === 0) {
    return (
      <div className="card p-6 text-center">
        <div className="text-4xl mb-3">📊</div>
        <p style={{ color: 'var(--text-tertiary)' }}>No open positions</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {positions.map((pos) => {
        const pnl = formatPnL(pos.unrealizedPnl)
        return (
          <div key={pos.positionId} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  pos.side === PositionSide.Long ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {pos.side === PositionSide.Long ? 'LONG' : 'SHORT'}
                </span>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {formatSize(pos.size)}
                </span>
              </div>
              <span className={`font-semibold ${pnl.isProfit ? 'text-green-400' : 'text-red-400'}`}>
                {pnl.value}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Entry</span>
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  ${formatPrice(pos.entryPrice)}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Liq. Price</span>
                <div className="font-semibold text-red-400">
                  ${formatPrice(pos.liquidationPrice)}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Leverage</span>
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {Number(pos.currentLeverage) / 1e18}x
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CrossChainDepositPanel() {
  const [selectedChain, setSelectedChain] = useState(SUPPORTED_CHAINS[0].id)
  const [amount, setAmount] = useState('')
  const { isAvailable: eilAvailable } = useEILConfig()

  if (!eilAvailable) return null

  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        🌉 Cross-Chain Deposit
      </h3>
      <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Deposit margin from any supported chain
      </p>
      
      <div className="mb-4">
        <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
          Source Chain
        </label>
        <select
          value={selectedChain}
          onChange={(e) => setSelectedChain(Number(e.target.value))}
          className="input"
        >
          {SUPPORTED_CHAINS.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.icon} {chain.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
          Amount (USDC)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="input"
        />
      </div>

      <button className="btn-primary w-full py-3">
        Deposit from {SUPPORTED_CHAINS.find(c => c.id === selectedChain)?.name}
      </button>
    </div>
  )
}

export default function PerpsPage() {
  const { isConnected } = useAccount()
  const { isAvailable, perpetualMarket } = usePerpsConfig()
  const [selectedMarket, setSelectedMarket] = useState('BTC-PERP')
  const [activeTab, setActiveTab] = useState<'trade' | 'positions' | 'orders'>('trade')

  // Use sample data for now since contracts aren't deployed
  const markets = SAMPLE_MARKETS
  const positions: PositionWithPnL[] = []

  const handleTrade = (side: 'long' | 'short', size: string, leverage: number) => {
    toast.info(`Opening ${side} position: ${size} at ${leverage}x leverage`)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Demo Mode Banner */}
        {IS_DEMO_MODE && (
          <div className="mb-4 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
            <div className="flex items-center gap-2 text-yellow-400 text-sm">
              <span>⚠️</span>
              <span>Demo Mode: Showing sample data. Deploy PerpetualMarket contracts for live trading.</span>
            </div>
          </div>
        )}
        
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            📈 Perpetuals
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Trade crypto perpetual futures with up to 50x leverage
          </p>
        </div>

        {/* Market Selector */}
        <div className="mb-6">
          <MarketSelector
            markets={markets}
            selected={selectedMarket}
            onSelect={setSelectedMarket}
          />
        </div>

        {/* Price Display */}
        <div className="mb-6">
          <PriceDisplay symbol={selectedMarket} />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trading Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Mobile Tabs */}
            <div className="flex gap-2 lg:hidden">
              {(['trade', 'positions', 'orders'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${
                    activeTab === tab ? 'bg-bazaar-primary text-white' : ''
                  }`}
                  style={activeTab !== tab ? {
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)'
                  } : undefined}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Trade Tab (Mobile) */}
            <div className={`lg:hidden ${activeTab !== 'trade' ? 'hidden' : ''}`}>
              <TradingPanel
                symbol={selectedMarket}
                isConnected={isConnected}
                onTrade={handleTrade}
              />
            </div>

            {/* Positions Tab (Mobile) */}
            <div className={`lg:hidden ${activeTab !== 'positions' ? 'hidden' : ''}`}>
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Open Positions
              </h3>
              <PositionsPanel positions={positions} />
            </div>

            {/* Desktop: Chart Placeholder + Positions */}
            <div className="hidden lg:block">
              {/* Chart Placeholder */}
              <div className="card p-6 h-96 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-5xl mb-4">📊</div>
                  <p style={{ color: 'var(--text-tertiary)' }}>TradingView chart coming soon</p>
                </div>
              </div>
            </div>

            {/* Desktop Positions */}
            <div className="hidden lg:block">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Open Positions
              </h3>
              <PositionsPanel positions={positions} />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Desktop Trading Panel */}
            <div className="hidden lg:block">
              <TradingPanel
                symbol={selectedMarket}
                isConnected={isConnected}
                onTrade={handleTrade}
              />
            </div>

            {/* Cross-Chain Deposit */}
            <CrossChainDepositPanel />

            {/* Market Stats */}
            <div className="card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Market Info
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Max Leverage</span>
                  <span style={{ color: 'var(--text-primary)' }}>50x</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Taker Fee</span>
                  <span style={{ color: 'var(--text-primary)' }}>0.05%</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Maker Fee</span>
                  <span style={{ color: 'var(--text-primary)' }}>0.02%</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Funding Interval</span>
                  <span style={{ color: 'var(--text-primary)' }}>1 hour</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Open Interest</span>
                  <span style={{ color: 'var(--text-primary)' }}>$25.4M</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
