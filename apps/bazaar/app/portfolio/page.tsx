'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useClaim } from '@/hooks/markets/useClaim'
import { useUserPositions } from '@/hooks/markets/useUserPositions'
import {
  calculatePositionCurrentValue,
  calculatePositionPnL,
  countActivePositions,
  formatEthValue,
  formatPortfolioPnL,
} from '@/lib/portfolio'
import type { Position } from '@/types/markets'

function ClaimButton({ sessionId }: { sessionId: string }) {
  const { claim, isPending } = useClaim(sessionId)
  return (
    <button
      onClick={claim}
      disabled={isPending}
      className="btn-accent px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {isPending ? 'Claiming...' : 'Claim'}
    </button>
  )
}

function PositionRow({ position }: { position: Position }) {
  const currentValue = calculatePositionCurrentValue(position)
  const pnl = calculatePositionPnL(position)

  return (
    <tr className="hover:bg-[var(--bg-secondary)] transition-colors">
      <td className="px-4 md:px-6 py-4">
        <Link
          href={`/markets/${position.market.sessionId}`}
          className="hover:text-bazaar-primary transition-colors line-clamp-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {position.market.question}
        </Link>
      </td>
      <td className="px-4 md:px-6 py-4 hidden sm:table-cell">
        <div className="flex gap-2 flex-wrap">
          {position.yesShares > 0n && (
            <span className="badge-success">
              YES {formatEthValue(position.yesShares)}
            </span>
          )}
          {position.noShares > 0n && (
            <span className="badge-error">
              NO {formatEthValue(position.noShares)}
            </span>
          )}
        </div>
      </td>
      <td
        className="px-4 md:px-6 py-4 hidden md:table-cell"
        style={{ color: 'var(--text-primary)' }}
      >
        {formatEthValue(currentValue)} ETH
      </td>
      <td className="px-4 md:px-6 py-4">
        <span
          className={pnl >= 0n ? 'text-bazaar-success' : 'text-bazaar-error'}
        >
          {formatPortfolioPnL(pnl)} ETH
        </span>
      </td>
      <td className="px-4 md:px-6 py-4 hidden sm:table-cell">
        {position.market.resolved ? (
          position.hasClaimed ? (
            <span style={{ color: 'var(--text-tertiary)' }}>Claimed</span>
          ) : (
            <span className="text-bazaar-success">Ready to claim</span>
          )
        ) : (
          <span className="text-bazaar-info">Active</span>
        )}
      </td>
      <td className="px-4 md:px-6 py-4 text-right">
        {position.market.resolved && !position.hasClaimed && (
          <ClaimButton sessionId={position.market.sessionId} />
        )}
      </td>
    </tr>
  )
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount()
  const { positions, totalValue, totalPnL, loading } = useUserPositions(address)

  return (
    <div>
      <h1
        className="text-3xl md:text-4xl font-bold mb-8"
        style={{ color: 'var(--text-primary)' }}
      >
        Your Portfolio
      </h1>

      {!isConnected ? (
        <div className="text-center py-20" data-testid="connect-wallet-message">
          <div className="text-6xl md:text-7xl mb-4">🔐</div>
          <h2
            className="text-xl md:text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Connect Your Wallet
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            View your market positions and claim winnings
          </p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 mb-8">
            <div className="stat-card">
              <div className="stat-label">Total Value</div>
              <div className="stat-value">{formatEthValue(totalValue)} ETH</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total P&amp;L</div>
              <div
                className={`stat-value ${totalPnL >= 0n ? 'text-bazaar-success' : 'text-bazaar-error'}`}
              >
                {formatPortfolioPnL(totalPnL)} ETH
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Positions</div>
              <div className="stat-value">
                {countActivePositions(positions)}
              </div>
            </div>
          </div>

          {/* Positions Table */}
          <div className="card overflow-hidden" data-testid="positions-table">
            <div
              className="p-5 md:p-6 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <h2
                className="text-lg md:text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                Positions
              </h2>
            </div>

            {positions.length === 0 ? (
              <div className="p-12 text-center" data-testid="no-positions">
                <p style={{ color: 'var(--text-secondary)' }}>
                  No positions yet.{' '}
                  <Link
                    href="/markets"
                    className="text-bazaar-primary hover:underline"
                  >
                    Browse markets
                  </Link>
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <tr>
                      <th
                        className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Market
                      </th>
                      <th
                        className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden sm:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Position
                      </th>
                      <th
                        className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden md:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Value
                      </th>
                      <th
                        className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        P&amp;L
                      </th>
                      <th
                        className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden sm:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Status
                      </th>
                      <th
                        className="px-4 md:px-6 py-3 text-right text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    className="divide-y"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {positions.map((pos) => (
                      <PositionRow key={pos.id} position={pos} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
