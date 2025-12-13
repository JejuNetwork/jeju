'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { ArrowLeft, Server, Cloud, Database, Wallet, CreditCard, Info, ExternalLink, CheckCircle } from 'lucide-react'
import { BackendStatus } from '@/components/BackendStatus'
import { fetchHealth, fetchBackends, type HealthResponse } from '@/config/api'

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
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-medium mb-4 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold">Settings</h1>
        <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
          Configure storage backends and payment options
        </p>
      </div>

      {/* Account Section */}
      <section>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Wallet size={22} />
          Account
        </h2>
        <div className="card-static p-6">
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-storage-primary to-storage-accent flex items-center justify-center text-lg font-bold text-dark-bg">
                  {address?.slice(2, 4).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">Connected Wallet</p>
                  <p className="text-sm font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {address}
                  </p>
                </div>
              </div>
              
              <div className="pt-4 border-t flex flex-wrap gap-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-storage-success" />
                  <span className="text-sm">Wallet connected</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-storage-success" />
                  <span className="text-sm">Ready to upload</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Wallet size={48} className="mx-auto mb-4 text-storage-primary" />
              <h3 className="font-bold mb-2">Connect Your Wallet</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                Connect your wallet to enable paid storage and premium features
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Storage Backends */}
      <section>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Server size={22} />
          Storage Backends
        </h2>
        <BackendStatus
          backends={health?.backends.available ?? []}
          health={health?.backends.health ?? {}}
          loading={loading}
        />
        
        <div 
          className="mt-4 rounded-xl p-4 flex items-start gap-3"
          style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)' }}
        >
          <Info size={20} className="text-storage-accent flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-sm mb-1">Backend Selection</h4>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Files are automatically uploaded to the highest priority available backend. 
              Backend configuration is managed server-side via environment variables.
            </p>
          </div>
        </div>
      </section>

      {/* Payment Options */}
      <section>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <CreditCard size={22} />
          Payment Options
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card-static p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <span className="text-xl">Ξ</span>
              </div>
              <div>
                <h3 className="font-medium">ETH</h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Native currency</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Pay for storage using ETH via x402 micropayments
            </p>
          </div>
          
          <div className="card-static p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <span className="text-xl">$</span>
              </div>
              <div>
                <h3 className="font-medium">USDC / ERC-20</h3>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Stablecoins & tokens</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Use ERC-4337 paymaster for multi-token payments
            </p>
          </div>
        </div>
      </section>

      {/* API Integration */}
      <section>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Database size={22} />
          API Integration
        </h2>
        <div className="card-static p-6 space-y-4">
          <div>
            <h3 className="font-medium mb-2">REST API</h3>
            <code 
              className="block p-3 rounded-lg text-sm font-mono break-all"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/api
            </code>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">A2A Endpoint (Agent-to-Agent)</h3>
            <code 
              className="block p-3 rounded-lg text-sm font-mono break-all"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/a2a
            </code>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">Agent Card</h3>
            <a
              href="/.well-known/agent-card.json"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              /.well-known/agent-card.json
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* Service Info */}
      <section>
        <h2 className="text-xl font-bold mb-4">Service Information</h2>
        <div className="card-static p-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Version</p>
              <p className="font-mono">{health?.version ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Service</p>
              <p className="font-mono">{health?.service ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>IPFS Status</p>
              <p className="flex items-center gap-2">
                {health?.ipfs.connected ? (
                  <>
                    <CheckCircle size={16} className="text-storage-success" />
                    <span>Connected</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>Not connected</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>IPFS Peer ID</p>
              <p className="font-mono text-sm truncate" title={health?.ipfs.peerId}>
                {health?.ipfs.peerId?.slice(0, 20) ?? '—'}...
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}






