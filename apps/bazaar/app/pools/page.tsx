'use client'

import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'

export default function PoolsPage() {
  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Liquidity Pools</h1>

      {!hasPeriphery && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-200 mb-6">
          ⚠️ V4 Periphery contracts not deployed. Pool features unavailable.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pool Cards */}
        <div className="p-6 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-500" />
              <div className="w-8 h-8 rounded-full bg-orange-500 -ml-3" />
              <span className="ml-2 font-semibold">ETH/USDC</span>
            </div>
            <span className="text-sm text-green-400">0.3%</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-slate-400">TVL</div>
              <div className="font-semibold">$1.2M</div>
            </div>
            <div>
              <div className="text-slate-400">Volume 24h</div>
              <div className="font-semibold">$150K</div>
            </div>
          </div>
          <button className="w-full mt-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors font-medium">
            Add Liquidity
          </button>
        </div>

        {/* Create Pool Button */}
        <div className="p-6 rounded-xl bg-white/5 border border-white/10 border-dashed flex flex-col items-center justify-center hover:bg-white/10 transition-all cursor-pointer">
          <div className="text-4xl mb-2">➕</div>
          <h3 className="font-semibold mb-2">Create New Pool</h3>
          <p className="text-sm text-slate-400 text-center">
            Create a Uniswap V4 pool with custom hooks
          </p>
        </div>
      </div>
    </div>
  )
}

