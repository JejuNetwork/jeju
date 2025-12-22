'use client'

import { useQuery } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

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

// ============ Fetchers ============

async function fetchPackages(query?: {
  scope?: string
  search?: string
}): Promise<PackageListItem[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (query?.scope) params.set('scope', query.scope)
  if (query?.search) params.set('q', query.search)

  const res = await fetch(`${dwsUrl}/api/packages?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.packages || []
}

async function fetchPackage(
  scope: string,
  name: string,
): Promise<PackageInfo | null> {
  const dwsUrl = getDwsUrl()
  // Remove @ prefix if present for API call
  const cleanScope = scope.startsWith('@') ? scope.slice(1) : scope

  const res = await fetch(`${dwsUrl}/api/packages/${cleanScope}/${name}`)
  if (!res.ok) return null
  return res.json()
}

async function fetchPackageVersions(
  scope: string,
  name: string,
): Promise<PackageVersion[]> {
  const dwsUrl = getDwsUrl()
  const cleanScope = scope.startsWith('@') ? scope.slice(1) : scope

  const res = await fetch(
    `${dwsUrl}/api/packages/${cleanScope}/${name}/versions`,
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.versions || []
}

async function fetchPackageReadme(
  scope: string,
  name: string,
): Promise<string> {
  const dwsUrl = getDwsUrl()
  const cleanScope = scope.startsWith('@') ? scope.slice(1) : scope

  const res = await fetch(`${dwsUrl}/api/packages/${cleanScope}/${name}/readme`)
  if (!res.ok) return ''
  const data = await res.json()
  return data.readme || ''
}

// ============ Hooks ============

export function usePackages(query?: { scope?: string; search?: string }) {
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
