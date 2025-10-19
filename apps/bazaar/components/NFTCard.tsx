'use client'

import { LoadingSkeleton } from './LoadingSpinner'

interface NFT {
  id: string
  name: string
  image?: string
  price?: string
  collection: string
}

interface NFTCardProps {
  nft: NFT
  onClick?: () => void
}

export function NFTCard({ nft, onClick }: NFTCardProps) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl bg-white/5 border border-white/10 overflow-hidden hover:scale-105 transition-all cursor-pointer group"
    >
      {/* Image */}
      <div className="aspect-square bg-gradient-to-br from-purple-500/20 to-pink-500/20 relative overflow-hidden">
        {nft.image ? (
          <img
            src={nft.image}
            alt={nft.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl">
            🖼️
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold mb-1 truncate">{nft.name}</h3>
        <p className="text-sm text-slate-400 mb-3 truncate">{nft.collection}</p>
        {nft.price && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Price</span>
            <span className="font-semibold">{nft.price} ETH</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function NFTCardSkeleton() {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
      <LoadingSkeleton className="aspect-square" />
      <div className="p-4 space-y-2">
        <LoadingSkeleton className="h-5 w-3/4" />
        <LoadingSkeleton className="h-4 w-1/2" />
        <LoadingSkeleton className="h-4 w-full" />
      </div>
    </div>
  )
}

