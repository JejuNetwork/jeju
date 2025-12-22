'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  Package,
  Copy,
  Check,
  Shield,
  GitFork,
  FileText,
  Code,
  Users,
  ExternalLink,
  AlertTriangle,
  Tag,
  Terminal,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { usePackage, usePackageVersions, usePackageReadme } from '../../../../hooks/usePackages';

type PackageTab = 'readme' | 'versions' | 'dependencies' | 'files';

export default function PackageDetailPage() {
  const params = useParams();
  const rawScope = params.scope as string;
  const name = params.name as string;
  const { isConnected: _isConnected } = useAccount();
  
  // Decode URL-encoded scope (e.g., %40jejunetwork -> @jejunetwork)
  const scope = decodeURIComponent(rawScope);
  
  const [tab, setTab] = useState<PackageTab>('readme');
  const [copied, setCopied] = useState<string | null>(null);

  // Fetch real data
  const { package: pkg, isLoading, error } = usePackage(scope, name);
  const { versions, isLoading: versionsLoading } = usePackageVersions(scope, name);
  const { readme, isLoading: readmeLoading } = usePackageReadme(scope, name);

  const fullName = scope.startsWith('@') ? `${scope}/${name}` : name;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

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
    return new Date(timestamp).toLocaleDateString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 mx-auto mb-4 text-factory-600" />
          <h2 className="text-xl font-semibold text-factory-300 mb-2">Package not found</h2>
          <p className="text-factory-500">{fullName} does not exist in the registry.</p>
        </div>
      </div>
    );
  }

  // Use fetched versions or package versions
  const displayVersions = versions.length > 0 ? versions : pkg.versions;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-factory-800 bg-factory-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Package className="w-8 h-8 text-orange-400" />
                <h1 className="text-2xl font-bold text-factory-100">{fullName}</h1>
                {pkg.verified && (
                  <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                    <Shield className="w-3 h-3 mr-1" />
                    Verified
                  </span>
                )}
                {pkg.hasTypes && (
                  <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    TS
                  </span>
                )}
                {pkg.deprecated && (
                  <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Deprecated
                  </span>
                )}
              </div>
              <p className="text-factory-400 mb-4">{pkg.description}</p>
              
              <div className="flex flex-wrap gap-2">
                {pkg.keywords.map((keyword) => (
                  <span key={keyword} className="badge badge-info">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>

            {/* Install Command */}
            <div className="w-full lg:w-96">
              <div className="card p-4">
                <label className="block text-sm text-factory-400 mb-2">Install</label>
                <div className="flex items-center gap-2 bg-factory-900 rounded-lg p-3">
                  <code className="flex-1 text-sm text-factory-200 font-mono truncate">
                    bun add {fullName}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`bun add ${fullName}`, 'install')}
                    className="p-1.5 hover:bg-factory-800 rounded"
                  >
                    {copied === 'install' ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-factory-400" />
                    )}
                  </button>
                </div>

                <div className="mt-4 text-sm">
                  <div className="flex justify-between text-factory-400 mb-1">
                    <span>Version</span>
                    <span className="text-factory-200">{pkg.version}</span>
                  </div>
                  <div className="flex justify-between text-factory-400 mb-1">
                    <span>License</span>
                    <span className="text-factory-200">{pkg.license}</span>
                  </div>
                  <div className="flex justify-between text-factory-400 mb-1">
                    <span>Downloads</span>
                    <span className="text-factory-200">{formatNumber(pkg.downloads)}</span>
                  </div>
                  <div className="flex justify-between text-factory-400">
                    <span>Last publish</span>
                    <span className="text-factory-200">{formatDate(pkg.publishedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-6 overflow-x-auto -mb-px">
            {([
              { id: 'readme' as const, label: 'Readme', icon: FileText },
              { id: 'versions' as const, label: `Versions (${displayVersions.length})`, icon: Tag },
              { id: 'dependencies' as const, label: 'Dependencies', icon: GitFork },
              { id: 'files' as const, label: 'Files', icon: Code },
            ]).map(({ id, label, icon: Icon }) => (
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
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-3">
            {tab === 'readme' && (
              <div className="card p-6 prose prose-invert max-w-none">
                {readmeLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                  </div>
                ) : readme ? (
                  <div dangerouslySetInnerHTML={{ 
                    __html: readme
                      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
                      .replace(/`([^`]+)`/g, '<code>$1</code>')
                      .replace(/\n/g, '<br/>') 
                  }} />
                ) : (
                  <p className="text-factory-500">No README available</p>
                )}
              </div>
            )}

            {tab === 'versions' && (
              <div className="card divide-y divide-factory-800">
                {versionsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                  </div>
                ) : displayVersions.length > 0 ? (
                  displayVersions.map((version) => (
                    <div
                      key={version.version}
                      className={clsx(
                        'p-4 flex items-center justify-between',
                        version.deprecated && 'opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Tag className="w-4 h-4 text-factory-400" />
                        <span className={clsx(
                          'font-mono',
                          version.version === pkg.version ? 'text-accent-400' : 'text-factory-200'
                        )}>
                          v{version.version}
                        </span>
                        {version.version === pkg.version && (
                          <span className="badge bg-accent-500/20 text-accent-400 border border-accent-500/30">
                            latest
                          </span>
                        )}
                        {version.deprecated && (
                          <span className="badge bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            deprecated
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-factory-500">
                        <span>{formatSize(version.size)}</span>
                        <span>{formatDate(version.publishedAt)}</span>
                        <button
                          onClick={() => copyToClipboard(`bun add ${fullName}@${version.version}`, version.version)}
                          className="btn btn-secondary text-xs py-1 px-2"
                        >
                          {copied === version.version ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="p-4 text-factory-500">No versions available</p>
                )}
              </div>
            )}

            {tab === 'dependencies' && (
              <div className="space-y-6">
                <div className="card p-6">
                  <h3 className="font-semibold text-factory-100 mb-4">Dependencies ({Object.keys(pkg.dependencies).length})</h3>
                  {Object.keys(pkg.dependencies).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(pkg.dependencies).map(([dep, version]) => (
                        <div key={dep} className="flex items-center justify-between p-2 bg-factory-800/50 rounded">
                          <span className="text-factory-200 font-mono">{dep}</span>
                          <span className="text-factory-500">{version}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-factory-500">No dependencies</p>
                  )}
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold text-factory-100 mb-4">Dev Dependencies ({Object.keys(pkg.devDependencies).length})</h3>
                  {Object.keys(pkg.devDependencies).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(pkg.devDependencies).map(([dep, version]) => (
                        <div key={dep} className="flex items-center justify-between p-2 bg-factory-800/50 rounded">
                          <span className="text-factory-200 font-mono">{dep}</span>
                          <span className="text-factory-500">{version}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-factory-500">No dev dependencies</p>
                  )}
                </div>
              </div>
            )}

            {tab === 'files' && (
              <div className="card p-6">
                <p className="text-factory-400 mb-4">Package contents from tarball</p>
                <div className="bg-factory-900 rounded-lg p-4 font-mono text-sm text-factory-300">
                  <pre>{`├── dist/
│   ├── index.js
│   └── index.d.ts
├── package.json
├── README.md
└── LICENSE`}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Registry Config */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-accent-400" />
                Registry Setup
              </h3>
              <p className="text-factory-500 text-sm mb-4">
                Configure your package manager to use Jeju registry:
              </p>
              <div className="bg-factory-900 rounded-lg p-3 font-mono text-xs mb-4">
                <pre className="text-factory-400"># .npmrc or .bunfig.toml
@jeju:registry=https://pkg.jejunetwork.org</pre>
              </div>
              <button
                onClick={() => copyToClipboard('@jeju:registry=https://pkg.jejunetwork.org', 'registry')}
                className="btn btn-secondary text-sm w-full"
              >
                {copied === 'registry' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copy Config
              </button>
            </div>

            {/* Links */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4">Links</h3>
              <div className="space-y-2">
                {pkg.homepage && (
                  <a 
                    href={pkg.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-accent-400 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Homepage
                  </a>
                )}
                {pkg.repository && (
                  <a 
                    href={pkg.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-factory-400 hover:text-accent-400 transition-colors"
                  >
                    <Code className="w-4 h-4" />
                    Repository
                  </a>
                )}
              </div>
            </div>

            {/* Maintainers */}
            <div className="card p-6">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5" />
                Maintainers
              </h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-factory-800 flex items-center justify-center">
                  <span className="text-factory-400 font-medium">{pkg.author[0]?.toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-factory-200">{pkg.author}</p>
                  <p className="text-factory-500 text-sm">Owner</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
