'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketCard } from '@/components/MarketCard';
import { useMarkets } from '@/hooks/useMarkets';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function Home() {
  const { markets, loading, error } = useMarkets();
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active');

  const filteredMarkets = markets.filter((market) => {
    if (filter === 'active') return !market.resolved;
    if (filter === 'resolved') return market.resolved;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2">
                <div className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-600 bg-clip-text text-transparent">
                  Predimarket
                </div>
              </Link>
              <nav className="hidden md:flex gap-6">
                <Link href="/" className="text-gray-300 hover:text-white transition">
                  Markets
                </Link>
                <Link href="/portfolio" className="text-gray-300 hover:text-white transition">
                  Portfolio
                </Link>
                <Link href="/leaderboard" className="text-gray-300 hover:text-white transition">
                  Leaderboard
                </Link>
              </nav>
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold text-white mb-4">
            Decentralized Prediction Markets
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Trade on real-world outcomes powered by TEE oracles and Caliguland game data
          </p>
          <div className="mt-6 flex items-center justify-center gap-4">
            <div className="px-4 py-2 bg-gray-800 rounded-lg">
              <div className="text-sm text-gray-400">Total Volume</div>
              <div className="text-2xl font-bold text-white">
                {(markets.reduce((sum, m) => sum + Number(m.totalVolume), 0) / 1e18).toLocaleString()} ETH
              </div>
            </div>
            <div className="px-4 py-2 bg-gray-800 rounded-lg">
              <div className="text-sm text-gray-400">Active Markets</div>
              <div className="text-2xl font-bold text-white">
                {markets.filter(m => !m.resolved).length}
              </div>
            </div>
            <div className="px-4 py-2 bg-gray-800 rounded-lg">
              <div className="text-sm text-gray-400">Total Markets</div>
              <div className="text-2xl font-bold text-white">
                {markets.length}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-8 flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg transition ${
              filter === 'all'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            All Markets
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-2 rounded-lg transition ${
              filter === 'active'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-4 py-2 rounded-lg transition ${
              filter === 'resolved'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Resolved
          </button>
        </div>

        {/* Markets Grid */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-gray-400">Loading markets...</div>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <div className="text-red-400">Error: {error.message}</div>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="markets-grid">
            {filteredMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )}

        {!loading && !error && filteredMarkets.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400">No markets found</div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-500 text-sm">
            <p>Powered by Jeju Network • TEE Oracles</p>
            <p className="mt-2">Gasless trading via LiquidityPaymaster</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

