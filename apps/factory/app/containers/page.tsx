'use client'

import { clsx } from 'clsx'
import {
  Check,
  Clock,
  Container,
  Copy,
  Download,
  Globe,
  HardDrive,
  Layers,
  Lock,
  Plus,
  Search,
  Shield,
  Star,
  Tag,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

type ContainerFilter = 'all' | 'public' | 'private' | 'official'

const mockContainers = [
  {
    name: 'jeju/guardian-node',
    description:
      'Official Guardian node for Jeju Network - validates bounties and reviews submissions.',
    pulls: 125400,
    stars: 342,
    lastPush: Date.now() - 1 * 24 * 60 * 60 * 1000,
    tags: ['latest', 'v2.1.0', 'v2.0.5', 'beta'],
    size: '245 MB',
    isOfficial: true,
    isPrivate: false,
    os: 'linux',
    arch: ['amd64', 'arm64'],
  },
  {
    name: 'jeju/model-inference',
    description:
      'Inference server for Jeju Model Hub - supports transformers, GGUF, and ONNX models.',
    pulls: 89200,
    stars: 256,
    lastPush: Date.now() - 3 * 24 * 60 * 60 * 1000,
    tags: ['latest', 'v1.8.0', 'cuda-12.1', 'cpu-only'],
    size: '4.2 GB',
    isOfficial: true,
    isPrivate: false,
    os: 'linux',
    arch: ['amd64'],
  },
  {
    name: 'jeju/psyche-trainer',
    description:
      'Distributed training container for Psyche network integration.',
    pulls: 45800,
    stars: 189,
    lastPush: Date.now() - 7 * 24 * 60 * 60 * 1000,
    tags: ['latest', 'v0.9.0', 'nightly'],
    size: '8.1 GB',
    isOfficial: true,
    isPrivate: false,
    os: 'linux',
    arch: ['amd64'],
  },
  {
    name: 'alice/custom-validator',
    description:
      'Custom validation container with specialized ML checks for code quality.',
    pulls: 12300,
    stars: 67,
    lastPush: Date.now() - 14 * 24 * 60 * 60 * 1000,
    tags: ['latest', 'v1.2.0'],
    size: '890 MB',
    isOfficial: false,
    isPrivate: false,
    os: 'linux',
    arch: ['amd64', 'arm64'],
  },
  {
    name: 'bob/private-runner',
    description: 'Private CI runner with custom toolchain.',
    pulls: 2450,
    stars: 12,
    lastPush: Date.now() - 2 * 24 * 60 * 60 * 1000,
    tags: ['latest'],
    size: '1.5 GB',
    isOfficial: false,
    isPrivate: true,
    os: 'linux',
    arch: ['amd64'],
  },
]

export default function ContainersPage() {
  const [filter, setFilter] = useState<ContainerFilter>('all')
  const [search, setSearch] = useState('')
  const [copiedImage, setCopiedImage] = useState<string | null>(null)

  const filteredContainers = mockContainers.filter((container) => {
    if (filter === 'public' && container.isPrivate) return false
    if (filter === 'private' && !container.isPrivate) return false
    if (filter === 'official' && !container.isOfficial) return false
    if (
      search &&
      !container.name.toLowerCase().includes(search.toLowerCase()) &&
      !container.description.toLowerCase().includes(search.toLowerCase())
    )
      return false
    return true
  })

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return n.toString()
  }

  const formatDate = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    return `${Math.floor(days / 7)} weeks ago`
  }

  const copyPull = (name: string) => {
    navigator.clipboard.writeText(
      `docker pull registry.jejunetwork.org/${name}`,
    )
    setCopiedImage(name)
    setTimeout(() => setCopiedImage(null), 2000)
  }

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Container className="w-7 h-7 text-cyan-400" />
            Container Registry
          </h1>
          <p className="text-factory-400 mt-1">
            Decentralized container images on Jeju
          </p>
        </div>
        <Link href="/containers/push" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Push Image
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search containers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'public', 'private', 'official'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filter === f
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Images',
            value: '847',
            icon: Container,
            color: 'text-cyan-400',
          },
          {
            label: 'Total Pulls',
            value: '2.3M',
            icon: Download,
            color: 'text-green-400',
          },
          {
            label: 'Storage Used',
            value: '4.8 TB',
            icon: HardDrive,
            color: 'text-purple-400',
          },
          {
            label: 'Official Images',
            value: '24',
            icon: Shield,
            color: 'text-amber-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={clsx('w-8 h-8', stat.color)} />
              <div>
                <p className="text-2xl font-bold text-factory-100">
                  {stat.value}
                </p>
                <p className="text-factory-500 text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Container List */}
      <div className="space-y-4">
        {filteredContainers.map((container) => (
          <div key={container.name} className="card p-6 card-hover">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Container name & badges */}
                <div className="flex items-center gap-3 mb-2">
                  <Link
                    href={`/containers/${container.name}`}
                    className="font-semibold text-lg text-accent-400 hover:underline font-mono"
                  >
                    {container.name}
                  </Link>
                  {container.isOfficial && (
                    <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      <Shield className="w-3 h-3 mr-1" />
                      Official
                    </span>
                  )}
                  <span
                    className={clsx(
                      'badge',
                      container.isPrivate
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-factory-700/50 text-factory-400 border border-factory-600',
                    )}
                  >
                    {container.isPrivate ? (
                      <>
                        <Lock className="w-3 h-3 mr-1" /> Private
                      </>
                    ) : (
                      <>
                        <Globe className="w-3 h-3 mr-1" /> Public
                      </>
                    )}
                  </span>
                </div>

                {/* Description */}
                <p className="text-factory-400 text-sm mb-3">
                  {container.description}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {container.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="badge bg-factory-700/50 text-factory-300 border border-factory-600 font-mono text-xs"
                    >
                      <Tag className="w-3 h-3 mr-1" />
                      {tag}
                    </span>
                  ))}
                  {container.tags.length > 4 && (
                    <span className="badge bg-factory-700/50 text-factory-500 border border-factory-600 text-xs">
                      +{container.tags.length - 4} more
                    </span>
                  )}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-5 text-sm text-factory-500">
                  <span className="flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    {formatNumber(container.pulls)} pulls
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4" />
                    {container.stars}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-4 h-4" />
                    {container.size}
                  </span>
                  <span className="flex items-center gap-1">
                    <Layers className="w-4 h-4" />
                    {container.arch.join(', ')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {formatDate(container.lastPush)}
                  </span>
                </div>
              </div>

              {/* Pull command */}
              <button
                className="btn btn-secondary text-sm font-mono"
                onClick={() => copyPull(container.name)}
              >
                {copiedImage === container.name ? (
                  <>
                    <Check className="w-4 h-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> docker pull
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredContainers.length === 0 && (
        <div className="card p-12 text-center">
          <Container className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No containers found
          </h3>
          <p className="text-factory-500 mb-4">
            Try adjusting your filters or push a new image
          </p>
          <Link href="/containers/push" className="btn btn-primary">
            Push Image
          </Link>
        </div>
      )}
    </div>
  )
}
