/**
 * TEE GPU Provider for DWS
 *
 * Manages H200/H100 GPU provisioning via Trusted Execution Environment (TEE).
 * Supports Phala Network for secure GPU compute isolation.
 *
 * Architecture:
 * 1. DWS registers as a TEE-enabled compute node with GPU capabilities
 * 2. Training jobs are scheduled to TEE-enabled nodes with H200 GPUs
 * 3. GPU workloads run in secure enclaves with attestation
 * 4. Results are signed by the enclave for verification
 */

import { expectValid, HexSchema } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import { TeeGpuAttestationResponseSchema } from '../types'
import {
  registerNode,
  updateNodeResources,
  updateNodeStatus,
} from './scheduler'
import type { ComputeNode, ContainerResources } from './types'

// Types

export const GPUType = {
  H200: 'nvidia-h200',
  H100: 'nvidia-h100',
  A100: 'nvidia-a100',
  A10G: 'nvidia-a10g',
  L4: 'nvidia-l4',
  T4: 'nvidia-t4',
} as const
export type GPUType = (typeof GPUType)[keyof typeof GPUType]

export const TEEProvider = {
  PHALA: 'phala',
  INTEL_TDX: 'intel-tdx',
  AMD_SEV: 'amd-sev',
  LOCAL: 'local', // For testing - generates simulated attestations
} as const
export type TEEProvider = (typeof TEEProvider)[keyof typeof TEEProvider]

export interface GPUCapabilities {
  gpuType: GPUType
  gpuCount: number
  vramGb: number
  cudaVersion: string
  tensorCoreSupport: boolean
  fp8Support: boolean
  nvlinkSupport: boolean
}

export interface TEEAttestation {
  quote: Hex
  mrEnclave: Hex
  mrSigner: Hex
  reportData: Hex
  timestamp: number
  provider: TEEProvider
  /** True if this is a simulated attestation (LOCAL mode) */
  simulated: boolean
}

export interface TEEGPUNodeConfig {
  nodeId: string
  address: Address
  endpoint: string
  region: string
  zone: string
  gpu: GPUCapabilities
  teeProvider: TEEProvider
  /** Required for non-LOCAL providers */
  teeEndpoint?: string
  /** Required for non-LOCAL providers */
  teeApiKey?: string
}

export interface TEEGPUNode extends ComputeNode {
  gpu: GPUCapabilities
  teeProvider: TEEProvider
  teeEndpoint: string
  attestation?: TEEAttestation
  lastAttestationAt?: number
}

export interface GPUJobRequest {
  jobId: string
  imageRef: string
  command: string[]
  env: Record<string, string>
  resources: ContainerResources & { gpuType: GPUType; gpuCount: number }
  input: {
    trajectoryManifestCID: string
    rewardsManifestCID: string
    policyModelCID: string
    referenceModelCID?: string
    rlConfig: Record<string, number>
  }
  attestationRequired: boolean
}

export interface GPUJobResult {
  jobId: string
  status: 'completed' | 'failed'
  outputCID?: string
  attestation?: TEEAttestation
  metrics?: {
    trainingLoss: number
    evalScore?: number
    gpuUtilization: number
    vramUsedGb: number
    durationSeconds: number
  }
  error?: string
}

// Validation schemas
const TEEProviderSchema = z.enum(['phala', 'intel-tdx', 'amd-sev', 'local'])

const TEEAttestationSchema = z.object({
  quote: HexSchema,
  mrEnclave: HexSchema,
  mrSigner: HexSchema,
  reportData: HexSchema,
  timestamp: z.number(),
  provider: TEEProviderSchema,
  simulated: z.boolean(),
})

const GPUJobResultSchema = z.object({
  jobId: z.string(),
  status: z.enum(['completed', 'failed']),
  outputCID: z.string().optional(),
  attestation: TEEAttestationSchema.optional(),
  metrics: z
    .object({
      trainingLoss: z.number(),
      evalScore: z.number().optional(),
      gpuUtilization: z.number(),
      vramUsedGb: z.number(),
      durationSeconds: z.number(),
    })
    .optional(),
  error: z.string().optional(),
})

// TEE GPU Provider

const teeGpuNodes = new Map<string, TEEGPUNode>()
const pendingJobs = new Map<string, GPUJobRequest>()
const completedJobs = new Map<string, GPUJobResult>()

export class TEEGPUProvider {
  private config: TEEGPUNodeConfig
  private initialized = false
  private attestationInterval?: ReturnType<typeof setInterval>

