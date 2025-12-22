/**
 * DWS (Decentralized Web Services) hooks
 * React hooks for interacting with Git, Packages, CI/CD, and Compute
 */

import { useCallback, useEffect, useState } from 'react'
import type { DWSNode } from '@/lib/services/dws'
import type { Package, Repository } from '@/types'

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030'

interface HookDWSNode extends Omit<DWSNode, 'capabilities'> {
  nodeTypes: string[]
}

interface HookDWSHealth {
  status: 'healthy' | 'degraded' | 'unavailable'
  services: Record<string, boolean>
  timestamp: number
  decentralized?: {
    registeredNodes: number
    connectedPeers: number
    frontendCid: string
    p2pEnabled: boolean
  }
}

interface Workflow {
  id: string
  name: string
  repoId: string
  triggers: string[]
  active: boolean
}

interface WorkflowRun {
  id: string
  workflowId: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  conclusion?: 'success' | 'failure' | 'cancelled'
  startedAt: number
  completedAt?: number
}

export function useDWS() {
  const [isInitialized, setIsInitialized] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<HookDWSNode[]>([])
  const [health, setHealth] = useState<HookDWSHealth | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    const response = await fetch(`${DWS_API_URL}/health`)
    if (!response.ok) {
      setError('DWS health check failed')
      setIsConnected(false)
      setIsLoading(false)
      return
    }

    const healthData: HookDWSHealth = await response.json()
    setHealth(healthData)
    setIsConnected(healthData.status === 'healthy')
    setIsInitialized(true)

    const nodesResponse = await fetch(`${DWS_API_URL}/api/nodes`)
    if (nodesResponse.ok) {
      const nodesData = await nodesResponse.json()
      setNodes(
        nodesData.map(
          (n: {
            agentId: number | string
            endpoint: string
            latency?: number
            isBanned?: boolean
            nodeTypes?: string[]
            stake?: string | number
          }) => ({
            ...n,
            agentId: BigInt(n.agentId || 0),
            stake: BigInt(n.stake || 0),
          }),
        ),
      )
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    // Refresh every 30 seconds
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [refresh])

  return {
    isInitialized,
    isConnected,
    isLoading,
    error,
    nodes,
    nodeCount: nodes.length,
    health,
    refresh,
  }
}

// ============ Git Hooks ============

