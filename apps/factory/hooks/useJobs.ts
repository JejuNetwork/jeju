import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export interface JobSalary {
  min: number
  max: number
  currency: string
  period?: 'hour' | 'day' | 'week' | 'month' | 'year'
}

export interface Job {
  id: string
  title: string
  company: string
  companyLogo?: string
  type: 'full-time' | 'part-time' | 'contract' | 'bounty'
  remote: boolean
  location: string
  salary?: JobSalary
  skills: string[]
  description: string
  createdAt: number
  updatedAt: number
  applications: number
}

export interface JobStats {
  totalJobs: number
  openJobs: number
  remoteJobs: number
  averageSalary: number
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
  const data = extractDataSafe(response) as { jobs: Job[] } | null
  return data?.jobs || []
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
  return { jobs: jobs || [], isLoading, error, refetch }
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
