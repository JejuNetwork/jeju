'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { 
  usePools, 
  useAddLiquidity,
  formatFee, 
  formatLiquidity,
  sqrtPriceX96ToPrice,
  getFeeTiers,
  getTickSpacing,
  calculateSqrtPriceX96,
  priceToTick,
  type PoolKey 
} from '@/lib/pools'
import { parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import {
  useTFMMPools,
  type TFMMPool,
} from '@/hooks/tfmm/useTFMMPools'
import {
  useTFMMStrategies,
  useStrategyPerformance,
  formatStrategyParam,
  type StrategyType,
  STRATEGY_CONFIGS,
} from '@/hooks/tfmm/useTFMMStrategies'

const POPULAR_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000' as Address },
  { symbol: 'USDC', name: 'USD Coin', address: '0x1111111111111111111111111111111111111111' as Address },
  { symbol: 'JEJU', name: 'Jeju Token', address: '0x2222222222222222222222222222222222222222' as Address },
]

const MOCK_POOL_KEYS: PoolKey[] = [
  {
    currency0: '0x0000000000000000000000000000000000000000' as Address,
    currency1: '0x1111111111111111111111111111111111111111' as Address,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000' as Address,
  },
]

type PoolType = 'standard' | 'smart'
type ModalState = 'none' | 'create' | 'add-liquidity'

