'use client';

import { useState } from 'react';
import { 
  Container, 
  Search, 
  Plus,
  Download,
  Clock,
  Shield,
  Star,
  Layers,
  HardDrive,
  Tag,
  Copy,
  Check,
  Globe,
  Lock,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useContainerImages, useContainerStats } from '../../hooks';

type ContainerFilter = 'all' | 'public' | 'private' | 'official';

export default function ContainersPage() {
  const [filter, setFilter] = useState<ContainerFilter>('all');
  const [search, setSearch] = useState('');
  const [copiedImage, setCopiedImage] = useState<string | null>(null);

  const { images, isLoading } = useContainerImages({ search: search || undefined });
  const { stats } = useContainerStats();

  const filteredContainers = images.filter(container => {
    if (filter === 'public' && !container.isPublic) return false;
    if (filter === 'private' && container.isPublic) return false;
    // For 'official', we check if name starts with 'jeju/'
    if (filter === 'official' && !container.name.startsWith('jeju/')) return false;
    return true;
  });

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  };

  const formatDate = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return `${Math.floor(days / 7)} weeks ago`;
  };

  const copyPull = (name: string) => {
    navigator.clipboard.writeText(`docker pull registry.jejunetwork.org/${name}`);
    setCopiedImage(name);
    setTimeout(() => setCopiedImage(null), 2000);
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Container className="w-7 h-7 text-cyan-400" />
            Container Registry
          </h1>
          <p className="text-factory-400 mt-1">Decentralized container images on Jeju</p>
        </div>
        <Link href="/containers/push" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Push Image
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search containers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(['all', 'public', 'private', 'official'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                  filter === f
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Images', value: stats.totalImages.toString(), icon: Container, color: 'text-cyan-400' },
          { label: 'Total Pulls', value: formatNumber(stats.totalPulls), icon: Download, color: 'text-green-400' },
          { label: 'Storage Used', value: stats.totalStorage, icon: HardDrive, color: 'text-purple-400' },
          { label: 'Running Containers', value: stats.runningContainers.toString(), icon: Shield, color: 'text-amber-400' },
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

      {/* Container List */}
      {isLoading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-accent-400" />
        </div>
      ) : filteredContainers.length === 0 ? (
        <div className="card p-12 text-center">
          <Container className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No containers found</h3>
          <p className="text-factory-500 mb-4">Try adjusting your filters or push a new image</p>
          <Link href="/containers/push" className="btn btn-primary">
            Push Image
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredContainers.map((container) => {
            const isOfficial = container.name.startsWith('jeju/');
            return (
              <div key={container.id} className="card p-6 card-hover">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Container name & badges */}
                    <div className="flex items-center gap-3 mb-2">
                      <Link 
                        href={`/containers/${container.name}`}
                        className="font-semibold text-lg text-accent-400 hover:underline font-mono"
                      >
                        {container.name}:{container.tag}
                      </Link>
                      {isOfficial && (
                        <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          <Shield className="w-3 h-3 mr-1" />
                          Official
                        </span>
                      )}
                      <span className={clsx(
                        'badge',
                        !container.isPublic 
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-factory-700/50 text-factory-400 border border-factory-600'
                      )}>
                        {!container.isPublic ? (
                          <><Lock className="w-3 h-3 mr-1" /> Private</>
                        ) : (
                          <><Globe className="w-3 h-3 mr-1" /> Public</>
                        )}
                      </span>
                    </div>

                    {/* Description */}
                    {container.description && (
                      <p className="text-factory-400 text-sm mb-3">{container.description}</p>
                    )}

                    {/* Digest */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className="badge bg-factory-700/50 text-factory-300 border border-factory-600 font-mono text-xs">
                        <Tag className="w-3 h-3 mr-1" />
                        {container.digest.substring(0, 12)}...
                      </span>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-5 text-sm text-factory-500">
                      <span className="flex items-center gap-1">
                        <Download className="w-4 h-4" />
                        {formatNumber(container.pulls)} pulls
                      </span>
                      <span className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        -
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-4 h-4" />
                        {container.size}
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="w-4 h-4" />
                        linux
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDate(container.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Pull command */}
                  <button 
                    className="btn btn-secondary text-sm font-mono"
                    onClick={() => copyPull(container.name)}
                  >
                    {copiedImage === container.name ? (
                      <><Check className="w-4 h-4" /> Copied</>
                    ) : (
                      <><Copy className="w-4 h-4" /> docker pull</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
