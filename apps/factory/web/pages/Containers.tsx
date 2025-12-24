import { clsx } from 'clsx'
import { Box, Download, HardDrive, Loader2, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useContainerImages, useContainerStats } from '../hooks/useContainers'

export function ContainersPage() {
  const [search, setSearch] = useState('')
  const { images, isLoading, error } = useContainerImages({
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useContainerStats()

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

  const formatPulls = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
    return count.toString()
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Box className="w-7 h-7 text-cyan-400" />
            Containers
          </h1>
          <p className="text-factory-400 mt-1">
            Container registry for the Jeju ecosystem
          </p>
        </div>
        <Link to="/containers/push" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Push Image
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input
            type="text"
            placeholder="Search containers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Images',
            value: stats.totalImages.toString(),
            color: 'text-cyan-400',
          },
          {
            label: 'Running',
            value: stats.runningContainers.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Total Pulls',
            value: formatPulls(stats.totalPulls),
            color: 'text-blue-400',
          },
          {
            label: 'Storage',
            value: stats.totalStorage,
            color: 'text-purple-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {statsLoading ? (
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
          <Box className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load containers
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : images.length === 0 ? (
        <div className="card p-12 text-center">
          <Box className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No container images found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Push your first container image'}
          </p>
          <Link to="/containers/push" className="btn btn-primary">
            Push Image
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {images.map((image) => (
            <Link
              key={image.id}
              to={`/containers/${image.name}/${image.tag}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-factory-100">
                      {image.name}
                    </h3>
                    <span className="text-factory-500 text-sm">
                      :{image.tag}
                    </span>
                    {image.isPublic && (
                      <span className="badge badge-info">Public</span>
                    )}
                  </div>
                  <p className="text-factory-400 text-sm line-clamp-2 mb-3">
                    {image.description || 'No description provided'}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-factory-500">
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-4 h-4" />
                      {image.size}
                    </span>
                    <span className="flex items-center gap-1">
                      <Download className="w-4 h-4" />
                      {formatPulls(image.pulls)} pulls
                    </span>
                    <span className="font-mono text-xs">
                      {image.digest.slice(0, 12)}...
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-factory-500 text-sm">
                    Pushed {formatDate(image.createdAt)}
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
