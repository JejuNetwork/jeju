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
import { z } from 'zod'
import { getServicesConfig } from '../config'
import type { JejuWallet } from '../wallet'

// API response schemas for validation
const JobStepSchema = z.object({
  name: z.string(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  duration: z.number().optional(),
  output: z.string().optional(),
})

const WorkflowJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  steps: z.array(JobStepSchema),
  logs: z.string().optional(),
})

const ArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
})

const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  repoName: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  commitMessage: z.string().optional(),
  status: z.enum([
    'pending',
    'queued',
    'running',
    'success',
    'failed',
    'cancelled',
  ]),
  triggeredBy: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  jobs: z.array(WorkflowJobSchema),
  artifacts: z.array(ArtifactSchema).optional(),
})

const CICDWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  repoId: z.string(),
  repoName: z.string(),
  branch: z.string(),
  trigger: z.enum(['push', 'pull_request', 'manual', 'schedule', 'tag']),
  configPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  isActive: z.boolean(),
})

const DeploymentSchema = z.object({
  id: z.string(),
  environment: z.enum(['staging', 'production']),
  repoName: z.string(),
  branch: z.string(),
  commitSha: z.string(),
  status: z.enum([
    'pending',
    'in_progress',
    'success',
    'failed',
    'rolled_back',
  ]),
  deployedBy: z.string(),
  deployedAt: z.string(),
  url: z.string().optional(),
  version: z.string().optional(),
  previousDeploymentId: z.string().optional(),
})

const ReleaseSchema = z.object({
  id: z.string(),
  tag: z.string(),
  name: z.string(),
  createdAt: z.string(),
  prerelease: z.boolean(),
})

const QueueStatusSchema = z.object({
  pending: z.number(),
  running: z.number(),
  queued: z.number(),
  runners: z.number(),
  availableRunners: z.number(),
})

const CreateReleaseResponseSchema = z.object({
  releaseId: z.string(),
  deploymentId: z.string().optional(),
})

export const CICDWorkflowStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type CICDWorkflowStatus =
  (typeof CICDWorkflowStatus)[keyof typeof CICDWorkflowStatus]

export const DeploymentEnvironment = {
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const
export type DeploymentEnvironment =
  (typeof DeploymentEnvironment)[keyof typeof DeploymentEnvironment]

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
    schema?: z.ZodType<T>,
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

    const json: unknown = await response.json()
    if (schema) {
      return schema.parse(json)
    }
    return json as T
  }

  return {
    // Workflows
    async createWorkflow(params) {
      return request(
        '/workflows',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        CICDWorkflowSchema,
      )
    },

    async getWorkflow(workflowId) {
      return request(
        `/workflows/${workflowId}`,
        {},
        CICDWorkflowSchema.nullable(),
      )
    },

    async listWorkflows(repoId) {
      const query = repoId ? `?repo=${repoId}` : ''
      return request(`/workflows${query}`, {}, z.array(CICDWorkflowSchema))
    },

    async updateWorkflow(workflowId, updates) {
      return request(
        `/workflows/${workflowId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        },
        CICDWorkflowSchema,
      )
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
      return request(
        `/workflows/${params.workflowId}/trigger`,
        {
          method: 'POST',
          body: JSON.stringify({
            branch: params.branch,
            inputs: params.inputs,
          }),
        },
        WorkflowRunSchema,
      )
    },

    async getRun(runId) {
      return request(`/runs/${runId}`, {}, WorkflowRunSchema.nullable())
    },

    async listRuns(workflowId, status) {
      const params = new URLSearchParams()
      if (workflowId) params.set('workflow', workflowId)
      if (status) params.set('status', status)
      const query = params.toString() ? `?${params}` : ''
      return request(`/runs${query}`, {}, z.array(WorkflowRunSchema))
    },

    async cancelRun(runId) {
      await request(`/runs/${runId}/cancel`, { method: 'POST' })
    },

    async rerunWorkflow(runId) {
      return request(
        `/runs/${runId}/rerun`,
        { method: 'POST' },
        WorkflowRunSchema,
      )
    },

    async getRunLogs(runId, jobId) {
      const path = jobId
        ? `/runs/${runId}/jobs/${jobId}/logs`
        : `/runs/${runId}/logs`
      return request(path, {}, z.string())
    },

    // Artifacts
    async listArtifacts(runId) {
      return request(`/runs/${runId}/artifacts`, {}, z.array(ArtifactSchema))
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
      return request(
        `/repos/${repoId}/deploy`,
        {
          method: 'POST',
          body: JSON.stringify(config),
        },
        DeploymentSchema,
      )
    },

    async getDeployment(deploymentId) {
      return request(
        `/deployments/${deploymentId}`,
        {},
        DeploymentSchema.nullable(),
      )
    },

    async listDeployments(repoId, environment) {
      const params = new URLSearchParams()
      if (repoId) params.set('repo', repoId)
      if (environment) params.set('environment', environment)
      const query = params.toString() ? `?${params}` : ''
      return request(`/deployments${query}`, {}, z.array(DeploymentSchema))
    },

    async rollback(deploymentId) {
      return request(
        `/deployments/${deploymentId}/rollback`,
        {
          method: 'POST',
        },
        DeploymentSchema,
      )
    },

    async promoteToProduction(stagingDeploymentId) {
      return request(
        `/deployments/${stagingDeploymentId}/promote`,
        {
          method: 'POST',
        },
        DeploymentSchema,
      )
    },

    async getDeploymentStatus(deploymentId) {
      return request(
        `/deployments/${deploymentId}/status`,
        {},
        DeploymentSchema,
      )
    },

    // Releases
    async createRelease(repoId, tag, options = {}) {
      return request(
        `/repos/${repoId}/releases`,
        {
          method: 'POST',
          body: JSON.stringify({ tag, ...options }),
        },
        CreateReleaseResponseSchema,
      )
    },

    async listReleases(repoId) {
      return request(`/repos/${repoId}/releases`, {}, z.array(ReleaseSchema))
    },

    // Queue Management
    async getQueueStatus() {
      return request('/queue/status', {}, QueueStatusSchema)
    },

    async pauseQueue() {
      await request('/queue/pause', { method: 'POST' })
    },

    async resumeQueue() {
      await request('/queue/resume', { method: 'POST' })
    },
  }
}
