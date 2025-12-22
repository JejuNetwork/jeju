/**
 * CI/CD Types for Jeju Git
 */

import type { Address, Hex } from 'viem'

// ============ Workflow Types ============

export interface Workflow {
  workflowId: Hex
  repoId: Hex
  name: string
  description: string
  triggers: WorkflowTrigger[]
  jobs: WorkflowJob[]
  env: Record<string, string>
  concurrency?: ConcurrencyConfig
  defaults?: WorkflowDefaults
  createdAt: number
  updatedAt: number
  active: boolean
  source: 'jeju' | 'github'
}

export interface ConcurrencyConfig {
  group: string
  cancelInProgress: boolean
}

export interface WorkflowDefaults {
  run?: {
    shell?: string
    workingDirectory?: string
  }
}

export interface WorkflowTrigger {
  type:
    | 'push'
    | 'pull_request'
    | 'schedule'
    | 'workflow_dispatch'
    | 'release'
    | 'workflow_call'
  branches?: string[]
  branchesIgnore?: string[]
  tags?: string[]
  tagsIgnore?: string[]
  paths?: string[]
  pathsIgnore?: string[]
  schedule?: string
  types?: string[]
  inputs?: Record<string, WorkflowInput>
}

export interface WorkflowInput {
  description: string
  required?: boolean
  default?: string
  type?: 'string' | 'boolean' | 'number' | 'choice' | 'environment'
  options?: string[]
}

export interface WorkflowJob {
  jobId: string
  name: string
  runsOn: string | string[]
  needs?: string[]
  if?: string
  steps: WorkflowStep[]
  env?: Record<string, string>
  timeout?: number
  continueOnError?: boolean
  strategy?: JobStrategy
  outputs?: Record<string, string>
  environment?: string | EnvironmentRef
  concurrency?: ConcurrencyConfig
  services?: Record<string, ServiceContainer>
  container?: ContainerConfig
}

export interface JobStrategy {
  matrix: MatrixConfig
  failFast?: boolean
  maxParallel?: number
}

export interface MatrixConfig {
  include?: Record<string, string | number | boolean>[]
  exclude?: Record<string, string | number | boolean>[]
  [key: string]:
    | string[]
    | number[]
    | boolean[]
    | Record<string, string | number | boolean>[]
    | undefined
}

export interface EnvironmentRef {
  name: string
  url?: string
}

export interface ServiceContainer {
  image: string
  credentials?: { username: string; password: string }
  env?: Record<string, string>
  ports?: string[]
  volumes?: string[]
  options?: string
}

export interface ContainerConfig {
  image: string
  credentials?: { username: string; password: string }
  env?: Record<string, string>
  ports?: number[]
  volumes?: string[]
  options?: string
}

export interface WorkflowStep {
  stepId: string
  name?: string
  id?: string
  if?: string
  uses?: string
  run?: string
  with?: Record<string, string>
  env?: Record<string, string>
  workingDirectory?: string
  shell?: 'bash' | 'sh' | 'pwsh' | 'python' | 'cmd'
  timeoutMinutes?: number
  continueOnError?: boolean
}

// ============ Run Types ============

// Import consolidated RunStatus from @jejunetwork/types
import type { RunStatus } from '@jejunetwork/types'
export type { RunStatus }

export interface WorkflowRun {
  runId: Hex
  workflowId: Hex
  repoId: Hex
  runNumber: number
  triggeredBy: Address
  triggerType: WorkflowTrigger['type']
  branch: string
  commitSha: string
  status: RunStatus
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral'
  startedAt: number
  completedAt?: number
  jobs: JobRun[]
  logsCid?: string
  artifacts: Artifact[]
  environment?: string
  concurrencyGroup?: string
  inputs?: Record<string, string>
  prNumber?: number
}

export interface JobRun {
  jobId: string
  name: string
  status: RunStatus
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped'
  startedAt?: number
  completedAt?: number
  steps: StepRun[]
  logs?: string
  logsCid?: string
  runnerName?: string
  runnerId?: string
  matrixValues?: Record<string, string | number | boolean>
  outputs?: Record<string, string>
}

export interface StepRun {
  stepId: string
  name: string
  status: RunStatus
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped'
  startedAt?: number
  completedAt?: number
  output?: string
  exitCode?: number
  outputs?: Record<string, string>
}

export interface Artifact {
  artifactId: string
  name: string
  sizeBytes: number
  cid: string
  createdAt: number
  expiresAt: number
  paths: string[]
}

