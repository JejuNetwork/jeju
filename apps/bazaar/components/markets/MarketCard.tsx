'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { Market } from '@/types/markets';

export function MarketCard({ market }: { market: Market }) {
  const yesPercent = Number(market.yesPrice) / 1e16;
  const noPercent = Number(market.noPrice) / 1e16;
  
  return (
    <Link href={`/markets/${market.sessionId}`} data-testid="market-card">
      <div className="card p-5 md:p-6 h-full flex flex-col group">
        <div className="flex items-center justify-between mb-4">
          {market.resolved ? (
            <span className="badge" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              Resolved
            </span>
          ) : (
            <span className="badge-success">
              Active
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {formatDistanceToNow(market.createdAt, { addSuffix: true })}
          </span>
        </div>

        <h3 
          className="text-base md:text-lg font-semibold mb-4 line-clamp-2 group-hover:text-bazaar-primary transition-colors flex-1"
          style={{ color: 'var(--text-primary)' }}
        >
          {market.question}
        </h3>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>YES</span>
              <span className="text-sm font-bold text-bazaar-success">{yesPercent.toFixed(1)}%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill progress-bar-success"
                style={{ width: `${yesPercent}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>NO</span>
              <span className="text-sm font-bold text-bazaar-error">{noPercent.toFixed(1)}%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill progress-bar-error"
                style={{ width: `${noPercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-tertiary)' }}>Volume</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {(Number(market.totalVolume) / 1e18).toLocaleString()} ETH
            </span>
          </div>
        </div>

        {market.resolved && market.outcome !== undefined && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className={`text-center py-2 rounded-xl font-bold ${
              market.outcome
                ? 'bg-bazaar-success/20 text-bazaar-success'
                : 'bg-bazaar-error/20 text-bazaar-error'
            }`}>
              Outcome: {market.outcome ? 'YES' : 'NO'}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
