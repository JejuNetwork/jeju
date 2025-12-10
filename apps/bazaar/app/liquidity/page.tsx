'use client'

import { useState, useEffect, Suspense } from 'react'
import { useAccount } from 'wagmi'
import { useSearchParams } from 'next/navigation'
import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import {
  useAddLiquidity,
  useRemoveLiquidity,
  usePositions,
  usePool,
  createPoolKey,
  formatLiquidity,
  sqrtPriceX96ToPrice,
  priceToTick,
  tickToPrice,
  type PoolKey,
} from '@/lib/pools'
import { parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useEILConfig, SUPPORTED_CHAINS } from '@/hooks/useEIL'

function LiquidityPageContent() {
  const { address, isConnected, chain } = useAccount()
  const searchParams = useSearchParams()

  const [token0Address, setToken0Address] = useState('')
  const [token1Address, setToken1Address] = useState('')
  const [fee, setFee] = useState(3000)
  const [token0Amount, setToken0Amount] = useState('')
  const [token1Amount, setToken1Amount] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedPosition, setSelectedPosition] = useState<bigint | null>(null)
  const [removeAmount, setRemoveAmount] = useState('')
  const [activeSection, setActiveSection] = useState<'v4' | 'xlp'>('v4')

  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID
  const { isAvailable: eilAvailable } = useEILConfig()

  const poolKey: PoolKey | null = token0Address && token1Address
    ? createPoolKey(token0Address as Address, token1Address as Address, fee, 60)
    : null

  const { pool } = usePool(poolKey)
  const { positions, refetch: refetchPositions } = usePositions(poolKey || undefined)
  const { addLiquidity, isLoading: isAdding, isSuccess: addSuccess } = useAddLiquidity()
  const { removeLiquidity, isLoading: isRemoving, isSuccess: removeSuccess } = useRemoveLiquidity()

  useEffect(() => {
    if (addSuccess) {
      toast.success('Liquidity added')
      refetchPositions()
      setToken0Amount('')
      setToken1Amount('')
    }
  }, [addSuccess, refetchPositions])

  useEffect(() => {
    if (removeSuccess) {
      toast.success('Liquidity removed')
      refetchPositions()
      setRemoveAmount('')
      setSelectedPosition(null)
    }
  }, [removeSuccess, refetchPositions])

  const handleAddLiquidity = async () => {
    if (!poolKey || !token0Amount || !token1Amount || !minPrice || !maxPrice) {
      toast.error('Fill all fields')
      return
    }
    if (!address) {
      toast.error('Connect wallet')
      return
    }

    const amount0 = parseUnits(token0Amount, 18)
    const amount1 = parseUnits(token1Amount, 18)
    const tickLower = priceToTick(parseFloat(minPrice))
    const tickUpper = priceToTick(parseFloat(maxPrice))
    const liquidity = amount0 > amount1 ? amount0 : amount1

    await addLiquidity({
      poolKey,
      tickLower,
      tickUpper,
      liquidity,
      amount0Max: amount0,
      amount1Max: amount1,
      recipient: address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    })
  }

  const handleRemoveLiquidity = async () => {
    if (!selectedPosition || !removeAmount) {
      toast.error('Select position and amount')
      return
    }

    const liquidity = parseUnits(removeAmount, 18)

    await removeLiquidity({
      tokenId: selectedPosition,
      liquidity: liquidity as bigint,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    })
  }

  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold mb-8" style={{ color: 'var(--text-primary)' }}>
        💧 Liquidity
      </h1>

      <div className="flex gap-3 mb-8 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
        <button
          onClick={() => setActiveSection('v4')}
          className={`px-5 py-3 rounded-xl font-semibold whitespace-nowrap transition-all ${
            activeSection === 'v4' ? 'btn-primary' : 'btn-secondary'
          }`}
        >
          V4 Pools
        </button>
        <button
          onClick={() => setActiveSection('xlp')}
          className={`px-5 py-3 rounded-xl font-semibold whitespace-nowrap transition-all ${
            activeSection === 'xlp' ? 'btn-accent' : 'btn-secondary'
          }`}
        >
          Cross-Chain XLP
        </button>
      </div>

      {activeSection === 'xlp' && (
        <div className="space-y-6">
          <div className="card p-5 border-bazaar-accent/30 bg-bazaar-accent/5">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              🔗 V4 + XLP Integration
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Liquidity now serves both local V4 swaps and cross-chain transfers. 
              Deposit once, earn from both sources.
            </p>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-xl mb-1">💧</div>
                <div style={{ color: 'var(--text-tertiary)' }}>V4 LP Fees</div>
                <div className="font-semibold">0.01-1%</div>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-xl mb-1">🌉</div>
                <div style={{ color: 'var(--text-tertiary)' }}>XLP Fees</div>
                <div className="font-semibold">~0.05%</div>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-xl mb-1">⚡</div>
                <div style={{ color: 'var(--text-tertiary)' }}>Gas Sponsor</div>
                <div className="font-semibold">+10%</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Supported Chains</h3>
              <div className="grid grid-cols-2 gap-3">
                {SUPPORTED_CHAINS.map((chain) => (
                  <div key={chain.id} className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="text-2xl mb-1">{chain.icon}</div>
                    <div className="text-sm font-medium">{chain.name}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Get Started</h3>
              <div className="space-y-3">
                <a 
                  href="https://gateway.jeju.network?tab=xlp" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded-xl btn-secondary text-center"
                >
                  Register as XLP →
                </a>
                <a 
                  href="https://gateway.jeju.network?tab=xlp" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 rounded-xl btn-secondary text-center"
                >
                  Deposit Dual Liquidity →
                </a>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>How It Works</h3>
            <div className="space-y-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <div>
                  <strong>Deposit ETH or tokens</strong> - Your liquidity is split between V4 pools (70%) and XLP transport (30%)
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <div>
                  <strong>Earn from both</strong> - V4 pools earn swap fees, XLP earns cross-chain transport fees
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <div>
                  <strong>Cross-chain volume</strong> - Users on any chain can swap into Jeju tokens via your liquidity
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'v4' && (
        <>
          {!hasPeriphery && (
            <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
              <p className="text-bazaar-warning text-sm">V4 contracts not deployed</p>
            </div>
          )}

          {isConnected && !isCorrectChain && (
            <div className="card p-4 mb-6 border-bazaar-error/50 bg-bazaar-error/10">
              <p className="text-bazaar-error text-sm">Switch to Jeju (Chain {JEJU_CHAIN_ID})</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <h2 className="text-xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
                Add Liquidity
              </h2>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Token 0</label>
                  <input
                    type="text"
                    value={token0Address}
                    onChange={(e) => setToken0Address(e.target.value)}
                    placeholder="0x..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Token 1</label>
                  <input
                    type="text"
                    value={token1Address}
                    onChange={(e) => setToken1Address(e.target.value)}
                    placeholder="0x..."
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Fee</label>
                  <select value={fee} onChange={(e) => setFee(Number(e.target.value))} className="input">
                    <option value={100}>0.01%</option>
                    <option value={500}>0.05%</option>
                    <option value={3000}>0.3%</option>
                    <option value={10000}>1%</option>
                  </select>
                </div>
              </div>

              {pool && (
                <div className="mb-6 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-tertiary)' }}>Price</span>
                    <span>{sqrtPriceX96ToPrice(pool.slot0.sqrtPriceX96).toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-tertiary)' }}>Liquidity</span>
                    <span>{formatLiquidity(pool.liquidity)}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Amount 0</label>
                  <input
                    type="number"
                    value={token0Amount}
                    onChange={(e) => setToken0Amount(e.target.value)}
                    placeholder="0.0"
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Amount 1</label>
                  <input
                    type="number"
                    value={token1Amount}
                    onChange={(e) => setToken1Amount(e.target.value)}
                    placeholder="0.0"
                    className="input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Min Price</label>
                  <input
                    type="number"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="0.0"
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>Max Price</label>
                  <input
                    type="number"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="0.0"
                    className="input"
                  />
                </div>
              </div>

              <button
                onClick={handleAddLiquidity}
                disabled={!isConnected || !hasPeriphery || !isCorrectChain || isAdding}
                className="btn-primary w-full py-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {!isConnected ? 'Connect Wallet' : isAdding ? 'Adding...' : 'Add Liquidity'}
              </button>
            </div>

            <div className="space-y-6">
              <div className="card p-5">
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  Positions
                </h2>
                
                {!isConnected ? (
                  <p className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Connect wallet</p>
                ) : positions.length === 0 ? (
                  <p className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No positions</p>
                ) : (
                  <div className="space-y-3">
                    {positions.map((position) => (
                      <div
                        key={position.tokenId.toString()}
                        onClick={() => setSelectedPosition(position.tokenId)}
                        className={`p-4 rounded-xl border cursor-pointer ${
                          selectedPosition === position.tokenId ? 'border-bazaar-primary bg-bazaar-primary/10' : ''
                        }`}
                        style={selectedPosition !== position.tokenId ? { 
                          backgroundColor: 'var(--bg-secondary)',
                          borderColor: 'var(--border)'
                        } : undefined}
                      >
                        <div className="flex justify-between mb-2">
                          <span className="font-semibold">#{position.tokenId.toString()}</span>
                          <span className="text-sm text-bazaar-success">Active</span>
                        </div>
                        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                          {tickToPrice(position.tickLower).toFixed(4)} - {tickToPrice(position.tickUpper).toFixed(4)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedPosition && (
                <div className="card p-5">
                  <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Remove
                  </h2>
                  
                  <div className="mb-4">
                    <input
                      type="number"
                      value={removeAmount}
                      onChange={(e) => setRemoveAmount(e.target.value)}
                      placeholder="0.0"
                      className="input mb-2"
                    />
                    <div className="flex gap-2">
                      {['25', '50', '75', '100'].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => setRemoveAmount(pct)}
                          className="flex-1 px-3 py-2 rounded-lg text-sm"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleRemoveLiquidity}
                    disabled={!removeAmount || isRemoving}
                    className="w-full py-4 rounded-xl font-bold bg-bazaar-error text-white disabled:opacity-50"
                  >
                    {isRemoving ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function LiquidityPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>}>
      <LiquidityPageContent />
    </Suspense>
  )
}
