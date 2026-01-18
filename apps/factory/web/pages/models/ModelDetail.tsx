import { clsx } from 'clsx'
import {
  ArrowLeft,
  Book,
  Cpu,
  Download,
  File,
  FileText,
  GitFork,
  History,
  Layers,
  Play,
  Scale,
  Send,
  Shield,
  Sparkles,
  Star,
  Tag,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import {
  type ModelFile,
  type ModelVersion,
  useInference,
  useModel,
  useModelVersions,
  useStarModel,
} from '../../hooks/useModels'
import { formatCompactNumber, formatRelativeTime } from '../../lib/format'

type TabType = 'model' | 'files' | 'versions' | 'inference'

const typeLabels: Record<string, string> = {
  llm: 'Large Language Model',
  vision: 'Vision Model',
  audio: 'Audio Model',
  embedding: 'Embedding Model',
  multimodal: 'Multimodal Model',
}

export function ModelDetailPage() {
  const { org, name } = useParams<{ org: string; name: string }>()
  const { isConnected } = useAccount()

  const [activeTab, setActiveTab] = useState<TabType>('model')

  const { model, isLoading, error } = useModel(org ?? '', name ?? '')
  const { versions, isLoading: versionsLoading } = useModelVersions(
    org ?? '',
    name ?? '',
  )
  const starMutation = useStarModel()

  const handleStar = async () => {
    if (!isConnected) {
      toast.error('Connect your wallet to star models')
      return
    }
    try {
      await starMutation.mutateAsync({ org: org ?? '', name: name ?? '' })
      toast.success('Model starred')
    } catch {
      toast.error('Failed to star model')
    }
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading model..." />
      </div>
    )
  }

  if (error || !model) {
    return (
      <div className="page-container">
        <Link
          to="/models"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Models
        </Link>
        <EmptyState
          icon={Sparkles}
          title="Model not found"
          description="The model you're looking for doesn't exist or has been removed."
          actionLabel="Browse Models"
          actionHref="/models"
        />
      </div>
    )
  }

  const tabs = [
    { id: 'model' as const, label: 'Model Card', icon: Book },
    {
      id: 'files' as const,
      label: 'Files',
      icon: File,
      count: model.files.length,
    },
    {
      id: 'versions' as const,
      label: 'Versions',
      icon: History,
      count: versions.length,
    },
    ...(model.hasInference
      ? [{ id: 'inference' as const, label: 'Inference', icon: Play }]
      : []),
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/models"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Models
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-surface-100 font-display">
                {model.organization}/{model.name}
              </h1>
              <span className="badge badge-info">
                {typeLabels[model.type] ?? model.type}
              </span>
              {model.isVerified && (
                <span className="badge badge-success">
                  <Shield className="w-3 h-3 mr-1" />
                  Verified
                </span>
              )}
              {model.hasInference && (
                <span className="badge badge-accent">
                  <Play className="w-3 h-3 mr-1" />
                  Inference Ready
                </span>
              )}
            </div>
            <p className="text-surface-400 mb-4">
              {model.description || 'No description provided'}
            </p>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-surface-500">
              <span className="flex items-center gap-1.5">
                <Download className="w-4 h-4" />
                {formatCompactNumber(model.downloads)} downloads
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="w-4 h-4" />
                {formatCompactNumber(model.stars)} stars
              </span>
              <span className="flex items-center gap-1.5">
                <GitFork className="w-4 h-4" />
                {formatCompactNumber(model.forks)} forks
              </span>
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4" />
                {model.parameters}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon={Star}
              onClick={handleStar}
              loading={starMutation.isPending}
            >
              Star
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Download}
              onClick={() => {
                const url = `https://models.jejunetwork.org/${org}/${name}/download`
                window.open(url, '_blank')
              }}
            >
              Download
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

      {/* Two-column layout for model card */}
      {activeTab === 'model' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            <ModelCardTab readme={model.readme} tags={model.tags} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <ModelMetadataSidebar model={model} />
          </div>
        </div>
      )}

      {activeTab === 'files' && <FilesTab files={model.files} />}

      {activeTab === 'versions' && (
        <VersionsTab versions={versions} isLoading={versionsLoading} />
      )}

      {activeTab === 'inference' && model.hasInference && (
        <InferenceTab org={org ?? ''} name={name ?? ''} />
      )}
    </div>
  )
}

