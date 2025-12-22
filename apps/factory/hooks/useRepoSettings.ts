import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

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

// ============ Fetchers ============

async function fetchRepoSettings(
  owner: string,
  repo: string,
): Promise<RepoSettings | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/settings`)
  if (!res.ok) return null
  return res.json()
}

async function updateRepoSettings(
  owner: string,
  repo: string,
  settings: Partial<RepoSettings>,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return res.ok
}

async function addCollaborator(
  owner: string,
  repo: string,
  data: { login: string; permission: 'read' | 'write' | 'admin' },
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/collaborators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.ok
}

async function removeCollaborator(
  owner: string,
  repo: string,
  login: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/collaborators/${login}`,
    {
      method: 'DELETE',
    },
  )
  return res.ok
}

async function addWebhook(
  owner: string,
  repo: string,
  data: { url: string; events: string[] },
): Promise<RepoWebhook | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return null
  return res.json()
}

async function deleteWebhook(
  owner: string,
  repo: string,
  webhookId: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/webhooks/${webhookId}`,
    {
      method: 'DELETE',
    },
  )
  return res.ok
}

async function transferRepo(
  owner: string,
  repo: string,
  newOwner: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newOwner }),
  })
  return res.ok
}

async function deleteRepo(owner: string, repo: string): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}`, {
    method: 'DELETE',
  })
  return res.ok
}

// ============ Hooks ============

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
