/**
 * Perps View - Perpetual futures trading
 */

import {
  Activity,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import {
  type PerpMarket,
  type PerpPosition,
  PositionSide,
  perpsService,
} from '../../../api/services'

interface PerpsViewProps {
  address: Address
}

type TabType = 'trade' | 'positions' | 'markets'

export function PerpsView({ address }: PerpsViewProps) {
  const [tab, setTab] = useState<TabType>('trade')
  const [markets, setMarkets] = useState<PerpMarket[]>([])
  const [positions, setPositions] = useState<PerpPosition[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMarket, setSelectedMarket] = useState<string>('ETH-PERP')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [leverage, setLeverage] = useState(5)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    const [m, p] = await Promise.all([
      perpsService.getMarkets(),
      perpsService.getPositions(address),
    ])
    setMarkets(m)
    setPositions(p)
    setIsLoading(false)
  }, [address])

  useEffect(() => {
    fetchData()
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  const selectedMarketData = markets.find((m) => m.symbol === selectedMarket)
  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0n)
  const totalPnlNum = Number(formatUnits(totalPnl, 18))

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20">
                <Activity className="w-6 h-6 text-orange-400" />
              </div>
              Perpetual Trading
            </h2>
            <p className="text-muted-foreground mt-1">
              Long or short with up to 20x leverage
            </p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            disabled={isLoading}
            aria-label="Refresh market data"
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-xl transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-card border border-border rounded-xl p-4 hover:border-orange-500/30 transition-colors">
            <div className="text-sm text-muted-foreground">Open Positions</div>
            <div className="text-2xl font-bold mt-1 text-orange-400">{positions.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 hover:border-orange-500/30 transition-colors">
            <div className="text-sm text-muted-foreground">Unrealized PnL</div>
            <div
              className={`text-2xl font-bold mt-1 ${totalPnlNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {totalPnlNum >= 0 ? '+' : ''}
              {totalPnlNum.toFixed(2)} USD
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 hover:border-orange-500/30 transition-colors">
            <div className="text-sm text-muted-foreground">
              Available Markets
            </div>
            <div className="text-2xl font-bold mt-1">{markets.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 hover:border-orange-500/30 transition-colors">
            <div className="text-sm text-muted-foreground">Max Leverage</div>
            <div className="text-2xl font-bold mt-1 text-amber-400">20x</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
          {[
            { id: 'trade' as const, label: 'Trade', icon: Activity },
            {
              id: 'positions' as const,
              label: `Positions (${positions.length})`,
              icon: TrendingUp,
            },
            { id: 'markets' as const, label: 'Markets', icon: DollarSign },
          ].map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${
                tab === id
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20'
                  : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Trade Tab */}
        {tab === 'trade' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Trading Panel */}
            <div className="bg-card border border-border rounded-2xl p-6 hover:border-orange-500/20 transition-colors">
              <h3 className="text-lg font-bold mb-4">Open Position</h3>

              {/* Market Selection */}
              <div className="mb-4">
                <span className="text-sm text-muted-foreground mb-2 block font-medium">
                  Market
                </span>
                <div className="flex gap-2">
                  {['ETH-PERP', 'BTC-PERP'].map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setSelectedMarket(m)}
                      aria-pressed={selectedMarket === m}
                      className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/50 ${
                        selectedMarket === m
                          ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md'
                          : 'bg-secondary hover:bg-secondary/80'
                      }`}
                    >
                      {m.replace('-PERP', '')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Side Selection */}
              <div className="mb-4">
                <span className="text-sm text-muted-foreground mb-2 block font-medium">
                  Direction
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSide('long')}
                    aria-pressed={side === 'long'}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      side === 'long'
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/20'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    Long
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('short')}
                    aria-pressed={side === 'short'}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                      side === 'short'
                        ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-md shadow-red-500/20'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                  >
                    <TrendingDown className="w-4 h-4" />
                    Short
                  </button>
                </div>
              </div>

              {/* Leverage */}
              <div className="mb-4">
                <label
                  htmlFor="leverage-slider"
                  className="text-sm text-muted-foreground mb-2 block font-medium"
                >
                  Leverage: <span className="text-amber-400 font-bold">{leverage}x</span>
                </label>
                <input
                  id="leverage-slider"
                  type="range"
                  min={1}
                  max={20}
                  value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
                  className="w-full accent-orange-500 h-2 bg-secondary rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>1x</span>
                  <span>10x</span>
                  <span>20x</span>
                </div>
              </div>

              {/* Margin */}
              <div className="mb-6">
                <label
                  htmlFor="margin-input"
                  className="text-sm text-muted-foreground mb-2 block font-medium"
                >
                  Margin (USDC)
                </label>
                <input
                  id="margin-input"
                  type="text"
                  placeholder="0.0"
                  className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
                />
              </div>

              <button
                type="button"
                className={`w-full px-6 py-3.5 rounded-xl font-semibold transition-all shadow-lg focus:outline-none focus:ring-2 ${
                  side === 'long'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-emerald-500/20 focus:ring-emerald-500/50'
                    : 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white shadow-red-500/20 focus:ring-red-500/50'
                }`}
              >
                {side === 'long' ? 'Long' : 'Short'} {selectedMarket}
              </button>

              <p className="text-xs text-muted-foreground mt-4 text-center bg-secondary/50 rounded-lg py-2 px-3">
                💬 Or use chat: "{side === 'long' ? 'Long' : 'Short'}{' '}
                {selectedMarket.replace('-PERP', '')} {leverage}x with 100 USDC"
              </p>
            </div>

            {/* Market Info */}
            <div className="bg-card border border-border rounded-2xl p-6 hover:border-orange-500/20 transition-colors">
              <h3 className="text-lg font-bold mb-4">
                {selectedMarket} Info
              </h3>

              {selectedMarketData ? (
                <div className="space-y-1">
                  <div className="flex justify-between py-3 border-b border-border">
                    <span className="text-muted-foreground">Mark Price</span>
                    <span className="font-bold text-lg">
                      $
                      {perpsService.formatPrice(
                        selectedMarketData.markPrice ?? 0n,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-border">
                    <span className="text-muted-foreground">
                      Funding Rate (8h)
                    </span>
                    <span
                      className={`font-semibold ${Number(selectedMarketData.fundingRate ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {selectedMarketData.fundingRate
                        ? (
                            (Number(selectedMarketData.fundingRate) / 1e18) *
                            100
                          ).toFixed(4)
                        : '0'}
                      %
                    </span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-border">
                    <span className="text-muted-foreground">Max Leverage</span>
                    <span className="font-semibold text-amber-400">
                      {selectedMarketData.maxLeverage}x
                    </span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-border">
                    <span className="text-muted-foreground">Open Interest</span>
                    <span className="font-medium">
                      {formatUnits(selectedMarketData.currentOpenInterest, 8)}
                    </span>
                  </div>
                  <div className="flex justify-between py-3">
                    <span className="text-muted-foreground">Taker Fee</span>
                    <span className="font-medium">
                      {selectedMarketData.takerFeeBps / 100}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Loading market data...
                    </span>
                  ) : (
                    'Market data unavailable'
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Positions Tab */}
        {tab === 'positions' && (
          <div className="space-y-4">
            {positions.length === 0 ? (
              <div className="text-center py-12 bg-card border border-border rounded-2xl">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center mb-4">
                  <Activity className="w-8 h-8 text-orange-400" />
                </div>
                <h3 className="text-lg font-bold">No Open Positions</h3>
                <p className="text-muted-foreground mt-2">
                  Open a position to start trading perpetuals
                </p>
                <button
                  type="button"
                  onClick={() => setTab('trade')}
                  className="mt-4 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl font-medium shadow-lg shadow-orange-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                >
                  Start Trading
                </button>
              </div>
            ) : (
              positions.map((pos) => {
                const pnlNum = Number(formatUnits(pos.unrealizedPnl, 18))
                return (
                  <div
                    key={pos.positionId}
                    className="bg-card border border-border rounded-2xl p-5 hover:border-orange-500/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold ${
                            pos.side === PositionSide.Long
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {pos.side === PositionSide.Long
                            ? '🟢 LONG'
                            : '🔴 SHORT'}
                        </div>
                        <div>
                          <p className="font-bold">{pos.symbol}</p>
                          <p className="text-xs text-muted-foreground">
                            {pos.leverage.toFixed(1)}x leverage
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-lg font-bold ${pnlNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {pnlNum >= 0 ? '+' : ''}
                          {pnlNum.toFixed(2)} USD
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Unrealized PnL
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm bg-secondary/30 rounded-xl p-3">
                      <div>
                        <p className="text-muted-foreground text-xs">Size</p>
                        <p className="font-semibold">
                          {formatUnits(pos.size, 8)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Entry</p>
                        <p className="font-semibold">
                          ${perpsService.formatPrice(pos.entryPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Mark</p>
                        <p className="font-semibold">
                          ${perpsService.formatPrice(pos.markPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-yellow-500" />
                          Liq. Price
                        </p>
                        <p className="font-semibold text-yellow-500">
                          ${perpsService.formatPrice(pos.liquidationPrice)}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-4">
                      <button
                        type="button"
                        className="flex-1 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                      >
                        Add Margin
                      </button>
                      <button
                        type="button"
                        className="flex-1 px-4 py-2.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl text-sm font-medium border border-red-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      >
                        Close Position
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Markets Tab */}
        {tab === 'markets' && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">
                      Market
                    </th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground">
                      Price
                    </th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground hidden sm:table-cell">
                      Funding (8h)
                    </th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground">
                      Max Lev.
                    </th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground hidden md:table-cell">
                      Open Interest
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {markets.map((market) => (
                    <tr key={market.marketId} className="hover:bg-secondary/30 transition-colors">
                      <td className="p-4 font-bold">{market.symbol}</td>
                      <td className="p-4 text-right font-semibold">
                        ${perpsService.formatPrice(market.markPrice ?? 0n)}
                      </td>
                      <td
                        className={`p-4 text-right font-medium hidden sm:table-cell ${Number(market.fundingRate ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {market.fundingRate
                          ? ((Number(market.fundingRate) / 1e18) * 100).toFixed(4)
                          : '0'}
                        %
                      </td>
                      <td className="p-4 text-right font-semibold text-amber-400">{market.maxLeverage}x</td>
                      <td className="p-4 text-right hidden md:table-cell">
                        {formatUnits(market.currentOpenInterest, 8)}
                      </td>
                    </tr>
                  ))}
                  {markets.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-muted-foreground"
                      >
                        {isLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Loading markets...
                          </span>
                        ) : (
                          'No markets available on this network'
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PerpsView
