'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { TradingInterface } from '@/components/markets/TradingInterface';
import { MarketChart } from '@/components/markets/MarketChart';
import { useMarket } from '@/hooks/markets/useMarket';
import { useClaim } from '@/hooks/markets/useClaim';
import { formatDistanceToNow } from 'date-fns';
import { LoadingSpinner } from '@/components/LoadingSpinner';

interface PageProps {
  params: { id: string };
}

function ClaimButton({ sessionId }: { sessionId: string }) {
  const { claim, isPending } = useClaim(sessionId);
  
  return (
    <button 
      onClick={claim}
      disabled={isPending}
      className="btn-accent w-full mt-4 disabled:opacity-50"
    >
      {isPending ? 'Claiming...' : 'Claim Winnings'}
    </button>
  );
}

export default function MarketPage({ params }: PageProps) {
  const { id } = params;
  const { address } = useAccount();
  const { market, loading, error } = useMarket(id);
  const [selectedTab, setSelectedTab] = useState<'trade' | 'activity'>('trade');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl md:text-7xl mb-4">❌</div>
        <h2 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Market Not Found
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          This market doesn't exist or hasn't been indexed yet
        </p>
      </div>
    );
  }

  const yesPercent = Number(market.yesPrice) / 1e16;
  const noPercent = Number(market.noPrice) / 1e16;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {market.question}
          </h1>
          {market.resolved ? (
            <span className="badge shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              Resolved
            </span>
          ) : (
            <span className="badge-success shrink-0">Active</span>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>Created {formatDistanceToNow(market.createdAt, { addSuffix: true })}</span>
          <span className="hidden sm:inline">•</span>
          <span>Volume: {(Number(market.totalVolume) / 1e18).toLocaleString()} ETH</span>
          {market.resolved && market.outcome !== undefined && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className={market.outcome ? 'text-bazaar-success' : 'text-bazaar-error'}>
                Outcome: {market.outcome ? 'YES' : 'NO'}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Chart */}
          <div className="card p-5 md:p-6">
            <h2 className="text-lg md:text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Price History
            </h2>
            <MarketChart marketId={market.sessionId} />
          </div>

          {/* Activity Tabs */}
          <div className="card overflow-hidden">
            <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setSelectedTab('trade')}
                className={`flex-1 px-4 md:px-6 py-4 font-medium transition ${
                  selectedTab === 'trade'
                    ? 'text-bazaar-primary border-b-2 border-bazaar-primary'
                    : ''
                }`}
                style={{ color: selectedTab === 'trade' ? undefined : 'var(--text-secondary)' }}
              >
                Recent Activity
              </button>
              <button
                onClick={() => setSelectedTab('activity')}
                className={`flex-1 px-4 md:px-6 py-4 font-medium transition ${
                  selectedTab === 'activity'
                    ? 'text-bazaar-primary border-b-2 border-bazaar-primary'
                    : ''
                }`}
                style={{ color: selectedTab === 'activity' ? undefined : 'var(--text-secondary)' }}
              >
                Your Position
              </button>
            </div>
            <div className="p-5 md:p-6">
              {selectedTab === 'trade' ? (
                <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                  Recent trading activity will appear here
                </div>
              ) : (
                <div className="space-y-4">
                  {address ? (
                    <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                      Your position details will appear here
                    </div>
                  ) : (
                    <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                      Connect wallet to view your position
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          {/* Current Prices */}
          <div className="card p-5 md:p-6">
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Current Prices
            </h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span style={{ color: 'var(--text-secondary)' }}>YES</span>
                  <span className="text-xl md:text-2xl font-bold text-bazaar-success">{yesPercent.toFixed(1)}%</span>
                </div>
                <div className="progress-bar h-3">
                  <div className="progress-bar-fill progress-bar-success" style={{ width: `${yesPercent}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span style={{ color: 'var(--text-secondary)' }}>NO</span>
                  <span className="text-xl md:text-2xl font-bold text-bazaar-error">{noPercent.toFixed(1)}%</span>
                </div>
                <div className="progress-bar h-3">
                  <div className="progress-bar-fill progress-bar-error" style={{ width: `${noPercent}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Trading Interface or Outcome */}
          {!market.resolved && (
            <TradingInterface market={market} />
          )}

          {market.resolved && market.outcome !== undefined && (
            <div className="card p-5 md:p-6">
              <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Final Outcome
              </h2>
              <div className={`text-center py-6 rounded-xl font-bold text-xl ${
                market.outcome
                  ? 'bg-bazaar-success/20 text-bazaar-success'
                  : 'bg-bazaar-error/20 text-bazaar-error'
              }`}>
                {market.outcome ? 'YES' : 'NO'}
              </div>
              <ClaimButton sessionId={market.sessionId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
