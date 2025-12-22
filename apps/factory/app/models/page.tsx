'use client';

import { useState } from 'react';
import { 
  Brain, 
  Search, 
  Download, 
  Star, 
  Plus,
  Clock,
  CheckCircle,
  Shield,
  Zap,
  Loader2
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useModels } from '@/lib/hooks/useModels';
import type { ModelType } from '@/types';

type FilterType = 'all' | 'llm' | 'vision' | 'audio' | 'embedding' | 'multimodal';

const typeColors: Record<string, string> = {
  llm: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  vision: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  audio: 'bg-green-500/20 text-green-400 border-green-500/30',
  embedding: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  multimodal: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  code: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  image: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  other: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

function getModelTypeLabel(type: ModelType | string): string {
  const labels: Record<string, string> = {
    llm: 'LLM',
    vision: 'Vision',
    audio: 'Audio',
    embedding: 'Embedding',
    multimodal: 'Multimodal',
    code: 'Code',
    image: 'Image',
  };
  return labels[type] || 'Other';
}

export default function ModelsPage() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'downloads' | 'stars' | 'updated'>('downloads');
  
  const { models, isLoading, error, refresh } = useModels({
    type: filter === 'all' ? undefined : filter,
    search: search || undefined,
  });

  // Calculate stats from actual data
  const stats = {
    totalModels: models.length,
    totalDownloads: models.reduce((sum, m) => sum + (m.downloads || 0), 0),
    totalInference: 0, // Not available in new type yet
    verifiedModels: models.filter(m => m.isVerified).length,
  };

  // Sort models
  const sortedModels = [...models].sort((a, b) => {
    if (sortBy === 'downloads') return b.downloads - a.downloads;
    if (sortBy === 'stars') return b.stars - a.stars;
    return b.updatedAt - a.updatedAt;
  });

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  const formatDate = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return `${Math.floor(days / 7)} weeks ago`;
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Brain className="w-7 h-7 text-amber-400" />
            Model Hub
          </h1>
          <p className="text-factory-400 mt-1">Discover, share, and deploy ML models on-chain</p>
        </div>
        <Link href="/models/upload" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Upload Model
        </Link>
      </div>

      {/* Filters */}
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

          <div className="flex gap-2 overflow-x-auto">
            {(['all', 'llm', 'vision', 'audio', 'embedding', 'multimodal'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  filter === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {type === 'all' ? 'All Models' : getModelTypeLabel(type)}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input w-auto"
          >
            <option value="downloads">Most Downloads</option>
            <option value="stars">Most Stars</option>
            <option value="updated">Recently Updated</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Models', value: formatNumber(stats.totalModels), icon: Brain, color: 'text-amber-400' },
          { label: 'Total Downloads', value: formatNumber(stats.totalDownloads), icon: Download, color: 'text-green-400' },
          { label: 'Inference Endpoints', value: formatNumber(stats.totalInference), icon: Zap, color: 'text-blue-400' },
          { label: 'Verified Models', value: formatNumber(stats.verifiedModels), icon: Shield, color: 'text-purple-400' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={clsx('w-8 h-8', stat.color)} />
              <div>
                <p className="text-2xl font-bold text-factory-100">{stat.value}</p>
                <p className="text-factory-500 text-sm">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="card p-12 text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-factory-600 animate-spin" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">Loading models...</h3>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="card p-12 text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">Error loading models</h3>
          <p className="text-factory-500 mb-4">{error.message}</p>
          <button onClick={refresh} className="btn btn-primary">
            Try Again
          </button>
        </div>
      )}

      {/* Model Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sortedModels.map((model) => {
            return (
              <Link 
                key={model.id}
                href={`/models/${model.organization}/${model.name}`}
                className="card p-6 card-hover"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-factory-400 text-sm">{model.organization}/</span>
                      <span className="font-semibold text-factory-100">{model.name}</span>
                      {model.isVerified && (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      )}
                    </div>
                    <span className={clsx(
                      'badge border',
                      typeColors[model.type] || typeColors.other
                    )}>
                      {getModelTypeLabel(model.type)}
                    </span>
                  </div>
                  {/* Inference button removed as metrics.inferences is not available */}
                </div>

                <p className="text-factory-400 text-sm mb-4 line-clamp-2">
                  {model.description}
                </p>

                <div className="flex flex-wrap gap-2 mb-4">
                  {model.tags?.slice(0, 4).map((tag) => (
                    <span key={tag} className="badge badge-info">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between text-sm border-t border-factory-800 pt-4">
                  <div className="flex items-center gap-4 text-factory-500">
                    <span className="flex items-center gap-1">
                      <Download className="w-4 h-4" />
                      {formatNumber(model.downloads)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-4 h-4" />
                      {formatNumber(model.stars)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-factory-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDate(model.updatedAt)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && sortedModels.length === 0 && (
        <div className="card p-12 text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No models found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or upload a new model</p>
          <Link href="/models/upload" className="btn btn-primary">
            Upload Model
          </Link>
        </div>
      )}
    </div>
  );
}