export function useDWSGit() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    fetch(`${DWS_API_URL}/health`)
      .then((r) => r.ok && setIsReady(true))
      .catch(() => setIsReady(false))
  }, [])

  const listRepositories = useCallback(
    async (owner?: string): Promise<Repository[]> => {
      const url = owner ? `/api/git/repos?owner=${owner}` : '/api/git/repos'
      const response = await fetch(`${DWS_API_URL}${url}`)
      if (!response.ok) throw new Error('Failed to fetch repositories')
      return response.json()
    },
    [],
  )

  const getRepository = useCallback(
    async (owner: string, name: string): Promise<Repository> => {
      const response = await fetch(
        `${DWS_API_URL}/api/git/repos/${owner}/${name}`,
      )
      if (!response.ok) throw new Error('Repository not found')
      return response.json()
    },
    [],
  )

  const getRepoFiles = useCallback(
    async (
      owner: string,
      name: string,
      path = '',
      ref = 'main',
    ): Promise<{ path: string; type: 'file' | 'dir'; size?: number }[]> => {
      const response = await fetch(
        `${DWS_API_URL}/api/git/repos/${owner}/${name}/files?path=${path}&ref=${ref}`,
      )
      if (!response.ok) throw new Error('Failed to fetch files')
      return response.json()
    },
    [],
  )

  const createRepository = useCallback(
    async (params: {
      name: string
      description?: string
      isPrivate: boolean
    }): Promise<Repository> => {
      const response = await fetch(`${DWS_API_URL}/api/git/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!response.ok) throw new Error('Failed to create repository')
      return response.json()
    },
    [],
  )

  return {
    isReady,
    listRepositories,
    getRepository,
    getRepoFiles,
    createRepository,
  }
}

// ============ Package Hooks ============

export function useDWSPackages() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    fetch(`${DWS_API_URL}/health`)
      .then((r) => r.ok && setIsReady(true))
      .catch(() => setIsReady(false))
  }, [])

  const searchPackages = useCallback(
    async (query: string): Promise<Package[]> => {
      const response = await fetch(
        `${DWS_API_URL}/api/packages/search?q=${query}`,
      )
      if (!response.ok) throw new Error('Search failed')
      return response.json()
    },
    [],
  )

  const getPackage = useCallback(
    async (name: string, version?: string): Promise<Package> => {
      const url = version
        ? `/api/packages/${name}/${version}`
        : `/api/packages/${name}`
      const response = await fetch(`${DWS_API_URL}${url}`)
      if (!response.ok) throw new Error('Package not found')
      return response.json()
    },
    [],
  )

  const publishPackage = useCallback(
    async (
      tarball: Blob,
      metadata: {
        name: string
        version: string
        description?: string
        author: string
        license: string
      },
    ): Promise<Package> => {
      const formData = new FormData()
      formData.append('tarball', tarball)
      formData.append('metadata', JSON.stringify(metadata))

      const response = await fetch(`${DWS_API_URL}/api/packages`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) throw new Error('Publish failed')
      return response.json()
    },
    [],
  )

  return {
    isReady,
    searchPackages,
    getPackage,
    publishPackage,
  }
}

// ============ CI/CD Hooks ============

export function useDWSCI() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    fetch(`${DWS_API_URL}/health`)
      .then((r) => r.ok && setIsReady(true))
      .catch(() => setIsReady(false))
  }, [])

  const listWorkflows = useCallback(
    async (repoId?: string): Promise<Workflow[]> => {
      const url = repoId
        ? `/api/ci/workflows?repoId=${repoId}`
        : '/api/ci/workflows'
      const response = await fetch(`${DWS_API_URL}${url}`)
      if (!response.ok) throw new Error('Failed to fetch workflows')
      return response.json()
    },
    [],
  )

  const getWorkflowRuns = useCallback(
    async (workflowId: string): Promise<WorkflowRun[]> => {
      const response = await fetch(
        `${DWS_API_URL}/api/ci/workflows/${workflowId}/runs`,
      )
      if (!response.ok) throw new Error('Failed to fetch runs')
      return response.json()
    },
    [],
  )

  const triggerWorkflow = useCallback(
    async (
      workflowId: string,
      inputs?: Record<string, string>,
    ): Promise<WorkflowRun> => {
      const response = await fetch(
        `${DWS_API_URL}/api/ci/workflows/${workflowId}/trigger`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs }),
        },
      )
      if (!response.ok) throw new Error('Failed to trigger workflow')
      return response.json()
    },
    [],
  )

  const getRunLogs = useCallback(async (runId: string): Promise<string> => {
    const response = await fetch(`${DWS_API_URL}/api/ci/runs/${runId}/logs`)
    if (!response.ok) throw new Error('Failed to fetch logs')
    return response.text()
  }, [])

  const cancelRun = useCallback(async (runId: string): Promise<void> => {
    const response = await fetch(`${DWS_API_URL}/api/ci/runs/${runId}/cancel`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error('Failed to cancel run')
  }, [])

  const rerunWorkflow = useCallback(
    async (runId: string): Promise<WorkflowRun> => {
      const response = await fetch(
        `${DWS_API_URL}/api/ci/runs/${runId}/rerun`,
        {
          method: 'POST',
        },
      )
      if (!response.ok) throw new Error('Failed to rerun workflow')
      return response.json()
    },
    [],
  )

  return {
    isReady,
    listWorkflows,
    getWorkflowRuns,
    triggerWorkflow,
    getRunLogs,
    cancelRun,
    rerunWorkflow,
  }
}

// ============ Compute Hooks ============

export function useDWSCompute() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    fetch(`${DWS_API_URL}/health`)
      .then((r) => r.ok && setIsReady(true))
      .catch(() => setIsReady(false))
  }, [])

  const createTrainingJob = useCallback(
    async (params: {
      modelId: string
      datasetId: string
      configUri: string
    }): Promise<{ jobId: string }> => {
      const response = await fetch(`${DWS_API_URL}/api/compute/training`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!response.ok) throw new Error('Failed to create training job')
      return response.json()
    },
    [],
  )

  const createInferenceJob = useCallback(
    async (params: {
      modelId: string
      input: Record<string, unknown>
    }): Promise<{ output: Record<string, unknown>; jobId: string }> => {
      const response = await fetch(`${DWS_API_URL}/api/compute/inference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!response.ok) throw new Error('Failed to run inference')
      return response.json()
    },
    [],
  )

  const getJobStatus = useCallback(
    async (
      jobId: string,
    ): Promise<{
      status: 'pending' | 'running' | 'completed' | 'failed'
      progress?: number
      output?: Record<string, unknown>
    }> => {
      const response = await fetch(`${DWS_API_URL}/api/compute/jobs/${jobId}`)
      if (!response.ok) throw new Error('Job not found')
      return response.json()
    },
    [],
  )

  return {
    isReady,
    createTrainingJob,
    createInferenceJob,
    getJobStatus,
  }
}

// ============ Models Hooks ============

export function useDWSModels() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    fetch(`${DWS_API_URL}/health`)
      .then((r) => r.ok && setIsReady(true))
      .catch(() => setIsReady(false))
  }, [])

  const listModels = useCallback(
    async (params?: {
      type?: string
      search?: string
      sortBy?: string
    }): Promise<
      {
        id: string
        name: string
        organization: string
        type: string
        downloads: number
        stars: number
      }[]
    > => {
      const query = new URLSearchParams(
        params as Record<string, string>,
      ).toString()
      const response = await fetch(`${DWS_API_URL}/api/models?${query}`)
      if (!response.ok) throw new Error('Failed to fetch models')
      return response.json()
    },
    [],
  )

  const getModel = useCallback(
    async (
      org: string,
      name: string,
    ): Promise<{
      id: string
      name: string
      organization: string
      description: string
      type: string
      parameters: string
      downloads: number
      stars: number
      files: { name: string; size: string }[]
    }> => {
      const response = await fetch(`${DWS_API_URL}/api/models/${org}/${name}`)
      if (!response.ok) throw new Error('Model not found')
      return response.json()
    },
    [],
  )

  const uploadModel = useCallback(
    async (params: {
      name: string
      organization: string
      description: string
      type: string
      license: string
      tags: string[]
      weightsUri: string
    }): Promise<{ modelId: string }> => {
      const response = await fetch(`${DWS_API_URL}/api/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!response.ok) throw new Error('Failed to upload model')
      return response.json()
    },
    [],
  )

  const runInference = useCallback(
    async (
      org: string,
      name: string,
      input: Record<string, unknown>,
    ): Promise<{ output: Record<string, unknown> }> => {
      const response = await fetch(
        `${DWS_API_URL}/api/models/${org}/${name}/inference`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      if (!response.ok) throw new Error('Inference failed')
      return response.json()
    },
    [],
  )

  return {
    isReady,
    listModels,
    getModel,
    uploadModel,
    runInference,
  }
}