  constructor(config: TEEGPUNodeConfig) {
    // LOCAL mode doesn't require endpoint/key - used for testing
    if (config.teeProvider !== TEEProvider.LOCAL) {
      if (!config.teeEndpoint) {
        throw new Error(
          'TEE endpoint is required - set PHALA_ENDPOINT environment variable',
        )
      }
      if (!config.teeApiKey) {
        throw new Error(
          'TEE API key is required - set PHALA_API_KEY environment variable',
        )
      }
    }
    this.config = config
  }

  /**
   * Check if this provider is running in simulated mode
   */
  isSimulated(): boolean {
    return this.config.teeProvider === TEEProvider.LOCAL
  }

  /**
   * Initialize the TEE GPU provider
   */
  async initialize(): Promise<TEEAttestation> {
    console.log(
      `[TEE-GPU] Initializing ${this.config.gpu.gpuType} node ${this.config.nodeId}`,
    )

    // Generate initial attestation from real TEE provider
    const attestation = await this.generateAttestation()

    // Register as compute node
    const node: TEEGPUNode = {
      nodeId: this.config.nodeId,
      address: this.config.address,
      endpoint: this.config.endpoint,
      region: this.config.region,
      zone: this.config.zone,
      resources: {
        totalCpu: 64,
        totalMemoryMb: 512 * 1024, // 512GB
        totalStorageMb: 2 * 1024 * 1024, // 2TB
        availableCpu: 64,
        availableMemoryMb: 512 * 1024,
        availableStorageMb: 2 * 1024 * 1024,
        gpuTypes: [this.config.gpu.gpuType],
      },
      capabilities: [
        'gpu',
        'tee',
        this.config.gpu.gpuType,
        `cuda-${this.config.gpu.cudaVersion}`,
        ...(this.config.gpu.tensorCoreSupport ? ['tensor-cores'] : []),
        ...(this.config.gpu.fp8Support ? ['fp8'] : []),
        ...(this.config.gpu.nvlinkSupport ? ['nvlink'] : []),
      ],
      containers: new Map(),
      cachedImages: new Set(),
      lastHeartbeat: Date.now(),
      status: 'online',
      reputation: 100,
      gpu: this.config.gpu,
      teeProvider: this.config.teeProvider,
      teeEndpoint: this.config.teeEndpoint ?? '',
      attestation,
      lastAttestationAt: Date.now(),
    }

    teeGpuNodes.set(this.config.nodeId, node)
    registerNode(node)

    // Start periodic attestation refresh
    this.attestationInterval = setInterval(async () => {
      await this.refreshAttestation()
    }, 300000) // Every 5 minutes

    this.initialized = true
    console.log(
      `[TEE-GPU] Node ${this.config.nodeId} initialized with ${this.config.gpu.gpuCount}x ${this.config.gpu.gpuType}`,
    )

    return attestation
  }

