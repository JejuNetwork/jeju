/**
 * @module DependencyScanner
 * @description Scans repositories for dependencies and calculates funding weights
 *
 * Features:
 * - Multi-registry support (npm, PyPI, Cargo, Go)
 * - Transitive dependency resolution with depth tracking
 * - Weight calculation with depth decay
 * - Integration with ContributorRegistry for maintainer lookup
 */

import { Octokit } from '@octokit/rest';
import type { Address } from 'viem';

// ============ Types ============

export interface PackageInfo {
  name: string;
  version: string;
  registryType: RegistryType;
  depth: number;
  usageCount: number;
  directDependents: string[];
  maintainers: string[];
  repository?: string;
  license?: string;
}

export type RegistryType = 'npm' | 'pypi' | 'cargo' | 'go' | 'unknown';

export interface DependencyNode {
  name: string;
  version: string;
  registryType: RegistryType;
  depth: number;
  dependencies: DependencyNode[];
  metadata?: PackageMetadata;
}

export interface PackageMetadata {
  description?: string;
  homepage?: string;
  repository?: string;
  maintainers: string[];
  license?: string;
  downloads?: number;
  stars?: number;
}

export interface DependencyWeight {
  packageName: string;
  registryType: RegistryType;
  rawWeight: number;
  adjustedWeight: number;
  depth: number;
  usageCount: number;
  registeredContributorId?: string;
}

export interface ScanResult {
  repoOwner: string;
  repoName: string;
  scannedAt: number;
  totalDependencies: number;
  directDependencies: number;
  transitiveDependencies: number;
  dependencies: DependencyWeight[];
  registeredDependencies: number;
  unregisteredDependencies: number;
  totalWeight: number;
}

export interface ScannerConfig {
  githubToken: string;
  maxDepth: number;
  depthDecayBps: number;
  minWeightThreshold: number;
  includeDevDependencies: boolean;
}

// ============ Constants ============

const DEFAULT_CONFIG: ScannerConfig = {
  githubToken: process.env.GITHUB_TOKEN || '',
  maxDepth: 3,
  depthDecayBps: 2000, // 20% decay per level
  minWeightThreshold: 10,
  includeDevDependencies: false,
};

const MAX_BPS = 10000;

// ============ Registry Clients ============

async function fetchNpmPackage(packageName: string): Promise<PackageMetadata> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    throw new Error(`NPM package not found: ${packageName}`);
  }

  const data = await response.json();
  const latest = data['dist-tags']?.latest;
  const latestVersion = latest ? data.versions?.[latest] : null;

  return {
    description: data.description,
    homepage: data.homepage,
    repository: typeof data.repository === 'string' ? data.repository : data.repository?.url,
    maintainers: data.maintainers?.map((m: { name?: string; email?: string }) => m.name || m.email) || [],
    license: latestVersion?.license || data.license,
  };
}

async function fetchPyPIPackage(packageName: string): Promise<PackageMetadata> {
  const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
  if (!response.ok) {
    throw new Error(`PyPI package not found: ${packageName}`);
  }

  const data = await response.json();
  const info = data.info;

  return {
    description: info.summary,
    homepage: info.home_page || info.project_url,
    repository: info.project_urls?.Source || info.project_urls?.Repository,
    maintainers: [info.author, info.maintainer].filter(Boolean) as string[],
    license: info.license,
  };
}

async function fetchCargoPackage(packageName: string): Promise<PackageMetadata> {
  const response = await fetch(`https://crates.io/api/v1/crates/${packageName}`);
  if (!response.ok) {
    throw new Error(`Cargo package not found: ${packageName}`);
  }

  const data = await response.json();
  const crate = data.crate;

  return {
    description: crate.description,
    homepage: crate.homepage,
    repository: crate.repository,
    maintainers: [], // Would need additional API call for owners
    license: data.versions?.[0]?.license,
    downloads: crate.downloads,
  };
}

// ============ Dependency Parser ============

function detectRegistryType(filePath: string): RegistryType {
  if (filePath.includes('package.json') || filePath.includes('package-lock.json')) {
    return 'npm';
  }
  if (filePath.includes('requirements.txt') || filePath.includes('pyproject.toml') || filePath.includes('setup.py')) {
    return 'pypi';
  }
  if (filePath.includes('Cargo.toml') || filePath.includes('Cargo.lock')) {
    return 'cargo';
  }
  if (filePath.includes('go.mod') || filePath.includes('go.sum')) {
    return 'go';
  }
  return 'unknown';
}

function parseNpmDependencies(
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  includeDevDeps: boolean
): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];

  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      deps.push({ name, version });
    }
  }

  if (includeDevDeps && packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      deps.push({ name, version });
    }
  }

  return deps;
}

