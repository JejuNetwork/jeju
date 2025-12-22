import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export interface Issue {
  id: string
  number: number
  repo: string
  title: string
  body: string
  status: 'open' | 'closed'
  author: { name: string; avatar?: string }
  labels: string[]
  assignees: Array<{ name: string; avatar?: string }>
  comments: number
  createdAt: number
  updatedAt: number
}

export interface IssueComment {
  id: string
  author: { name: string; avatar?: string }
  body: string
  createdAt: number
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

async function fetchIssues(query?: {
  status?: Issue['status']
  repo?: string
  author?: string
}): Promise<Issue[]> {
  const response = await api.api.issues.get({
    query: { status: query?.status, repo: query?.repo, author: query?.author },
  })
  const data = extractDataSafe(response) as { issues: Issue[] } | null
  return data?.issues || []
}

async function fetchIssue(
  issueNumber: string,
): Promise<{ issue: Issue; comments: IssueComment[] } | null> {
  return fetchApi<{ issue: Issue; comments: IssueComment[] }>(
    `/api/issues/${issueNumber}`,
  )
}

async function createIssue(data: {
  repo: string
  title: string
  body: string
  labels?: string[]
  assignees?: string[]
}): Promise<Issue | null> {
  const response = await api.api.issues.post(data)
  return extractDataSafe(response) as Issue | null
}

async function updateIssue(
  issueNumber: string,
  updates: Partial<Issue>,
): Promise<Issue | null> {
  return fetchApi<Issue>(`/api/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

async function addIssueComment(
  issueNumber: string,
  content: string,
): Promise<IssueComment | null> {
  return fetchApi<IssueComment>(`/api/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export function useIssues(query?: {
  status?: Issue['status']
  repo?: string
  author?: string
}) {
  const {
    data: issues,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['issues', query],
    queryFn: () => fetchIssues(query),
    staleTime: 30000,
  })
  return { issues: issues || [], isLoading, error, refetch }
}

export function useIssue(issueNumber: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['issue', issueNumber],
    queryFn: () => fetchIssue(issueNumber),
    enabled: !!issueNumber,
    staleTime: 30000,
  })
  return {
    issue: data?.issue || null,
    comments: data?.comments || [],
    isLoading,
    error,
    refetch,
  }
}

export function useCreateIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      repo: string
      title: string
      body: string
      labels?: string[]
      assignees?: string[]
    }) => createIssue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })
}

export function useUpdateIssue(issueNumber: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (updates: Partial<Issue>) => updateIssue(issueNumber, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueNumber] })
      queryClient.invalidateQueries({ queryKey: ['issues'] })
    },
  })
}

export function useAddIssueComment(issueNumber: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => addIssueComment(issueNumber, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueNumber] })
    },
  })
}
