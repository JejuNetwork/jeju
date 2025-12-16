'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { 
  Package, 
  Search, 
  Plus,
  Download,
  Clock,
  Shield,
  Star,
  TrendingUp,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type PackageSort = 'popular' | 'recent' | 'downloads' | 'quality';

const mockPackages = [
  {
    name: '@jeju/sdk',
    version: '1.5.2',
    description: 'Official Jeju Network SDK - interact with contracts, bounties, guardians, and models.',
    downloads: 45230,
    weeklyDownloads: 3240,
    lastPublish: Date.now() - 2 * 24 * 60 * 60 * 1000,
    author: 'jeju',
    keywords: ['jeju', 'web3', 'sdk', 'ethereum'],
    license: 'MIT',
    score: 98,
    verified: true,
    types: true,
  },
  {
    name: '@jeju/contracts',
    version: '2.1.0',
    description: 'TypeScript bindings for Jeju smart contracts - ready-to-use ABIs and type definitions.',
    downloads: 32150,
    weeklyDownloads: 2180,
    lastPublish: Date.now() - 5 * 24 * 60 * 60 * 1000,
    author: 'jeju',
    keywords: ['contracts', 'abi', 'typescript', 'solidity'],
    license: 'MIT',
    score: 95,
    verified: true,
    types: true,
  },
  {
    name: 'jeju-guardian-kit',
    version: '0.8.3',
    description: 'Toolkit for building Jeju Guardians - validation utilities, reputation helpers, and review templates.',
    downloads: 8920,
    weeklyDownloads: 890,
    lastPublish: Date.now() - 1 * 24 * 60 * 60 * 1000,
    author: 'alice.eth',
    keywords: ['guardian', 'validator', 'toolkit'],
    license: 'Apache-2.0',
    score: 87,
    verified: false,
    types: true,
  },
  {
    name: 'model-inference-client',
    version: '1.2.1',
    description: 'Client library for running inference on Jeju Model Hub - supports all major model types.',
    downloads: 15680,
    weeklyDownloads: 1450,
    lastPublish: Date.now() - 7 * 24 * 60 * 60 * 1000,
    author: 'bob.eth',
    keywords: ['ai', 'inference', 'models', 'ml'],
    license: 'MIT',
    score: 91,
    verified: true,
    types: true,
  },
  {
    name: 'psyche-trainer',
    version: '0.5.0',
    description: 'Distributed training coordinator for Psyche network integration with Jeju.',
    downloads: 5230,
    weeklyDownloads: 620,
    lastPublish: Date.now() - 14 * 24 * 60 * 60 * 1000,
    author: 'psyche-labs',
    keywords: ['training', 'distributed', 'psyche'],
    license: 'GPL-3.0',
    score: 82,
    verified: false,
    types: false,
  },
];

export default function PackagesPage() {
  const { isConnected } = useAccount();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<PackageSort>('popular');
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  const filteredPackages = mockPackages.filter(pkg => 
    pkg.name.toLowerCase().includes(search.toLowerCase()) ||
    pkg.description.toLowerCase().includes(search.toLowerCase()) ||
    pkg.keywords.some(k => k.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => {
    switch (sortBy) {
      case 'downloads': return b.downloads - a.downloads;
      case 'recent': return b.lastPublish - a.lastPublish;
      case 'quality': return b.score - a.score;
      default: return b.weeklyDownloads - a.weeklyDownloads;
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
          {(['popular', 'recent', 'downloads', 'quality'] as const).map((sort) => (
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
          { label: 'Total Packages', value: '2,847', icon: Package, color: 'text-orange-400' },
          { label: 'Weekly Downloads', value: '156k', icon: Download, color: 'text-green-400' },
          { label: 'Verified', value: '892', icon: Shield, color: 'text-blue-400' },
          { label: 'Publishers', value: '1.2k', icon: TrendingUp, color: 'text-purple-400' },
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

      {/* Package List */}
      <div className="space-y-4">
        {filteredPackages.map((pkg) => (
          <div key={pkg.name} className="card p-6 card-hover">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Package name & badges */}
                <div className="flex items-center gap-3 mb-2">
                  <Link 
                    href={`/packages/${pkg.name}`}
                    className="font-semibold text-lg text-accent-400 hover:underline"
                  >
                    {pkg.name}
                  </Link>
                  <span className="text-factory-500 text-sm">v{pkg.version}</span>
                  {pkg.verified && (
                    <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                      <Shield className="w-3 h-3 mr-1" />
                      Verified
                    </span>
                  )}
                  {pkg.types && (
                    <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      TS
                    </span>
                  )}
                </div>

                {/* Description */}
                <p className="text-factory-400 text-sm mb-3">{pkg.description}</p>

                {/* Keywords */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {pkg.keywords.map((keyword) => (
                    <span key={keyword} className="badge badge-info">
                      {keyword}
                    </span>
                  ))}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-5 text-sm text-factory-500">
                  <span className="flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    {formatNumber(pkg.downloads)} downloads
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    {formatNumber(pkg.weeklyDownloads)}/week
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {formatDate(pkg.lastPublish)}
                  </span>
                  <span>by {pkg.author}</span>
                  <span>{pkg.license}</span>
                </div>
              </div>

              {/* Install button */}
              <button 
                className="btn btn-secondary text-sm font-mono"
                onClick={() => copyInstall(pkg.name)}
              >
                {copiedPkg === pkg.name ? (
                  <><Check className="w-4 h-4" /> Copied</>
                ) : (
                  <><Copy className="w-4 h-4" /> bun add {pkg.name}</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredPackages.length === 0 && (
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