function parseRequirementsTxt(content: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
      continue;
    }

    // Parse formats like: package==1.0.0, package>=1.0.0, package
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*([<>=!~]+\s*[\d.]+)?/);
    if (match) {
      deps.push({
        name: match[1],
        version: match[2]?.replace(/[<>=!~\s]/g, '') || '*',
      });
    }
  }

  return deps;
}

function parseCargoToml(content: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];

  // Simple regex-based parsing for [dependencies] section
  const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
  if (depsMatch) {
    const lines = depsMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*["']?([^"'\s}]+)/);
      if (match) {
        deps.push({ name: match[1], version: match[2] });
      }
    }
  }

  return deps;
}

function parseGoMod(content: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  const lines = content.split('\n');

  let inRequire = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('require (')) {
      inRequire = true;
      continue;
    }
    if (trimmed === ')') {
      inRequire = false;
      continue;
    }
    if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
      const match = trimmed.match(/^require\s+(\S+)\s+(\S+)/);
      if (match) {
        deps.push({ name: match[1], version: match[2] });
      }
      continue;
    }

    if (inRequire) {
      const match = trimmed.match(/^(\S+)\s+(\S+)/);
      if (match && !match[1].startsWith('//')) {
        deps.push({ name: match[1], version: match[2] });
      }
    }
  }

  return deps;
}

// ============ Main Scanner Class ============

