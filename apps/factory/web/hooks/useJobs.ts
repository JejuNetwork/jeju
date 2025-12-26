import { hasArrayProperty } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Job, JobSalary, JobStats } from '../../lib/types'
import { api, extractDataSafe } from '../lib/client'

export type { Job, JobSalary, JobStats }

// Browser-only hook - API is same origin
const API_BASE = ''

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

interface JobsResponse {
  jobs: Job[]
}

function isJobsResponse(data: unknown): data is JobsResponse {
  return hasArrayProperty(data, 'jobs')
}

async function fetchJobs(query?: {
  type?: Job['type']
  remote?: boolean
  search?: string
}): Promise<Job[]> {
  const params = new URLSearchParams()
  if (query?.type) params.set('type', query.type)
  if (query?.remote !== undefined) params.set('remote', String(query.remote))
  if (query?.search) params.set('q', query.search)
  const response = await api.api.jobs.get({ query: Object.fromEntries(params) })
  const data = extractDataSafe(response)
  if (!isJobsResponse(data)) return []
  return data.jobs
}

async function fetchJob(jobId: string): Promise<Job | null> {
  return fetchApi<Job>(`/api/jobs/${jobId}`)
}

async function fetchJobStats(): Promise<JobStats> {
  const data = await fetchApi<JobStats>('/api/jobs/stats')
  return data || { totalJobs: 0, openJobs: 0, remoteJobs: 0, averageSalary: 0 }
}

async function cancelJob(jobId: string): Promise<boolean> {
  const response = await fetchApi(`/api/jobs/${jobId}/cancel`, {
    method: 'POST',
  })
  return response !== null
}

async function retryJob(jobId: string): Promise<boolean> {
  const response = await fetchApi(`/api/jobs/${jobId}/retry`, {
    method: 'POST',
  })
  return response !== null
}

export function useJobs(query?: {
  type?: Job['type']
  remote?: boolean
  search?: string
}) {
  const {
    data: jobs,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['jobs', query],
    queryFn: () => fetchJobs(query),
    staleTime: 30000,
  })
  return { jobs: jobs ?? [], isLoading, error, refetch }
}

export function useJob(jobId: string) {
  const {
    data: job,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId),
    enabled: !!jobId,
    staleTime: 30000,
  })
  return { job, isLoading, error, refetch }
}

export function useJobStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['jobStats'],
    queryFn: fetchJobStats,
    staleTime: 120000,
  })
  return {
    stats: stats || {
      totalJobs: 0,
      openJobs: 0,
      remoteJobs: 0,
      averageSalary: 0,
    },
    isLoading,
    error,
  }
}

export function useCancelJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useRetryJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => retryJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}