// ============ Runner Types ============

export interface Runner {
  runnerId: string
  name: string
  labels: string[]
  nodeId: string
  nodeAddress: Address
  status: 'idle' | 'busy' | 'offline' | 'draining'
  lastHeartbeat: number
  capabilities: RunnerCapabilities
  currentRun?: { runId: Hex; jobId: string }
  registeredAt: number
  owner: Address
  selfHosted: boolean
}

export interface RunnerCapabilities {
  architecture: 'amd64' | 'arm64'
  os: 'linux' | 'macos' | 'windows'
  docker: boolean
  gpu: boolean
  gpuType?: string
  cpuCores: number
  memoryMb: number
  storageMb: number
}

// ============ Environment Types ============

export interface Environment {
  environmentId: string
  repoId: Hex
  name: string
  url?: string
  protectionRules: ProtectionRules
  secrets: EnvironmentSecret[]
  variables: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface ProtectionRules {
  requiredReviewers?: Address[]
  waitTimer?: number
  preventSelfReview?: boolean
  deployBranchPolicy?: {
    protectedBranches: boolean
    customBranches?: string[]
  }
}

export interface EnvironmentSecret {
  secretId: string
  name: string
  mpcKeyId: string
  createdAt: number
  updatedAt: number
}

// ============ Secret Types ============

export interface CISecret {
  secretId: string
  repoId: Hex
  name: string
  mpcKeyId: string
  environment?: string
  createdAt: number
  updatedAt: number
}

// ============ Log Types ============

export interface LogEntry {
  timestamp: number
  runId: string
  jobId: string
  stepId?: string
  level: 'info' | 'warn' | 'error' | 'debug' | 'group' | 'endgroup' | 'command'
  message: string
  stream: 'stdout' | 'stderr'
}

export interface LogConfig {
  retentionDays: number
  maxSizeBytes: number
}

// ============ Action Types ============

export interface Action {
  name: string
  description: string
  author?: string
  inputs?: Record<string, ActionInput>
  outputs?: Record<string, ActionOutput>
  runs: ActionRuns
  post?: { steps: WorkflowStep[] }
  branding?: { icon: string; color: string }
}

export interface ActionInput {
  description: string
  required?: boolean
  default?: string
  deprecationMessage?: string
}

export interface ActionOutput {
  description: string
  value?: string
}

export type ActionRuns =
  | { using: 'composite'; steps: WorkflowStep[] }
  | { using: 'node16' | 'node20'; main: string; pre?: string; post?: string }
  | {
      using: 'docker'
      image: string
      args?: string[]
      env?: Record<string, string>
      entrypoint?: string
    }

// ============ Workflow Config Types ============

export interface JejuWorkflowConfig {
  name: string
  description?: string
  run_name?: string

  on: WorkflowOnConfig

  env?: Record<string, string>
  defaults?: WorkflowDefaults
  concurrency?: string | ConcurrencyConfig

  jobs: Record<string, JejuJobConfig>
}

export type WorkflowOnConfig = {
  push?: TriggerConfig
  pull_request?: TriggerConfig & { types?: string[] }
  pull_request_target?: TriggerConfig & { types?: string[] }
  schedule?: Array<{ cron: string }>
  workflow_dispatch?: { inputs?: Record<string, WorkflowInput> }
  workflow_call?: {
    inputs?: Record<string, WorkflowInput>
    outputs?: Record<string, ActionOutput>
    secrets?: Record<string, { required?: boolean }>
  }
  release?: { types?: string[] }
  issues?: { types?: string[] }
  issue_comment?: { types?: string[] }
  create?: Record<string, never>
  delete?: Record<string, never>
  fork?: Record<string, never>
  watch?: { types?: string[] }
}

export interface TriggerConfig {
  branches?: string[]
  'branches-ignore'?: string[]
  tags?: string[]
  'tags-ignore'?: string[]
  paths?: string[]
  'paths-ignore'?: string[]
}

export interface JejuJobConfig {
  name?: string
  'runs-on': string | string[]
  needs?: string | string[]
  if?: string
  env?: Record<string, string>
  'timeout-minutes'?: number
  'continue-on-error'?: boolean
  strategy?: {
    matrix?: MatrixConfig
    'fail-fast'?: boolean
    'max-parallel'?: number
  }
  outputs?: Record<string, string>
  environment?: string | { name: string; url?: string }
  concurrency?: string | ConcurrencyConfig
  services?: Record<string, ServiceContainer>
  container?: string | ContainerConfig
  permissions?: Record<string, string>

