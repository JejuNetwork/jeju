'use client'

import { useAccount } from 'wagmi'

export default function MyNFTsPage() {
  const { isConnected, address } = useAccount()

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <h1 className="text-4xl font-bold mb-4">My NFTs</h1>
        <p className="text-slate-400 mb-8">
          Connect your wallet to view and manage your NFT collection
        </p>
        <div className="text-6xl mb-4">👛</div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">My NFTs</h1>

      {/* Empty State */}
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🖼️</div>
        <h3 className="text-2xl font-semibold mb-2">No NFTs Yet</h3>
        <p className="text-slate-400 mb-6">
          You don't own any NFTs on Jeju. Check out the marketplace!
        </p>
        <a
          href="/nfts"
          className="inline-block px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-semibold transition-all"
        >
          Browse Marketplace
        </a>
      </div>
    </div>
  )
}

