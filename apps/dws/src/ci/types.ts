/**
 * CI/CD Types for Jeju Git
 */

import type { Address, Hex } from 'viem';

// ============ Workflow Types ============

export interface Workflow {
  workflowId: Hex;
  repoId: Hex;
  name: string;
  description: string;
  triggers: WorkflowTrigger[];
  jobs: WorkflowJob[];
  env: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  active: boolean;
}

export interface WorkflowTrigger {
  type: 'push' | 'pull_request' | 'schedule' | 'workflow_dispatch' | 'release';
  branches?: string[];
  paths?: string[];
  schedule?: string; // cron expression
  types?: string[]; // for pull_request: opened, synchronize, etc.
}

export interface WorkflowJob {
  jobId: string;
  name: string;
  runsOn: 'jeju-compute' | 'self-hosted';
  needs?: string[]; // job dependencies
  steps: WorkflowStep[];
  env?: Record<string, string>;
  timeout?: number; // minutes
  continueOnError?: boolean;
}

export interface WorkflowStep {
  stepId: string;
  name?: string;
  uses?: string; // action reference: actions/checkout@v4
  run?: string; // shell command
  with?: Record<string, string>; // action inputs
  env?: Record<string, string>;
  workingDirectory?: string;
  shell?: 'bash' | 'sh' | 'pwsh' | 'python';
  timeoutMinutes?: number;
  continueOnError?: boolean;
}

// ============ Run Types ============

export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface WorkflowRun {
  runId: Hex;
  workflowId: Hex;
  repoId: Hex;
  triggeredBy: Address;
  triggerType: WorkflowTrigger['type'];
  branch: string;
  commitSha: string;
  status: RunStatus;
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  startedAt: number;
  completedAt?: number;
  jobs: JobRun[];
  logs?: string;
  artifacts?: Artifact[];
}

export interface JobRun {
  jobId: string;
  name: string;
  status: RunStatus;
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  steps: StepRun[];
  logs?: string;
  runnerName?: string;
}

export interface StepRun {
  stepId: string;
  name: string;
  status: RunStatus;
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  output?: string;
  exitCode?: number;
}

export interface Artifact {
  artifactId: string;
  name: string;
  sizeByes: number;
  cid: string;
  expiresAt?: number;
}

// ============ Action Types ============

export interface Action {
  name: string;
  description: string;
  author?: string;
  inputs?: Record<string, ActionInput>;
  outputs?: Record<string, ActionOutput>;
  runs: ActionRuns;
  post?: { steps: WorkflowStep[] }; // Optional post-job steps (e.g., cache save)
}

export interface ActionInput {
  description: string;
  required?: boolean;
  default?: string;
}

export interface ActionOutput {
  description: string;
  value?: string;
}

export type ActionRuns =
  | {
      using: 'composite';
      steps: WorkflowStep[];
    }
  | {
      using: 'node16' | 'node20';
      main: string;
      pre?: string;
      post?: string;
    }
  | {
      using: 'docker';
      image: string;
      args?: string[];
      env?: Record<string, string>;
    };

// ============ Jeju Workflow Config (jeju.yml) ============

export interface JejuWorkflowConfig {
  name: string;
  description?: string;

  on: {
    push?: {
      branches?: string[];
      paths?: string[];
    };
    pull_request?: {
      branches?: string[];
      types?: string[];
    };
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: {
      inputs?: Record<
        string,
        {
          description: string;
          required?: boolean;
          default?: string;
          type?: 'string' | 'boolean' | 'number' | 'choice';
          options?: string[];
        }
      >;
    };
    release?: {
      types?: string[];
    };
  };

  env?: Record<string, string>;

  jobs: Record<string, JejuJobConfig>;
}

export interface JejuJobConfig {
  name?: string;
  'runs-on': 'jeju-compute' | 'self-hosted' | string;
  needs?: string | string[];
  env?: Record<string, string>;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;

  steps: Array<{
    id?: string;
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, string>;
    env?: Record<string, string>;
    'working-directory'?: string;
    shell?: 'bash' | 'sh' | 'pwsh' | 'python';
    'timeout-minutes'?: number;
    'continue-on-error'?: boolean;
  }>;
}

// ============ Built-in Actions ============

export const BUILTIN_ACTIONS: Record<string, Action> = {
  'jeju/checkout': {
    name: 'Checkout',
    description: 'Checkout a repository',
    inputs: {
      ref: { description: 'Branch/tag/commit to checkout', required: false },
      path: { description: 'Relative path under $GITHUB_WORKSPACE', required: false },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'checkout',
          name: 'Checkout repository',
          run: 'git clone ${{ github.repository_url }} . && git checkout ${{ inputs.ref || github.sha }}',
        },
      ],
    },
  },
  'jeju/setup-bun': {
    name: 'Setup Bun',
    description: 'Setup Bun runtime',
    inputs: {
      'bun-version': { description: 'Bun version', required: false, default: 'latest' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Install Bun',
          run: 'curl -fsSL https://bun.sh/install | bash',
        },
      ],
    },
  },
  'jeju/cache': {
    name: 'Cache',
    description: 'Cache dependencies using DWS storage',
    inputs: {
      path: { description: 'Path to cache', required: true },
      key: { description: 'Cache key', required: true },
      'restore-keys': { description: 'Restore keys (comma-separated prefixes)', required: false },
    },
    outputs: {
      'cache-hit': { description: 'Whether cache was hit' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'cache-restore',
          name: 'Restore cache',
          run: `
CACHE_KEY="\${{ inputs.key }}"
CACHE_PATH="\${{ inputs.path }}"
CACHE_DIR="\${JEJU_CACHE_DIR:-/tmp/jeju-cache}"
mkdir -p "$CACHE_DIR"

# Check if cache exists in DWS storage
CACHE_CID=$(curl -sf "\${DWS_URL:-http://localhost:4030}/storage/cache/$CACHE_KEY" 2>/dev/null | jq -r '.cid // empty')

if [ -n "$CACHE_CID" ]; then
  echo "Cache hit: $CACHE_KEY"
  curl -sf "\${DWS_URL:-http://localhost:4030}/storage/download/$CACHE_CID" > "$CACHE_DIR/$CACHE_KEY.tar.gz"
  mkdir -p "$CACHE_PATH"
  tar -xzf "$CACHE_DIR/$CACHE_KEY.tar.gz" -C "$CACHE_PATH"
  echo "cache-hit=true" >> $GITHUB_OUTPUT
else
  echo "Cache miss: $CACHE_KEY"
  echo "cache-hit=false" >> $GITHUB_OUTPUT
fi
`,
        },
      ],
    },
    post: {
      steps: [
        {
          stepId: 'cache-save',
          name: 'Save cache',
          run: `
CACHE_KEY="\${{ inputs.key }}"
CACHE_PATH="\${{ inputs.path }}"
CACHE_DIR="\${JEJU_CACHE_DIR:-/tmp/jeju-cache}"

if [ -d "$CACHE_PATH" ]; then
  tar -czf "$CACHE_DIR/$CACHE_KEY.tar.gz" -C "$CACHE_PATH" .
  curl -sf -X POST "\${DWS_URL:-http://localhost:4030}/storage/upload" \
    -F "file=@$CACHE_DIR/$CACHE_KEY.tar.gz" \
    -F "key=$CACHE_KEY" > /dev/null
  echo "Cache saved: $CACHE_KEY"
fi
`,
        },
      ],
    },
  },
};