  steps: Array<{
    id?: string
    name?: string
    if?: string
    uses?: string
    run?: string
    with?: Record<string, string>
    env?: Record<string, string>
    'working-directory'?: string
    shell?: 'bash' | 'sh' | 'pwsh' | 'python' | 'cmd'
    'timeout-minutes'?: number
    'continue-on-error'?: boolean
  }>
}

// ============ Event Types ============

export type CIEvent =
  | {
      type: 'push'
      repoId: Hex
      branch: string
      commitSha: string
      pusher: Address
    }
  | {
      type: 'pull_request'
      repoId: Hex
      action: string
      prNumber: number
      headSha: string
      baseBranch: string
      author: Address
    }
  | {
      type: 'release'
      repoId: Hex
      action: string
      tagName: string
      author: Address
    }
  | { type: 'schedule'; repoId: Hex; workflowId: Hex }
  | {
      type: 'workflow_dispatch'
      repoId: Hex
      workflowId: Hex
      branch: string
      triggeredBy: Address
      inputs: Record<string, string>
    }

// ============ Concurrency Types ============

export interface ConcurrencyQueue {
  group: string
  repoId: Hex
  pending: Hex[]
  running?: Hex
}

// ============ Webhook Types ============

export interface WebhookDelivery {
  deliveryId: string
  repoId: Hex
  event: string
  payload: Record<string, unknown>
  signature: string
  deliveredAt: number
  responseStatus?: number
  responseBody?: string
}

// ============ Built-in Actions ============

/** Built-in CI/CD actions available without external dependencies */
export const BUILTIN_ACTIONS: Record<string, Action> = {
  'actions/checkout@v4': {
    name: 'Checkout',
    description: 'Checkout a Git repository',
    inputs: {
      repository: {
        description: 'Repository name with owner',
        required: false,
        default: '',
      },
      ref: {
        description: 'The branch, tag or SHA to checkout',
        required: false,
        default: '',
      },
      token: {
        description: 'Personal access token',
        required: false,
        default: '',
      },
      path: {
        description: 'Relative path under $GITHUB_WORKSPACE',
        required: false,
        default: '',
      },
      'fetch-depth': {
        description: 'Number of commits to fetch',
        required: false,
        default: '1',
      },
    },
    outputs: {},
    runs: { using: 'node20', main: 'dist/index.js' },
  },
  'actions/setup-node@v4': {
    name: 'Setup Node.js',
    description: 'Set up Node.js environment',
    inputs: {
      'node-version': {
        description: 'Version Spec of the version to use',
        required: false,
      },
      'node-version-file': {
        description: 'File containing version spec',
        required: false,
      },
      cache: { description: 'Package manager for caching', required: false },
    },
    outputs: {
      'node-version': { description: 'The installed node version' },
    },
    runs: { using: 'node20', main: 'dist/setup/index.js' },
  },
  'actions/cache@v4': {
    name: 'Cache',
    description: 'Cache dependencies and build outputs',
    inputs: {
      path: {
        description: 'List of files/directories to cache',
        required: true,
      },
      key: {
        description: 'Key for restoring and saving the cache',
        required: true,
      },
      'restore-keys': {
        description: 'Ordered list of keys for restoring stale cache',
        required: false,
      },
    },
    outputs: {
      'cache-hit': {
        description: 'Whether an exact match was found for the key',
      },
    },
    runs: {
      using: 'node20',
      main: 'dist/restore/index.js',
      post: 'dist/save/index.js',
    },
  },
  'actions/upload-artifact@v4': {
    name: 'Upload Artifact',
    description: 'Upload a build artifact',
    inputs: {
      name: { description: 'Artifact name', required: true },
      path: { description: 'Path to upload', required: true },
      'retention-days': {
        description: 'Number of days to retain',
        required: false,
      },
    },
    outputs: {
      'artifact-id': { description: 'ID of uploaded artifact' },
    },
    runs: { using: 'node20', main: 'dist/index.js' },
  },
  'actions/download-artifact@v4': {
    name: 'Download Artifact',
    description: 'Download a build artifact',
    inputs: {
      name: { description: 'Artifact name', required: true },
      path: { description: 'Destination path', required: false, default: '.' },
    },
    outputs: {},
    runs: { using: 'node20', main: 'dist/index.js' },
  },
}
