/**
 * CI/CD Hooks for Factory
 * Real-time workflow monitoring and control
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';

const DWS_API_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';

export interface Workflow {
  workflowId: string;
  name: string;
  description: string;
  source: 'jeju' | 'github';
  triggers: Array<{
    type: string;
    branches?: string[];
    schedule?: string;
  }>;
  jobs: Array<{
    jobId: string;
    name: string;
    runsOn: string;
    stepCount: number;
    hasMatrix: boolean;
  }>;
  concurrency?: { group: string; cancelInProgress: boolean };
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRun {
  runId: string;
  runNumber: number;
  workflowId: string;
  repoId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  triggerType: string;
  branch: string;
  commitSha: string;
  triggeredBy: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  environment?: string;
  concurrencyGroup?: string;
  inputs?: Record<string, string>;
  prNumber?: number;
  jobs: JobRun[];
  artifacts?: Artifact[];
}

export interface JobRun {
  jobId: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  runnerName?: string;
  matrixValues?: Record<string, string | number | boolean>;
  outputs?: Record<string, string>;
  steps: StepRun[];
}

export interface StepRun {
  stepId: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  outputs?: Record<string, string>;
}

export interface Artifact {
  artifactId: string;
  name: string;
  sizeBytes: number;
  cid: string;
  createdAt: number;
  expiresAt: number;
  paths: string[];
}

export interface LogEntry {
  timestamp: number;
  runId: string;
  jobId: string;
  stepId?: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'group' | 'endgroup' | 'command';
  message: string;
  stream: 'stdout' | 'stderr';
}

export interface Secret {
  secretId: string;
  name: string;
  environment?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Environment {
  environmentId: string;
  name: string;
  url?: string;
  secretCount: number;
  variableCount: number;
  protectionRules: {
    requiredReviewers?: string[];
    waitTimer?: number;
    preventSelfReview?: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

export interface Runner {
  runnerId: string;
  name: string;
  labels: string[];
  status: 'idle' | 'busy' | 'offline' | 'draining';
  selfHosted: boolean;
  capabilities: {
    architecture: 'amd64' | 'arm64';
    os: 'linux' | 'macos' | 'windows';
    docker: boolean;
    gpu: boolean;
    cpuCores: number;
    memoryMb: number;
  };
  currentRun?: { runId: string; jobId: string };
  lastHeartbeat: number;
  registeredAt: number;
}

export function useWorkflows(repoId: string) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const response = await globalThis.fetch(`${DWS_API_URL}/ci/workflows/${repoId}`);
    if (!response.ok) throw new Error('Failed to fetch workflows');
    const data = await response.json();
    setWorkflows(data.workflows);
    setIsLoading(false);
  }, [repoId]);

  useEffect(() => {
    fetch().catch(setError);
  }, [fetch]);

  return { workflows, isLoading, error, refetch: fetch };
}

export function useWorkflowRuns(repoId: string, options?: { limit?: number; branch?: string; status?: string }) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.branch) params.set('branch', options.branch);
    if (options?.status) params.set('status', options.status);

    const response = await globalThis.fetch(`${DWS_API_URL}/ci/repos/${repoId}/runs?${params}`);
    if (!response.ok) throw new Error('Failed to fetch runs');
    const data = await response.json();
    setRuns(data.runs);
    setTotal(data.total);
    setIsLoading(false);
  }, [repoId, options?.limit, options?.branch, options?.status]);

  useEffect(() => {
    fetchRuns().catch(setError);
    const interval = setInterval(() => {
      fetchRuns().catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  return { runs, total, isLoading, error, refetch: fetchRuns };
}

export function useWorkflowRun(runId: string) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRun = useCallback(async () => {
    const response = await globalThis.fetch(`${DWS_API_URL}/ci/runs/${runId}`);
    if (!response.ok) throw new Error('Run not found');
    const data = await response.json();
    setRun(data);
    setIsLoading(false);
    return data;
  }, [runId]);

  useEffect(() => {
    fetchRun().catch(setError);
    const interval = setInterval(() => {
      fetchRun().catch(console.error);
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchRun]);

  return { run, isLoading, error, refetch: fetchRun };
}

export function useRunLogs(runId: string, options?: { jobId?: string; stepId?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (options?.jobId) params.set('job', options.jobId);
    if (options?.stepId) params.set('step', options.stepId);

    globalThis.fetch(`${DWS_API_URL}/ci/runs/${runId}/logs?${params}`)
      .then((r) => r.json())
      .then((data) => setLogs(data.logs || []))
      .catch(console.error);

    const eventSource = new EventSource(`${DWS_API_URL}/ci/runs/${runId}/logs/stream`);
    eventSourceRef.current = eventSource;
    setIsStreaming(true);

    eventSource.addEventListener('log', (event) => {
      const entry = JSON.parse(event.data) as LogEntry;
      if (options?.jobId && entry.jobId !== options.jobId) return;
      if (options?.stepId && entry.stepId !== options.stepId) return;
      setLogs((prev) => [...prev, entry]);
    });

    eventSource.addEventListener('complete', () => {
      setIsStreaming(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setIsStreaming(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [runId, options?.jobId, options?.stepId]);

  return { logs, isStreaming };
}

export function useCIActions() {
  const { address } = useAccount();

  const triggerWorkflow = useCallback(
    async (repoId: string, workflowId: string, branch?: string, inputs?: Record<string, string>) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/runs/${repoId}/${workflowId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': address || '',
        },
        body: JSON.stringify({ branch, inputs }),
      });
      if (!response.ok) throw new Error('Failed to trigger workflow');
      return response.json() as Promise<WorkflowRun>;
    },
    [address]
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/runs/${runId}/cancel`, {
        method: 'POST',
        headers: { 'x-jeju-address': address || '' },
      });
      if (!response.ok) throw new Error('Failed to cancel run');
      return response.json();
    },
    [address]
  );

  const rerunWorkflow = useCallback(
    async (runId: string) => {
      const run = await globalThis.fetch(`${DWS_API_URL}/ci/runs/${runId}`).then((r) => r.json());
      return triggerWorkflow(run.repoId, run.workflowId, run.branch, run.inputs);
    },
    [triggerWorkflow]
  );

  return { triggerWorkflow, cancelRun, rerunWorkflow };
}

export function useSecrets(repoId: string) {
  const { address } = useAccount();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSecrets = useCallback(async () => {
    const response = await globalThis.fetch(`${DWS_API_URL}/ci/secrets/${repoId}`, {
      headers: { 'x-jeju-address': address || '' },
    });
    if (!response.ok) throw new Error('Failed to fetch secrets');
    const data = await response.json();
    setSecrets(data.secrets);
    setIsLoading(false);
  }, [repoId, address]);

  const createSecret = useCallback(
    async (name: string, value: string, environment?: string) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/secrets/${repoId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': address || '',
        },
        body: JSON.stringify({ name, value, environment }),
      });
      if (!response.ok) throw new Error('Failed to create secret');
      await fetchSecrets();
      return response.json();
    },
    [repoId, address, fetchSecrets]
  );

  const deleteSecret = useCallback(
    async (secretId: string) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/secrets/${secretId}`, {
        method: 'DELETE',
        headers: { 'x-jeju-address': address || '' },
      });
      if (!response.ok) throw new Error('Failed to delete secret');
      await fetchSecrets();
    },
    [address, fetchSecrets]
  );

  useEffect(() => {
    fetchSecrets().catch(setError);
  }, [fetchSecrets]);

  return { secrets, isLoading, error, createSecret, deleteSecret, refetch: fetchSecrets };
}

export function useEnvironments(repoId: string) {
  const { address } = useAccount();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchEnvironments = useCallback(async () => {
    const response = await globalThis.fetch(`${DWS_API_URL}/ci/environments/${repoId}`);
    if (!response.ok) throw new Error('Failed to fetch environments');
    const data = await response.json();
    setEnvironments(data.environments);
    setIsLoading(false);
  }, [repoId]);

  const createEnvironment = useCallback(
    async (name: string, options?: { url?: string; protectionRules?: Environment['protectionRules'] }) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/environments/${repoId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': address || '',
        },
        body: JSON.stringify({ name, ...options }),
      });
      if (!response.ok) throw new Error('Failed to create environment');
      await fetchEnvironments();
      return response.json();
    },
    [repoId, address, fetchEnvironments]
  );

  useEffect(() => {
    fetchEnvironments().catch(setError);
  }, [fetchEnvironments]);

  return { environments, isLoading, error, createEnvironment, refetch: fetchEnvironments };
}

export function useRunners(labels?: string[]) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRunners = useCallback(async () => {
    const params = labels ? `?labels=${labels.join(',')}` : '';
    const response = await globalThis.fetch(`${DWS_API_URL}/ci/runners${params}`);
    if (!response.ok) throw new Error('Failed to fetch runners');
    const data = await response.json();
    setRunners(data.runners);
    setIsLoading(false);
  }, [labels]);

  useEffect(() => {
    fetchRunners().catch(setError);
    const interval = setInterval(() => {
      fetchRunners().catch(console.error);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchRunners]);

  return { runners, isLoading, error, refetch: fetchRunners };
}

export function useArtifacts(runId: string) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    globalThis
      .fetch(`${DWS_API_URL}/ci/artifacts/${runId}`)
      .then((r) => r.json())
      .then((data) => {
        setArtifacts(data.artifacts);
        setIsLoading(false);
      })
      .catch(console.error);
  }, [runId]);

  const downloadArtifact = useCallback(
    async (name: string) => {
      const response = await globalThis.fetch(`${DWS_API_URL}/ci/artifacts/${runId}/${name}`);
      if (!response.ok) throw new Error('Failed to download artifact');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [runId]
  );

  return { artifacts, isLoading, downloadArtifact };
}


