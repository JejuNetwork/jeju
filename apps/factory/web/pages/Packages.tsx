/**
 * Packages Page
 *
 * Browse and search packages with responsive design.
 */

import { Download, Package, Plus, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../components/shared'
import { usePackages } from '../hooks/usePackages'
import { formatCompactNumber, formatRelativeTime } from '../lib/format'

export function PackagesPage() {
  const [search, setSearch] = useState('')
  const { packages, isLoading, error } = usePackages({
    search: search || undefined,
  })

  const statsData = useMemo(
    () => [
      {
        label: 'Total Packages',
        value: packages.length.toString(),
        color: 'text-info-400',
        loading: isLoading,
      },
      {
        label: 'Total Downloads',
        value: formatCompactNumber(
          packages.reduce((sum, p) => sum + p.downloads, 0),
        ),
        color: 'text-success-400',
        loading: isLoading,
      },
      {
        label: 'Verified',
        value: packages.filter((p) => p.verified).length.toString(),
        color: 'text-accent-400',
        loading: isLoading,
      },
    ],
    [packages, isLoading],
  )

  return (
    <div className="page-container">
      <PageHeader
        title="Packages"
        icon={Package}
        iconColor="text-info-400"
        action={
          <Link to="/packages/publish" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Publish</span> Package
          </Link>
        }
      />

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search packages..."
      />

      <StatsGrid stats={statsData} columns={3} />

      {isLoading ? (
        <LoadingState text="Loading packages..." />
      ) : error ? (
        <ErrorState title="Failed to load packages" />
      ) : packages.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No packages found"
          description={
            search
              ? 'Try a different search term'
              : 'Publish a package to share your code'
          }
          actionLabel="Publish Package"
          actionHref="/packages/publish"
        />
      ) : (
        <div className="space-y-4">
          {packages.map((pkg, index) => (
            <Link
              key={pkg.name}
              to={`/packages/${pkg.scope}/${pkg.name}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                    <h3 className="font-semibold text-surface-100">
                      {pkg.scope ? `@${pkg.scope}/` : ''}
                      {pkg.name}
                    </h3>
                    <span className="text-surface-500 text-sm">
                      v{pkg.version}
                    </span>
                    {pkg.verified && (
                      <span className="flex items-center gap-1.5 text-success-400 text-sm">
                        <Shield className="w-4 h-4" aria-hidden="true" />
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-surface-400 text-sm line-clamp-2">
                    {pkg.description ?? 'No description provided'}
                  </p>
                </div>
                <div className="text-left sm:text-right flex-shrink-0">
                  <div className="flex items-center gap-1.5 text-surface-300">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span className="font-medium">
                      {formatCompactNumber(pkg.downloads)}
                    </span>
                  </div>
                  <p className="text-surface-500 text-sm mt-1">
                    Updated {formatRelativeTime(pkg.updatedAt)}
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
