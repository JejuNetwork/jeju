'use client';

import { useState } from 'react';
import { 
  Package, 
  Search, 
  Plus,
  Download,
  Clock,
  Shield,
  TrendingUp,
  Copy,
  Check,
  Loader2
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { usePackages, type PackageListItem } from '../../hooks/usePackages';

type PackageSort = 'popular' | 'recent' | 'downloads' | 'quality';

export default function PackagesPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<PackageSort>('popular');
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  // Fetch real data
  const { packages, isLoading, error, refetch } = usePackages({ search: search || undefined });

  const sortedPackages = [...packages].sort((a, b) => {
    switch (sortBy) {
      case 'downloads': return b.downloads - a.downloads;
      case 'recent': return b.updatedAt - a.updatedAt;
      case 'quality': return b.downloads - a.downloads; // Use downloads as proxy for quality
      default: return b.downloads - a.downloads; // Popular = downloads
    }
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
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  const copyInstall = (name: string) => {
    navigator.clipboard.writeText(`bun add ${name}`);
    setCopiedPkg(name);
    setTimeout(() => setCopiedPkg(null), 2000);
  };

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Package className="w-7 h-7 text-orange-400" />
            Packages
          </h1>
          <p className="text-factory-400 mt-1">Decentralized package registry on Jeju</p>
        </div>
        <Link href="/packages/publish" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Publish Package
        </Link>
      </div>

      {/* Search */}
      <div className="card p-6 mb-8">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-factory-500" />
          <input
            type="text"
            placeholder="Search packages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-12 text-lg"
          />
        </div>
        <div className="flex justify-center gap-3 mt-4">
          {(['popular', 'recent', 'downloads'] as const).map((sort) => (
            <button
              key={sort}
              onClick={() => setSortBy(sort)}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                sortBy === sort
                  ? 'bg-accent-600 text-white'
                  : 'bg-factory-800 text-factory-400 hover:text-factory-100'
              )}
            >
              {sort}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Packages', value: packages.length.toString(), icon: Package, color: 'text-orange-400' },
          { label: 'Weekly Downloads', value: formatNumber(packages.reduce((acc, p) => acc + p.downloads, 0)), icon: Download, color: 'text-green-400' },
          { label: 'Verified', value: packages.filter(p => p.verified).length.toString(), icon: Shield, color: 'text-blue-400' },
          { label: 'Publishers', value: new Set(packages.map(p => p.scope)).size.toString(), icon: TrendingUp, color: 'text-purple-400' },
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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-red-400 mb-4">Failed to load packages</p>
          <button onClick={() => refetch()} className="btn btn-secondary">
            Try Again
          </button>
        </div>
      )}

      {/* Package List */}
      {!isLoading && !error && (
        <div className="space-y-4">
          {sortedPackages.map((pkg) => (
            <PackageCard 
              key={pkg.name} 
              pkg={pkg} 
              formatNumber={formatNumber}
              formatDate={formatDate}
              copyInstall={copyInstall}
              copiedPkg={copiedPkg}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && sortedPackages.length === 0 && (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">No packages found</h3>
          <p className="text-factory-500 mb-4">Try a different search term or publish your own package</p>
          <Link href="/packages/publish" className="btn btn-primary">
            Publish Package
          </Link>
        </div>
      )}
    </div>
  );
}

function PackageCard({ 
  pkg, 
  formatNumber, 
  formatDate, 
  copyInstall, 
  copiedPkg 
}: { 
  pkg: PackageListItem; 
  formatNumber: (n: number) => string;
  formatDate: (ts: number) => string;
  copyInstall: (name: string) => void;
  copiedPkg: string | null;
}) {
  const fullName = pkg.scope ? `${pkg.scope}/${pkg.name}` : pkg.name;
  
  return (
    <div className="card p-6 card-hover">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Package name & badges */}
          <div className="flex items-center gap-3 mb-2">
            <Link 
              href={`/packages/${encodeURIComponent(pkg.scope)}/${pkg.name}`}
              className="font-semibold text-lg text-accent-400 hover:underline"
            >
              {fullName}
            </Link>
            <span className="text-factory-500 text-sm">v{pkg.version}</span>
            {pkg.verified && (
              <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                <Shield className="w-3 h-3 mr-1" />
                Verified
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-factory-400 text-sm mb-3">{pkg.description}</p>

          {/* Stats row */}
          <div className="flex items-center gap-5 text-sm text-factory-500">
            <span className="flex items-center gap-1">
              <Download className="w-4 h-4" />
              {formatNumber(pkg.downloads)} downloads
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {formatDate(pkg.updatedAt)}
            </span>
          </div>
        </div>

        {/* Install button */}
        <button 
          className="btn btn-secondary text-sm font-mono"
          onClick={() => copyInstall(fullName)}
        >
          {copiedPkg === fullName ? (
            <><Check className="w-4 h-4" /> Copied</>
          ) : (
            <><Copy className="w-4 h-4" /> bun add {fullName}</>
          )}
        </button>
      </div>
    </div>
  );
}
