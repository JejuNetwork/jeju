'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { ArrowLeft, Server, Cloud, Database, Wallet, CreditCard, Info, ExternalLink, CheckCircle } from 'lucide-react'
import { BackendStatus } from '@/src/components/BackendStatus'
import { fetchHealth, fetchBackends, type HealthResponse } from '@/src/config/api'

export default function SettingsPage() {
  const { address, isConnected } = useAccount()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6 md:space-y-8 lg:space-y-10">
      {/* Header */}
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-semibold mb-4 sm:mb-5 transition-colors active:scale-[0.98] hover:text-storage-primary"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 sm:mt-3 text-sm sm:text-base md:text-lg" style={{ color: 'var(--text-secondary)' }}>
          Configure storage backends and payment options
        </p>
      </div>

      {/* Account Section */}
      <section>
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
          <div className="p-2 rounded-xl bg-storage-primary/15">
            <Wallet size={20} className="text-storage-primary sm:w-[22px] sm:h-[22px]" />
          </div>
          Account
        </h2>
        <div className="card-static p-4 sm:p-6 md:p-8">
          {isConnected ? (
            <div className="space-y-4 sm:space-y-5">
              <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl bg-gradient-to-br from-storage-primary to-storage-accent flex items-center justify-center text-base sm:text-lg md:text-xl font-bold flex-shrink-0"
                  style={{ color: 'var(--text-on-primary)' }}
                >
                  {address?.slice(2, 4).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm sm:text-base md:text-lg">Connected Wallet</p>
                  <p className="text-xs sm:text-sm md:text-base font-mono mt-1 sm:mt-1.5 break-all" style={{ color: 'var(--text-secondary)' }}>
                    {address}
                  </p>
                </div>
              </div>
              
              <div className="pt-4 sm:pt-5 border-t flex flex-wrap gap-2 sm:gap-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-storage-success/10">
                  <CheckCircle size={14} className="text-storage-success sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm font-medium">Wallet connected</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-storage-success/10">
                  <CheckCircle size={14} className="text-storage-success sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm font-medium">Ready to upload</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 sm:py-10">
              <Wallet size={48} className="mx-auto mb-4 sm:mb-5 text-storage-primary sm:w-14 sm:h-14" />
              <h3 className="font-bold text-base sm:text-lg md:text-xl mb-2 sm:mb-3">Connect Your Wallet</h3>
              <p className="text-sm sm:text-base mb-4 sm:mb-5 max-w-md mx-auto px-4" style={{ color: 'var(--text-secondary)' }}>
                Connect your wallet to enable paid storage and premium features
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Storage Backends */}
      <section>
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
          <div className="p-2 rounded-xl bg-storage-accent/15">
            <Server size={20} className="text-storage-accent sm:w-[22px] sm:h-[22px]" />
          </div>
          Storage Backends
        </h2>
        <BackendStatus
          backends={health?.backends.available ?? []}
          health={health?.backends.health ?? {}}
          loading={loading}
        />
        
        <div 
          className="mt-4 sm:mt-5 rounded-xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4"
          style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)' }}
        >
          <Info size={18} className="text-storage-accent flex-shrink-0 mt-0.5 sm:w-[22px] sm:h-[22px]" />
          <div>
            <h4 className="font-semibold text-sm sm:text-base mb-1 sm:mb-1.5">Backend Selection</h4>
            <p className="text-xs sm:text-sm md:text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Files are automatically uploaded to the highest priority available backend. 
              Backend configuration is managed server-side via environment variables.
            </p>
          </div>
        </div>
      </section>

      {/* Payment Options */}
      <section>
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
          <div className="p-2 rounded-xl bg-storage-warning/15">
            <CreditCard size={20} className="text-storage-warning sm:w-[22px] sm:h-[22px]" />
          </div>
          Payment Options
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
          <div className="card-static p-4 sm:p-6 md:p-7 active:scale-[0.98] transition-all duration-300">
            <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-storage-primary/20 to-storage-accent/20 flex-shrink-0">
                <span className="text-xl sm:text-2xl font-bold">Ξ</span>
              </div>
              <div>
                <h3 className="font-semibold text-sm sm:text-base md:text-lg">ETH</h3>
                <p className="text-xs sm:text-sm" style={{ color: 'var(--text-tertiary)' }}>Native currency</p>
              </div>
            </div>
            <p className="text-xs sm:text-sm md:text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Pay for storage using ETH via x402 micropayments
            </p>
          </div>
          
          <div className="card-static p-4 sm:p-6 md:p-7 active:scale-[0.98] transition-all duration-300">
            <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-storage-success/20 to-storage-primary/20 flex-shrink-0">
                <span className="text-xl sm:text-2xl font-bold">$</span>
              </div>
              <div>
                <h3 className="font-semibold text-sm sm:text-base md:text-lg">USDC / ERC-20</h3>
                <p className="text-xs sm:text-sm" style={{ color: 'var(--text-tertiary)' }}>Stablecoins & tokens</p>
              </div>
            </div>
            <p className="text-xs sm:text-sm md:text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Use ERC-4337 paymaster for multi-token payments
            </p>
          </div>
        </div>
      </section>

      {/* API Integration */}
      <section>
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 sm:mb-5 flex items-center gap-2 sm:gap-3">
          <div className="p-2 rounded-xl bg-storage-info/15">
            <Database size={20} className="text-storage-info sm:w-[22px] sm:h-[22px]" />
          </div>
          API Integration
        </h2>
        <div className="card-static p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-5">
          <div>
            <h3 className="font-semibold text-sm sm:text-base mb-2 sm:mb-3">REST API</h3>
            <code 
              className="block p-3 sm:p-4 rounded-xl text-xs sm:text-sm md:text-base font-mono break-all"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/api
            </code>
          </div>
          
          <div>
            <h3 className="font-semibold text-sm sm:text-base mb-2 sm:mb-3">A2A Endpoint (Agent-to-Agent)</h3>
            <code 
              className="block p-3 sm:p-4 rounded-xl text-xs sm:text-sm md:text-base font-mono break-all"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/a2a
            </code>
          </div>
          
          <div>
            <h3 className="font-semibold text-sm sm:text-base mb-2 sm:mb-3">Agent Card</h3>
            <a
              href="/.well-known/agent-card.json"
              target="_blank"
              rel="noopener noreferrer"
              className="link-primary text-sm sm:text-base"
            >
              /.well-known/agent-card.json
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* Service Info */}
      <section>
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 sm:mb-5">Service Information</h2>
        <div className="card-static p-4 sm:p-6 md:p-8">
          <div className="grid grid-cols-2 gap-4 sm:gap-5 md:gap-6">
            <div>
              <p className="text-xs sm:text-sm font-medium mb-1 sm:mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Version</p>
              <p className="font-mono text-sm sm:text-base md:text-lg">{health?.version ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm font-medium mb-1 sm:mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Service</p>
              <p className="font-mono text-sm sm:text-base md:text-lg">{health?.service ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm font-medium mb-1 sm:mb-1.5" style={{ color: 'var(--text-tertiary)' }}>IPFS Status</p>
              <p className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base">
                {health?.ipfs.connected ? (
                  <>
                    <CheckCircle size={16} className="text-storage-success sm:w-[18px] sm:h-[18px]" />
                    <span className="font-medium">Connected</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>Not connected</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs sm:text-sm font-medium mb-1 sm:mb-1.5" style={{ color: 'var(--text-tertiary)' }}>IPFS Peer ID</p>
              <p className="font-mono text-xs sm:text-sm truncate" title={health?.ipfs.peerId}>
                {health?.ipfs.peerId?.slice(0, 16) ?? '—'}...
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

