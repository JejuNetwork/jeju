/**
 * Perpetuals Trading Page
 *
 * Trade perpetual futures with up to 50x leverage
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import {
  fetchPerpsMarkets,
  fetchTraderPositions,
  type PerpsMarket,
  type PerpsPosition,
} from '../../lib/perps-client'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'

type PositionSide = 'long' | 'short'

export default function PerpsPage() {
  const { address, isConnected } = useAccount()
  const [selectedMarket, setSelectedMarket] = useState<PerpsMarket | null>(null)
  const [side, setSide] = useState<PositionSide>('long')
  const [leverage, setLeverage] = useState(10)
  const [marginAmount, setMarginAmount] = useState('')

  // Fetch markets
  const {
    data: markets,
    isLoading: marketsLoading,
    error: marketsError,
  } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: fetchPerpsMarkets,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  // Fetch user positions
  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ['perps-positions', address],
    queryFn: () =>
      address ? fetchTraderPositions(address) : Promise.resolve([]),
    enabled: Boolean(address),
    refetchInterval: 10000,
  })

  // Auto-select first market
  if (markets && markets.length > 0 && !selectedMarket) {
    setSelectedMarket(markets[0])
  }

  function formatPrice(price: bigint): string {
    return `$${Number(formatUnits(price, 8)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  function calculatePositionSize(): string {
    if (!marginAmount || !leverage) return '0'
    const margin = Number(marginAmount)
    return (margin * leverage).toFixed(2)
  }

  if (marketsLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (marketsError || !markets || markets.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            📈 Perpetuals
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)' }}
          >
            Trade perpetual futures with up to 50x leverage
          </p>
        </div>

        <div className="card p-6 mb-6">
          <div className="text-center">
            <div className="text-5xl mb-4">🚀</div>
            <h3
              className="text-lg font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              No Markets Available
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              Perpetual markets need to be deployed. Run the bootstrap script:
            </p>
            <code
              className="block p-3 rounded-lg text-sm"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              cd apps/bazaar && bun run scripts/bootstrap-perps.ts
            </code>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📈 Perpetuals
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Trade perpetual futures with up to 50x leverage
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market Selection & Price */}
        <div className="lg:col-span-2 space-y-4">
          {/* Market Tabs */}
          <div className="card p-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {markets.map((market) => (
                <button
                  key={market.marketId}
                  type="button"
                  onClick={() => setSelectedMarket(market)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedMarket?.marketId === market.marketId
                      ? 'bg-bazaar-primary text-white'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{
                    color:
                      selectedMarket?.marketId === market.marketId
                        ? undefined
                        : 'var(--text-secondary)',
                  }}
                >
                  {market.symbol}
                </button>
              ))}
            </div>
          </div>

          {/* Price Display */}
          {selectedMarket && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2
                    className="text-2xl font-bold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {selectedMarket.symbol}
                  </h2>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Max {selectedMarket.maxLeverage}x Leverage
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {formatPrice(selectedMarket.markPrice)}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Mark Price
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Index Price
                  </p>
                  <p
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {formatPrice(selectedMarket.indexPrice)}
                  </p>
                </div>
                <div>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Funding Rate
                  </p>
                  <p
                    className={`font-medium ${selectedMarket.fundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {(Number(selectedMarket.fundingRate) / 100).toFixed(4)}%
                  </p>
                </div>
                <div>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Long OI
                  </p>
                  <p
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    $
                    {Number(
                      formatUnits(selectedMarket.longOI, 18),
                    ).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Short OI
                  </p>
                  <p
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    $
                    {Number(
                      formatUnits(selectedMarket.shortOI, 18),
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Positions */}
          <div className="card p-4">
            <h3
              className="font-semibold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Your Positions
            </h3>

            {!isConnected ? (
              <div className="text-center py-8">
                <p
                  className="text-sm mb-4"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Connect wallet to view positions
                </p>
                <AuthButton />
              </div>
            ) : positionsLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !positions || positions.length === 0 ? (
              <div className="text-center py-8">
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No open positions
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)' }}>
                      <th className="text-left py-2">Market</th>
                      <th className="text-left py-2">Side</th>
                      <th className="text-right py-2">Size</th>
                      <th className="text-right py-2">Entry</th>
                      <th className="text-right py-2">Margin</th>
                      <th className="text-right py-2">PnL</th>
                      <th className="text-right py-2">Liq. Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <PositionRow key={pos.positionId} position={pos} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Trading Panel */}
        <div className="card p-4 h-fit">
          <h3
            className="font-semibold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Open Position
          </h3>

          {!isConnected ? (
            <div className="text-center py-8">
              <p
                className="text-sm mb-4"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Connect wallet to trade
              </p>
              <AuthButton className="w-full" />
            </div>
          ) : !selectedMarket ? (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Select a market to trade
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Side Selection */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide('long')}
                  className={`py-3 rounded-lg font-medium transition-colors ${
                    side === 'long'
                      ? 'bg-green-500 text-white'
                      : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                  }`}
                >
                  Long
                </button>
                <button
                  type="button"
                  onClick={() => setSide('short')}
                  className={`py-3 rounded-lg font-medium transition-colors ${
                    side === 'short'
                      ? 'bg-red-500 text-white'
                      : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  }`}
                >
                  Short
                </button>
              </div>

              {/* Leverage */}
              <div>
                <div className="flex justify-between mb-2">
                  <label
                    htmlFor="leverage-slider"
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Leverage
                  </label>
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {leverage}x
                  </span>
                </div>
                <input
                  id="leverage-slider"
                  type="range"
                  min="1"
                  max={selectedMarket.maxLeverage}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full"
                />
                <div
                  className="flex justify-between text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>1x</span>
                  <span>{selectedMarket.maxLeverage}x</span>
                </div>
              </div>

              {/* Margin Amount */}
              <div>
                <label
                  htmlFor="margin-amount"
                  className="text-sm block mb-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Margin (USDC)
                </label>
                <input
                  id="margin-amount"
                  type="number"
                  placeholder="100"
                  value={marginAmount}
                  onChange={(e) => setMarginAmount(e.target.value)}
                  className="input w-full"
                  min="0"
                  step="0.01"
                />
              </div>

              {/* Position Size */}
              <div>
                <label
                  htmlFor="position-size"
                  className="text-sm block mb-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Position Size
                </label>
                <input
                  id="position-size"
                  type="text"
                  value={`$${calculatePositionSize()}`}
                  readOnly
                  className="input w-full"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                />
              </div>

              {/* Summary */}
              <div
                className="space-y-2 pt-2 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    Entry Price
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {formatPrice(selectedMarket.markPrice)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    Liquidation Price
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {marginAmount
                      ? '~' +
                        formatPrice(
                          side === 'long'
                            ? selectedMarket.markPrice -
                                (selectedMarket.markPrice *
                                  BigInt(100 - leverage)) /
                                  100n
                            : selectedMarket.markPrice +
                                (selectedMarket.markPrice *
                                  BigInt(100 - leverage)) /
                                  100n,
                        )
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>Fee</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {marginAmount
                      ? `$${(Number(marginAmount) * leverage * 0.0005).toFixed(2)}`
                      : '-'}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                disabled={!marginAmount || Number(marginAmount) <= 0}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  side === 'long'
                    ? 'bg-green-500 hover:bg-green-600 disabled:bg-green-500/50'
                    : 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/50'
                } text-white disabled:cursor-not-allowed`}
              >
                {side === 'long' ? 'Open Long' : 'Open Short'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PositionRow({ position }: { position: PerpsPosition }) {
  const isLong = position.side === 0
  const pnlValue = Number(formatUnits(position.unrealizedPnl, 18))
  const isProfitable = pnlValue >= 0

  return (
    <tr className="border-t" style={{ borderColor: 'var(--border)' }}>
      <td className="py-3" style={{ color: 'var(--text-primary)' }}>
        {position.symbol}
      </td>
      <td className="py-3">
        <span className={isLong ? 'text-green-400' : 'text-red-400'}>
          {isLong ? 'Long' : 'Short'}
        </span>
      </td>
      <td className="py-3 text-right" style={{ color: 'var(--text-primary)' }}>
        ${Number(formatUnits(position.size, 18)).toLocaleString()}
      </td>
      <td className="py-3 text-right" style={{ color: 'var(--text-primary)' }}>
        ${Number(formatUnits(position.entryPrice, 8)).toLocaleString()}
      </td>
      <td className="py-3 text-right" style={{ color: 'var(--text-primary)' }}>
        ${Number(formatUnits(position.margin, 18)).toLocaleString()}
      </td>
      <td
        className={`py-3 text-right ${isProfitable ? 'text-green-400' : 'text-red-400'}`}
      >
        {isProfitable ? '+' : ''}${pnlValue.toFixed(2)}
      </td>
      <td
        className="py-3 text-right"
        style={{ color: 'var(--text-secondary)' }}
      >
        ${Number(formatUnits(position.liquidationPrice, 8)).toLocaleString()}
      </td>
    </tr>
  )
}