interface ModelCardTabProps {
  readme: string
  tags: string[]
}

function ModelCardTab({ readme, tags }: ModelCardTabProps) {
  return (
    <div className="space-y-6">
      {tags.length > 0 && (
        <div className="card p-6 animate-in">
          <h3 className="font-semibold text-surface-100 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-surface-400" />
            Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="badge badge-neutral">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
        <h3 className="text-lg font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-surface-400" />
          Model Card
        </h3>
        {readme ? (
          <div className="prose prose-invert max-w-none prose-sm">
            <pre className="whitespace-pre-wrap text-surface-300 bg-surface-800/50 p-4 rounded-lg text-sm">
              {readme}
            </pre>
          </div>
        ) : (
          <p className="text-surface-500">No model card provided.</p>
        )}
      </div>
    </div>
  )
}

interface ModelMetadataSidebarProps {
  model: {
    framework: string
    precision: string
    license: string
    task: string
    lastUpdated: number
    computeRequirements: {
      minVram: string
      recommendedVram: string
      architecture: string[]
    }
  }
}

function ModelMetadataSidebar({ model }: ModelMetadataSidebarProps) {
  return (
    <>
      <div className="card p-6 animate-in">
        <h3 className="font-semibold text-surface-100 mb-4">Model Info</h3>
        <dl className="space-y-3">
          {model.task && (
            <div className="flex justify-between">
              <dt className="text-surface-500">Task</dt>
              <dd className="text-surface-200">{model.task}</dd>
            </div>
          )}
          {model.framework && (
            <div className="flex justify-between">
              <dt className="text-surface-500">Framework</dt>
              <dd className="text-surface-200">{model.framework}</dd>
            </div>
          )}
          {model.precision && (
            <div className="flex justify-between">
              <dt className="text-surface-500">Precision</dt>
              <dd className="text-surface-200">{model.precision}</dd>
            </div>
          )}
          {model.license && (
            <div className="flex justify-between items-center">
              <dt className="text-surface-500 flex items-center gap-1.5">
                <Scale className="w-4 h-4" />
                License
              </dt>
              <dd className="text-surface-200">{model.license}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-surface-500">Updated</dt>
            <dd className="text-surface-200">
              {formatRelativeTime(model.lastUpdated)}
            </dd>
          </div>
        </dl>
      </div>

      {(model.computeRequirements.minVram ||
        model.computeRequirements.architecture.length > 0) && (
        <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
          <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-surface-400" />
            Compute Requirements
          </h3>
          <dl className="space-y-3">
            {model.computeRequirements.minVram && (
              <div className="flex justify-between">
                <dt className="text-surface-500">Min VRAM</dt>
                <dd className="text-surface-200">
                  {model.computeRequirements.minVram}
                </dd>
              </div>
            )}
            {model.computeRequirements.recommendedVram && (
              <div className="flex justify-between">
                <dt className="text-surface-500">Recommended</dt>
                <dd className="text-surface-200">
                  {model.computeRequirements.recommendedVram}
                </dd>
              </div>
            )}
            {model.computeRequirements.architecture.length > 0 && (
              <div>
                <dt className="text-surface-500 mb-2">Architectures</dt>
                <dd className="flex flex-wrap gap-2">
                  {model.computeRequirements.architecture.map((arch) => (
                    <span key={arch} className="badge badge-neutral text-xs">
                      {arch}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </>
  )
}

interface FilesTabProps {
  files: ModelFile[]
}

function FilesTab({ files }: FilesTabProps) {
  if (files.length === 0) {
    return (
      <div className="card p-8 animate-in text-center">
        <File className="w-12 h-12 mx-auto mb-3 text-surface-600" />
        <h3 className="text-lg font-semibold text-surface-200 mb-2">
          No Files Available
        </h3>
        <p className="text-surface-500">
          This model has no downloadable files.
        </p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden animate-in">
      <div className="divide-y divide-surface-800/50">
        {files.map((file, idx) => (
          <div
            key={file.name}
            className="flex items-center gap-4 px-4 py-4 animate-slide-up"
            style={{ animationDelay: `${idx * 30}ms` }}
          >
            <File className="w-5 h-5 text-surface-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-surface-200 truncate">
                {file.name}
              </p>
              <p className="text-sm text-surface-500">{file.type}</p>
            </div>
            <span className="text-sm text-surface-500">{file.size}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={Download}
              onClick={() => {
                toast.success(`Downloading ${file.name}...`)
              }}
            >
              Download
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

interface VersionsTabProps {
  versions: ModelVersion[]
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
          No Version History
        </h3>
        <p className="text-surface-500">
          No version history available for this model.
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
              </div>
              <p className="text-sm text-surface-500">
                Released {formatRelativeTime(version.date)}
              </p>
              {version.notes && (
                <p className="text-sm text-surface-400 mt-1">{version.notes}</p>
              )}
            </div>
            {version.sha && (
              <span className="text-sm text-surface-600 font-mono">
                {version.sha.slice(0, 7)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface InferenceTabProps {
  org: string
  name: string
}

function InferenceTab({ org, name }: InferenceTabProps) {
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState(256)
  const [temperature, setTemperature] = useState(0.7)

  const { runInferenceAsync, isLoading, data, error, reset } = useInference(
    org,
    name,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) {
      toast.error('Please enter a prompt')
      return
    }
    try {
      await runInferenceAsync({ prompt, maxTokens, temperature })
    } catch {
      toast.error('Inference request failed')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Input */}
      <div className="card p-6 animate-in">
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-400" />
          Try Inference
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="prompt"
              className="block text-sm font-medium text-surface-200 mb-2"
            >
              Prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="input w-full resize-none"
              rows={6}
              placeholder="Enter your prompt here..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="maxTokens"
                className="block text-sm font-medium text-surface-200 mb-2"
              >
                Max Tokens
              </label>
              <input
                id="maxTokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="input w-full"
                min={1}
                max={4096}
              />
            </div>
            <div>
              <label
                htmlFor="temperature"
                className="block text-sm font-medium text-surface-200 mb-2"
              >
                Temperature
              </label>
              <input
                id="temperature"
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="input w-full"
                min={0}
                max={2}
                step={0.1}
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={isLoading}
            icon={Send}
          >
            Run Inference
          </Button>
        </form>
      </div>

      {/* Output */}
      <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-surface-100 flex items-center gap-2">
            <FileText className="w-4 h-4 text-surface-400" />
            Output
          </h3>
          {data && (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-surface-400 hover:text-surface-200"
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="p-4 bg-error-500/10 border border-error-500/30 rounded-lg text-error-400">
            Inference failed. Please try again.
          </div>
        )}

        {!data && !error && !isLoading && (
          <div className="flex items-center justify-center h-48 text-surface-500">
            Output will appear here
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center h-48">
            <LoadingState text="Running inference..." />
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="bg-surface-800/50 rounded-lg p-4">
              <pre className="whitespace-pre-wrap text-surface-200 text-sm">
                {data.output}
              </pre>
            </div>
            <div className="flex items-center gap-4 text-sm text-surface-500">
              <span>Prompt tokens: {data.usage.promptTokens}</span>
              <span>Completion tokens: {data.usage.completionTokens}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
