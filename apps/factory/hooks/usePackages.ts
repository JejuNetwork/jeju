import { getCoreAppUrl } from '@jejunetwork/config/ports'
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

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

async function fetchApi<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
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
  const packages = Array.isArray(data)
    ? data
    : (data as { packages?: PackageListItem[] }).packages || []
  return packages as PackageListItem[]
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
  return pkg?.versions || []
}

async function fetchPackageReadme(
  scope: string,
  name: string,
): Promise<string> {
  // Fetch package and extract readme
  const pkg = await fetchPackage(scope, name)
  return pkg?.readme || ''
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
    packages: packages || [],
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
    versions: versions || [],
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
    readme: readme || '',
    isLoading,
    error,
  }
}
