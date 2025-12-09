'use client';

import { useState } from 'react';
import { MarketCard } from '@/components/markets/MarketCard';
import { useMarkets } from '@/hooks/markets/useMarkets';

export default function MarketsPage() {
  const { markets, loading, error } = useMarkets();
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMarkets = markets.filter((market) => {
    const matchesFilter = 
      filter === 'all' || 
      (filter === 'active' && !market.resolved) ||
      (filter === 'resolved' && market.resolved);
    
    const matchesSearch = searchQuery === '' || 
      market.question.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          📊 Prediction Markets
        </h1>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Trade on real-world outcomes powered by TEE oracles and game data
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <div className="stat-card">
            <div className="stat-label">Total Volume</div>
            <div className="stat-value text-lg md:text-2xl">
              {(markets.reduce((sum, m) => sum + Number(m.totalVolume), 0) / 1e18).toLocaleString()} ETH
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Markets</div>
            <div className="stat-value text-lg md:text-2xl">
              {markets.filter(m => !m.resolved).length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Markets</div>
            <div className="stat-value text-lg md:text-2xl">
              {markets.length}
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search markets..."
          className="input flex-1"
          data-testid="market-search"
        />
        
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          {(['all', 'active', 'resolved'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f
                  ? 'bg-bazaar-primary text-white'
                  : ''
              }`}
              style={{ 
                backgroundColor: filter === f ? undefined : 'var(--bg-secondary)',
                color: filter === f ? undefined : 'var(--text-secondary)'
              }}
              data-testid={`filter-${f}`}
            >
              {f === 'all' ? 'All Markets' : f === 'active' ? 'Active' : 'Resolved'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--color-primary)' }} />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="font-semibold mb-2 text-bazaar-error">Failed to load markets</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
        </div>
      )}

      {/* Markets Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6" data-testid="markets-grid">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredMarkets.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl md:text-7xl mb-4">📊</div>
          <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No Markets Found
          </h3>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            {searchQuery ? 'No markets match your search' : 'No prediction markets matching your filters'}
          </p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="btn-primary"
            >
              Clear Search
            </button>
          )}
        </div>
      )}
    </div>
  );
}
