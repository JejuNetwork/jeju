import { clsx } from 'clsx'
import {
  ArrowLeft,
  Box,
  Copy,
  Cpu,
  Download,
  HardDrive,
  History,
  Layers,
  Play,
  Settings,
  Square,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import {
  type ContainerInstance,
  useContainerImages,
  useContainerInstances,
  useStopContainer,
} from '../../hooks/useContainers'
import { formatCompactNumber, formatRelativeTime } from '../../lib/format'

type TabType = 'overview' | 'tags' | 'instances'

export function ContainerDetailPage() {
  const { name, tag } = useParams<{ name: string; tag: string }>()
  // Wallet connection for future features
  useAccount()

  const [activeTab, setActiveTab] = useState<TabType>('overview')

  const decodedName = decodeURIComponent(name ?? '')
  const { images, isLoading } = useContainerImages()
  const { instances, isLoading: instancesLoading } = useContainerInstances()

  // Find the specific image
  const image = images.find(
    (img) => img.name === decodedName && img.tag === tag,
  )
  // Find all tags for this image
  const allTags = images.filter((img) => img.name === decodedName)
  // Find instances for this image
  const imageInstances = instances.filter((inst) =>
    inst.image.startsWith(`${decodedName}:`),
  )

  const handleCopyPull = () => {
    const pullCommand = `docker pull registry.jeju.network/${decodedName}:${tag}`
    navigator.clipboard.writeText(pullCommand)
    toast.success('Pull command copied to clipboard')
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading container..." />
      </div>
    )
  }

  if (!image) {
    return (
      <div className="page-container">
        <Link
          to="/containers"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Containers
        </Link>
        <EmptyState
          icon={Box}
          title="Container not found"
          description="The container image you're looking for doesn't exist or has been removed."
          actionLabel="Browse Containers"
          actionHref="/containers"
        />
      </div>
    )
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Box },
    {
      id: 'tags' as const,
      label: 'Tags',
      icon: History,
      count: allTags.length,
    },
    {
      id: 'instances' as const,
      label: 'Instances',
      icon: Play,
      count: imageInstances.length,
    },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/containers"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Containers
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-surface-100 font-display">
                {decodedName}
              </h1>
              <span className="badge badge-info">:{tag}</span>
              {image.isPublic && (
                <span className="badge badge-success">Public</span>
              )}
            </div>
            <p className="text-surface-400 mb-4">
              {image.description || 'No description provided'}
            </p>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-4 h-4" />
                {image.size}
              </span>
              <span className="flex items-center gap-1.5">
                <Download className="w-4 h-4" />
                {formatCompactNumber(image.pulls)} pulls
              </span>
              <span className="flex items-center gap-1.5 font-mono text-xs">
                {image.digest.slice(0, 16)}...
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-surface-800/50 rounded-lg p-3 font-mono text-xs">
              <span className="text-surface-400">$</span>
              <span className="text-surface-200 truncate">
                docker pull registry.jeju.network/{decodedName}:{tag}
              </span>
              <button
                type="button"
                onClick={handleCopyPull}
                className="p-1.5 rounded hover:bg-surface-700 transition-colors ml-2 flex-shrink-0"
                title="Copy pull command"
              >
                <Copy className="w-4 h-4 text-surface-400" />
              </button>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={Play}
              onClick={() => toast.info('Container deployment coming soon')}
            >
              Deploy Container
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-800/50 mb-6">
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

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab image={image} />}

      {activeTab === 'tags' && (
        <TagsTab tags={allTags} currentTag={tag ?? ''} />
      )}

      {activeTab === 'instances' && (
        <InstancesTab instances={imageInstances} isLoading={instancesLoading} />
      )}
    </div>
  )
}

interface OverviewTabProps {
  image: {
    digest: string
    size: string
    createdAt: number
    pulls: number
  }
}

