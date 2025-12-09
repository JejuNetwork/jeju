'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Upload, FolderOpen, ArrowRight, Server, Zap } from 'lucide-react'
import { StatsCard } from '@/src/components/StatsCard'
import { BackendStatus } from '@/src/components/BackendStatus'
import { UploadZone } from '@/src/components/UploadZone'
import { fetchHealth, fetchStats, fetchPins, type HealthResponse, type StorageStats, type Pin } from '@/src/config/api'
import { FileCard } from '@/src/components/FileCard'

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [recentPins, setRecentPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    const [healthData, statsData, pinsData] = await Promise.all([
      fetchHealth().catch(() => null),
      fetchStats().catch(() => null),
      fetchPins({ limit: 4 }).catch(() => ({ results: [] })),
    ])
    
    setHealth(healthData)
    setStats(statsData)
    setRecentPins(pinsData.results)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleUploadComplete = () => {
    loadData()
  }

  return (
    <div className="space-y-6 sm:space-y-8 md:space-y-12">
      {/* Hero Section */}
      <section className="text-center py-6 sm:py-10 md:py-16 lg:py-20">
        <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full mb-4 sm:mb-6"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          <div className="w-2 h-2 rounded-full bg-storage-success animate-pulse" />
          <span className="text-xs sm:text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {health?.status === 'healthy' ? 'All systems operational' : 'Connecting...'}
          </span>
        </div>
        
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold mb-4 sm:mb-6 md:mb-8 tracking-tight px-2">
          <span className="text-gradient">Decentralized</span>{' '}
          <span className="block sm:inline">File Storage</span>
        </h1>
        
        <p className="text-base sm:text-lg md:text-xl lg:text-2xl max-w-3xl mx-auto mb-6 sm:mb-8 md:mb-10 px-4" style={{ color: 'var(--text-secondary)' }}>
          Upload and store files across IPFS, cloud, and permanent storage.
          <span className="block mt-1">Pay with crypto. No logins required.</span>
        </p>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 px-4 sm:px-0">
          <Link href="/upload" className="btn-primary flex items-center gap-2 justify-center text-base">
            <Upload size={20} />
            Upload Files
          </Link>
          <Link href="/files" className="btn-secondary flex items-center gap-2 justify-center text-base">
            <FolderOpen size={20} />
            Browse Files
          </Link>
        </div>
      </section>

      {/* Quick Stats */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          <StatsCard
            icon="files"
            label="Total Files"
            value={stats?.totalPins ?? '—'}
            subValue="Pinned content"
          />
          <StatsCard
            icon="storage"
            label="Storage Used"
            value={stats ? `${stats.totalSizeGB.toFixed(2)} GB` : '—'}
            subValue={`${stats?.totalSizeBytes.toLocaleString() ?? 0} bytes`}
          />
          <StatsCard
            icon="backends"
            label="Active Backends"
            value={health?.backends.available.length ?? '—'}
            subValue="Storage providers"
          />
          <StatsCard
            icon="speed"
            label="Price"
            value={`$${stats?.pricePerGBMonth ?? '0.10'}`}
            subValue="per GB/month"
          />
        </div>
      </section>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">
        {/* Quick Upload */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold">Quick Upload</h2>
          </div>
          <UploadZone onUploadComplete={handleUploadComplete} />
        </div>

        {/* Backend Status */}
        <div>
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold">Backends</h2>
            <Link 
              href="/settings" 
              className="link-primary text-sm"
            >
              Configure <ArrowRight size={14} />
            </Link>
          </div>
          <BackendStatus
            backends={health?.backends.available ?? []}
            health={health?.backends.health ?? {}}
            loading={loading}
          />
        </div>
      </div>

      {/* Recent Files */}
      {recentPins.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold">Recent Files</h2>
            <Link href="/files" className="link-primary text-sm">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
            {recentPins.map((pin) => (
              <FileCard key={pin.requestId} pin={pin} onDelete={loadData} />
            ))}
          </div>
        </section>
      )}

      {/* Features */}
      <section className="py-6 sm:py-8 md:py-12 lg:py-16">
        <div className="text-center mb-6 sm:mb-8 md:mb-12">
          <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3">
            Why Use Jeju Storage?
          </h2>
          <p className="text-sm sm:text-base md:text-lg max-w-2xl mx-auto px-4" style={{ color: 'var(--text-secondary)' }}>
            Built for the decentralized web, powered by multiple storage providers
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6 lg:gap-8">
          {[
            {
              icon: '🔐',
              title: 'Permissionless',
              description: 'No API keys, no logins. Just connect your wallet and start uploading.',
            },
            {
              icon: '🌐',
              title: 'Multi-Provider',
              description: 'Automatic routing across IPFS, cloud storage, and Arweave for optimal performance.',
            },
            {
              icon: '💰',
              title: 'Pay with Crypto',
              description: 'Use ETH, USDC, or any supported token via x402 micropayments.',
            },
            {
              icon: '🤖',
              title: 'AI-Ready',
              description: 'A2A and MCP integration for seamless AI agent file access.',
            },
            {
              icon: '⚡',
              title: 'Fast & Global',
              description: 'CDN-backed cloud storage with IPFS redundancy for speed and reliability.',
            },
            {
              icon: '♾️',
              title: 'Permanent Option',
              description: 'Store forever on Arweave with one-time payment.',
            },
          ].map((feature) => (
            <div key={feature.title} className="card-static p-5 sm:p-6 md:p-8 text-center group active:scale-[0.98] transition-all duration-300">
              <div className="text-3xl sm:text-4xl md:text-5xl mb-3 sm:mb-4 md:mb-5 group-hover:scale-110 transition-transform duration-300">{feature.icon}</div>
              <h3 className="text-base sm:text-lg md:text-xl font-bold mb-2 sm:mb-3">{feature.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

