import { clsx } from 'clsx'
import {
  Brain,
  Download,
  Loader2,
  Play,
  Plus,
  Search,
  Shield,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type ModelType, useModelStats, useModels } from '../hooks/useModels'

const typeLabels: Record<ModelType, string> = {
  llm: 'LLM',
  vision: 'Vision',
  audio: 'Audio',
  embedding: 'Embedding',
  multimodal: 'Multimodal',
}

export function ModelsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ModelType | 'all'>('all')

  const { models, isLoading, error } = useModels({
    search: search || undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
  })
  const { stats, isLoading: statsLoading } = useModelStats()

  const formatDownloads = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
    return count.toString()
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Brain className="w-7 h-7 text-amber-400" />
            Models
          </h1>
          <p className="text-factory-400 mt-1">
            AI model hub for the Jeju ecosystem
          </p>
        </div>
        <Link to="/models/upload" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Upload Model
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(
              [
                'all',
                'llm',
                'vision',
                'audio',
                'embedding',
                'multimodal',
              ] as const
            ).map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => setTypeFilter(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  typeFilter === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {type === 'all' ? 'All' : typeLabels[type]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Models',
            value: stats.totalModels.toString(),
            color: 'text-amber-400',
          },
          {
            label: 'Total Downloads',
            value: formatDownloads(stats.totalDownloads),
            color: 'text-blue-400',
          },
          {
            label: 'Verified',
            value: stats.verifiedModels.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Active Inference',
            value: stats.activeInference.toString(),
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
          <Brain className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load models
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : models.length === 0 ? (
        <div className="card p-12 text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No models found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Upload your first model'}
          </p>
          <Link to="/models/upload" className="btn btn-primary">
            Upload Model
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <Link
              key={model.id}
              to={`/models/${model.organization}/${model.name}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-factory-100 truncate">
                      {model.name}
                    </h3>
                    {model.isVerified && (
                      <Shield className="w-4 h-4 text-green-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-factory-500 text-sm">
                    {model.organization}
                  </p>
                </div>
                <span className="badge badge-info">
                  {typeLabels[model.type]}
                </span>
              </div>

              <p className="text-factory-400 text-sm line-clamp-2 mb-4">
                {model.description || 'No description provided'}
              </p>

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4 text-factory-500">
                  <span className="flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    {formatDownloads(model.downloads)}
                  </span>
                  <span>{model.parameters}</span>
                </div>
                {model.hasInference && (
                  <span className="flex items-center gap-1 text-green-400">
                    <Play className="w-4 h-4" />
                    Inference
                  </span>
                )}
              </div>

              {model.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {model.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-factory-500 bg-factory-800 px-2 py-0.5 rounded"
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