export class DependencyScanner {
  private octokit: Octokit;
  private config: ScannerConfig;
  private cache: Map<string, PackageMetadata> = new Map();
  private contributorLookup: Map<string, string> = new Map(); // depHash -> contributorId

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.octokit = new Octokit({ auth: this.config.githubToken });
  }

  /**
   * Scan a GitHub repository for dependencies
   */
  async scanRepository(owner: string, repo: string): Promise<ScanResult> {
    const startTime = Date.now();
    const allDeps = new Map<string, DependencyWeight>();

    // Fetch dependency files
    const files = await this.findDependencyFiles(owner, repo);

    for (const file of files) {
      const registryType = detectRegistryType(file.path);
      if (registryType === 'unknown') continue;

      const content = await this.fetchFileContent(owner, repo, file.path);
      const deps = this.parseDependencies(content, registryType);

      for (const dep of deps) {
        const key = `${registryType}:${dep.name}`;
        if (!allDeps.has(key)) {
          allDeps.set(key, {
            packageName: dep.name,
            registryType,
            rawWeight: 100,
            adjustedWeight: 100,
            depth: 0,
            usageCount: 1,
          });
        } else {
          const existing = allDeps.get(key);
          if (existing) {
            existing.usageCount++;
          }
        }
      }
    }

    // Resolve transitive dependencies up to maxDepth
    await this.resolveTransitiveDeps(allDeps);

    // Calculate final weights
    let totalWeight = 0;
    const dependencies: DependencyWeight[] = [];

    for (const [key, dep] of allDeps) {
      // Apply depth decay
      dep.adjustedWeight = this.applyDepthDecay(dep.rawWeight, dep.depth);

      // Apply usage multiplier
      dep.adjustedWeight = Math.floor(dep.adjustedWeight * Math.log2(dep.usageCount + 1));

      // Check for registered contributor
      const contributorId = this.contributorLookup.get(key);
      if (contributorId) {
        dep.registeredContributorId = contributorId;
      }

      if (dep.adjustedWeight >= this.config.minWeightThreshold) {
        dependencies.push(dep);
        totalWeight += dep.adjustedWeight;
      }
    }

    // Normalize weights to sum to MAX_BPS
    for (const dep of dependencies) {
      dep.adjustedWeight = Math.floor((dep.adjustedWeight * MAX_BPS) / totalWeight);
    }

    const directCount = dependencies.filter(d => d.depth === 0).length;

    return {
      repoOwner: owner,
      repoName: repo,
      scannedAt: startTime,
      totalDependencies: dependencies.length,
      directDependencies: directCount,
      transitiveDependencies: dependencies.length - directCount,
      dependencies: dependencies.sort((a, b) => b.adjustedWeight - a.adjustedWeight),
      registeredDependencies: dependencies.filter(d => d.registeredContributorId).length,
      unregisteredDependencies: dependencies.filter(d => !d.registeredContributorId).length,
      totalWeight: MAX_BPS,
    };
  }

  /**
   * Apply depth decay to weight
   */
  private applyDepthDecay(weight: number, depth: number): number {
    if (depth === 0) return weight;

    let decayFactor = MAX_BPS;
    for (let i = 0; i < depth; i++) {
      decayFactor = Math.floor((decayFactor * (MAX_BPS - this.config.depthDecayBps)) / MAX_BPS);
    }

    return Math.floor((weight * decayFactor) / MAX_BPS);
  }

  /**
   * Find dependency files in a repository
   */
  private async findDependencyFiles(
    owner: string,
    repo: string
  ): Promise<Array<{ path: string; sha: string }>> {
    const files: Array<{ path: string; sha: string }> = [];
    const targetFiles = [
      'package.json',
      'requirements.txt',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
    ];

    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: '',
      });

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === 'file' && targetFiles.includes(item.name)) {
            files.push({ path: item.path, sha: item.sha });
          }
        }
      }
    } catch (error) {
      console.error(`Failed to list repository contents: ${error}`);
    }

    // Also check common subdirectories
    const subdirs = ['packages', 'apps', 'services'];
    for (const subdir of subdirs) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path: subdir,
        });

        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.type === 'dir') {
              for (const targetFile of targetFiles) {
                try {
                  const { data: fileData } = await this.octokit.repos.getContent({
                    owner,
                    repo,
                    path: `${item.path}/${targetFile}`,
                  });
                  if (!Array.isArray(fileData) && fileData.type === 'file') {
                    files.push({ path: fileData.path, sha: fileData.sha });
                  }
                } catch {
                  // File doesn't exist, continue
                }
              }
            }
          }
        }
      } catch {
        // Subdirectory doesn't exist, continue
      }
    }

    return files;
  }

  /**
   * Fetch file content from GitHub
   */
  private async fetchFileContent(owner: string, repo: string, path: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error(`Expected file at ${path}`);
    }

    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  /**
   * Parse dependencies from file content
   */
  private parseDependencies(
    content: string,
    registryType: RegistryType
  ): Array<{ name: string; version: string }> {
    switch (registryType) {
      case 'npm':
        return parseNpmDependencies(
          JSON.parse(content),
          this.config.includeDevDependencies
        );
      case 'pypi':
        return parseRequirementsTxt(content);
      case 'cargo':
        return parseCargoToml(content);
      case 'go':
        return parseGoMod(content);
      default:
        return [];
    }
  }

  /**
   * Resolve transitive dependencies
   */
  private async resolveTransitiveDeps(deps: Map<string, DependencyWeight>): Promise<void> {
    const toResolve = Array.from(deps.entries()).filter(([, d]) => d.depth < this.config.maxDepth);

    for (const [key, dep] of toResolve) {
      try {
        const metadata = await this.fetchPackageMetadata(dep.packageName, dep.registryType);

        // For npm, we can fetch nested dependencies
        if (dep.registryType === 'npm' && dep.depth < this.config.maxDepth) {
          const { dependencies } = await this.fetchNpmPackageDeps(dep.packageName);

          for (const [name] of Object.entries(dependencies || {})) {
            const childKey = `npm:${name}`;
            if (!deps.has(childKey)) {
              deps.set(childKey, {
                packageName: name,
                registryType: 'npm',
                rawWeight: 50, // Lower base weight for transitive deps
                adjustedWeight: 0,
                depth: dep.depth + 1,
                usageCount: 1,
              });
            } else {
              const existing = deps.get(childKey);
              if (existing) {
                existing.usageCount++;
              }
            }
          }
        }

        // Cache metadata
        this.cache.set(key, metadata);
      } catch (error) {
        console.warn(`Failed to resolve transitive deps for ${key}: ${error}`);
      }
    }
  }

  /**
   * Fetch package metadata
   */
  private async fetchPackageMetadata(
    packageName: string,
    registryType: RegistryType
  ): Promise<PackageMetadata> {
    const cacheKey = `${registryType}:${packageName}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let metadata: PackageMetadata;

    switch (registryType) {
      case 'npm':
        metadata = await fetchNpmPackage(packageName);
        break;
      case 'pypi':
        metadata = await fetchPyPIPackage(packageName);
        break;
      case 'cargo':
        metadata = await fetchCargoPackage(packageName);
        break;
      default:
        metadata = { maintainers: [] };
    }

    this.cache.set(cacheKey, metadata);
    return metadata;
  }

  /**
   * Fetch npm package dependencies
   */
  private async fetchNpmPackageDeps(
    packageName: string
  ): Promise<{ dependencies: Record<string, string> }> {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (!response.ok) {
      return { dependencies: {} };
    }

    const data = await response.json();
    return { dependencies: data.dependencies || {} };
  }

  /**
   * Set registered contributors for dependency lookup
   */
  setRegisteredContributors(lookup: Map<string, string>): void {
    this.contributorLookup = lookup;
  }

  /**
   * Get package metadata
   */
  getPackageMetadata(packageName: string, registryType: RegistryType): PackageMetadata | undefined {
    return this.cache.get(`${registryType}:${packageName}`);
  }
}

// ============ Singleton Export ============

let scanner: DependencyScanner | null = null;

export function getDependencyScanner(config?: Partial<ScannerConfig>): DependencyScanner {
  if (!scanner) {
    scanner = new DependencyScanner(config);
  }
  return scanner;
}

export function resetDependencyScanner(): void {
  scanner = null;
}

