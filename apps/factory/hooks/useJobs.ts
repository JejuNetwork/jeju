'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export type JobType = 'training' | 'inference' | 'validation' | 'compute'
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface JobProvider {
  id: string
  name: string
  address: string
}

export interface Job {
  id: string
  name: string
  type: JobType
  status: JobStatus
  progress: number
  provider?: JobProvider
  cost: string
  duration?: number
  startedAt?: number
  completedAt?: number
  createdAt: number
  logs?: string[]
  modelId?: string
  datasetId?: string
  config?: Record<string, string | number | boolean>
}

export interface JobStats {
  totalJobs: number
  runningJobs: number
  completedJobs: number
  totalCost: string
}

// ============ Fetchers ============

async function fetchJobs(filter?: {
  type?: JobType
  status?: JobStatus
}): Promise<Job[]> {
  const dwsUrl = getDwsUrl()
  const params = new URLSearchParams()
  if (filter?.type) params.set('type', filter.type)
  if (filter?.status) params.set('status', filter.status)

  const res = await fetch(`${dwsUrl}/api/jobs?${params.toString()}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.jobs || []
}

async function fetchJob(jobId: string): Promise<Job | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/jobs/${jobId}`)
  if (!res.ok) return null
  return res.json()
}

async function fetchJobStats(): Promise<JobStats> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/jobs/stats`)
  if (!res.ok) {
    return {
      totalJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalCost: '0 ETH',
    }
  }
  return res.json()
}

async function cancelJob(jobId: string): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/jobs/${jobId}/cancel`, {
    method: 'POST',
  })
  return res.ok
}

async function retryJob(jobId: string): Promise<Job | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/jobs/${jobId}/retry`, {
    method: 'POST',
  })
  if (!res.ok) return null
  return res.json()
}

// ============ Hooks ============

export function useJobs(filter?: { type?: JobType; status?: JobStatus }) {
  const {
    data: jobs,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['jobs', filter],
    queryFn: () => fetchJobs(filter),
    staleTime: 10000, // Refresh more frequently for jobs
    refetchInterval: 30000, // Auto-refresh every 30s
  })

  return {
    jobs: jobs || [],
    isLoading,
    error,
    refetch,
  }
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
    staleTime: 5000,
    refetchInterval: (data) => (data?.status === 'running' ? 5000 : false),
  })

  return {
    job,
    isLoading,
    error,
    refetch,
  }
}

export function useJobStats() {
  const {
    data: stats,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['jobStats'],
    queryFn: fetchJobStats,
    staleTime: 30000,
  })

  return {
    stats: stats || {
      totalJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalCost: '0 ETH',
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
      queryClient.invalidateQueries({ queryKey: ['jobStats'] })
    },
  })
}

export function useRetryJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (jobId: string) => retryJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['jobStats'] })
    },
  })
}
