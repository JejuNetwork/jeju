import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface RepoBranch {
  name: string
  protected: boolean
  default: boolean
}

export interface RepoWebhook {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: number
}

export interface RepoCollaborator {
  login: string
  avatar: string
  permission: 'read' | 'write' | 'admin'
}

export interface RepoSettings {
  name: string
  description: string
  visibility: 'public' | 'private'
  defaultBranch: string
  branches: RepoBranch[]
  webhooks: RepoWebhook[]
  collaborators: RepoCollaborator[]
  hasIssues: boolean
  hasWiki: boolean
  hasDiscussions: boolean
  allowMergeCommit: boolean
  allowSquashMerge: boolean
  allowRebaseMerge: boolean
  deleteBranchOnMerge: boolean
  archived: boolean
}

// Browser-only hook - API is same origin
const API_BASE = ''

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

async function fetchRepoSettings(
  owner: string,
  repo: string,
): Promise<RepoSettings | null> {
  return fetchApi<RepoSettings>(`/api/git/${owner}/${repo}/settings`)
}

async function updateRepoSettings(
  owner: string,
  repo: string,
  settings: Partial<RepoSettings>,
): Promise<boolean> {
  const response = await fetchApi(`/api/git/${owner}/${repo}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })
  return response !== null
}

async function addCollaborator(
  owner: string,
  repo: string,
  data: { login: string; permission: 'read' | 'write' | 'admin' },
): Promise<boolean> {
  const response = await fetchApi(
    `/api/git/${owner}/${repo}/settings/collaborators`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
  return response !== null
}

async function removeCollaborator(
  owner: string,
  repo: string,
  login: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/git/${owner}/${repo}/settings/collaborators/${login}`,
    { method: 'DELETE' },
  )
  return response !== null
}

async function addWebhook(
  owner: string,
  repo: string,
  data: { url: string; events: string[] },
): Promise<RepoWebhook | null> {
  return fetchApi<RepoWebhook>(`/api/git/${owner}/${repo}/settings/webhooks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function deleteWebhook(
  owner: string,
  repo: string,
  webhookId: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/git/${owner}/${repo}/settings/webhooks/${webhookId}`,
    { method: 'DELETE' },
  )
  return response !== null
}

async function transferRepo(
  owner: string,
  repo: string,
  newOwner: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/git/${owner}/${repo}/settings/transfer`,
    {
      method: 'POST',
      body: JSON.stringify({ newOwner }),
    },
  )
  return response !== null
}

async function deleteRepo(owner: string, repo: string): Promise<boolean> {
  const response = await fetchApi(`/api/git/${owner}/${repo}/settings`, {
    method: 'DELETE',
  })
  return response !== null
}

export function useRepoSettings(owner: string, repo: string) {
  const {
    data: settings,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['repoSettings', owner, repo],
    queryFn: () => fetchRepoSettings(owner, repo),
    enabled: !!owner && !!repo,
    staleTime: 60000,
  })

  return {
    settings,
    isLoading,
    error,
    refetch,
  }
}

export function useUpdateRepoSettings(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: Partial<RepoSettings>) =>
      updateRepoSettings(owner, repo, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoSettings', owner, repo] })
      queryClient.invalidateQueries({ queryKey: ['repo', owner, repo] })
    },
  })
}

export function useAddCollaborator(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      login: string
      permission: 'read' | 'write' | 'admin'
    }) => addCollaborator(owner, repo, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoSettings', owner, repo] })
    },
  })
}

export function useRemoveCollaborator(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (login: string) => removeCollaborator(owner, repo, login),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoSettings', owner, repo] })
    },
  })
}

export function useAddWebhook(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { url: string; events: string[] }) =>
      addWebhook(owner, repo, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoSettings', owner, repo] })
    },
  })
}

export function useDeleteWebhook(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (webhookId: string) => deleteWebhook(owner, repo, webhookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repoSettings', owner, repo] })
    },
  })
}

export function useTransferRepo(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (newOwner: string) => transferRepo(owner, repo, newOwner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
    },
  })
}

export function useDeleteRepo(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => deleteRepo(owner, repo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
    },
  })
}
