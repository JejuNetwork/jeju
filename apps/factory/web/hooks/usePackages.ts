import { isRecord } from '@jejunetwork/types'
import { useQuery } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export interface PackageVersion {
  version: string
  publishedAt: number
  tarballCid: string
  size: number
  deprecated: boolean
}

export interface PackageInfo {
  name: string
  scope: string
  version: string
  description: string
  author: string
  license: string
  homepage: string
  repository: string
  downloads: number
  weeklyDownloads: number
  publishedAt: number
  versions: PackageVersion[]
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  keywords: string[]
  verified: boolean
  hasTypes: boolean
  deprecated: boolean
  readme: string
}

export interface PackageListItem {
  name: string
  scope: string
  version: string
  description: string
  downloads: number
  updatedAt: number
  verified: boolean
}

// Browser-only hook - API is same origin
const API_BASE = ''

async function fetchApi<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

interface ApiPackage {
  name: string
  version: string
  description: string
  downloads: number
  updatedAt?: number
  verified?: boolean
  scope?: string
}

function transformPackage(p: ApiPackage): PackageListItem {
  const parts = p.name.split('/')
  return {
    name: parts.length > 1 ? parts[1] : p.name,
    scope: parts.length > 1 ? parts[0] : (p.scope ?? ''),
    version: p.version,
    description: p.description,
    downloads: p.downloads,
    updatedAt: p.updatedAt ?? Date.now(),
    verified: p.verified ?? false,
  }
}

function isApiPackage(item: unknown): item is ApiPackage {
  return (
    isRecord(item) &&
    typeof item.name === 'string' &&
    typeof item.version === 'string'
  )
}

function isApiPackageArray(data: unknown): data is ApiPackage[] {
  return Array.isArray(data) && data.every(isApiPackage)
}

interface PackagesResponse {
  packages: ApiPackage[]
}

function isPackagesResponse(data: unknown): data is PackagesResponse {
  return (
    isRecord(data) &&
    Array.isArray(data.packages) &&
    data.packages.every(isApiPackage)
  )
}

async function fetchPackages(query?: {
  search?: string
}): Promise<PackageListItem[]> {
  const response = await api.api.packages.get({
    query: {
      q: query?.search,
    },
  })

  const data = extractDataSafe(response)
  if (!data) return []

  // Transform API response to expected format
  if (isApiPackageArray(data)) {
    return data.map(transformPackage)
  }
  if (isPackagesResponse(data)) {
    return data.packages.map(transformPackage)
  }
  return []
}

async function fetchPackage(
  scope: string,
  name: string,
): Promise<PackageInfo | null> {
  // Remove @ prefix if present for API call
  const cleanScope = scope.startsWith('@') ? scope.slice(1) : scope
  const packageName = cleanScope ? `${cleanScope}/${name}` : name

  return fetchApi<PackageInfo>(
    `/api/packages/${encodeURIComponent(packageName)}`,
  )
}

async function fetchPackageVersions(
  scope: string,
  name: string,
): Promise<PackageVersion[]> {
  // Fetch package and extract versions
  const pkg = await fetchPackage(scope, name)
  return pkg?.versions ?? []
}

async function fetchPackageReadme(
  scope: string,
  name: string,
): Promise<string> {
  // Fetch package and extract readme
  const pkg = await fetchPackage(scope, name)
  return pkg?.readme ?? ''
}

export function usePackages(query?: { search?: string }) {
  const {
    data: packages,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['packages', query],
    queryFn: () => fetchPackages(query),
    staleTime: 60000,
  })

  return {
    packages: packages ?? [],
    isLoading,
    error,
    refetch,
  }
}

export function usePackage(scope: string, name: string) {
  const {
    data: pkg,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['package', scope, name],
    queryFn: () => fetchPackage(scope, name),
    enabled: !!scope && !!name,
    staleTime: 60000,
  })

  return {
    package: pkg,
    isLoading,
    error,
    refetch,
  }
}

export function usePackageVersions(scope: string, name: string) {
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['packageVersions', scope, name],
    queryFn: () => fetchPackageVersions(scope, name),
    enabled: !!scope && !!name,
    staleTime: 120000,
  })

  return {
    versions: versions ?? [],
    isLoading,
    error,
  }
}

export function usePackageReadme(scope: string, name: string) {
  const {
    data: readme,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['packageReadme', scope, name],
    queryFn: () => fetchPackageReadme(scope, name),
    enabled: !!scope && !!name,
    staleTime: 300000,
  })

  return {
    readme: readme ?? '',
    isLoading,
    error,
  }
}
