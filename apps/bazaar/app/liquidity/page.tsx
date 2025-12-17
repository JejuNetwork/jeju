'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useEILConfig, SUPPORTED_CHAINS } from '@/hooks/useEIL'

export default function LiquidityPage() {
  const { isConnected } = useAccount()
  const { isAvailable: eilAvailable } = useEILConfig()

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🌉 Cross-Chain Liquidity
        </h1>
        <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          Provide liquidity across multiple chains and earn from every bridge
        </p>
      </div>

      {/* Quick Link to Regular Pools */}
      <div className="card p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Looking for single-chain pools?</p>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Add liquidity to regular trading pools</p>
        </div>
        <Link href="/pools" className="btn-secondary whitespace-nowrap">
          Go to Pools →
        </Link>
      </div>

      {/* XLP Info */}
      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg md:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          How It Works
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-2xl md:text-3xl mb-2">💧</div>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Deposit Once</div>
            <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Your tokens work across all supported chains
            </div>
          </div>
          <div className="p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-2xl md:text-3xl mb-2">🔄</div>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Power Bridges</div>
            <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Enable instant cross-chain swaps for users
            </div>
          </div>
          <div className="p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-2xl md:text-3xl mb-2">💰</div>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Earn Fees</div>
            <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              ~0.05% on every cross-chain transfer
            </div>
          </div>
        </div>

        <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Deposit ETH or stablecoins</strong> — Your liquidity is split between local pools (70%) and cross-chain transport (30%)
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Earn from both sources</strong> — Swap fees from local trades + bridge fees from cross-chain transfers
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-bazaar-primary/20 text-bazaar-primary flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Withdraw anytime</strong> — No lock-up period, flexible liquidity management
            </div>
          </div>
        </div>
      </div>

      {/* Supported Chains */}
      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg md:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Supported Chains
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {SUPPORTED_CHAINS.map((chain) => (
            <div 
              key={chain.id} 
              className="p-3 md:p-4 rounded-xl text-center transition-all hover:scale-105"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="text-2xl md:text-3xl mb-1">{chain.icon}</div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{chain.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Fee Breakdown */}
      <div className="card p-5 md:p-6 mb-6">
        <h2 className="text-lg md:text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Earnings Breakdown
        </h2>
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <div className="p-3 md:p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-lg md:text-xl mb-1">💧</div>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Swap Fees</div>
            <div className="text-lg md:text-xl font-bold text-green-400">0.3%</div>
          </div>
          <div className="p-3 md:p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-lg md:text-xl mb-1">🌉</div>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Bridge Fees</div>
            <div className="text-lg md:text-xl font-bold text-green-400">0.05%</div>
          </div>
          <div className="p-3 md:p-4 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="text-lg md:text-xl mb-1">⚡</div>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Gas Rebates</div>
            <div className="text-lg md:text-xl font-bold text-green-400">+10%</div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="card p-5 md:p-6 text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        {!isConnected ? (
          <>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Connect your wallet to start providing cross-chain liquidity
            </p>
            <button className="btn-primary px-8 py-3" disabled>
              Connect Wallet First
            </button>
          </>
        ) : !eilAvailable ? (
          <>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Cross-chain liquidity is being enabled on this network
            </p>
            <button className="btn-secondary px-8 py-3" disabled>
              Coming Soon
            </button>
          </>
        ) : (
          <>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              Ready to start earning from cross-chain transfers?
            </p>
            <a 
              href="https://gateway.jeju.network?tab=xlp" 
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-block px-8 py-3"
            >
              Become a Liquidity Provider
            </a>
          </>
        )}
      </div>
    </div>
  )
}