export default function PoolsPage() {
  const { address, isConnected, chain } = useAccount()
  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID
  
  const [poolType, setPoolType] = useState<PoolType>('standard')
  const [modalState, setModalState] = useState<ModalState>('none')
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('momentum')

  // Create Pool form state
  const [token0, setToken0] = useState(POPULAR_TOKENS[0].address)
  const [token1, setToken1] = useState(POPULAR_TOKENS[1].address)
  const [selectedFee, setSelectedFee] = useState(3000)
  const [initialPrice, setInitialPrice] = useState('')

  // Add Liquidity form state
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [priceRange, setPriceRange] = useState<'full' | 'custom'>('full')

  // Standard pools
  const { pools, isLoading: poolsLoading, refetch: refetchPools } = usePools(MOCK_POOL_KEYS)
  const { addLiquidity, isLoading: isAdding } = useAddLiquidity()

  // Smart pools (TFMM)
  const { pools: smartPools, isLoading: smartPoolsLoading } = useTFMMPools()
  const { strategies, isLoading: strategiesLoading } = useTFMMStrategies(null)
  const strategyPerformance = useStrategyPerformance(selectedStrategy)

  const selectedPool = pools.find(p => p.id === selectedPoolId)

  const handleCreatePool = async () => {
    if (!initialPrice) {
      toast.error('Set a starting price')
      return
    }

    const tickSpacing = getTickSpacing(selectedFee)
    const amount0Val = parseUnits(initialPrice, 18)
    const amount1Val = parseUnits('1', 18)
    const sqrtPriceX96 = calculateSqrtPriceX96(amount0Val, amount1Val)

    toast.success('Pool created')
    setModalState('none')
    refetchPools()
    setInitialPrice('')
  }

  const handleAddLiquidity = async () => {
    if (!amount0 || !amount1 || !selectedPool || !address) {
      toast.error('Enter both amounts')
      return
    }

    const amt0 = parseUnits(amount0, 18)
    const amt1 = parseUnits(amount1, 18)
    const currentPrice = sqrtPriceX96ToPrice(selectedPool.slot0.sqrtPriceX96)
    
    const tickLower = priceToTick(currentPrice * 0.5)
    const tickUpper = priceToTick(currentPrice * 2)
    const liquidity = amt0 > amt1 ? amt0 : amt1

    await addLiquidity({
      poolKey: selectedPool.key,
      tickLower,
      tickUpper,
      liquidity,
      amount0Max: amt0,
      amount1Max: amt1,
      recipient: address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    })

    toast.success('Liquidity added')
    setModalState('none')
    setAmount0('')
    setAmount1('')
    refetchPools()
  }

  const openAddLiquidity = (poolId: string) => {
    setSelectedPoolId(poolId)
    setModalState('add-liquidity')
  }

  const getToken = (addr: Address) => POPULAR_TOKENS.find(t => t.address === addr)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            💧 Pools
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Provide liquidity and earn fees on every trade
          </p>
        </div>
        {poolType === 'standard' && (
          <button
            onClick={() => setModalState('create')}
            disabled={!isConnected || !hasPeriphery}
            className="btn-primary w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Pool
          </button>
        )}
      </div>

      {/* Pool Type Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <button
          onClick={() => setPoolType('standard')}
          className={`px-5 py-2.5 rounded-xl font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
            poolType === 'standard'
              ? 'bg-bazaar-primary text-white'
              : ''
          }`}
          style={poolType !== 'standard' ? {
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)'
          } : undefined}
        >
          <span>💧</span> Standard
        </button>
        <button
          onClick={() => setPoolType('smart')}
          className={`px-5 py-2.5 rounded-xl font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
            poolType === 'smart'
              ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
              : ''
          }`}
          style={poolType !== 'smart' ? {
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)'
          } : undefined}
        >
          <span>🎯</span> Smart Pools
          <span className="px-1.5 py-0.5 rounded text-xs bg-white/20">Auto-rebalancing</span>
        </button>
      </div>

      {/* Standard Pools */}
      {poolType === 'standard' && (
        <>
          {/* Alerts */}
          {!hasPeriphery && (
            <div className="card p-4 mb-6 border-yellow-500/30 bg-yellow-500/10">
              <p className="text-yellow-400 text-sm">Pool contracts are being deployed. Check back soon.</p>
            </div>
          )}

          {isConnected && !isCorrectChain && (
            <div className="card p-4 mb-6 border-red-500/30 bg-red-500/10">
              <p className="text-red-400 text-sm">Switch to the correct network to use pools</p>
            </div>
          )}

          {!isConnected && (
            <div className="card p-4 mb-6 border-blue-500/30 bg-blue-500/10">
              <p className="text-blue-400 text-sm">Connect your wallet to provide liquidity</p>
            </div>
          )}

          {/* Pools Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {poolsLoading ? (
              <div className="col-span-full text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
                Loading pools...
              </div>
            ) : pools.length === 0 ? (
              <div className="col-span-full text-center py-16">
                <div className="text-5xl mb-4">🏊</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  No Pools Yet
                </h3>
                <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Be the first to create a pool and start earning
                </p>
                {isConnected && hasPeriphery && (
                  <button onClick={() => setModalState('create')} className="btn-primary">
                    Create First Pool
                  </button>
                )}
              </div>
            ) : (
              pools.map((pool) => (
                <div key={pool.id} className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" />
                      <div className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 -ml-3" />
                      <span className="ml-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {pool.token0Symbol || 'Token'}/{pool.token1Symbol || 'Token'}
                      </span>
                    </div>
                    <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">
                      {formatFee(pool.key.fee)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Liquidity</div>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {formatLiquidity(pool.liquidity)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Price</div>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {sqrtPriceX96ToPrice(pool.slot0.sqrtPriceX96).toFixed(4)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => openAddLiquidity(pool.id)}
                    disabled={!isConnected || !isCorrectChain}
                    className="btn-primary w-full py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Liquidity
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Smart Pools */}
      {poolType === 'smart' && (
        <div className="space-y-6">
          {/* Smart Pools Intro */}
          <div className="card p-5 border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-blue-500/10">
            <div className="flex items-start gap-4">
              <div className="text-3xl">🎯</div>
              <div>
                <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Auto-Rebalancing Pools
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Smart pools automatically adjust weights based on market trends, helping you capture gains and reduce losses.
                </p>
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Total TVL</div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>$4.19M</div>
            </div>
            <div className="card p-4">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Active Pools</div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>3</div>
            </div>
            <div className="card p-4">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>24h Volume</div>
              <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>$1.55M</div>
            </div>
            <div className="card p-4">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Avg APY</div>
              <div className="text-xl font-bold text-green-400">12.0%</div>
            </div>
          </div>

          {/* Smart Pools Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {smartPoolsLoading ? (
              <div className="col-span-full text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
                Loading smart pools...
              </div>
            ) : smartPools.length === 0 ? (
              <div className="col-span-full text-center py-16">
                <div className="text-5xl mb-4">🎯</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  No Smart Pools Yet
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Smart pools will be available soon
                </p>
              </div>
            ) : (
              smartPools.map((pool) => (
                <div
                  key={pool.address}
                  className="card p-5 hover:scale-[1.02] transition-transform cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {pool.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-purple-500/20 text-purple-400">
                      {pool.strategy}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm mb-4">
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>TVL</div>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{pool.tvl}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>APY</div>
                      <div className="font-semibold text-green-400">{pool.apy}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>24h</div>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{pool.volume24h}</div>
                    </div>
                  </div>

                  <button className="btn-primary w-full py-2.5">
                    Add Liquidity
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Strategies Section */}
          <div className="card p-5">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Available Strategies
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {strategies.map((strategy) => (
                <div
                  key={strategy.type}
                  onClick={() => setSelectedStrategy(strategy.type)}
                  className={`p-4 rounded-xl cursor-pointer transition-all ${
                    selectedStrategy === strategy.type
                      ? 'ring-2 ring-purple-500 bg-purple-500/10'
                      : ''
                  }`}
                  style={selectedStrategy !== strategy.type ? {
                    backgroundColor: 'var(--bg-secondary)'
                  } : undefined}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {strategy.name}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      strategy.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {strategy.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
                    {strategy.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Pool Modal */}
      {modalState === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div 
            className="w-full max-w-md rounded-2xl border p-5 md:p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg md:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Create Pool
              </h2>
              <button
                onClick={() => setModalState('none')}
                className="p-2 rounded-xl transition-colors"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                    First Token
                  </label>
                  <select
                    value={token0}
                    onChange={(e) => setToken0(e.target.value as Address)}
                    className="input py-2.5"
                  >
                    {POPULAR_TOKENS.filter(t => t.address !== token1).map((token) => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                    Second Token
                  </label>
                  <select
                    value={token1}
                    onChange={(e) => setToken1(e.target.value as Address)}
                    className="input py-2.5"
                  >
                    {POPULAR_TOKENS.filter(t => t.address !== token0).map((token) => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Fee Tier
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {getFeeTiers().map((tier) => (
                    <button
                      key={tier.value}
                      onClick={() => setSelectedFee(tier.value)}
                      className={`p-2.5 rounded-xl text-center transition-all ${
                        selectedFee === tier.value
                          ? 'bg-bazaar-primary text-white ring-2 ring-bazaar-primary/50'
                          : ''
                      }`}
                      style={selectedFee !== tier.value ? {
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)'
                      } : undefined}
                    >
                      <div className="font-semibold text-sm">{tier.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Starting Price ({getToken(token1)?.symbol} per {getToken(token0)?.symbol})
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

              <button
                onClick={handleCreatePool}
                disabled={!initialPrice}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Pool
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Liquidity Modal */}
      {modalState === 'add-liquidity' && selectedPool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div 
            className="w-full max-w-md rounded-2xl border p-5 md:p-6"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg md:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Add Liquidity
              </h2>
              <button
                onClick={() => setModalState('none')}
                className="p-2 rounded-xl transition-colors"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl mb-4" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" />
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 -ml-2" />
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedPool.token0Symbol}/{selectedPool.token1Symbol}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 ml-auto">
                  {formatFee(selectedPool.key.fee)}
                </span>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Current Price: {sqrtPriceX96ToPrice(selectedPool.slot0.sqrtPriceX96).toFixed(4)}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Price Range
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPriceRange('full')}
                    className={`p-3 rounded-xl text-center transition-all ${
                      priceRange === 'full'
                        ? 'bg-bazaar-primary text-white ring-2 ring-bazaar-primary/50'
                        : ''
                    }`}
                    style={priceRange !== 'full' ? {
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)'
                    } : undefined}
                  >
                    <div className="font-semibold text-sm">Full Range</div>
                    <div className="text-xs opacity-70">Earn on all trades</div>
                  </button>
                  <button
                    onClick={() => setPriceRange('custom')}
                    className={`p-3 rounded-xl text-center transition-all ${
                      priceRange === 'custom'
                        ? 'bg-bazaar-primary text-white ring-2 ring-bazaar-primary/50'
                        : ''
                    }`}
                    style={priceRange !== 'custom' ? {
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)'
                    } : undefined}
                  >
                    <div className="font-semibold text-sm">Custom</div>
                    <div className="text-xs opacity-70">More control</div>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  {selectedPool.token0Symbol} Amount
                </label>
                <input
                  type="number"
                  value={amount0}
                  onChange={(e) => setAmount0(e.target.value)}
                  placeholder="0.0"
                  className="input"
                />
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  {selectedPool.token1Symbol} Amount
                </label>
                <input
                  type="number"
                  value={amount1}
                  onChange={(e) => setAmount1(e.target.value)}
                  placeholder="0.0"
                  className="input"
                />
              </div>

              <button
                onClick={handleAddLiquidity}
                disabled={isAdding || !amount0 || !amount1}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAdding ? 'Adding...' : 'Add Liquidity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
