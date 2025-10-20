'use client'

import { hasNFTMarketplace } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'

export default function NFTsPage() {
  const hasMarketplace = hasNFTMarketplace(JEJU_CHAIN_ID)

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">NFT Marketplace</h1>

      {!hasMarketplace && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-200 mb-6">
          ⚠️ NFT Marketplace contracts not deployed. Marketplace features unavailable.
        </div>
      )}

      {/* NFT Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {/* NFT Card Example */}
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl bg-white/5 border border-white/10 overflow-hidden hover:scale-105 transition-all cursor-pointer"
          >
            <div className="aspect-square bg-gradient-to-br from-purple-500 to-pink-500" />
            <div className="p-4">
              <h3 className="font-semibold mb-1">Hyperscape Item #{i}</h3>
              <p className="text-sm text-slate-400 mb-3">Bronze Sword</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Price</span>
                <span className="font-semibold">0.5 ETH</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

