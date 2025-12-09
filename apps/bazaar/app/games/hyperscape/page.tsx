'use client';

import { useState } from 'react';
import { getNFTContracts } from '../../../config/contracts';
import { useChainId } from 'wagmi';

interface HyperscapeItem {
  id: string
  name: string
  rarity: number
  attack: number
  defense: number
  strength: number
  balance: string
  minter: string
}

export default function HyperscapeItemsPage() {
  const chainId = useChainId();
  getNFTContracts(chainId);
  const [items] = useState<HyperscapeItem[]>([]);
  const [activeFilter, setActiveFilter] = useState('all');

  const filters = [
    { id: 'all', label: 'All Items' },
    { id: 'weapons', label: 'Weapons' },
    { id: 'armor', label: 'Armor' },
    { id: 'tools', label: 'Tools' },
    { id: 'resources', label: 'Resources' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🎮 Hyperscape Items
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Discover minted items from the Hyperscape MMORPG. Each item shows its original minter for provenance tracking.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeFilter === filter.id
                ? 'bg-bazaar-accent text-white'
                : ''
            }`}
            style={{ 
              backgroundColor: activeFilter === filter.id ? undefined : 'var(--bg-secondary)',
              color: activeFilter === filter.id ? undefined : 'var(--text-secondary)'
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.length === 0 ? (
          <div className="col-span-full text-center py-20">
            <div className="text-6xl md:text-7xl mb-4">🎮</div>
            <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              No Hyperscape items found
            </h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              Mint items in-game to see them here
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="card p-4">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${getRarityBadgeClass(item.rarity)}`}>
                  {getRarityName(item.rarity)}
                </span>
              </div>

              <div className="text-sm space-y-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
                {item.attack > 0 && <div>⚔️ Attack: +{item.attack}</div>}
                {item.strength > 0 && <div>💪 Strength: +{item.strength}</div>}
                {item.defense > 0 && <div>🛡️ Defense: +{item.defense}</div>}
              </div>

              <div className="text-xs pt-3 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                <div>Minted by: {item.minter?.slice(0, 6)}...{item.minter?.slice(-4)}</div>
                <div>Quantity: {item.balance}</div>
              </div>

              <button className="btn-accent w-full mt-3 py-2 text-sm">
                View Listing
              </button>
            </div>
          ))
        )}
      </div>

      {/* Info Section */}
      <div className="card p-5 md:p-6 mt-8">
        <h2 className="font-bold mb-3" style={{ color: 'var(--text-primary)' }}>About Hyperscape Items</h2>
        <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>🎮 All items come from the Hyperscape MMORPG</li>
          <li>🔒 Minted items are permanent and never drop on death</li>
          <li>👤 Original minter is tracked forever (provenance)</li>
          <li>⭐ Items minted by famous players may be worth more</li>
          <li>🤖 Be cautious of bot-farmed gear (check minter reputation)</li>
        </ul>
      </div>
    </div>
  );
}

function getRarityBadgeClass(rarity: number): string {
  switch (rarity) {
    case 0: return 'bg-gray-500/20 text-gray-400';
    case 1: return 'bg-green-500/20 text-green-400';
    case 2: return 'bg-blue-500/20 text-blue-400';
    case 3: return 'bg-purple-500/20 text-purple-400';
    case 4: return 'bg-yellow-500/20 text-yellow-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
}

function getRarityName(rarity: number): string {
  switch (rarity) {
    case 0: return 'Common';
    case 1: return 'Uncommon';
    case 2: return 'Rare';
    case 3: return 'Epic';
    case 4: return 'Legendary';
    default: return 'Unknown';
  }
}
