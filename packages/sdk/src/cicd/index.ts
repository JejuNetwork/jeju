/**
 * CI/CD Module - Continuous Integration and Deployment
 *
 * Provides TypeScript interface for:
 * - Workflow management and execution
 * - Build and deployment pipelines
 * - Artifact management
 * - Deployment to staging/production
 */

import type { NetworkType } from '@jejunetwork/types'
import { getServicesConfig } from '../config'
import type { JejuWallet } from '../wallet'

// ============================================================================
// Types
// ============================================================================

export enum CICDWorkflowStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum DeploymentEnvironment {
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export interface CICDWorkflow {
  id: string
  name: string
  repoId: string
  repoName: string
  branch: string
  trigger: 'push' | 'pull_request' | 'manual' | 'schedule' | 'tag'
  configPath: string
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  isActive: boolean
}

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  repoName: string
  branch: string
  commitSha: string
  commitMessage?: string
  status: CICDWorkflowStatus
  triggeredBy: string
  startedAt: string
  completedAt?: string
  duration?: number
  jobs: WorkflowJob[]
  artifacts?: Artifact[]
}

export interface WorkflowJob {
  id: string
  name: string
  status: CICDWorkflowStatus
  startedAt?: string
  completedAt?: string
  duration?: number
  steps: JobStep[]
  logs?: string
}

export interface JobStep {
  name: string
  status: CICDWorkflowStatus
  duration?: number
  output?: string
}

export interface Artifact {
  id: string
  name: string
  size: number
  downloadUrl: string
  expiresAt: string
}

export interface Deployment {
  id: string
  environment: DeploymentEnvironment
  repoName: string
  branch: string
  commitSha: string
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'rolled_back'
  deployedBy: string
  deployedAt: string
  url?: string
  version?: string
  previousDeploymentId?: string
}

export interface DeploymentConfig {
  environment: DeploymentEnvironment
  branch: string
  commitSha?: string
  tag?: string
  version?: string
  autoRollback?: boolean
  healthCheckUrl?: string
}

export interface CreateCICDWorkflowParams {
  repoId: string
  name: string
  configPath?: string
  triggers?: Array<'push' | 'pull_request' | 'manual' | 'schedule' | 'tag'>
  branches?: string[]
  schedule?: string // cron format
}

export interface TriggerWorkflowParams {
  workflowId: string
  branch?: string
  inputs?: Record<string, string>
}

// ============================================================================
// Module Interface
// ============================================================================

export interface CICDModule {
  // Workflows
  createWorkflow(params: CreateCICDWorkflowParams): Promise<CICDWorkflow>
  getWorkflow(workflowId: string): Promise<CICDWorkflow | null>
  listWorkflows(repoId?: string): Promise<CICDWorkflow[]>
  updateWorkflow(
    workflowId: string,
    updates: Partial<CreateCICDWorkflowParams>,
  ): Promise<CICDWorkflow>
  deleteWorkflow(workflowId: string): Promise<void>
  enableWorkflow(workflowId: string): Promise<void>
  disableWorkflow(workflowId: string): Promise<void>

  // Workflow Runs
  triggerWorkflow(params: TriggerWorkflowParams): Promise<WorkflowRun>
  getRun(runId: string): Promise<WorkflowRun | null>
  listRuns(
    workflowId?: string,
    status?: CICDWorkflowStatus,
  ): Promise<WorkflowRun[]>
  cancelRun(runId: string): Promise<void>
  rerunWorkflow(runId: string): Promise<WorkflowRun>
  getRunLogs(runId: string, jobId?: string): Promise<string>

  // Artifacts
  listArtifacts(runId: string): Promise<Artifact[]>
  downloadArtifact(artifactId: string): Promise<Blob>
  deleteArtifact(artifactId: string): Promise<void>

  // Deployments
  deploy(repoId: string, config: DeploymentConfig): Promise<Deployment>
  getDeployment(deploymentId: string): Promise<Deployment | null>
  listDeployments(
    repoId?: string,
    environment?: DeploymentEnvironment,
  ): Promise<Deployment[]>
  rollback(deploymentId: string): Promise<Deployment>
  promoteToProduction(stagingDeploymentId: string): Promise<Deployment>
  getDeploymentStatus(deploymentId: string): Promise<Deployment>

  // Releases
  createRelease(
    repoId: string,
    tag: string,
    options?: {
      name?: string
      description?: string
      prerelease?: boolean
      draft?: boolean
    },
  ): Promise<{ releaseId: string; deploymentId?: string }>
  listReleases(repoId: string): Promise<
    Array<{
      id: string
      tag: string
      name: string
      createdAt: string
      prerelease: boolean
    }>
  >

  // Queue Management
  getQueueStatus(): Promise<{
    pending: number
    running: number
    queued: number
    runners: number
    availableRunners: number
  }>
  pauseQueue(): Promise<void>
  resumeQueue(): Promise<void>
}

// ============================================================================
// Implementation
// ============================================================================

