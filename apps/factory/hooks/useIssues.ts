'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export type IssueState = 'open' | 'closed'
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical'

export interface IssueLabel {
  name: string
  color: string
}

export interface IssueAuthor {
  login: string
  avatar: string
}

export interface IssueComment {
  id: string
  author: IssueAuthor
  body: string
  createdAt: number
  updatedAt?: number
}

export interface Issue {
  id: string
  number: number
  title: string
  body: string
  state: IssueState
  priority?: IssuePriority
  author: IssueAuthor
  assignees: IssueAuthor[]
  labels: IssueLabel[]
  comments: number
  createdAt: number
  updatedAt: number
  closedAt?: number
  bountyId?: string
  bountyReward?: string
}

// ============ Fetchers ============

async function fetchIssues(
  owner: string,
  repo: string,
  query?: { state?: IssueState; labels?: string[] },
): Promise<Issue[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (query?.state) params.set('state', query.state)
  if (query?.labels?.length) params.set('labels', query.labels.join(','))

  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/issues?${params.toString()}`,
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.issues || []
}

async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ issue: Issue; comments: IssueComment[] } | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/issues/${issueNumber}`,
  )
  if (!res.ok) return null
  return res.json()
}

async function createIssue(
  owner: string,
  repo: string,
  data: { title: string; body: string; labels: string[]; assignees: string[] },
): Promise<Issue | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return null
  return res.json()
}

async function updateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  data: Partial<Issue>,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.ok
}

async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<IssueComment | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/git/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  )
  if (!res.ok) return null
  return res.json()
}

// ============ Hooks ============

export function useIssues(
  owner: string,
  repo: string,
  query?: { state?: IssueState; labels?: string[] },
) {
  const {
    data: issues,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['issues', owner, repo, query],
    queryFn: () => fetchIssues(owner, repo, query),
    enabled: !!owner && !!repo,
    staleTime: 30000,
  })

  return {
    issues: issues || [],
    isLoading,
    error,
    refetch,
  }
}

export function useIssue(owner: string, repo: string, issueNumber: number) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['issue', owner, repo, issueNumber],
    queryFn: () => fetchIssue(owner, repo, issueNumber),
    enabled: !!owner && !!repo && !!issueNumber,
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

export function useCreateIssue(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title: string
      body: string
      labels: string[]
      assignees: string[]
    }) => createIssue(owner, repo, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', owner, repo] })
    },
  })
}

export function useUpdateIssue(owner: string, repo: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      issueNumber,
      data,
    }: {
      issueNumber: number
      data: Partial<Issue>
    }) => updateIssue(owner, repo, issueNumber, data),
    onSuccess: (_, { issueNumber }) => {
      queryClient.invalidateQueries({
        queryKey: ['issue', owner, repo, issueNumber],
      })
      queryClient.invalidateQueries({ queryKey: ['issues', owner, repo] })
    },
  })
}

export function useAddIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: string) =>
      addIssueComment(owner, repo, issueNumber, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['issue', owner, repo, issueNumber],
      })
    },
  })
}
