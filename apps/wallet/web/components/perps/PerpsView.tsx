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
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-7 h-7 text-orange-400" />
              Perpetual Trading
            </h2>
            <p className="text-muted-foreground">
              Trade with up to 20x leverage
            </p>
          </div>
          <button
            type="button"
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground">Open Positions</div>
            <div className="text-2xl font-bold mt-1">{positions.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground">Unrealized PnL</div>
            <div
              className={`text-2xl font-bold mt-1 ${totalPnlNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {totalPnlNum >= 0 ? '+' : ''}
              {totalPnlNum.toFixed(2)} USD
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground">
              Available Markets
            </div>
            <div className="text-2xl font-bold mt-1">{markets.length}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground">Max Leverage</div>
            <div className="text-2xl font-bold mt-1">20x</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-2">
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-secondary'
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
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Open Position</h3>

              {/* Market Selection */}
              <div className="mb-4">
                <span className="text-sm text-muted-foreground mb-2 block">
                  Market
                </span>
                <div className="flex gap-2">
                  {['ETH-PERP', 'BTC-PERP'].map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setSelectedMarket(m)}
                      className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedMarket === m
                          ? 'bg-primary text-primary-foreground'
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
                <label
                  htmlFor="side-select"
                  className="text-sm text-muted-foreground mb-2 block"
                >
                  Direction
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSide('long')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                      side === 'long'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-secondary hover:bg-secondary/80'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    Long
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('short')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                      side === 'short'
                        ? 'bg-red-500 text-white'
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
                  className="text-sm text-muted-foreground mb-2 block"
                >
                  Leverage: {leverage}x
                </label>
                <input
                  id="leverage-slider"
                  type="range"
                  min={1}
                  max={20}
                  value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1x</span>
                  <span>10x</span>
                  <span>20x</span>
                </div>
              </div>

              {/* Margin */}
              <div className="mb-6">
                <label
                  htmlFor="margin-input"
                  className="text-sm text-muted-foreground mb-2 block"
                >
                  Margin (USDC)
                </label>
                <input
                  id="margin-input"
                  type="text"
                  placeholder="0.0"
                  className="w-full px-4 py-3 bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <button
                type="button"
                className={`w-full px-6 py-3 rounded-xl font-medium transition-colors ${
                  side === 'long'
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {side === 'long' ? 'Long' : 'Short'} {selectedMarket}
              </button>

              <p className="text-xs text-muted-foreground mt-4 text-center">
                Or use chat: "{side === 'long' ? 'Long' : 'Short'}{' '}
                {selectedMarket.replace('-PERP', '')} {leverage}x with 100 USDC"
              </p>
            </div>

            {/* Market Info */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">
                {selectedMarket} Info
              </h3>

              {selectedMarketData ? (
                <div className="space-y-4">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Mark Price</span>
                    <span className="font-medium">
                      $
                      {perpsService.formatPrice(
                        selectedMarketData.markPrice ?? 0n,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">
                      Funding Rate (8h)
                    </span>
                    <span
                      className={`font-medium ${Number(selectedMarketData.fundingRate ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
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
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Max Leverage</span>
                    <span className="font-medium">
                      {selectedMarketData.maxLeverage}x
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Open Interest</span>
                    <span className="font-medium">
                      {formatUnits(selectedMarketData.currentOpenInterest, 8)}
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Taker Fee</span>
                    <span className="font-medium">
                      {selectedMarketData.takerFeeBps / 100}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {isLoading ? 'Loading...' : 'Market data unavailable'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Positions Tab */}
        {tab === 'positions' && (
          <div className="space-y-4">
            {positions.length === 0 ? (
              <div className="text-center py-12 bg-card border border-border rounded-xl">
                <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Open Positions</h3>
                <p className="text-muted-foreground mt-2">
                  Open a position to start trading
                </p>
                <button
                  type="button"
                  onClick={() => setTab('trade')}
                  className="mt-4 px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl"
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
                    className="bg-card border border-border rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
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
                          <p className="font-semibold">{pos.symbol}</p>
                          <p className="text-xs text-muted-foreground">
                            {pos.leverage.toFixed(1)}x leverage
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-bold ${pnlNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {pnlNum >= 0 ? '+' : ''}
                          {pnlNum.toFixed(2)} USD
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Unrealized PnL
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Size</p>
                        <p className="font-medium">
                          {formatUnits(pos.size, 8)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Entry</p>
                        <p className="font-medium">
                          ${perpsService.formatPrice(pos.entryPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Mark</p>
                        <p className="font-medium">
                          ${perpsService.formatPrice(pos.markPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-yellow-500" />
                          Liq. Price
                        </p>
                        <p className="font-medium text-yellow-500">
                          ${perpsService.formatPrice(pos.liquidationPrice)}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button
                        type="button"
                        className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm"
                      >
                        Add Margin
                      </button>
                      <button
                        type="button"
                        className="flex-1 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm"
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
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                    Market
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                    Price
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                    Funding (8h)
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                    Max Lev.
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                    Open Interest
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {markets.map((market) => (
                  <tr key={market.marketId} className="hover:bg-secondary/30">
                    <td className="p-4 font-medium">{market.symbol}</td>
                    <td className="p-4 text-right">
                      ${perpsService.formatPrice(market.markPrice ?? 0n)}
                    </td>
                    <td
                      className={`p-4 text-right ${Number(market.fundingRate ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {market.fundingRate
                        ? ((Number(market.fundingRate) / 1e18) * 100).toFixed(4)
                        : '0'}
                      %
                    </td>
                    <td className="p-4 text-right">{market.maxLeverage}x</td>
                    <td className="p-4 text-right">
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
                      {isLoading
                        ? 'Loading markets...'
                        : 'No markets available on this network'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default PerpsView
