'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export interface Repository {
  id: string
  name: string
  owner: string
  fullName: string
  description: string
  isPrivate: boolean
  language: string
  stars: number
  forks: number
  watchers: number
  issues: number
  updatedAt: number
  createdAt: number
  defaultBranch: string
  topics: string[]
  isFork?: boolean
  parentRepo?: string
}

export interface RepositoryStats {
  totalRepos: number
  publicRepos: number
  totalStars: number
  contributors: number
}

export interface GitFile {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
  lastCommitMessage?: string
  lastModified?: number
}

export interface RepoData {
  owner: string
  name: string
  description: string
  isPrivate: boolean
  stars: number
  forks: number
  tags: number
  branches: string[]
  files: GitFile[]
  commits: GitCommit[]
  readme?: string
}

export interface GitCommit {
  sha: string
  message: string
  author: string
  authorEmail: string
  date: number
}

export interface GitBranch {
  name: string
  sha: string
  isDefault: boolean
  isProtected: boolean
}

// ============ Fetchers ============

async function fetchRepositories(query?: {
  owner?: string
  search?: string
}): Promise<Repository[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (query?.owner) params.set('owner', query.owner)
  if (query?.search) params.set('q', query.search)

  const res = await fetch(`${dwsUrl}/api/git/repos?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.repositories || []).map(
    (r: Repository & { updatedAt: number }) => ({
      ...r,
      fullName: `${r.owner}/${r.name}`,
      updatedAt: r.updatedAt || Date.now(),
    }),
  )
}

async function fetchRepository(
  owner: string,
  name: string,
): Promise<Repository | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/repos/${owner}/${name}`)
  if (!res.ok) return null
  return res.json()
}

async function fetchRepoData(
  owner: string,
  name: string,
): Promise<RepoData | null> {
  const dwsUrl = getDwsUrl()

  // Fetch repo details, files, commits, and branches in parallel
  const [repoRes, filesRes, commitsRes, branchesRes] = await Promise.all([
    fetch(`${dwsUrl}/api/git/repos/${owner}/${name}`),
    fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/files`),
    fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/commits?limit=10`),
    fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/branches`),
  ])

  if (!repoRes.ok) return null

  const repo = await repoRes.json()
  const filesData = filesRes.ok ? await filesRes.json() : { files: [] }
  const commitsData = commitsRes.ok ? await commitsRes.json() : { commits: [] }
  const branchesData = branchesRes.ok
    ? await branchesRes.json()
    : { branches: [] }

  return {
    owner,
    name,
    description: repo.description || '',
    isPrivate: repo.isPrivate || false,
    stars: repo.stars || 0,
    forks: repo.forks || 0,
    tags: repo.tags || 0,
    branches: (branchesData.branches || []).map(
      (b: { name: string }) => b.name,
    ),
    files: filesData.files || [],
    commits: commitsData.commits || [],
    readme: repo.readme,
  }
}

async function fetchRepositoryStats(): Promise<RepositoryStats> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/stats`)
  if (!res.ok) {
    return { totalRepos: 0, publicRepos: 0, totalStars: 0, contributors: 0 }
  }
  return res.json()
}

async function fetchRepoFiles(
  owner: string,
  name: string,
  path: string = '',
  ref?: string,
): Promise<GitFile[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  if (ref) params.set('ref', ref)

  const res = await fetch(
    `${dwsUrl}/api/git/repos/${owner}/${name}/files?${params.toString()}`,
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.files || []
}

async function fetchRepoCommits(
  owner: string,
  name: string,
  options?: { branch?: string; limit?: number },
): Promise<GitCommit[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (options?.branch) params.set('branch', options.branch)
  if (options?.limit) params.set('limit', options.limit.toString())

  const res = await fetch(
    `${dwsUrl}/api/git/repos/${owner}/${name}/commits?${params.toString()}`,
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.commits || []
}

async function fetchRepoBranches(
  owner: string,
  name: string,
): Promise<GitBranch[]> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/branches`)
  if (!res.ok) return []
  const data = await res.json()
  return data.branches || []
}

async function starRepository(owner: string, name: string): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/star`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return res.ok
}

async function forkRepository(
  owner: string,
  name: string,
): Promise<Repository | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/repos/${owner}/${name}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) return null
  return res.json()
}

// ============ Hooks ============

export function useRepositories(query?: { owner?: string; search?: string }) {
  const {
    data: repositories,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['repositories', query],
    queryFn: () => fetchRepositories(query),
    staleTime: 30000,
  })

  return {
    repositories: repositories || [],
    isLoading,
    error,
    refetch,
  }
}

export function useRepository(owner: string, name: string) {
  const {
    data: repository,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => fetchRepository(owner, name),
    enabled: !!owner && !!name,
    staleTime: 30000,
  })

  return {
    repository,
    isLoading,
    error,
    refetch,
  }
}

export function useRepo(owner: string, name: string) {
  const {
    data: repo,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['repo', owner, name],
    queryFn: () => fetchRepoData(owner, name),
    enabled: !!owner && !!name,
    staleTime: 30000,
  })

  return {
    repo,
    isLoading,
    error,
    refetch,
  }
}

export function useRepositoryStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repositoryStats'],
    queryFn: fetchRepositoryStats,
    staleTime: 120000,
  })

  return {
    stats: stats || {
      totalRepos: 0,
      publicRepos: 0,
      totalStars: 0,
      contributors: 0,
    },
    isLoading,
    error,
  }
}

export function useRepoFiles(
  owner: string,
  name: string,
  path?: string,
  ref?: string,
) {
  const {
    data: files,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repoFiles', owner, name, path, ref],
    queryFn: () => fetchRepoFiles(owner, name, path, ref),
    enabled: !!owner && !!name,
    staleTime: 30000,
  })

  return {
    files: files || [],
    isLoading,
    error,
  }
}

export function useRepoCommits(
  owner: string,
  name: string,
  options?: { branch?: string; limit?: number },
) {
  const {
    data: commits,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repoCommits', owner, name, options],
    queryFn: () => fetchRepoCommits(owner, name, options),
    enabled: !!owner && !!name,
    staleTime: 30000,
  })

  return {
    commits: commits || [],
    isLoading,
    error,
  }
}

export function useRepoBranches(owner: string, name: string) {
  const {
    data: branches,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repoBranches', owner, name],
    queryFn: () => fetchRepoBranches(owner, name),
    enabled: !!owner && !!name,
    staleTime: 60000,
  })

  return {
    branches: branches || [],
    isLoading,
    error,
  }
}

export function useStarRepo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      starRepository(owner, name),
    onSuccess: (_, { owner, name }) => {
      queryClient.invalidateQueries({ queryKey: ['repository', owner, name] })
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

export function useForkRepo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      forkRepository(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}
