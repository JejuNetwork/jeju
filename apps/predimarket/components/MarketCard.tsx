'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { Market } from '@/types';

export function MarketCard({ market }: { market: Market }) {
  const yesPercent = Number(market.yesPrice) / 1e16; // Convert to percentage (18 decimals -> 2 decimals)
  const noPercent = Number(market.noPrice) / 1e16;
  
  return (
    <Link href={`/market/${market.sessionId}`}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-green-600 transition cursor-pointer group">
        {/* Status Badge */}
        <div className="flex items-center justify-between mb-4">
          {market.resolved ? (
            <span className="px-3 py-1 bg-gray-800 text-gray-400 rounded-full text-xs font-medium">
              Resolved
            </span>
          ) : (
            <span className="px-3 py-1 bg-green-600/20 text-green-400 rounded-full text-xs font-medium">
              Active
            </span>
          )}
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(market.createdAt, { addSuffix: true })}
          </span>
        </div>

        {/* Question */}
        <h3 className="text-lg font-semibold text-white mb-4 group-hover:text-green-400 transition line-clamp-2">
          {market.question}
        </h3>

        {/* Price Display */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-400">YES</span>
              <span className="text-sm font-bold text-green-400">{yesPercent.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-green-600 to-green-400 h-2 rounded-full transition-all"
                style={{ width: `${yesPercent}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-400">NO</span>
              <span className="text-sm font-bold text-red-400">{noPercent.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-red-600 to-red-400 h-2 rounded-full transition-all"
                style={{ width: `${noPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Volume */}
        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Volume</span>
            <span className="text-white font-medium">
              {(Number(market.totalVolume) / 1e18).toLocaleString()} elizaOS
            </span>
          </div>
        </div>

        {/* Outcome Badge (if resolved) */}
        {market.resolved && market.outcome !== undefined && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <div className={`text-center py-2 rounded-lg font-bold ${
              market.outcome
                ? 'bg-green-600/20 text-green-400'
                : 'bg-red-600/20 text-red-400'
            }`}>
              Outcome: {market.outcome ? 'YES' : 'NO'}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

