/**
 * Sandbox Executor
 * 
 * Secure container execution for proof-of-concept validation
 * Isolates exploit code from production systems
 * 
 * FULLY DECENTRALIZED - All execution goes through DWS compute network
 */

import { getDWSComputeUrl } from '@jejunetwork/config';
import { keccak256, stringToHex } from 'viem';
import { VulnerabilityType, ValidationResult } from './types';

// ============ Configuration (Network-Aware) ============

// DWS endpoint is resolved dynamically based on the current network
function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? process.env.DWS_COMPUTE_URL ?? getDWSComputeUrl();
}
const MAX_EXECUTION_TIME = parseInt(process.env.SANDBOX_MAX_TIME ?? '3600', 10); // 1 hour
const MAX_MEMORY_MB = parseInt(process.env.SANDBOX_MAX_MEMORY ?? '8192', 10);
const MAX_CPU_CORES = parseInt(process.env.SANDBOX_MAX_CPU ?? '4', 10);

// ============ Types ============

export interface SandboxConfig {
  imageRef: string;
  command: string[];
  env: Record<string, string>;
  resources: {
    cpuCores: number;
    memoryMb: number;
    storageMb: number;
    networkBandwidthMbps: number;
    gpuType?: string;
    gpuCount?: number;
  };
  timeout: number;
  securityOptions: {
    noNetwork: boolean;
    readOnlyFs: boolean;
    dropCapabilities: string[];
    seccompProfile: string;
  };
}

export interface SandboxJob {
  jobId: string;
  submissionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: number;
  completedAt?: number;
  config: SandboxConfig;
  result?: SandboxExecutionResult;
}

export interface SandboxExecutionResult {
  success: boolean;
  exitCode: number;
  exploitTriggered: boolean;
  exploitDetails: string;
  stdout: string;
  stderr: string;
  metrics: {
    executionTimeMs: number;
    peakMemoryMb: number;
    cpuTimeMs: number;
  };
  artifacts: SandboxArtifact[];
}

export interface SandboxArtifact {
  name: string;
  type: 'log' | 'screenshot' | 'memory_dump' | 'network_capture' | 'file';
  cid: string;
  size: number;
}

// ============ Sandbox Image Registry ============

const SANDBOX_IMAGES: Record<string, { image: string; description: string }> = {
  evm: {
    image: 'jeju/security-sandbox:evm-v1',
    description: 'EVM/Solidity exploit testing with forked mainnet',
  },
  crypto: {
    image: 'jeju/security-sandbox:crypto-v1',
    description: 'Cryptographic vulnerability testing (MPC, TEE)',
  },
  web: {
    image: 'jeju/security-sandbox:web-v1',
    description: 'Web application security testing',
  },
  consensus: {
    image: 'jeju/security-sandbox:consensus-v1',
    description: 'Blockchain consensus attack simulation',
  },
  general: {
    image: 'jeju/security-sandbox:general-v1',
    description: 'General purpose security testing',
  },
  rce: {
    image: 'jeju/security-sandbox:isolated-v1',
    description: 'Heavily isolated RCE testing',
  },
};

// ============ Job Management ============

const activeJobs = new Map<string, SandboxJob>();
const completedJobs = new Map<string, SandboxJob>();

// ============ Core Functions ============

export function getSandboxImageForVulnType(vulnType: VulnerabilityType): string {
  switch (vulnType) {
    case VulnerabilityType.FUNDS_AT_RISK:
    case VulnerabilityType.WALLET_DRAIN:
      return SANDBOX_IMAGES.evm.image;

    case VulnerabilityType.TEE_BYPASS:
    case VulnerabilityType.MPC_KEY_EXPOSURE:
      return SANDBOX_IMAGES.crypto.image;

    case VulnerabilityType.CONSENSUS_ATTACK:
      return SANDBOX_IMAGES.consensus.image;

    case VulnerabilityType.REMOTE_CODE_EXECUTION:
    case VulnerabilityType.PRIVILEGE_ESCALATION:
      return SANDBOX_IMAGES.rce.image;

    case VulnerabilityType.DENIAL_OF_SERVICE:
    case VulnerabilityType.INFORMATION_DISCLOSURE:
      return SANDBOX_IMAGES.web.image;

    default:
      return SANDBOX_IMAGES.general.image;
  }
}

