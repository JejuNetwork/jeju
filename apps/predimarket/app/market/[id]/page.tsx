'use client';

import { use, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { TradingInterface } from '@/components/TradingInterface';
import { MarketChart } from '@/components/MarketChart';
import { useMarket } from '@/hooks/useMarket';
import { formatDistanceToNow } from 'date-fns';
import { request, gql } from 'graphql-request';
import type { Trade } from '@/types';

const RECENT_TRADES_QUERY = gql`
  query GetRecentTrades($marketId: String!) {
    marketTrades(where: { market: { sessionId_eq: $marketId } }, orderBy: timestamp_DESC, limit: 20) {
      id
      timestamp
      trader
      amount
      outcome
      yesPrice
      noPrice
    }
  }
`;

function RecentTrades({ marketId }: { marketId: string }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrades() {
      const endpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 
                       process.env.PREDIMARKET_GRAPHQL_URL || 
                       `http://localhost:${process.env.INDEXER_GRAPHQL_PORT || '4350'}/graphql`;
      const data = await request(endpoint, RECENT_TRADES_QUERY, { marketId }) as {
        marketTrades: Array<{
          id: string;
          timestamp: string;
          trader: string;
          amount: string;
          outcome: boolean;
          yesPrice: string;
          noPrice: string;
        }>
      };
      setTrades(data.marketTrades);
      setLoading(false);
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, 5000);
    return () => clearInterval(interval);
  }, [marketId]);

  if (loading) {
    return <div className="text-gray-400 text-center py-8">Loading recent activity...</div>;
  }

  if (trades.length === 0) {
    return <div className="text-gray-400 text-center py-8">No trades yet</div>;
  }

  return (
    <div className="space-y-3">
      {trades.map((trade) => (
        <div key={trade.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              trade.outcome ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
            }`}>
              {trade.outcome ? 'YES' : 'NO'}
            </span>
            <span className="text-gray-400 text-sm">
              {trade.trader.slice(0, 6)}...{trade.trader.slice(-4)}
            </span>
          </div>
          <div className="text-right">
            <div className="text-white font-medium">{(Number(trade.amount) / 1e18).toFixed(2)} ETH</div>
            <div className="text-gray-500 text-xs">{formatDistanceToNow(new Date(trade.timestamp), { addSuffix: true })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { address } = useAccount();
  const { market, loading, error } = useMarket(id);
  const [selectedTab, setSelectedTab] = useState<'trade' | 'activity'>('trade');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading market...</div>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-red-400">Market not found</div>
      </div>
    );
  }

  const yesPercent = Number(market.yesPrice) / 1e16;
  const noPercent = Number(market.noPrice) / 1e16;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <a href="/" className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-600 bg-clip-text text-transparent">
                Predimarket
              </a>
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Market Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-white">
              {market.question}
            </h1>
            {market.resolved ? (
              <span className="px-4 py-2 bg-gray-800 text-gray-400 rounded-lg font-medium">
                Resolved
              </span>
            ) : (
              <span className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg font-medium">
                Active
              </span>
            )}
          </div>
          <div className="flex gap-6 text-sm text-gray-400">
            <span>Created {formatDistanceToNow(market.createdAt, { addSuffix: true })}</span>
            <span>•</span>
            <span>Volume: {(Number(market.totalVolume) / 1e18).toLocaleString()} ETH</span>
            {market.resolved && market.outcome !== undefined && (
              <>
                <span>•</span>
                <span className={market.outcome ? 'text-green-400' : 'text-red-400'}>
                  Outcome: {market.outcome ? 'YES' : 'NO'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Chart */}
          <div className="lg:col-span-2 space-y-6">
            {/* Price Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4">Price History</h2>
              <MarketChart marketId={market.sessionId} />
            </div>

            {/* Tabs */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl">
              <div className="flex border-b border-gray-800">
                <button
                  onClick={() => setSelectedTab('trade')}
                  className={`flex-1 px-6 py-4 font-medium transition ${
                    selectedTab === 'trade'
                      ? 'text-green-400 border-b-2 border-green-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Recent Activity
                </button>
                <button
                  onClick={() => setSelectedTab('activity')}
                  className={`flex-1 px-6 py-4 font-medium transition ${
                    selectedTab === 'activity'
                      ? 'text-green-400 border-b-2 border-green-400'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Your Position
                </button>
              </div>
              <div className="p-6">
                {selectedTab === 'trade' ? (
                  <RecentTrades marketId={market.sessionId} />
                ) : (
                  <div className="space-y-4">
                    {address ? (
                      <div className="text-gray-400 text-center py-8">
                        Your position details will appear here
                      </div>
                    ) : (
                      <div className="text-gray-400 text-center py-8">
                        Connect wallet to view your position
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Trading */}
          <div className="lg:col-span-1">
            {/* Current Prices */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
              <h2 className="text-lg font-bold text-white mb-4">Current Prices</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">YES</span>
                    <span className="text-2xl font-bold text-green-400">{yesPercent.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-green-600 to-green-400 h-3 rounded-full"
                      style={{ width: `${yesPercent}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-gray-400">NO</span>
                    <span className="text-2xl font-bold text-red-400">{noPercent.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-red-600 to-red-400 h-3 rounded-full"
                      style={{ width: `${noPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Trading Interface */}
            {!market.resolved && (
              <TradingInterface market={market} />
            )}

            {/* Resolved Outcome */}
            {market.resolved && market.outcome !== undefined && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-lg font-bold text-white mb-4">Final Outcome</h2>
                <div className={`text-center py-6 rounded-lg font-bold text-xl ${
                  market.outcome
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-red-600/20 text-red-400'
                }`}>
                  {market.outcome ? 'YES' : 'NO'}
                </div>
                <button className="w-full mt-4 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition">
                  Claim Winnings
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

