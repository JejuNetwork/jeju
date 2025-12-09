'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { 
  usePools, 
  useCreatePool, 
  formatFee, 
  formatLiquidity,
  sqrtPriceX96ToPrice,
  getFeeTiers,
  getTickSpacing,
  calculateSqrtPriceX96,
  type PoolKey 
} from '@/lib/pools'
import { parseUnits, type Address } from 'viem'
import { toast } from 'sonner'

const MOCK_POOL_KEYS: PoolKey[] = [
  {
    currency0: '0x0000000000000000000000000000000000000000' as Address,
    currency1: '0x1111111111111111111111111111111111111111' as Address,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000' as Address,
  },
]

export default function PoolsPage() {
  const { address, isConnected } = useAccount()
  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { pools, isLoading: poolsLoading, refetch: refetchPools } = usePools(MOCK_POOL_KEYS)

  const [token0, setToken0] = useState('')
  const [token1, setToken1] = useState('')
  const [selectedFee, setSelectedFee] = useState(3000)
  const [initialPrice, setInitialPrice] = useState('')
  const [hooksAddress, setHooksAddress] = useState('')

  const { createPool, isLoading: isCreating, isSuccess, error: createError } = useCreatePool()

  const handleCreatePool = async () => {
    if (!token0 || !token1 || !initialPrice) {
      toast.error('Please fill in all required fields')
      return
    }

    const tickSpacing = getTickSpacing(selectedFee)
    const amount0 = parseUnits(initialPrice, 18)
    const amount1 = parseUnits('1', 18)
    const sqrtPriceX96 = calculateSqrtPriceX96(amount0, amount1)

    await createPool({
      token0: token0 as Address,
      token1: token1 as Address,
      fee: selectedFee,
      tickSpacing,
      hooks: hooksAddress ? (hooksAddress as Address) : undefined,
      sqrtPriceX96,
    })

    toast.success('Pool created successfully.')
    setShowCreateModal(false)
    refetchPools()
    
    setToken0('')
    setToken1('')
    setInitialPrice('')
    setHooksAddress('')
  }

  if (isSuccess) {
    toast.success('Pool created successfully.')
  }

  if (createError) {
    toast.error(`Error: ${createError.message}`)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            💧 Liquidity Pools
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Provide liquidity and earn fees on trades
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={!isConnected || !hasPeriphery}
          className="btn-primary w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Pool
        </button>
      </div>

      {/* Alerts */}
      {!hasPeriphery && (
        <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
          <p className="text-bazaar-warning">
            V4 Periphery contracts not deployed. Pool features unavailable.
          </p>
        </div>
      )}

      {!isConnected && (
        <div className="card p-4 mb-6 border-bazaar-info/50 bg-bazaar-info/10">
          <p className="text-bazaar-info">
            Connect your wallet to create and manage pools
          </p>
        </div>
      )}

      {/* Pools Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {poolsLoading ? (
          <div className="col-span-full text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
            Loading pools...
          </div>
        ) : pools.length === 0 ? (
          <div className="col-span-full text-center py-20">
            <div className="text-6xl md:text-7xl mb-4">🏊</div>
            <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              No Pools Yet
            </h3>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Be the first to create a liquidity pool.
            </p>
          </div>
        ) : (
          pools.map((pool) => (
            <div key={pool.id} className="card p-5 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" />
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 -ml-3" />
                  <span className="ml-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {pool.token0Symbol || 'Token0'}/{pool.token1Symbol || 'Token1'}
                  </span>
                </div>
                <span className="badge-success">{formatFee(pool.key.fee)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>TVL</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatLiquidity(pool.liquidity)}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Price</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {sqrtPriceX96ToPrice(pool.slot0.sqrtPriceX96).toFixed(6)}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>Tick</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {pool.slot0.tick}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)' }}>LP Fee</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatFee(pool.slot0.lpFee)}
                  </div>
                </div>
              </div>

              {pool.key.hooks !== '0x0000000000000000000000000000000000000000' && (
                <div className="mb-4 p-2 rounded-lg text-xs border border-bazaar-purple/30 bg-bazaar-purple/10">
                  🪝 Hook: {pool.key.hooks.slice(0, 10)}...
                </div>
              )}

              <Link
                href={`/liquidity?pool=${pool.id}`}
                className="btn-secondary w-full text-center py-2.5"
              >
                Add Liquidity
              </Link>
            </div>
          ))
        )}
      </div>

      {/* Create Pool Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div 
            className="w-full max-w-md rounded-2xl border p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Create New Pool
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 rounded-xl hover:bg-[var(--bg-secondary)] transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Token 0 Address</label>
                <input
                  type="text"
                  value={token0}
                  onChange={(e) => setToken0(e.target.value)}
                  placeholder="0x..."
                  className="input"
                />
              </div>

              <div>
                <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Token 1 Address</label>
                <input
                  type="text"
                  value={token1}
                  onChange={(e) => setToken1(e.target.value)}
                  placeholder="0x..."
                  className="input"
                />
              </div>

              <div>
                <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Fee Tier</label>
                <select
                  value={selectedFee}
                  onChange={(e) => setSelectedFee(Number(e.target.value))}
                  className="input"
                >
                  {getFeeTiers().map((tier) => (
                    <option key={tier.value} value={tier.value}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
                  Initial Price (Token1 per Token0)
                </label>
                <input
                  type="number"
                  value={initialPrice}
                  onChange={(e) => setInitialPrice(e.target.value)}
                  placeholder="1.0"
                  step="0.000001"
                  className="input"
                />
              </div>

              <div>
                <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>
                  Hooks Contract (Optional)
                </label>
                <input
                  type="text"
                  value={hooksAddress}
                  onChange={(e) => setHooksAddress(e.target.value)}
                  placeholder="0x... (leave empty for no hooks)"
                  className="input"
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Add custom hooks for TWAMM, limit orders, dynamic fees, etc.
                </p>
              </div>

              <button
                onClick={handleCreatePool}
                disabled={isCreating || !token0 || !token1 || !initialPrice}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? 'Creating Pool...' : 'Create Pool'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
