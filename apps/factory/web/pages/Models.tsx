import { clsx } from 'clsx'
import { Brain, Download, Play, Plus, Shield } from 'lucide-react'
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
import { type ModelType, useModelStats, useModels } from '../hooks/useModels'
import { formatCompactNumber } from '../lib/format'

const typeLabels: Record<ModelType, string> = {
  llm: 'LLM',
  vision: 'Vision',
  audio: 'Audio',
  embedding: 'Embedding',
  multimodal: 'Multimodal',
}

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'llm', label: 'LLM' },
  { value: 'vision', label: 'Vision' },
  { value: 'audio', label: 'Audio' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'multimodal', label: 'Multimodal' },
]

export function ModelsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ModelType | 'all'>('all')

  const { models, isLoading, error } = useModels({
    search: search || undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
  })
  const { stats, isLoading: statsLoading } = useModelStats()

  const statsData = useMemo(
    () => [
      {
        label: 'Total Models',
        value: stats.totalModels.toString(),
        color: 'text-warning-400',
        loading: statsLoading,
      },
      {
        label: 'Total Downloads',
        value: formatCompactNumber(stats.totalDownloads),
        color: 'text-info-400',
        loading: statsLoading,
      },
      {
        label: 'Verified',
        value: stats.verifiedModels.toString(),
        color: 'text-success-400',
        loading: statsLoading,
      },
      {
        label: 'Active Inference',
        value: stats.activeInference.toString(),
        color: 'text-accent-400',
        loading: statsLoading,
      },
    ],
    [stats, statsLoading],
  )

  return (
    <div className="page-container">
      <PageHeader
        title="Models"
        icon={Brain}
        iconColor="text-warning-400"
        action={
          <Link to="/models/upload" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span> Model
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search models..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none"
          />

          <fieldset
            className="flex flex-wrap gap-2 border-0"
            aria-label="Model type filters"
          >
            {typeFilters.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setTypeFilter(type.value as ModelType | 'all')}
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  typeFilter === type.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={typeFilter === type.value}
              >
                {type.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading models..." />
      ) : error ? (
        <ErrorState title="Failed to load models" />
      ) : models.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No models found"
          description={
            search
              ? 'Try a different search term'
              : 'Upload a model to share with others'
          }
          actionLabel="Upload Model"
          actionHref="/models/upload"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model, index) => (
            <Link
              key={model.id}
              to={`/models/${model.organization}/${model.name}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-surface-100 truncate">
                      {model.name}
                    </h3>
                    {model.isVerified && (
                      <Shield
                        className="w-4 h-4 text-success-400 flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p className="text-surface-500 text-sm">
                    {model.organization}
                  </p>
                </div>
                <span className="badge badge-info">
                  {typeLabels[model.type]}
                </span>
              </div>

              <p className="text-surface-400 text-sm line-clamp-2 mb-4">
                {model.description ?? 'No description provided'}
              </p>

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4 text-surface-500">
                  <span className="flex items-center gap-1.5">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {formatCompactNumber(model.downloads)}
                  </span>
                  <span>{model.parameters}</span>
                </div>
                {model.hasInference && (
                  <span className="flex items-center gap-1.5 text-success-400">
                    <Play className="w-4 h-4" aria-hidden="true" />
                    Inference
                  </span>
                )}
              </div>

              {model.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {model.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
