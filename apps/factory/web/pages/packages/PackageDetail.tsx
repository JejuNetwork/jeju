import { clsx } from 'clsx'
import {
  ArrowLeft,
  Book,
  Calendar,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  Home,
  Package,
  Scale,
  Shield,
  Tag,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, LoadingState } from '../../components/shared'
import {
  type PackageVersion,
  usePackage,
  usePackageVersions,
} from '../../hooks/usePackages'
import {
  formatCompactNumber,
  formatFileSize,
  formatRelativeTime,
} from '../../lib/format'

type TabType = 'readme' | 'versions' | 'dependencies'

export function PackageDetailPage() {
  const { scope, name } = useParams<{ scope: string; name: string }>()
  const [activeTab, setActiveTab] = useState<TabType>('readme')

  // Handle special case where scope is '_' (no scope)
  const actualScope = scope === '_' ? '' : (scope ?? '')
  const { package: pkg, isLoading, error } = usePackage(actualScope, name ?? '')
  const { versions, isLoading: versionsLoading } = usePackageVersions(
    actualScope,
    name ?? '',
  )

  const handleCopyInstall = () => {
    if (!pkg) return
    const packageName = pkg.scope ? `@${pkg.scope}/${pkg.name}` : pkg.name
    navigator.clipboard.writeText(`bun add ${packageName}`)
    toast.success('Install command copied to clipboard')
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading package..." />
      </div>
    )
  }

  if (error || !pkg) {
    return (
      <div className="page-container">
        <Link
          to="/packages"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Packages
        </Link>
        <EmptyState
          icon={Package}
          title="Package not found"
          description="The package you're looking for doesn't exist or has been removed."
          actionLabel="Browse Packages"
          actionHref="/packages"
        />
      </div>
    )
  }

  const packageName = pkg.scope ? `@${pkg.scope}/${pkg.name}` : pkg.name

  const tabs = [
    { id: 'readme' as const, label: 'Readme', icon: Book },
    {
      id: 'versions' as const,
      label: 'Versions',
      icon: History,
      count: versions.length,
    },
    { id: 'dependencies' as const, label: 'Dependencies', icon: Package },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/packages"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Packages
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-surface-100 font-display">
                {packageName}
              </h1>
              <span className="badge badge-info">v{pkg.version}</span>
              {pkg.verified && (
                <span className="badge badge-success">
                  <Shield className="w-3 h-3 mr-1" />
                  Verified
                </span>
              )}
              {pkg.hasTypes && (
                <span className="badge badge-neutral">TypeScript</span>
              )}
              {pkg.deprecated && (
                <span className="badge badge-error">Deprecated</span>
              )}
            </div>
            <p className="text-surface-400 mb-4">
              {pkg.description || 'No description provided'}
            </p>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
              <span className="flex items-center gap-1.5">
                <Download className="w-4 h-4" />
                {formatCompactNumber(pkg.downloads)} downloads
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {formatCompactNumber(pkg.weeklyDownloads)}/week
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Updated {formatRelativeTime(pkg.publishedAt)}
              </span>
            </div>
          </div>

          {/* Install button */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-surface-800/50 rounded-lg p-3 font-mono text-sm">
              <span className="text-surface-400">$</span>
              <span className="text-surface-200">bun add {packageName}</span>
              <button
                type="button"
                onClick={handleCopyInstall}
                className="p-1.5 rounded hover:bg-surface-700 transition-colors ml-2"
                title="Copy install command"
              >
                <Copy className="w-4 h-4 text-surface-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-surface-800/50">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab.id
                    ? 'text-factory-400 border-factory-400'
                    : 'text-surface-400 border-transparent hover:text-surface-100 hover:border-surface-600',
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.count !== undefined && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-surface-800 text-surface-400">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'readme' && <ReadmeTab readme={pkg.readme} />}

          {activeTab === 'versions' && (
            <VersionsTab versions={versions} isLoading={versionsLoading} />
          )}

          {activeTab === 'dependencies' && (
            <DependenciesTab
              dependencies={pkg.dependencies}
              devDependencies={pkg.devDependencies}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="card p-6 animate-in">
            <h3 className="font-semibold text-surface-100 mb-4">
              Package Info
            </h3>
            <dl className="space-y-3">
              {pkg.author && (
                <div className="flex justify-between">
                  <dt className="text-surface-500">Author</dt>
                  <dd className="text-surface-200">{pkg.author}</dd>
                </div>
              )}
              {pkg.license && (
                <div className="flex justify-between items-center">
                  <dt className="text-surface-500 flex items-center gap-1.5">
                    <Scale className="w-4 h-4" />
                    License
                  </dt>
                  <dd className="text-surface-200">{pkg.license}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-surface-500 flex items-center gap-1.5">
                  <Tag className="w-4 h-4" />
                  Versions
                </dt>
                <dd className="text-surface-200">{pkg.versions.length}</dd>
              </div>
            </dl>
          </div>

          {/* Links */}
          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '50ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">Links</h3>
            <ul className="space-y-2">
              {pkg.homepage && (
                <li>
                  <a
                    href={pkg.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-factory-300 transition-colors"
                  >
                    <Home className="w-4 h-4" />
                    Homepage
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </a>
                </li>
              )}
              {pkg.repository && (
                <li>
                  <a
                    href={pkg.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-factory-300 transition-colors"
                  >
                    <GitBranch className="w-4 h-4" />
                    Repository
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Keywords */}
          {pkg.keywords.length > 0 && (
            <div
              className="card p-6 animate-in"
              style={{ animationDelay: '100ms' }}
            >
              <h3 className="font-semibold text-surface-100 mb-4">Keywords</h3>
              <div className="flex flex-wrap gap-2">
                {pkg.keywords.map((keyword) => (
                  <span key={keyword} className="badge badge-neutral">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface ReadmeTabProps {
  readme: string
}

function ReadmeTab({ readme }: ReadmeTabProps) {
  if (!readme) {
    return (
      <div className="card p-8 animate-in text-center">
        <FileText className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No README Found
        </h3>
        <p className="text-surface-500">
          This package does not have a README file.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-6 animate-in">
      <div className="prose prose-invert max-w-none prose-sm">
        <pre className="whitespace-pre-wrap text-surface-300 bg-surface-800/50 p-4 rounded-lg text-sm">
          {readme}
        </pre>
      </div>
    </div>
  )
}

interface VersionsTabProps {
  versions: PackageVersion[]
  isLoading: boolean
}

function VersionsTab({ versions, isLoading }: VersionsTabProps) {
  if (isLoading) {
    return (
      <div className="card p-8 animate-in">
        <LoadingState text="Loading versions..." />
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <History className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No Versions Found
        </h3>
        <p className="text-surface-500">
          No version history available for this package.
        </p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden animate-in">
      <div className="divide-y divide-surface-800/50">
        {versions.map((version, idx) => (
          <div
            key={version.version}
            className="flex items-center gap-4 px-4 py-4 animate-slide-up"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-surface-200">
                  v{version.version}
                </span>
                {idx === 0 && (
                  <span className="badge badge-success text-xs">latest</span>
                )}
                {version.deprecated && (
                  <span className="badge badge-error text-xs">deprecated</span>
                )}
              </div>
              <p className="text-sm text-surface-500">
                Published {formatRelativeTime(version.publishedAt)}
              </p>
            </div>
            <span className="text-sm text-surface-500">
              {formatFileSize(version.size)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface DependenciesTabProps {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

function DependenciesTab({
  dependencies,
  devDependencies,
}: DependenciesTabProps) {
  const depEntries = Object.entries(dependencies)
  const devDepEntries = Object.entries(devDependencies)

  if (depEntries.length === 0 && devDepEntries.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <Package className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No Dependencies
        </h3>
        <p className="text-surface-500">This package has no dependencies.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {depEntries.length > 0 && (
        <div className="card overflow-hidden animate-in">
          <div className="px-4 py-3 bg-surface-800/50 border-b border-surface-800/50">
            <h4 className="font-medium text-surface-200">
              Dependencies ({depEntries.length})
            </h4>
          </div>
          <div className="divide-y divide-surface-800/50">
            {depEntries.map(([name, version]) => (
              <div
                key={name}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-factory-400">{name}</span>
                <span className="text-surface-500 font-mono text-sm">
                  {version}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {devDepEntries.length > 0 && (
        <div
          className="card overflow-hidden animate-in"
          style={{ animationDelay: '50ms' }}
        >
          <div className="px-4 py-3 bg-surface-800/50 border-b border-surface-800/50">
            <h4 className="font-medium text-surface-200">
              Dev Dependencies ({devDepEntries.length})
            </h4>
          </div>
          <div className="divide-y divide-surface-800/50">
            {devDepEntries.map(([name, version]) => (
              <div
                key={name}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-surface-400">{name}</span>
                <span className="text-surface-500 font-mono text-sm">
                  {version}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
