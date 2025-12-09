'use client';

import { useAccount } from 'wagmi';
import { useUserPositions } from '@/hooks/markets/useUserPositions';
import { useClaim } from '@/hooks/markets/useClaim';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import Link from 'next/link';

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { positions, totalValue, totalPnL, loading } = useUserPositions(address);

  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold mb-8" style={{ color: 'var(--text-primary)' }}>
        📊 Your Portfolio
      </h1>

      {!isConnected ? (
        <div className="text-center py-20" data-testid="connect-wallet-message">
          <div className="text-6xl md:text-7xl mb-4">🔐</div>
          <h2 className="text-xl md:text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Connect Your Wallet
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>View your market positions and claim winnings</p>
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
              <div className="stat-value">
                {(Number(totalValue) / 1e18).toLocaleString()} ETH
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total P&L</div>
              <div className={`stat-value ${totalPnL >= 0n ? 'text-bazaar-success' : 'text-bazaar-error'}`}>
                {totalPnL >= 0n ? '+' : ''}{(Number(totalPnL) / 1e18).toLocaleString()} ETH
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Positions</div>
              <div className="stat-value">
                {positions.filter(p => !p.market.resolved).length}
              </div>
            </div>
          </div>

          {/* Positions Table */}
          <div className="card overflow-hidden" data-testid="positions-table">
            <div className="p-5 md:p-6 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg md:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Positions
              </h2>
            </div>
            
            {positions.length === 0 ? (
              <div className="p-12 text-center" data-testid="no-positions">
                <p style={{ color: 'var(--text-secondary)' }}>
                  No positions yet.{' '}
                  <Link href="/markets" className="text-bazaar-primary hover:underline">
                    Browse markets
                  </Link>
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <tr>
                      <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}>
                        Market
                      </th>
                      <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden sm:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}>
                        Position
                      </th>
                      <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden md:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}>
                        Value
                      </th>
                      <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}>
                        P&L
                      </th>
                      <th className="px-4 md:px-6 py-3 text-left text-xs font-medium uppercase tracking-wider hidden sm:table-cell"
                        style={{ color: 'var(--text-tertiary)' }}>
                        Status
                      </th>
                      <th className="px-4 md:px-6 py-3 text-right text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {positions.map((pos) => {
                      const pnl = Number(pos.totalReceived) - Number(pos.totalSpent);
                      const currentValue = pos.market.resolved
                        ? (pos.market.outcome ? Number(pos.yesShares) : Number(pos.noShares))
                        : Number(pos.yesShares) + Number(pos.noShares);
                      
                      const PositionClaimButton = () => {
                        const { claim, isPending } = useClaim(pos.market.sessionId);
                        return (
                          <button 
                            onClick={claim}
                            disabled={isPending}
                            className="btn-accent px-3 py-1.5 text-sm disabled:opacity-50"
                          >
                            {isPending ? 'Claiming...' : 'Claim'}
                          </button>
                        );
                      };
                      
                      return (
                        <tr key={pos.id} className="hover:bg-[var(--bg-secondary)] transition-colors">
                          <td className="px-4 md:px-6 py-4">
                            <Link 
                              href={`/markets/${pos.market.sessionId}`} 
                              className="hover:text-bazaar-primary transition-colors line-clamp-2"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {pos.market.question}
                            </Link>
                          </td>
                          <td className="px-4 md:px-6 py-4 hidden sm:table-cell">
                            <div className="flex gap-2 flex-wrap">
                              {Number(pos.yesShares) > 0 && (
                                <span className="badge-success">
                                  YES {(Number(pos.yesShares) / 1e18).toFixed(2)}
                                </span>
                              )}
                              {Number(pos.noShares) > 0 && (
                                <span className="badge-error">
                                  NO {(Number(pos.noShares) / 1e18).toFixed(2)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-4 hidden md:table-cell" style={{ color: 'var(--text-primary)' }}>
                            {(currentValue / 1e18).toLocaleString()} ETH
                          </td>
                          <td className="px-4 md:px-6 py-4">
                            <span className={pnl >= 0 ? 'text-bazaar-success' : 'text-bazaar-error'}>
                              {pnl >= 0 ? '+' : ''}{(pnl / 1e18).toFixed(2)} ETH
                            </span>
                          </td>
                          <td className="px-4 md:px-6 py-4 hidden sm:table-cell">
                            {pos.market.resolved ? (
                              pos.hasClaimed ? (
                                <span style={{ color: 'var(--text-tertiary)' }}>Claimed</span>
                              ) : (
                                <span className="text-bazaar-success">Ready to claim</span>
                              )
                            ) : (
                              <span className="text-bazaar-info">Active</span>
                            )}
                          </td>
                          <td className="px-4 md:px-6 py-4 text-right">
                            {pos.market.resolved && !pos.hasClaimed && <PositionClaimButton />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
