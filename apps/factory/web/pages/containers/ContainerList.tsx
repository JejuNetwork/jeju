import { Box, Download, HardDrive, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../../components/shared'
import {
  useContainerImages,
  useContainerStats,
} from '../../hooks/useContainers'
import { formatCompactNumber, formatRelativeTime } from '../../lib/format'

export function ContainerListPage() {
  const [search, setSearch] = useState('')
  const { images, isLoading, error } = useContainerImages({
    search: search || undefined,
  })
  const { stats, isLoading: statsLoading } = useContainerStats()

  const statsData = useMemo(
    () => [
      {
        label: 'Total Images',
        value: stats.totalImages.toString(),
        color: 'text-factory-400',
        loading: statsLoading,
      },
      {
        label: 'Running',
        value: stats.runningContainers.toString(),
        color: 'text-success-400',
        loading: statsLoading,
      },
      {
        label: 'Total Pulls',
        value: formatCompactNumber(stats.totalPulls),
        color: 'text-info-400',
        loading: statsLoading,
      },
      {
        label: 'Storage',
        value: stats.totalStorage,
        color: 'text-accent-400',
        loading: statsLoading,
      },
    ],
    [stats, statsLoading],
  )

  return (
    <div className="page-container">
      <PageHeader
        title="Containers"
        icon={Box}
        iconColor="text-factory-400"
        action={
          <Link to="/containers/push" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Push</span> Image
          </Link>
        }
      />

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search containers..."
      />

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading containers..." />
      ) : error ? (
        <ErrorState title="Failed to load containers" />
      ) : images.length === 0 ? (
        <EmptyState
          icon={Box}
          title="No container images found"
          description={
            search
              ? 'Try a different search term'
              : 'Push an image to the registry'
          }
          actionLabel="Push Image"
          actionHref="/containers/push"
        />
      ) : (
        <div className="space-y-4">
          {images.map((image, index) => (
            <Link
              key={image.id}
              to={`/containers/${encodeURIComponent(image.name)}/${image.tag}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <h3 className="font-semibold text-surface-100">
                      {image.name}
                    </h3>
                    <span className="text-surface-500 text-sm">
                      :{image.tag}
                    </span>
                    {image.isPublic && (
                      <span className="badge badge-info">Public</span>
                    )}
                  </div>
                  <p className="text-surface-400 text-sm line-clamp-2 mb-3">
                    {image.description ?? 'No description provided'}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4" aria-hidden="true" />
                      {image.size}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Download className="w-4 h-4" aria-hidden="true" />
                      {formatCompactNumber(image.pulls)} pulls
                    </span>
                    <span className="font-mono text-xs">
                      {image.digest.slice(0, 12)}...
                    </span>
                  </div>
                </div>
                <div className="text-left sm:text-right flex-shrink-0">
                  <p className="text-surface-500 text-sm">
                    Pushed {formatRelativeTime(image.createdAt)}
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