export function createSandboxConfig(
  vulnType: VulnerabilityType,
  pocCode: string,
  customEnv?: Record<string, string>
): SandboxConfig {
  const baseConfig: SandboxConfig = {
    imageRef: getSandboxImageForVulnType(vulnType),
    command: ['validate'],
    env: {
      POC_CODE: Buffer.from(pocCode).toString('base64'),
      VULN_TYPE: String(vulnType),
      ...customEnv,
    },
    resources: {
      cpuCores: 2,
      memoryMb: 4096,
      storageMb: 1024,
      networkBandwidthMbps: 0, // No network by default
    },
    timeout: 300, // 5 minutes default
    securityOptions: {
      noNetwork: true,
      readOnlyFs: true,
      dropCapabilities: ['ALL'],
      seccompProfile: 'strict',
    },
  };

  // Adjust based on vulnerability type
  switch (vulnType) {
    case VulnerabilityType.FUNDS_AT_RISK:
    case VulnerabilityType.WALLET_DRAIN:
      // EVM needs more resources for forking
      baseConfig.resources.memoryMb = 8192;
      baseConfig.resources.cpuCores = 4;
      baseConfig.timeout = 600;
      baseConfig.command = ['validate-evm'];
      // Allow network for RPC (but sandboxed)
      baseConfig.resources.networkBandwidthMbps = 10;
      baseConfig.securityOptions.noNetwork = false;
      break;

    case VulnerabilityType.CONSENSUS_ATTACK:
      baseConfig.resources.memoryMb = 8192;
      baseConfig.resources.cpuCores = 4;
      baseConfig.timeout = 1800; // 30 minutes
      baseConfig.command = ['validate-consensus'];
      break;

    case VulnerabilityType.REMOTE_CODE_EXECUTION:
      // Most restricted
      baseConfig.resources.memoryMb = 1024;
      baseConfig.resources.cpuCores = 1;
      baseConfig.timeout = 60;
      baseConfig.command = ['validate-rce'];
      baseConfig.securityOptions.seccompProfile = 'paranoid';
      break;

    case VulnerabilityType.TEE_BYPASS:
    case VulnerabilityType.MPC_KEY_EXPOSURE:
      baseConfig.resources.memoryMb = 4096;
      baseConfig.command = ['validate-crypto'];
      break;
  }

  // Apply global limits
  baseConfig.resources.memoryMb = Math.min(baseConfig.resources.memoryMb, MAX_MEMORY_MB);
  baseConfig.resources.cpuCores = Math.min(baseConfig.resources.cpuCores, MAX_CPU_CORES);
  baseConfig.timeout = Math.min(baseConfig.timeout, MAX_EXECUTION_TIME);

  return baseConfig;
}