export function createCICDModule(
  wallet: JejuWallet,
  network: NetworkType,
): CICDModule {
  const services = getServicesConfig(network)
  const baseUrl = `${services.factory.api}/api/ci`

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString()
    const message = `cicd:${timestamp}`
    const signature = await wallet.signMessage(message)

    return {
      'Content-Type': 'application/json',
      'x-jeju-address': wallet.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    }
  }

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = await buildAuthHeaders()
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`CI/CD API error: ${response.status} - ${error}`)
    }

    return response.json() as Promise<T>
  }

  return {
    // Workflows
    async createWorkflow(params) {
      return request<CICDWorkflow>('/workflows', {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },

    async getWorkflow(workflowId) {
      return request<CICDWorkflow | null>(`/workflows/${workflowId}`)
    },

    async listWorkflows(repoId) {
      const query = repoId ? `?repo=${repoId}` : ''
      return request<CICDWorkflow[]>(`/workflows${query}`)
    },

    async updateWorkflow(workflowId, updates) {
      return request<CICDWorkflow>(`/workflows/${workflowId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
    },

    async deleteWorkflow(workflowId) {
      await request(`/workflows/${workflowId}`, { method: 'DELETE' })
    },

    async enableWorkflow(workflowId) {
      await request(`/workflows/${workflowId}/enable`, { method: 'POST' })
    },

    async disableWorkflow(workflowId) {
      await request(`/workflows/${workflowId}/disable`, { method: 'POST' })
    },

    // Workflow Runs
    async triggerWorkflow(params) {
      return request<WorkflowRun>(`/workflows/${params.workflowId}/trigger`, {
        method: 'POST',
        body: JSON.stringify({
          branch: params.branch,
          inputs: params.inputs,
        }),
      })
    },

    async getRun(runId) {
      return request<WorkflowRun | null>(`/runs/${runId}`)
    },

    async listRuns(workflowId, status) {
      const params = new URLSearchParams()
      if (workflowId) params.set('workflow', workflowId)
      if (status) params.set('status', status)
      const query = params.toString() ? `?${params}` : ''
      return request<WorkflowRun[]>(`/runs${query}`)
    },

    async cancelRun(runId) {
      await request(`/runs/${runId}/cancel`, { method: 'POST' })
    },

    async rerunWorkflow(runId) {
      return request<WorkflowRun>(`/runs/${runId}/rerun`, { method: 'POST' })
    },

    async getRunLogs(runId, jobId) {
      const path = jobId
        ? `/runs/${runId}/jobs/${jobId}/logs`
        : `/runs/${runId}/logs`
      return request<string>(path)
    },

    // Artifacts
    async listArtifacts(runId) {
      return request<Artifact[]>(`/runs/${runId}/artifacts`)
    },

    async downloadArtifact(artifactId) {
      const headers = await buildAuthHeaders()
      const response = await fetch(
        `${baseUrl}/artifacts/${artifactId}/download`,
        {
          headers,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to download artifact: ${response.statusText}`)
      }

      return response.blob()
    },

    async deleteArtifact(artifactId) {
      await request(`/artifacts/${artifactId}`, { method: 'DELETE' })
    },

    // Deployments
    async deploy(repoId, config) {
      return request<Deployment>(`/repos/${repoId}/deploy`, {
        method: 'POST',
        body: JSON.stringify(config),
      })
    },

    async getDeployment(deploymentId) {
      return request<Deployment | null>(`/deployments/${deploymentId}`)
    },

    async listDeployments(repoId, environment) {
      const params = new URLSearchParams()
      if (repoId) params.set('repo', repoId)
      if (environment) params.set('environment', environment)
      const query = params.toString() ? `?${params}` : ''
      return request<Deployment[]>(`/deployments${query}`)
    },

    async rollback(deploymentId) {
      return request<Deployment>(`/deployments/${deploymentId}/rollback`, {
        method: 'POST',
      })
    },

    async promoteToProduction(stagingDeploymentId) {
      return request<Deployment>(
        `/deployments/${stagingDeploymentId}/promote`,
        {
          method: 'POST',
        },
      )
    },

    async getDeploymentStatus(deploymentId) {
      return request<Deployment>(`/deployments/${deploymentId}/status`)
    },

    // Releases
    async createRelease(repoId, tag, options = {}) {
      return request<{ releaseId: string; deploymentId?: string }>(
        `/repos/${repoId}/releases`,
        {
          method: 'POST',
          body: JSON.stringify({ tag, ...options }),
        },
      )
    },

    async listReleases(repoId) {
      return request<
        Array<{
          id: string
          tag: string
          name: string
          createdAt: string
          prerelease: boolean
        }>
      >(`/repos/${repoId}/releases`)
    },

    // Queue Management
    async getQueueStatus() {
      return request<{
        pending: number
        running: number
        queued: number
        runners: number
        availableRunners: number
      }>('/queue/status')
    },

    async pauseQueue() {
      await request('/queue/pause', { method: 'POST' })
    },

    async resumeQueue() {
      await request('/queue/resume', { method: 'POST' })
    },
  }
}
