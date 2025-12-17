/**
 * Package Detail Page
 * npm-like package view with readme, versions, dependencies
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  Package,
  Download,
  Clock,
  Tag,
  GitBranch,
  FileText,
  Code,
  Box,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Shield,
  AlertTriangle,
  Star,
  Users,
  History,
  Terminal,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

type PackageTab = 'readme' | 'versions' | 'dependencies' | 'dependents';

interface PackageVersion {
  version: string;
  publishedAt: number;
  downloads: number;
  size: string;
  tarballUri: string;
}

interface PackageData {
  name: string;
  scope?: string;
  description: string;
  version: string;
  license: string;
  repository?: string;
  homepage?: string;
  author: {
    name: string;
    address: string;
  };
  keywords: string[];
  downloads: {
    weekly: number;
    total: number;
  };
  publishedAt: number;
  updatedAt: number;
  versions: PackageVersion[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  readme: string;
  isVerified: boolean;
}

const mockPackage: PackageData = {
  name: 'jeju-sdk',
  scope: '@jejunetwork',
  description: 'Official SDK for interacting with the Jeju Network - identity, bounties, guardians, compute marketplace, and more.',
  version: '1.2.0',
  license: 'MIT',
  repository: 'https://github.com/jejunetwork/jeju-sdk',
  homepage: 'https://docs.jeju.network/sdk',
  author: {
    name: 'Jeju Network',
    address: '0x1234...5678',
  },
  keywords: ['jeju', 'web3', 'ethereum', 'sdk', 'identity', 'bounties'],
  downloads: {
    weekly: 2450,
    total: 45600,
  },
  publishedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  versions: [
    { version: '1.2.0', publishedAt: Date.now() - 7 * 24 * 60 * 60 * 1000, downloads: 1200, size: '234 KB', tarballUri: 'ipfs://...' },
    { version: '1.1.0', publishedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, downloads: 15600, size: '228 KB', tarballUri: 'ipfs://...' },
    { version: '1.0.0', publishedAt: Date.now() - 60 * 24 * 60 * 60 * 1000, downloads: 28800, size: '215 KB', tarballUri: 'ipfs://...' },
  ],
  dependencies: {
    'viem': '^2.0.0',
    'ethers': '^6.0.0',
    '@noble/hashes': '^1.3.0',
  },
  devDependencies: {
    'typescript': '^5.0.0',
    'vitest': '^1.0.0',
  },
  peerDependencies: {
    'react': '>=18.0.0',
  },
  readme: `# @jejunetwork/jeju-sdk

The official SDK for interacting with the Jeju Network.

## Installation

\`\`\`bash
bun add @jejunetwork/jeju-sdk
\`\`\`

## Quick Start

\`\`\`typescript
import { JejuClient, IdentityRegistry, BountyRegistry } from '@jejunetwork/jeju-sdk';

// Initialize the client
const client = new JejuClient({
  rpcUrl: 'https://rpc.jeju.network',
  chainId: 8453,
});

// Get identity registry
const identity = new IdentityRegistry(client);
const agent = await identity.getAgent(agentId);

// Create a bounty
const bounty = new BountyRegistry(client);
await bounty.createBounty({
  title: 'Build awesome feature',
  description: 'We need help building X',
  reward: '1 ETH',
});
\`\`\`

## Features

- **Identity Management**: Register and manage ERC-8004 agent identities
- **Bounty System**: Create, fund, and complete bounties
- **Guardian Network**: Participate in bounty validation
- **Compute Marketplace**: Submit and manage compute jobs
- **Model Hub**: Upload and download ML models

## Documentation

See the [full documentation](https://docs.jeju.network/sdk) for more details.

## License

MIT
`,
  isVerified: true,
};

export default function PackageDetailPage() {
  const params = useParams();
  const scope = params.scope as string;
  const name = params.name as string;
  const { isConnected } = useAccount();
  
  const [tab, setTab] = useState<PackageTab>('readme');
  const [copied, setCopied] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(mockPackage.version);

  const fullName = scope ? `${scope}/${name}` : name;
  const installCommand = `bun add ${fullName}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-factory-800 bg-factory-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Package className="w-8 h-8 text-red-400" />
                <div>
                  <h1 className="text-2xl font-bold text-factory-100">
                    {mockPackage.scope && (
                      <span className="text-factory-400">{mockPackage.scope}/</span>
                    )}
                    {mockPackage.name}
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="badge bg-factory-800 text-factory-300 border border-factory-700">
                      v{mockPackage.version}
                    </span>
                    {mockPackage.isVerified && (
                      <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                        <Shield className="w-3 h-3 mr-1" />
                        Verified
                      </span>
                    )}
                    <span className="badge bg-factory-800 text-factory-300 border border-factory-700">
                      {mockPackage.license}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-factory-400 max-w-2xl">{mockPackage.description}</p>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-secondary text-sm">
                <Star className="w-4 h-4" />
                Star
              </button>
              {mockPackage.repository && (
                <a
                  href={mockPackage.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary text-sm"
                >
                  <GitBranch className="w-4 h-4" />
                  <span className="hidden sm:inline">Repository</span>
                </a>
              )}
            </div>
          </div>

          {/* Install Command */}
          <div className="card p-3 flex items-center gap-2 mb-6">
            <Terminal className="w-5 h-5 text-factory-500" />
            <code className="flex-1 text-sm text-factory-300 font-mono">
              {installCommand}
            </code>
            <button
              onClick={() => copyToClipboard(installCommand)}
              className="p-2 hover:bg-factory-800 rounded transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-factory-400" />
              )}
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-factory-100">{formatNumber(mockPackage.downloads.weekly)}</p>
              <p className="text-factory-500 text-sm">Weekly Downloads</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-factory-100">{formatNumber(mockPackage.downloads.total)}</p>
              <p className="text-factory-500 text-sm">Total Downloads</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-factory-100">{mockPackage.versions.length}</p>
              <p className="text-factory-500 text-sm">Versions</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-factory-100">{Object.keys(mockPackage.dependencies).length}</p>
              <p className="text-factory-500 text-sm">Dependencies</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {([
              { id: 'readme' as const, label: 'Readme', icon: FileText },
              { id: 'versions' as const, label: 'Versions', icon: History, count: mockPackage.versions.length },
              { id: 'dependencies' as const, label: 'Dependencies', icon: Box, count: Object.keys(mockPackage.dependencies).length },
              { id: 'dependents' as const, label: 'Dependents', icon: Users, count: 156 },
            ]).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-accent-500 text-accent-400'
                    : 'border-transparent text-factory-400 hover:text-factory-100 hover:border-factory-600'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-factory-800">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {tab === 'readme' && (
              <div className="card p-6 lg:p-8">
                <div className="prose prose-invert max-w-none prose-pre:bg-factory-950 prose-pre:border prose-pre:border-factory-800">
                  <ReactMarkdown>{mockPackage.readme}</ReactMarkdown>
                </div>
              </div>
            )}

            {tab === 'versions' && (
              <div className="card divide-y divide-factory-800">
                {mockPackage.versions.map((version) => (
                  <div
                    key={version.version}
                    className="p-4 hover:bg-factory-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-factory-100">
                          v{version.version}
                        </span>
                        {version.version === mockPackage.version && (
                          <span className="badge badge-success">Latest</span>
                        )}
                      </div>
                      <button
                        onClick={() => copyToClipboard(`bun add ${fullName}@${version.version}`)}
                        className="btn btn-ghost text-sm"
                      >
                        <Copy className="w-4 h-4" />
                        Copy
                      </button>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-factory-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatDate(version.publishedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Download className="w-4 h-4" />
                        {formatNumber(version.downloads)} downloads
                      </span>
                      <span>{version.size}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'dependencies' && (
              <div className="space-y-6">
                {Object.keys(mockPackage.dependencies).length > 0 && (
                  <div className="card">
                    <div className="p-4 border-b border-factory-800">
                      <h3 className="font-semibold text-factory-100">Dependencies ({Object.keys(mockPackage.dependencies).length})</h3>
                    </div>
                    <div className="divide-y divide-factory-800">
                      {Object.entries(mockPackage.dependencies).map(([dep, version]) => (
                        <Link
                          key={dep}
                          href={`/packages/${dep}`}
                          className="flex items-center justify-between p-4 hover:bg-factory-800/50 transition-colors"
                        >
                          <span className="text-accent-400">{dep}</span>
                          <span className="font-mono text-factory-500">{version}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(mockPackage.devDependencies).length > 0 && (
                  <div className="card">
                    <div className="p-4 border-b border-factory-800">
                      <h3 className="font-semibold text-factory-100">Dev Dependencies ({Object.keys(mockPackage.devDependencies).length})</h3>
                    </div>
                    <div className="divide-y divide-factory-800">
                      {Object.entries(mockPackage.devDependencies).map(([dep, version]) => (
                        <Link
                          key={dep}
                          href={`/packages/${dep}`}
                          className="flex items-center justify-between p-4 hover:bg-factory-800/50 transition-colors"
                        >
                          <span className="text-accent-400">{dep}</span>
                          <span className="font-mono text-factory-500">{version}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(mockPackage.peerDependencies).length > 0 && (
                  <div className="card">
                    <div className="p-4 border-b border-factory-800">
                      <h3 className="font-semibold text-factory-100">Peer Dependencies ({Object.keys(mockPackage.peerDependencies).length})</h3>
                    </div>
                    <div className="divide-y divide-factory-800">
                      {Object.entries(mockPackage.peerDependencies).map(([dep, version]) => (
                        <Link
                          key={dep}
                          href={`/packages/${dep}`}
                          className="flex items-center justify-between p-4 hover:bg-factory-800/50 transition-colors"
                        >
                          <span className="text-accent-400">{dep}</span>
                          <span className="font-mono text-factory-500">{version}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'dependents' && (
              <div className="card divide-y divide-factory-800">
                {['jeju-contracts', 'factory-ui', 'gateway', 'indexer', 'dws'].map((pkg) => (
                  <Link
                    key={pkg}
                    href={`/packages/@jejunetwork/${pkg}`}
                    className="flex items-center justify-between p-4 hover:bg-factory-800/50 transition-colors"
                  >
                    <div>
                      <span className="text-accent-400">@jejunetwork/{pkg}</span>
                      <p className="text-factory-500 text-sm mt-1">Uses {fullName}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-factory-500" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Maintainers */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Maintainers</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-500 to-purple-500 flex items-center justify-center text-white font-bold">
                  J
                </div>
                <div>
                  <p className="font-medium text-factory-100">{mockPackage.author.name}</p>
                  <p className="text-factory-500 text-sm font-mono">{mockPackage.author.address}</p>
                </div>
              </div>
            </div>

            {/* Keywords */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Keywords</h3>
              <div className="flex flex-wrap gap-2">
                {mockPackage.keywords.map((keyword) => (
                  <Link
                    key={keyword}
                    href={`/packages?q=${keyword}`}
                    className="badge badge-info hover:bg-blue-500/30 transition-colors"
                  >
                    {keyword}
                  </Link>
                ))}
              </div>
            </div>

            {/* Links */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Links</h3>
              <div className="space-y-3">
                {mockPackage.repository && (
                  <a
                    href={mockPackage.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-accent-400"
                  >
                    <GitBranch className="w-4 h-4" />
                    Repository
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </a>
                )}
                {mockPackage.homepage && (
                  <a
                    href={mockPackage.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-accent-400"
                  >
                    <FileText className="w-4 h-4" />
                    Documentation
                    <ExternalLink className="w-3 h-3 ml-auto" />
                  </a>
                )}
              </div>
            </div>

            {/* Last Published */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Activity</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-factory-500">Last published</span>
                  <span className="text-factory-300">{formatDate(mockPackage.publishedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-factory-500">Total versions</span>
                  <span className="text-factory-300">{mockPackage.versions.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