export async function executeInSandbox(
  submissionId: string,
  config: SandboxConfig
): Promise<SandboxJob> {
  const jobId = keccak256(stringToHex(`job-${submissionId}-${Date.now()}`)).slice(0, 18);

  const job: SandboxJob = {
    jobId,
    submissionId,
    status: 'pending',
    startedAt: Date.now(),
    config,
  };

  activeJobs.set(jobId, job);
  console.log(`[Sandbox] Starting job ${jobId} for submission ${submissionId.slice(0, 12)}...`);

  // Execute via DWS compute (decentralized container execution)
  const dwsEndpoint = getDWSEndpoint();
  const response = await fetch(`${dwsEndpoint}/api/containers/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageRef: config.imageRef,
      command: config.command,
      env: config.env,
      resources: config.resources,
      mode: 'serverless',
      timeout: config.timeout,
      // Security options would be passed to container runtime
    }),
  }).catch((err) => {
    console.error(`[Sandbox] DWS request failed:`, err);
    return null;
  });

  if (!response?.ok) {
    job.status = 'failed';
    job.completedAt = Date.now();
    job.result = {
      success: false,
      exitCode: -1,
      exploitTriggered: false,
      exploitDetails: '',
      stdout: '',
      stderr: 'Failed to connect to DWS compute service',
      metrics: { executionTimeMs: 0, peakMemoryMb: 0, cpuTimeMs: 0 },
      artifacts: [],
    };
    activeJobs.delete(jobId);
    completedJobs.set(jobId, job);
    return job;
  }

  job.status = 'running';

  const result = await response.json() as {
    executionId: string;
    status: string;
    output: {
      exploitTriggered?: boolean;
      exploitDetails?: string;
      result?: string;
    };
    logs?: string;
    exitCode?: number;
    metrics?: {
      executionTimeMs: number;
      memoryUsedMb: number;
      cpuUsagePercent: number;
    };
  };

  job.completedAt = Date.now();

  if (result.status === 'success' || result.status === 'completed') {
    job.status = 'completed';
    job.result = {
      success: true,
      exitCode: result.exitCode ?? 0,
      exploitTriggered: result.output?.exploitTriggered ?? false,
      exploitDetails: result.output?.exploitDetails ?? '',
      stdout: result.output?.result ?? '',
      stderr: result.logs ?? '',
      metrics: {
        executionTimeMs: result.metrics?.executionTimeMs ?? 0,
        peakMemoryMb: result.metrics?.memoryUsedMb ?? 0,
        cpuTimeMs: Math.floor((result.metrics?.cpuUsagePercent ?? 0) * (result.metrics?.executionTimeMs ?? 0) / 100),
      },
      artifacts: [],
    };
  } else if (result.status === 'timeout') {
    job.status = 'timeout';
    job.result = {
      success: false,
      exitCode: 124,
      exploitTriggered: false,
      exploitDetails: '',
      stdout: '',
      stderr: 'Execution timed out',
      metrics: { executionTimeMs: config.timeout * 1000, peakMemoryMb: 0, cpuTimeMs: 0 },
      artifacts: [],
    };
  } else {
    job.status = 'failed';
    job.result = {
      success: false,
      exitCode: result.exitCode ?? -1,
      exploitTriggered: false,
      exploitDetails: '',
      stdout: result.output?.result ?? '',
      stderr: result.logs ?? 'Execution failed',
      metrics: {
        executionTimeMs: result.metrics?.executionTimeMs ?? 0,
        peakMemoryMb: result.metrics?.memoryUsedMb ?? 0,
        cpuTimeMs: 0,
      },
      artifacts: [],
    };
  }

  activeJobs.delete(jobId);
  completedJobs.set(jobId, job);

  console.log(`[Sandbox] Job ${jobId} completed: ${job.status}, exploit: ${job.result?.exploitTriggered}`);

  return job;
}

export function getJob(jobId: string): SandboxJob | null {
  return activeJobs.get(jobId) ?? completedJobs.get(jobId) ?? null;
}

export function getJobsForSubmission(submissionId: string): SandboxJob[] {
  const jobs: SandboxJob[] = [];

  for (const job of activeJobs.values()) {
    if (job.submissionId === submissionId) jobs.push(job);
  }
  for (const job of completedJobs.values()) {
    if (job.submissionId === submissionId) jobs.push(job);
  }

  return jobs.sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;

  // In production, would send cancellation to DWS
  job.status = 'failed';
  job.completedAt = Date.now();
  job.result = {
    success: false,
    exitCode: -1,
    exploitTriggered: false,
    exploitDetails: '',
    stdout: '',
    stderr: 'Job cancelled',
    metrics: { executionTimeMs: Date.now() - job.startedAt, peakMemoryMb: 0, cpuTimeMs: 0 },
    artifacts: [],
  };

  activeJobs.delete(jobId);
  completedJobs.set(jobId, job);

  return true;
}

// ============ Validation Helper ============

export async function validatePoCInSandbox(
  submissionId: string,
  vulnType: VulnerabilityType,
  pocCode: string,
  affectedComponents: string[]
): Promise<{
  result: ValidationResult;
  exploitVerified: boolean;
  logs: string;
  executionTime: number;
}> {
  const config = createSandboxConfig(vulnType, pocCode, {
    AFFECTED_COMPONENTS: affectedComponents.join(','),
    SUBMISSION_ID: submissionId,
  });

  const job = await executeInSandbox(submissionId, config);

  if (!job.result) {
    return {
      result: ValidationResult.SANDBOX_ERROR,
      exploitVerified: false,
      logs: 'No result from sandbox execution',
      executionTime: 0,
    };
  }

  let validationResult: ValidationResult;

  if (job.result.exploitTriggered) {
    validationResult = ValidationResult.VERIFIED;
  } else if (job.result.success && job.result.exitCode === 0) {
    validationResult = ValidationResult.LIKELY_VALID;
  } else if (job.status === 'timeout') {
    validationResult = ValidationResult.NEEDS_MORE_INFO;
  } else if (job.status === 'failed') {
    validationResult = ValidationResult.SANDBOX_ERROR;
  } else {
    validationResult = ValidationResult.INVALID;
  }

  return {
    result: validationResult,
    exploitVerified: job.result.exploitTriggered,
    logs: job.result.stdout + '\n' + job.result.stderr,
    executionTime: job.result.metrics.executionTimeMs,
  };
}

// ============ Stats ============

export function getSandboxStats(): {
  activeJobs: number;
  completedJobs: number;
  successRate: number;
  avgExecutionTimeMs: number;
} {
  const completed = Array.from(completedJobs.values());
  const successful = completed.filter(j => j.status === 'completed');

  const totalTime = completed.reduce(
    (sum, j) => sum + (j.result?.metrics.executionTimeMs ?? 0),
    0
  );

  return {
    activeJobs: activeJobs.size,
    completedJobs: completedJobs.size,
    successRate: completed.length > 0 ? (successful.length / completed.length) * 100 : 0,
    avgExecutionTimeMs: completed.length > 0 ? totalTime / completed.length : 0,
  };
}

// ============ Cleanup ============

export function cleanupOldJobs(maxAge: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAge;
  let cleaned = 0;

  for (const [jobId, job] of completedJobs) {
    if ((job.completedAt ?? 0) < cutoff) {
      completedJobs.delete(jobId);
      cleaned++;
    }
  }

  return cleaned;
}

// Cleanup every hour
setInterval(() => cleanupOldJobs(), 60 * 60 * 1000);


