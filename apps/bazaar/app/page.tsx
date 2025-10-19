import Link from 'next/link'
import { ArrowRightIcon } from '@radix-ui/react-icons'

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center">
      <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent">
        Welcome to Bazaar
      </h1>
      <p className="text-xl text-slate-300 mb-8 max-w-2xl">
        The unified DeFi + NFT + Token Launchpad on Jeju L3. 
        Create and trade tokens, swap with Uniswap V4, provide liquidity, trade NFTs - all in one place.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-8 w-full max-w-6xl">
        {/* Tokens Card */}
        <Link href="/tokens" className="group">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105">
            <div className="text-4xl mb-4">🪙</div>
            <h3 className="text-2xl font-bold mb-2">Tokens</h3>
            <p className="text-slate-400 mb-4">
              Create and trade multi-chain tokens
            </p>
            <div className="flex items-center text-purple-400 group-hover:translate-x-2 transition-transform">
              <span>Launch Token</span>
              <ArrowRightIcon className="ml-2" />
            </div>
          </div>
        </Link>

        {/* Swap Card */}
        <Link href="/swap" className="group">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105">
            <div className="text-4xl mb-4">🔄</div>
            <h3 className="text-2xl font-bold mb-2">Swap</h3>
            <p className="text-slate-400 mb-4">
              Trade tokens with Uniswap V4 hooks
            </p>
            <div className="flex items-center text-purple-400 group-hover:translate-x-2 transition-transform">
              <span>Start Swapping</span>
              <ArrowRightIcon className="ml-2" />
            </div>
          </div>
        </Link>

        {/* Pools Card */}
        <Link href="/pools" className="group">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105">
            <div className="text-4xl mb-4">💧</div>
            <h3 className="text-2xl font-bold mb-2">Pools</h3>
            <p className="text-slate-400 mb-4">
              Provide liquidity and earn fees
            </p>
            <div className="flex items-center text-purple-400 group-hover:translate-x-2 transition-transform">
              <span>Explore Pools</span>
              <ArrowRightIcon className="ml-2" />
            </div>
          </div>
        </Link>

        {/* NFTs Card */}
        <Link href="/nfts" className="group">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105">
            <div className="text-4xl mb-4">🖼️</div>
            <h3 className="text-2xl font-bold mb-2">NFTs</h3>
            <p className="text-slate-400 mb-4">
              Browse and trade NFTs
            </p>
            <div className="flex items-center text-purple-400 group-hover:translate-x-2 transition-transform">
              <span>View Marketplace</span>
              <ArrowRightIcon className="ml-2" />
            </div>
          </div>
        </Link>
      </div>

      <div className="mt-16 text-slate-400">
        <p>Powered by Uniswap V4 on Jeju L3</p>
      </div>
    </div>
  )
}

