'use client'

/**
 * @deprecated This page is vendor-specific and maintained in vendor/hyperscape/app/.
 * This copy remains for backwards compatibility. For new development,
 * use the component from vendor/hyperscape/app/page.tsx
 */

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useGameItems, getRarityInfo, type GameItem } from '@/hooks/nft/useGameItems'
import { getGameContracts } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { LoadingSpinner } from '@/components/LoadingSpinner'

/**
 * Hyperscape Items Page
 * 
 * @deprecated Use vendor/hyperscape/app/page.tsx for new development
 * 
 * This is a game-specific page that uses the generic game hooks.
 * Hyperscape is just one game that uses Jeju's canonical Items.sol contract.
 */
export default function HyperscapeItemsPage() {
  const { address, isConnected } = useAccount()
  const [activeFilter, setActiveFilter] = useState<'all' | 'my-items'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedItem, setSelectedItem] = useState<GameItem | null>(null)

  // Get Hyperscape's Items.sol contract address from config
  const gameContracts = getGameContracts(JEJU_CHAIN_ID)
  const { items, isLoading, error, hasChain } = useGameItems(gameContracts.items, activeFilter)

  const filters = [
    { id: 'all', label: 'All Items' },
    { id: 'weapons', label: 'Weapons' },
    { id: 'armor', label: 'Armor' },
    { id: 'tools', label: 'Tools' },
    { id: 'resources', label: 'Resources' },
  ]

  // Filter items by category (based on item type in name/metadata)
  const filteredItems = items.filter((item) => {
    if (categoryFilter === 'all') return true
    const name = item.name.toLowerCase()
    switch (categoryFilter) {
      case 'weapons':
        return name.includes('sword') || name.includes('bow') || name.includes('staff') || item.attack > 0
      case 'armor':
        return name.includes('helmet') || name.includes('body') || name.includes('legs') || name.includes('shield') || item.defense > 0
      case 'tools':
        return name.includes('hatchet') || name.includes('pickaxe') || name.includes('fishing')
      case 'resources':
        return name.includes('logs') || name.includes('ore') || name.includes('fish') || item.stackable
      default:
        return true
    }
  })

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

      {/* Web2 Mode Notice */}
      {!hasChain && (
        <div className="card p-4 mb-6 border-bazaar-accent/50 bg-bazaar-accent/10">
          <p className="text-bazaar-accent">
            Running in web2 mode. Items are stored locally until blockchain is configured.
          </p>
        </div>
      )}

      {/* Ownership Filter */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            activeFilter === 'all' ? 'bg-bazaar-primary text-white' : ''
          }`}
          style={{ 
            backgroundColor: activeFilter === 'all' ? undefined : 'var(--bg-secondary)',
            color: activeFilter === 'all' ? undefined : 'var(--text-secondary)'
          }}
        >
          All Items
        </button>
        <button
          onClick={() => setActiveFilter('my-items')}
          disabled={!isConnected}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50 ${
            activeFilter === 'my-items' ? 'bg-bazaar-primary text-white' : ''
          }`}
          style={{ 
            backgroundColor: activeFilter === 'my-items' ? undefined : 'var(--bg-secondary)',
            color: activeFilter === 'my-items' ? undefined : 'var(--text-secondary)'
          }}
        >
          My Items {!isConnected && '(Connect Wallet)'}
        </button>
      </div>

      {/* Category Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setCategoryFilter(filter.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              categoryFilter === filter.id ? 'bg-bazaar-accent text-white' : ''
            }`}
            style={{ 
              backgroundColor: categoryFilter === filter.id ? undefined : 'var(--bg-secondary)',
              color: categoryFilter === filter.id ? undefined : 'var(--text-secondary)'
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-4 mb-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="text-bazaar-error">Failed to load items: {String(error)}</p>
        </div>
      )}

      {/* Items Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredItems.length === 0 ? (
            <div className="col-span-full text-center py-20">
              <div className="text-6xl md:text-7xl mb-4">🎮</div>
              <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {activeFilter === 'my-items' ? 'No items in your collection' : 'No Hyperscape items found'}
              </h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                {activeFilter === 'my-items' 
                  ? 'Mint items in-game to see them here'
                  : 'No items have been minted yet'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const rarityInfo = getRarityInfo(item.rarity)
              return (
                <div 
                  key={item.id} 
                  className="card p-4 cursor-pointer hover:border-bazaar-primary transition-all"
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>{item.name}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${rarityInfo.bgClass} ${rarityInfo.color}`}>
                      {rarityInfo.name}
                    </span>
                  </div>

                  <div className="text-sm space-y-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
                    {item.attack > 0 && <div>⚔️ Attack: +{item.attack}</div>}
                    {item.strength > 0 && <div>💪 Strength: +{item.strength}</div>}
                    {item.defense > 0 && <div>🛡️ Defense: +{item.defense}</div>}
                    {item.attack === 0 && item.defense === 0 && item.strength === 0 && (
                      <div className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
                        No combat stats
                      </div>
                    )}
                  </div>

                  <div className="text-xs pt-3 border-t space-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                    <div className="flex justify-between">
                      <span>Owner</span>
                      <span className="font-mono">{item.owner?.slice(0, 6)}...{item.owner?.slice(-4)}</span>
                    </div>
                    {item.originalMinter && (
                      <div className="flex justify-between">
                        <span>Minted by</span>
                        <span className="font-mono">{item.originalMinter.slice(0, 6)}...{item.originalMinter.slice(-4)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Quantity</span>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{item.balance}</span>
                    </div>
                  </div>

                  <button className="btn-accent w-full mt-3 py-2 text-sm">
                    View Details
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="w-full max-w-md rounded-2xl border p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {selectedItem.name}
              </h2>
              <span className={`text-xs px-2 py-1 rounded-full ${getRarityInfo(selectedItem.rarity).bgClass} ${getRarityInfo(selectedItem.rarity).color}`}>
                {getRarityInfo(selectedItem.rarity).name}
              </span>
            </div>

            <div className="aspect-square bg-gradient-to-br from-bazaar-accent to-bazaar-purple rounded-xl flex items-center justify-center text-6xl mb-4">
              🎮
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-lg">⚔️</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Attack</div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>+{selectedItem.attack}</div>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-lg">🛡️</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Defense</div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>+{selectedItem.defense}</div>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-lg">💪</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Strength</div>
                <div className="font-bold" style={{ color: 'var(--text-primary)' }}>+{selectedItem.strength}</div>
              </div>
            </div>

            <div className="space-y-2 mb-6 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Token ID</span>
                <span style={{ color: 'var(--text-primary)' }}>#{selectedItem.tokenId}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Owner</span>
                <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {selectedItem.owner?.slice(0, 10)}...
                </span>
              </div>
              {selectedItem.originalMinter && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-tertiary)' }}>Original Minter</span>
                  <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {selectedItem.originalMinter.slice(0, 10)}...
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Stackable</span>
                <span style={{ color: 'var(--text-primary)' }}>{selectedItem.stackable ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Quantity Owned</span>
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{selectedItem.balance}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setSelectedItem(null)} className="btn-secondary flex-1">
                Close
              </button>
              {selectedItem.owner?.toLowerCase() === address?.toLowerCase() && (
                <button className="btn-primary flex-1">
                  List for Sale
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="card p-5 md:p-6 mt-8">
        <h2 className="font-bold mb-3" style={{ color: 'var(--text-primary)' }}>About Hyperscape Items</h2>
        <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>🎮 All items come from the Hyperscape MMORPG (Items.sol ERC-1155)</li>
          <li>🔒 Minted items are permanent NFTs and never drop on death</li>
          <li>👤 Original minter is tracked forever on-chain (provenance)</li>
          <li>⭐ Items minted by famous players may be worth more</li>
          <li>🤖 Be cautious of bot-farmed gear (check minter reputation)</li>
          <li>🔥 Burning an NFT returns the item to your in-game inventory</li>
        </ul>
      </div>
    </div>
  )
}
