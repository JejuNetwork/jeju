import { clsx } from 'clsx'
import { Download, Loader2, Package, Plus, Search, Shield } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePackages } from '../hooks/usePackages'

export function PackagesPage() {
  const [search, setSearch] = useState('')
  const { packages, isLoading, error } = usePackages({
    search: search || undefined,
  })

  const formatDownloads = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
    return count.toString()
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  const stats = [
    {
      label: 'Total Packages',
      value: packages.length.toString(),
      color: 'text-blue-400',
    },
    {
      label: 'Total Downloads',
      value: formatDownloads(packages.reduce((sum, p) => sum + p.downloads, 0)),
      color: 'text-green-400',
    },
    {
      label: 'Verified',
      value: packages.filter((p) => p.verified).length.toString(),
      color: 'text-purple-400',
    },
  ]

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Package className="w-7 h-7 text-blue-400" />
            Packages
          </h1>
          <p className="text-factory-400 mt-1">
            Decentralized package registry
          </p>
        </div>
        <Link to="/packages/publish" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Publish Package
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search packages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-factory-500" />
            ) : (
              <p className={clsx('text-2xl font-bold', stat.color)}>
                {stat.value}
              </p>
            )}
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
        </div>
      ) : error ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load packages
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : packages.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No packages found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Be the first to publish a package'}
          </p>
          <Link to="/packages/publish" className="btn btn-primary">
            Publish Package
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {packages.map((pkg) => (
            <Link
              key={pkg.name}
              to={`/packages/${pkg.scope}/${pkg.name}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-factory-100">
                      {pkg.scope ? `@${pkg.scope}/` : ''}
                      {pkg.name}
                    </h3>
                    <span className="text-factory-500 text-sm">
                      v{pkg.version}
                    </span>
                    {pkg.verified && (
                      <span className="flex items-center gap-1 text-green-400 text-sm">
                        <Shield className="w-4 h-4" />
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-factory-400 text-sm line-clamp-2">
                    {pkg.description ?? 'No description provided'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 text-factory-300">
                    <Download className="w-4 h-4" />
                    <span className="font-medium">
                      {formatDownloads(pkg.downloads)}
                    </span>
                  </div>
                  <p className="text-factory-500 text-sm mt-1">
                    Updated {formatDate(pkg.updatedAt)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
