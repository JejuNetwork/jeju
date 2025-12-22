'use client';

import { useState, useEffect, type ComponentType } from 'react';
import { Search, Download, Package, Shield, Clock, ExternalLink, type LucideProps } from 'lucide-react';

// Fix for Lucide React 19 type compatibility
const SearchIcon = Search as ComponentType<LucideProps>;
const DownloadIcon = Download as ComponentType<LucideProps>;
const PackageIcon = Package as ComponentType<LucideProps>;
const ShieldIcon = Shield as ComponentType<LucideProps>;
const ClockIcon = Clock as ComponentType<LucideProps>;
const ExternalLinkIcon = ExternalLink as ComponentType<LucideProps>;

interface PackageInfo {
  name: string;
  scope?: string;
  description?: string;
  latestVersion: string;
  versions: string[];
  maintainers: string[];
  downloadCount: number;
  reputationScore: number;
  verified: boolean;
  deprecated: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SearchResult {
  package: {
    name: string;
    version: string;
    description?: string;
  };
  score: {
    final: number;
  };
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<PackageInfo | null>(null);

  useEffect(() => {
    searchPackages(searchQuery || '*');
  }, []);

  async function searchPackages(query: string) {
    setLoading(true);
    const registryUrl = process.env.NEXT_PUBLIC_JEJUPKG_URL ?? 'http://localhost:4030/pkg';

    try {
      const response = await fetch(`${registryUrl}/-/v1/search?text=${encodeURIComponent(query)}&size=50`);
      if (response.ok) {
        const data = await response.json() as { objects: SearchResult[] };
        setPackages(data.objects ?? []);
      }
    } catch (error) {
      console.error('Failed to search packages:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPackageDetails(name: string) {
    const registryUrl = process.env.NEXT_PUBLIC_JEJUPKG_URL ?? 'http://localhost:4030/pkg';
    
    try {
      const response = await fetch(`${registryUrl}/${encodeURIComponent(name)}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedPackage({
          name: data.name,
          scope: data.name.startsWith('@') ? data.name.split('/')[0] : undefined,
          description: data.description,
          latestVersion: data['dist-tags']?.latest ?? Object.keys(data.versions ?? {})[0],
          versions: Object.keys(data.versions ?? {}),
          maintainers: data.maintainers?.map((m: { name: string }) => m.name) ?? [],
          downloadCount: 0,
          reputationScore: 0,
          verified: false,
          deprecated: false,
          createdAt: data.time?.created ?? new Date().toISOString(),
          updatedAt: data.time?.modified ?? new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch package details:', error);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    searchPackages(searchQuery || '*');
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Packages</h1>
            <p className="text-gray-400 mt-1">
              Decentralized NPM registry with IPFS/Arweave storage
            </p>
          </div>
          <a
            href="https://docs.jejunetwork.org/packages"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            Publishing Guide
            <ExternalLinkIcon className="w-4 h-4" />
          </a>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search packages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-lg"
            />
          </div>
        </form>

        {/* Registry Config Banner */}
        <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700">
          <h3 className="font-semibold mb-2">Configure your package manager</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">npm:</span>
              <code className="ml-2 px-2 py-1 bg-gray-900 rounded text-green-400">
                npm config set registry {process.env.NEXT_PUBLIC_JEJUPKG_URL ?? 'http://localhost:4030/pkg'}
              </code>
            </div>
            <div>
              <span className="text-gray-400">bun:</span>
              <code className="ml-2 px-2 py-1 bg-gray-900 rounded text-green-400">
                bun config set registry {process.env.NEXT_PUBLIC_JEJUPKG_URL ?? 'http://localhost:4030/pkg'}
              </code>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Package List */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            ) : packages.length === 0 ? (
              <div className="text-center py-12">
                <PackageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No packages found</p>
                <p className="text-gray-500 text-sm mt-2">
                  Try searching for something else or publish a new package
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {packages.map((result) => (
                  <button
                    key={result.package.name}
                    onClick={() => fetchPackageDetails(result.package.name)}
                    className="w-full text-left p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <PackageIcon className="w-5 h-5 text-red-400" />
                          <span className="font-semibold text-blue-400">
                            {result.package.name}
                          </span>
                          <span className="text-gray-500 text-sm">
                            v{result.package.version}
                          </span>
                        </div>
                        {result.package.description && (
                          <p className="text-gray-400 text-sm mt-1 line-clamp-2">
                            {result.package.description}
                          </p>
                        )}
                      </div>
                      <div className="text-right text-sm text-gray-400">
                        Score: {(result.score.final * 100).toFixed(0)}%
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Package Details Sidebar */}
          <div className="lg:col-span-1">
            {selectedPackage ? (
              <div className="sticky top-4 p-6 bg-gray-800 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-4">
                  <PackageIcon className="w-6 h-6 text-red-400" />
                  <h2 className="text-xl font-bold">{selectedPackage.name}</h2>
                </div>

                {selectedPackage.verified && (
                  <div className="flex items-center gap-2 mb-4 text-green-400">
                    <ShieldIcon className="w-4 h-4" />
                    <span className="text-sm">Verified Package</span>
                  </div>
                )}

                {selectedPackage.description && (
                  <p className="text-gray-400 mb-4">{selectedPackage.description}</p>
                )}

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Latest Version</span>
                    <span className="font-mono">{selectedPackage.latestVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Versions</span>
                    <span>{selectedPackage.versions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Downloads</span>
                    <span className="flex items-center gap-1">
                      <DownloadIcon className="w-4 h-4" />
                      {selectedPackage.downloadCount.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Published</span>
                    <span className="flex items-center gap-1">
                      <ClockIcon className="w-4 h-4" />
                      {formatDate(selectedPackage.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-700">
                  <h3 className="font-semibold mb-2">Install</h3>
                  <div className="space-y-2">
                    <code className="block p-2 bg-gray-900 rounded text-sm text-green-400">
                      npm install {selectedPackage.name}
                    </code>
                    <code className="block p-2 bg-gray-900 rounded text-sm text-green-400">
                      bun add {selectedPackage.name}
                    </code>
                  </div>
                </div>

                {selectedPackage.maintainers.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-gray-700">
                    <h3 className="font-semibold mb-2">Maintainers</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedPackage.maintainers.map((maintainer) => (
                        <span
                          key={maintainer}
                          className="px-2 py-1 bg-gray-700 rounded text-sm"
                        >
                          {maintainer}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 bg-gray-800 rounded-lg border border-gray-700 text-center">
                <PackageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">Select a package to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



