import { hasArrayProperty } from '@jejunetwork/types'
import { useQuery } from '@tanstack/react-query'
import { api, extractDataSafe } from '../lib/client'

export type CIRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'

export interface CIJob {
  name: string
  status: string
  duration?: number
}

export interface CIRun {
  id: string
  workflow: string
  status: CIRunStatus
  conclusion?: string
  branch: string
  commit: string
  commitMessage: string
  author: string
  duration?: number
  startedAt: number
  completedAt?: number
  jobs: CIJob[]
  createdAt: number
  updatedAt: number
}

interface CIRunsResponse {
  runs: CIRun[]
}

function isCIRunsResponse(data: unknown): data is CIRunsResponse {
  return hasArrayProperty(data, 'runs')
}

async function fetchCIRuns(query?: {
  repo?: string
  status?: CIRunStatus
  branch?: string
}): Promise<CIRun[]> {
  const response = await api.api.ci.get({
    query: {
      repo: query?.repo,
      status: query?.status,
      branch: query?.branch,
    },
  })
  const data = extractDataSafe(response)
  if (!isCIRunsResponse(data)) return []
  return data.runs
}

export function useCIRuns(query?: {
  repo?: string
  status?: CIRunStatus
  branch?: string
}) {
  const {
    data: runs,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ciRuns', query],
    queryFn: () => fetchCIRuns(query),
    staleTime: 10000,
    refetchInterval: 30000,
  })

  return { runs: runs || [], isLoading, error, refetch }
}

export function useCIStats() {
  const { runs, isLoading, error } = useCIRuns()

  const stats = {
    total: runs.length,
    running: runs.filter((r) => r.status === 'running').length,
    success: runs.filter((r) => r.status === 'success').length,
    failed: runs.filter((r) => r.status === 'failure').length,
  }

  return { stats, isLoading, error }
}