function OverviewTab({ image }: OverviewTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Image Details */}
      <div className="card p-6 animate-in">
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-surface-400" />
          Image Details
        </h3>
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-surface-500">Digest</dt>
            <dd className="text-surface-200 font-mono text-sm truncate max-w-[200px]">
              {image.digest}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Size</dt>
            <dd className="text-surface-200">{image.size}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Created</dt>
            <dd className="text-surface-200">
              {formatRelativeTime(image.createdAt)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Total Pulls</dt>
            <dd className="text-surface-200">
              {formatCompactNumber(image.pulls)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Quick Actions */}
      <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-surface-400" />
          Quick Actions
        </h3>
        <div className="space-y-3">
          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={Play}
            onClick={() => toast.info('Run container coming soon')}
          >
            Run Container
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={Settings}
            onClick={() => toast.info('Configure deployment coming soon')}
          >
            Configure Deployment
          </Button>
          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={Cpu}
            onClick={() => toast.info('View layers coming soon')}
          >
            View Image Layers
          </Button>
        </div>
      </div>
    </div>
  )
}

interface TagsTabProps {
  tags: Array<{
    id: string
    tag: string
    size: string
    createdAt: number
    pulls: number
  }>
  currentTag: string
}

function TagsTab({ tags, currentTag }: TagsTabProps) {
  if (tags.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <History className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No Tags Found
        </h3>
        <p className="text-surface-500">
          No other tags available for this image.
        </p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden animate-in">
      <div className="divide-y divide-surface-800/50">
        {tags.map((tagInfo, idx) => (
          <Link
            key={tagInfo.id}
            to={`/containers/${encodeURIComponent(tagInfo.tag.split(':')[0] ?? '')}/${tagInfo.tag}`}
            className={clsx(
              'flex items-center gap-4 px-4 py-4 hover:bg-surface-800/30 transition-colors animate-slide-up',
              tagInfo.tag === currentTag && 'bg-surface-800/20',
            )}
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-surface-200">
                  :{tagInfo.tag}
                </span>
                {tagInfo.tag === currentTag && (
                  <span className="badge badge-success text-xs">current</span>
                )}
                {tagInfo.tag === 'latest' && (
                  <span className="badge badge-info text-xs">latest</span>
                )}
              </div>
              <p className="text-sm text-surface-500">
                Pushed {formatRelativeTime(tagInfo.createdAt)}
              </p>
            </div>
            <span className="text-sm text-surface-500">{tagInfo.size}</span>
            <span className="text-sm text-surface-500">
              {formatCompactNumber(tagInfo.pulls)} pulls
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

interface InstancesTabProps {
  instances: ContainerInstance[]
  isLoading: boolean
}

function InstancesTab({ instances, isLoading }: InstancesTabProps) {
  const stopMutation = useStopContainer()

  const handleStop = async (instanceId: string) => {
    try {
      await stopMutation.mutateAsync(instanceId)
      toast.success('Container stopped')
    } catch {
      toast.error('Failed to stop container')
    }
  }

  if (isLoading) {
    return (
      <div className="card p-8 animate-in">
        <LoadingState text="Loading instances..." />
      </div>
    )
  }

  if (instances.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <Box className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No Running Instances
        </h3>
        <p className="text-surface-500 mb-4">
          No instances of this container are currently running.
        </p>
        <Button
          variant="primary"
          icon={Play}
          onClick={() => toast.info('Container deployment coming soon')}
        >
          Deploy New Instance
        </Button>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    running: 'badge-success',
    stopped: 'badge-neutral',
    building: 'badge-warning',
    failed: 'badge-error',
  }

  return (
    <div className="card overflow-hidden animate-in">
      <div className="divide-y divide-surface-800/50">
        {instances.map((instance, idx) => (
          <div
            key={instance.id}
            className="flex flex-col sm:flex-row sm:items-center gap-4 px-4 py-4 animate-slide-up"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-surface-200">
                  {instance.name}
                </span>
                <span className={clsx('badge', statusColors[instance.status])}>
                  {instance.status}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-surface-500">
                <span>{instance.cpu} CPU</span>
                <span>{instance.memory} RAM</span>
                {instance.gpu && <span>{instance.gpu}</span>}
                {instance.endpoint && (
                  <a
                    href={instance.endpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-factory-400 hover:text-factory-300"
                  >
                    {instance.endpoint}
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-surface-500">
                {instance.cost}/hr
              </span>
              {instance.status === 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Square}
                  onClick={() => handleStop(instance.id)}
                  loading={stopMutation.isPending}
                >
                  Stop
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
