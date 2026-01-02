import { isRecord } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

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

interface ApiRepository {
  id: string
  name: string
  owner?: string
  description?: string
  isPrivate: boolean
  defaultBranch: string
  stars: number
  forks: number
  openIssues?: number
  openPRs?: number
  cloneUrl?: string
  sshUrl?: string
  createdAt: number
  updatedAt: number
  language?: string
  topics?: string[]
}

interface ApiFile {
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
}

import { API_BASE } from '../lib/api'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`)
  }

  return response.json()
}

function transformRepository(r: ApiRepository): Repository {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner ?? '',
    fullName: r.owner ? `${r.owner}/${r.name}` : r.name,
    description: r.description ?? '',
    isPrivate: r.isPrivate,
    language: r.language ?? '',
    stars: r.stars,
    forks: r.forks,
    watchers: r.stars,
    issues: r.openIssues ?? 0,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    defaultBranch: r.defaultBranch,
    topics: r.topics ?? [],
  }
}

function isApiRepository(item: unknown): item is ApiRepository {
  return (
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.name === 'string'
  )
}

function isApiRepositoryArray(data: unknown): data is ApiRepository[] {
  return Array.isArray(data) && data.every(isApiRepository)
}

async function fetchRepositories(query?: {
  owner?: string
  search?: string
}): Promise<Repository[]> {
  const response = await api.api.git.get({
    query: { owner: query?.owner },
  })

  const data = extractDataSafe(response)
  if (!isApiRepositoryArray(data)) return []

  return data.map(transformRepository)
}

async function fetchRepository(
  owner: string,
  name: string,
): Promise<Repository | null> {
  const data = await fetchApi<ApiRepository>(`/api/git/${owner}/${name}`)
  return transformRepository(data)
}

async function fetchRepoData(
  owner: string,
  name: string,
): Promise<RepoData | null> {
  const repo = await fetchRepository(owner, name)
  if (!repo) return null

  const files = await fetchRepoFiles(owner, name, '', repo.defaultBranch)
  const commits = await fetchRepoCommits(owner, name, {
    branch: repo.defaultBranch,
    limit: 10,
  })

  return {
    owner,
    name,
    description: repo.description,
    isPrivate: repo.isPrivate,
    stars: repo.stars,
    forks: repo.forks,
    tags: 0,
    branches: [repo.defaultBranch],
    files,
    commits,
  }
}

async function fetchRepositoryStats(): Promise<RepositoryStats> {
  const repos = await fetchRepositories()

  return {
    totalRepos: repos.length,
    publicRepos: repos.filter((r) => !r.isPrivate).length,
    totalStars: repos.reduce((sum, r) => sum + r.stars, 0),
    contributors: new Set(repos.map((r) => r.owner)).size,
  }
}

async function fetchRepoFiles(
  owner: string,
  name: string,
  path = '',
  ref = 'main',
): Promise<GitFile[]> {
  const encodedPath = encodeURIComponent(path)
  const data = await fetchApi<ApiFile[]>(
    `/api/git/${owner}/${name}/contents/${encodedPath}?ref=${ref}`,
  )

  if (!Array.isArray(data)) return []

  return data.map((f) => ({
    name: f.path.split('/').pop() || f.path,
    path: f.path,
    type: f.type,
    size: f.size,
    sha: f.sha,
  }))
}

async function fetchRepoCommits(
  owner: string,
  name: string,
  options?: { branch?: string; limit?: number },
): Promise<GitCommit[]> {
  const ref = options?.branch ?? 'main'
  return fetchApi<GitCommit[]>(`/api/git/${owner}/${name}/commits?ref=${ref}`)
}

async function fetchRepoBranches(
  owner: string,
  name: string,
): Promise<GitBranch[]> {
  return fetchApi<GitBranch[]>(`/api/git/${owner}/${name}/branches`)
}

async function starRepository(owner: string, name: string): Promise<boolean> {
  await fetchApi(`/api/git/${owner}/${name}/star`, { method: 'POST' })
  return true
}

async function forkRepository(
  owner: string,
  name: string,
): Promise<Repository | null> {
  const data = await fetchApi<ApiRepository>(`/api/git/${owner}/${name}/fork`, {
    method: 'POST',
  })
  return transformRepository(data)
}

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
    repositories: repositories ?? [],
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
    files: files ?? [],
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
    commits: commits ?? [],
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
    branches: branches ?? [],
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