  /**
   * Submit a GPU job for execution
   */
  async submitJob(request: GPUJobRequest): Promise<string> {
    if (!this.initialized) {
      throw new Error('TEE GPU provider not initialized')
    }

    console.log(`[TEE-GPU] Submitting job ${request.jobId}`)
    pendingJobs.set(request.jobId, request)

    // Execute job asynchronously
    this.executeJob(request).catch((err) => {
      console.error(`[TEE-GPU] Job ${request.jobId} failed:`, err)
      completedJobs.set(request.jobId, {
        jobId: request.jobId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return request.jobId
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): {
    status: 'pending' | 'running' | 'completed' | 'failed'
    result?: GPUJobResult
  } {
    const completed = completedJobs.get(jobId)
    if (completed) {
      return { status: completed.status, result: completed }
    }

    const pending = pendingJobs.get(jobId)
    if (pending) {
      return { status: 'pending' }
    }

    return {
      status: 'failed',
      result: { jobId, status: 'failed', error: 'Job not found' },
    }
  }

  /**
   * Execute GPU job in TEE
   */
  private async executeJob(request: GPUJobRequest): Promise<void> {
    pendingJobs.delete(request.jobId)

    const startTime = Date.now()

    // Allocate resources
    const node = teeGpuNodes.get(this.config.nodeId)
    if (!node) {
      throw new Error('Node not found')
    }

    node.resources.availableCpu -= request.resources.cpuCores
    node.resources.availableMemoryMb -= request.resources.memoryMb
    updateNodeResources(this.config.nodeId, {
      cpu: node.resources.availableCpu,
      memoryMb: node.resources.availableMemoryMb,
      storageMb: node.resources.availableStorageMb,
    })

    try {
      // Execute in TEE
      const result = await this.executeInTEE(request)

      // Generate attestation for result
      const attestation = request.attestationRequired
        ? await this.generateResultAttestation(
            request.jobId,
            result.outputCID ?? '',
          )
        : undefined

      completedJobs.set(request.jobId, {
        ...result,
        attestation,
        metrics: result.metrics
          ? {
              trainingLoss: result.metrics.trainingLoss,
              evalScore: result.metrics.evalScore,
              gpuUtilization: result.metrics.gpuUtilization,
              vramUsedGb: result.metrics.vramUsedGb,
              durationSeconds: (Date.now() - startTime) / 1000,
            }
          : undefined,
      })
    } finally {
      // Release resources
      node.resources.availableCpu += request.resources.cpuCores
      node.resources.availableMemoryMb += request.resources.memoryMb
      updateNodeResources(this.config.nodeId, {
        cpu: node.resources.availableCpu,
        memoryMb: node.resources.availableMemoryMb,
        storageMb: node.resources.availableStorageMb,
      })
    }
  }

  /**
   * Execute job in TEE environment
   */
  private async executeInTEE(request: GPUJobRequest): Promise<GPUJobResult> {
    // LOCAL mode - simulate TEE execution for testing
    if (this.config.teeProvider === TEEProvider.LOCAL) {
      console.log(
        `[TEE-GPU] SIMULATED execution for job ${request.jobId} (LOCAL mode)`,
      )
      await new Promise((resolve) => setTimeout(resolve, 100)) // Simulate processing

      return {
        jobId: request.jobId,
        status: 'completed',
        outputCID: `simulated-output-${Date.now()}`,
        metrics: {
          trainingLoss: 0.05,
          evalScore: 0.85,
          gpuUtilization: 95,
          vramUsedGb: 70,
          durationSeconds: 0.1,
        },
      }
    }

    // Real TEE execution
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.teeApiKey ?? '',
    }

    const response = await fetch(`${this.config.teeEndpoint}/gpu/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jobId: request.jobId,
        image: request.imageRef,
        command: request.command,
        env: request.env,
        gpuType: request.resources.gpuType,
        gpuCount: request.resources.gpuCount,
        input: request.input,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `TEE execution failed: ${response.status} ${await response.text()}`,
      )
    }

    return GPUJobResultSchema.parse(await response.json())
  }

  /**
   * Generate TEE attestation
   * In LOCAL mode, generates simulated attestation for testing
   */
  private async generateAttestation(): Promise<TEEAttestation> {
    // LOCAL mode - generate simulated attestation for testing
    if (this.config.teeProvider === TEEProvider.LOCAL) {
      const timestamp = Date.now()
      const mrEnclave = keccak256(toBytes(`${this.config.nodeId}:${timestamp}`))

      console.log(`[TEE-GPU] Generating SIMULATED attestation (LOCAL mode)`)

      return {
        quote: `0x${'00'.repeat(256)}` as Hex, // Placeholder quote
        mrEnclave,
        mrSigner: keccak256(toBytes(this.config.address)),
        reportData: keccak256(
          toBytes(`${mrEnclave}:${this.config.gpu.gpuType}`),
        ),
        timestamp,
        provider: TEEProvider.LOCAL,
        simulated: true,
      }
    }

    // Real TEE attestation
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.teeApiKey ?? '',
    }

    const response = await fetch(
      `${this.config.teeEndpoint}/attestation/generate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          gpuType: this.config.gpu.gpuType,
          gpuCount: this.config.gpu.gpuCount,
        }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `Failed to generate attestation: ${response.status} ${await response.text()}`,
      )
    }

    const data = expectValid(
      TeeGpuAttestationResponseSchema,
      await response.json(),
      'TEE GPU attestation response',
    )

    return {
      quote: data.quote as Hex,
      mrEnclave: data.mr_enclave as Hex,
      mrSigner: data.mr_signer as Hex,
      reportData: data.report_data as Hex,
      timestamp: data.timestamp,
      provider: this.config.teeProvider,
      simulated: false,
    }
  }

  /**
   * Generate attestation for job result
   */
  private async generateResultAttestation(
    jobId: string,
    outputCID: string,
  ): Promise<TEEAttestation> {
    const baseAttestation = await this.generateAttestation()
    const resultHash = keccak256(toBytes(`${jobId}:${outputCID}`))

    return {
      ...baseAttestation,
      reportData: resultHash,
    }
  }

  /**
   * Refresh attestation
   */
  private async refreshAttestation(): Promise<void> {
    const attestation = await this.generateAttestation()
    const node = teeGpuNodes.get(this.config.nodeId)
    if (node) {
      node.attestation = attestation
      node.lastAttestationAt = Date.now()
    }
    console.log(`[TEE-GPU] Attestation refreshed for ${this.config.nodeId}`)
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    if (this.attestationInterval) {
      clearInterval(this.attestationInterval)
    }
    updateNodeStatus(this.config.nodeId, 'offline')
    teeGpuNodes.delete(this.config.nodeId)
    this.initialized = false
    console.log(`[TEE-GPU] Node ${this.config.nodeId} shutdown`)
  }
}

// Factory Functions

/** GPU specifications by type */
export const GPU_SPECS: Record<GPUType, Omit<GPUCapabilities, 'gpuCount'>> = {
  [GPUType.H200]: {
    gpuType: GPUType.H200,
    vramGb: 141,
    cudaVersion: '12.4',
    tensorCoreSupport: true,
    fp8Support: true,
    nvlinkSupport: true,
  },
  [GPUType.H100]: {
    gpuType: GPUType.H100,
    vramGb: 80,
    cudaVersion: '12.4',
    tensorCoreSupport: true,
    fp8Support: true,
    nvlinkSupport: true,
  },
  [GPUType.A100]: {
    gpuType: GPUType.A100,
    vramGb: 80,
    cudaVersion: '12.0',
    tensorCoreSupport: true,
    fp8Support: false,
    nvlinkSupport: true,
  },
  [GPUType.A10G]: {
    gpuType: GPUType.A10G,
    vramGb: 24,
    cudaVersion: '12.0',
    tensorCoreSupport: true,
    fp8Support: false,
    nvlinkSupport: false,
  },
  [GPUType.L4]: {
    gpuType: GPUType.L4,
    vramGb: 24,
    cudaVersion: '12.0',
    tensorCoreSupport: true,
    fp8Support: true,
    nvlinkSupport: false,
  },
  [GPUType.T4]: {
    gpuType: GPUType.T4,
    vramGb: 16,
    cudaVersion: '11.8',
    tensorCoreSupport: true,
    fp8Support: false,
    nvlinkSupport: false,
  },
}

export interface CreateTEEGPUProviderConfig {
  gpuType: GPUType
  nodeId?: string
  address: Address
  endpoint: string
  region?: string
  zone?: string
  teeProvider?: TEEProvider
  teeEndpoint?: string
  teeApiKey?: string
  gpuCount?: number
}

/**
 * Create a TEE GPU provider for training
 *
 * For production: Requires PHALA_ENDPOINT and PHALA_API_KEY environment variables
 * For testing: Use teeProvider: TEEProvider.LOCAL to run in simulated mode
 */
export function createTEEGPUProvider(
  config: CreateTEEGPUProviderConfig,
): TEEGPUProvider {
  const gpuSpec = GPU_SPECS[config.gpuType]
  const gpuName = config.gpuType.replace('nvidia-', '')
  const teeProvider = config.teeProvider ?? TEEProvider.PHALA

  // LOCAL mode doesn't require endpoint/key
  if (teeProvider === TEEProvider.LOCAL) {
    console.log('[TEE-GPU] Creating provider in LOCAL (simulated) mode')
    return new TEEGPUProvider({
      nodeId: config.nodeId ?? `${gpuName}-local-${Date.now()}`,
      address: config.address,
      endpoint: config.endpoint,
      region: config.region ?? 'local',
      zone: config.zone ?? 'local-zone',
      gpu: {
        ...gpuSpec,
        gpuCount: config.gpuCount ?? 8,
      },
      teeProvider: TEEProvider.LOCAL,
    })
  }

  // Production mode requires real TEE credentials
  const teeEndpoint = config.teeEndpoint ?? process.env.PHALA_ENDPOINT
  const teeApiKey = config.teeApiKey ?? process.env.PHALA_API_KEY

  if (!teeEndpoint) {
    throw new Error(
      'TEE endpoint required: set PHALA_ENDPOINT environment variable or pass teeEndpoint',
    )
  }
  if (!teeApiKey) {
    throw new Error(
      'TEE API key required: set PHALA_API_KEY environment variable or pass teeApiKey',
    )
  }

  return new TEEGPUProvider({
    nodeId: config.nodeId ?? `${gpuName}-${Date.now()}`,
    address: config.address,
    endpoint: config.endpoint,
    region: config.region ?? 'us-west-2',
    zone: config.zone ?? 'gpu-zone-1',
    gpu: {
      ...gpuSpec,
      gpuCount: config.gpuCount ?? 8,
    },
    teeProvider,
    teeEndpoint,
    teeApiKey,
  })
}

// Utility Functions

export function getTEEGPUNodes(): TEEGPUNode[] {
  return [...teeGpuNodes.values()]
}

export function getTEEGPUNode(nodeId: string): TEEGPUNode | undefined {
  return teeGpuNodes.get(nodeId)
}

export function getAvailableGPUNodes(gpuType?: GPUType): TEEGPUNode[] {
  return [...teeGpuNodes.values()].filter((node) => {
    if (node.status !== 'online') return false
    if (gpuType && node.gpu.gpuType !== gpuType) return false
    return true
  })
}
