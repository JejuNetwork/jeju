import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export interface PullRequest {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed' | 'merged'
  isDraft: boolean
  author: { name: string; avatar?: string }
  sourceBranch: string
  targetBranch: string
  labels: string[]
  reviewers: Array<{ name: string; status: string }>
  commits: number
  additions: number
  deletions: number
  changedFiles: number
  checks: { passed: number; failed: number; pending: number }
  createdAt: number
  updatedAt: number
}

export interface Review {
  id: string
  author: { name: string; avatar?: string }
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
  submittedAt: number
}

const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.FACTORY_API_URL || getCoreAppUrl('FACTORY')

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) return null
  return response.json()
}

async function fetchPullRequests(query?: {
  status?: PullRequest['status']
  repo?: string
  author?: string
}): Promise<PullRequest[]> {
  const response = await api.api.pulls.get({
    query: { status: query?.status, repo: query?.repo, author: query?.author },
  })
  const data = extractDataSafe(response) as { pulls: PullRequest[] } | null
  return data?.pulls || []
}

async function fetchPullRequest(
  prNumber: string,
): Promise<{ pullRequest: PullRequest; reviews: Review[] } | null> {
  return fetchApi<{ pullRequest: PullRequest; reviews: Review[] }>(
    `/api/pulls/${prNumber}`,
  )
}

async function createPullRequest(data: {
  repo: string
  title: string
  body: string
  sourceBranch: string
  targetBranch: string
  isDraft?: boolean
}): Promise<PullRequest | null> {
  const response = await api.api.pulls.post(data)
  return extractDataSafe(response) as PullRequest | null
}

async function mergePullRequest(
  prNumber: string,
  method?: 'merge' | 'squash' | 'rebase',
): Promise<boolean> {
  const response = await fetchApi(`/api/pulls/${prNumber}/merge`, {
    method: 'POST',
    body: JSON.stringify({ method: method || 'merge' }),
  })
  return response !== null
}

async function submitReview(
  prNumber: string,
  event: 'approve' | 'request_changes' | 'comment',
  body: string,
): Promise<Review | null> {
  return fetchApi<Review>(`/api/pulls/${prNumber}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ event, body }),
  })
}

export function usePullRequests(query?: {
  status?: PullRequest['status']
  repo?: string
  author?: string
}) {
  const {
    data: pullRequests,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['pullRequests', query],
    queryFn: () => fetchPullRequests(query),
    staleTime: 30000,
  })
  return { pullRequests: pullRequests || [], isLoading, error, refetch }
}

export function usePullRequest(prNumber: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pullRequest', prNumber],
    queryFn: () => fetchPullRequest(prNumber),
    enabled: !!prNumber,
    staleTime: 30000,
  })
  return {
    pullRequest: data?.pullRequest || null,
    reviews: data?.reviews || [],
    isLoading,
    error,
    refetch,
  }
}

export function useCreatePullRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      repo: string
      title: string
      body: string
      sourceBranch: string
      targetBranch: string
      isDraft?: boolean
    }) => createPullRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequests'] })
    },
  })
}

export function useMergePullRequest(prNumber: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (method?: 'merge' | 'squash' | 'rebase') =>
      mergePullRequest(prNumber, method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequest', prNumber] })
      queryClient.invalidateQueries({ queryKey: ['pullRequests'] })
    },
  })
}

export function useSubmitReview(prNumber: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      event,
      body,
    }: {
      event: 'approve' | 'request_changes' | 'comment'
      body: string
    }) => submitReview(prNumber, event, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequest', prNumber] })
    },
  })
}
