'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  Brain, 
  Search, 
  Filter,
  Download,
  Star,
  Play,
  Plus,
  GitFork,
  Tag,
  Clock,
  CheckCircle,
  Shield,
  Zap,
  BarChart3
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type ModelType = 'all' | 'llm' | 'vision' | 'audio' | 'embedding' | 'multimodal';

const mockModels = [
  {
    id: '0x1234',
    name: 'llama-3-jeju-ft',
    organization: 'jeju',
    description: 'LLaMA 3 8B fine-tuned on Jeju documentation and smart contract code. Optimized for developer assistance and code generation.',
    type: 'llm',
    downloads: 12500,
    stars: 342,
    forks: 45,
    lastUpdated: Date.now() - 2 * 24 * 60 * 60 * 1000,
    parameters: '8B',
    license: 'LLAMA2',
    isVerified: true,
    tags: ['llm', 'code', 'jeju', 'fine-tuned'],
    hasInference: true,
  },
  {
    id: '0x5678',
    name: 'whisper-jeju',
    organization: 'audio-lab',
    description: 'Whisper large-v3 fine-tuned for transcribing developer discussions, technical meetings, and code reviews.',
    type: 'audio',
    downloads: 5600,
    stars: 156,
    forks: 23,
    lastUpdated: Date.now() - 5 * 24 * 60 * 60 * 1000,
    parameters: '1.55B',
    license: 'MIT',
    isVerified: true,
    tags: ['audio', 'transcription', 'whisper'],
    hasInference: true,
  },
  {
    id: '0x9abc',
    name: 'contract-embeddings',
    organization: 'security-ai',
    description: 'Embedding model trained on smart contract code for semantic search, similarity detection, and vulnerability pattern matching.',
    type: 'embedding',
    downloads: 8900,
    stars: 234,
    forks: 67,
    lastUpdated: Date.now() - 1 * 24 * 60 * 60 * 1000,
    parameters: '350M',
    license: 'APACHE2',
    isVerified: false,
    tags: ['embedding', 'security', 'solidity', 'search'],
    hasInference: false,
  },
  {
    id: '0xdef0',
    name: 'multimodal-auditor',
    organization: 'jeju',
    description: 'Multimodal model that analyzes smart contracts through both code and visual architecture diagrams for comprehensive auditing.',
    type: 'multimodal',
    downloads: 3400,
    stars: 189,
    forks: 12,
    lastUpdated: Date.now() - 7 * 24 * 60 * 60 * 1000,
    parameters: '7B',
    license: 'CC-BY-NC-4',
    isVerified: true,
    tags: ['multimodal', 'audit', 'security', 'vision'],
    hasInference: true,
  },
];

const typeColors = {
  llm: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  vision: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  audio: 'bg-green-500/20 text-green-400 border-green-500/30',
  embedding: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  multimodal: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const typeLabels = {
  llm: 'LLM',
  vision: 'Vision',
  audio: 'Audio',
  embedding: 'Embedding',
  multimodal: 'Multimodal',
};

export default function ModelsPage() {
  const { isConnected } = useAccount();
  const [filter, setFilter] = useState<ModelType>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'downloads' | 'stars' | 'updated'>('downloads');

  const filteredModels = mockModels.filter(model => {
    if (filter !== 'all' && model.type !== filter) return false;
    if (search && !model.name.toLowerCase().includes(search.toLowerCase()) && 
        !model.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'downloads') return b.downloads - a.downloads;
    if (sortBy === 'stars') return b.stars - a.stars;
    return b.lastUpdated - a.lastUpdated;
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
                {type === 'all' ? 'All Models' : typeLabels[type]}
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
          { label: 'Total Models', value: '892', icon: Brain, color: 'text-amber-400' },
          { label: 'Total Downloads', value: '1.2M', icon: Download, color: 'text-green-400' },
          { label: 'Inference Endpoints', value: '234', icon: Zap, color: 'text-blue-400' },
          { label: 'Verified Models', value: '156', icon: Shield, color: 'text-purple-400' },
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

      {/* Model Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredModels.map((model) => (
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
                  typeColors[model.type as keyof typeof typeColors]
                )}>
                  {typeLabels[model.type as keyof typeof typeLabels]}
                </span>
              </div>
              {model.hasInference && (
                <button className="btn btn-secondary text-sm py-1.5">
                  <Play className="w-3 h-3" />
                  Try it
                </button>
              )}
            </div>

            <p className="text-factory-400 text-sm mb-4 line-clamp-2">
              {model.description}
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              {model.tags.slice(0, 4).map((tag) => (
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
                <span className="flex items-center gap-1">
                  <GitFork className="w-4 h-4" />
                  {model.forks}
                </span>
              </div>
              <div className="flex items-center gap-3 text-factory-500">
                <span className="flex items-center gap-1">
                  <BarChart3 className="w-4 h-4" />
                  {model.parameters}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {formatDate(model.lastUpdated)}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Empty State */}
      {filteredModels.length === 0 && (
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

