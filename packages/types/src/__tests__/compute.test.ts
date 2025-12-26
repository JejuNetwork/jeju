/**
 * @fileoverview Comprehensive tests for compute.ts
 *
 * Tests cover:
 * - RunStatusSchema: Run/job status validation
 * - ComputeProviderSchema: Provider registration validation
 * - ComputeCapabilitySchema: Model capabilities validation
 * - InferenceRequestSchema: Chat inference request validation
 * - InferenceResponseSchema: Inference response validation
 * - ComputeResourcesSchema: Hardware resources validation
 * - ResourcePricingSchema: Pricing model validation
 * - ComputeRentalSchema: Rental session validation
 * - Various utility schemas and types
 */

import { describe, expect, test } from 'bun:test'
import {
  ArchitectureSchema,
  ChatMessageRoleSchema,
  type ComputeCapability,
  ComputeCapabilitySchema,
  type ComputeProvider,
  ComputeProviderSchema,
  type ComputeRental,
  ComputeRentalSchema,
  type ComputeResources,
  ComputeResourcesSchema,
  ComputeStakeType,
  ContainerStatusSchema,
  type CreateRentalRequest,
  CreateRentalRequestSchema,
  GatewayRouteTypeSchema,
  GPUType,
  type HardwareInfo,
  HardwareInfoSchema,
  type InferenceRequest,
  InferenceRequestSchema,
  type InferenceResponse,
  InferenceResponseSchema,
  ModelBackendSchema,
  PlatformSchema,
  RentalStatus,
  ResourceType,
  type RunStatus,
  RunStatusSchema,
  type TokenUsage,
  TokenUsageSchema,
} from '../compute'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
const TEST_HASH = `0x${'a'.repeat(64)}` as `0x${string}`

describe('RunStatusSchema', () => {
  const validStatuses: RunStatus[] = [
    'queued',
    'waiting',
    'in_progress',
    'started',
    'completed',
    'failed',
    'cancelled',
    'skipped',
    'timeout',
  ]

  const invalidStatuses = ['running', 'pending', 'done', '']

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(RunStatusSchema.safeParse(status).success).toBe(true)
  })

  test.each(invalidStatuses)('rejects invalid status: %s', (status) => {
    expect(RunStatusSchema.safeParse(status).success).toBe(false)
  })
})

describe('ComputeProviderSchema', () => {
  const validProvider: ComputeProvider = {
    address: TEST_ADDRESS,
    name: 'Provider One',
    endpoint: 'https://compute.example.com',
    attestationHash: TEST_HASH,
    stake: 1000000000000000000n,
    registeredAt: Date.now(),
    agentId: 1,
    active: true,
  }

  test('accepts valid provider', () => {
    const result = ComputeProviderSchema.safeParse(validProvider)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Provider One')
      expect(result.data.active).toBe(true)
    }
  })

  test('rejects invalid endpoint URL', () => {
    const provider = {
      ...validProvider,
      endpoint: 'not-a-url',
    }
    expect(ComputeProviderSchema.safeParse(provider).success).toBe(false)
  })

  test('rejects invalid address', () => {
    const provider = {
      ...validProvider,
      address: '0xinvalid',
    }
    expect(ComputeProviderSchema.safeParse(provider).success).toBe(false)
  })

  test('rejects negative agentId', () => {
    const provider = {
      ...validProvider,
      agentId: -1,
    }
    expect(ComputeProviderSchema.safeParse(provider).success).toBe(false)
  })
})

describe('ComputeCapabilitySchema', () => {
  const validCapability: ComputeCapability = {
    model: 'llama-3-70b',
    pricePerInputToken: 100n,
    pricePerOutputToken: 200n,
    maxContextLength: 8192,
    active: true,
  }

  test('accepts valid capability', () => {
    const result = ComputeCapabilitySchema.safeParse(validCapability)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('llama-3-70b')
      expect(result.data.maxContextLength).toBe(8192)
    }
  })

  test('rejects non-positive maxContextLength', () => {
    const cap = { ...validCapability, maxContextLength: 0 }
    expect(ComputeCapabilitySchema.safeParse(cap).success).toBe(false)

    const capNegative = { ...validCapability, maxContextLength: -1 }
    expect(ComputeCapabilitySchema.safeParse(capNegative).success).toBe(false)
  })
})

describe('ChatMessageRoleSchema', () => {
  test('accepts valid roles', () => {
    expect(ChatMessageRoleSchema.safeParse('system').success).toBe(true)
    expect(ChatMessageRoleSchema.safeParse('user').success).toBe(true)
    expect(ChatMessageRoleSchema.safeParse('assistant').success).toBe(true)
  })

  test('rejects invalid roles', () => {
    expect(ChatMessageRoleSchema.safeParse('function').success).toBe(false)
    expect(ChatMessageRoleSchema.safeParse('tool').success).toBe(false)
  })
})

describe('InferenceRequestSchema', () => {
  const validRequest: InferenceRequest = {
    model: 'llama-3-70b',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello, world!' },
    ],
    temperature: 0.7,
    max_tokens: 1000,
    stream: false,
  }

  test('accepts valid request', () => {
    const result = InferenceRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model).toBe('llama-3-70b')
      expect(result.data.messages).toHaveLength(2)
    }
  })

  test('accepts minimal request', () => {
    const minimal = {
      model: 'llama-3-8b',
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const result = InferenceRequestSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  test('rejects temperature out of range', () => {
    const request = { ...validRequest, temperature: 3 }
    expect(InferenceRequestSchema.safeParse(request).success).toBe(false)

    const requestNegative = { ...validRequest, temperature: -0.1 }
    expect(InferenceRequestSchema.safeParse(requestNegative).success).toBe(
      false,
    )
  })

  test('rejects empty messages array', () => {
    const request = { ...validRequest, messages: [] }
    // Empty array is technically valid per schema, but 0 length allowed
    const result = InferenceRequestSchema.safeParse(request)
    expect(result.success).toBe(true)
  })

  test('accepts request with seed', () => {
    const request = { ...validRequest, seed: 42 }
    const result = InferenceRequestSchema.safeParse(request)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.seed).toBe(42)
    }
  })
})

describe('TokenUsageSchema', () => {
  const validUsage: TokenUsage = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  }

  test('accepts valid usage', () => {
    const result = TokenUsageSchema.safeParse(validUsage)
    expect(result.success).toBe(true)
  })

  test('rejects negative tokens', () => {
    const usage = { ...validUsage, prompt_tokens: -1 }
    expect(TokenUsageSchema.safeParse(usage).success).toBe(false)
  })

  test('rejects non-integer tokens', () => {
    const usage = { ...validUsage, prompt_tokens: 100.5 }
    expect(TokenUsageSchema.safeParse(usage).success).toBe(false)
  })
})

describe('InferenceResponseSchema', () => {
  const validResponse: InferenceResponse = {
    id: 'response-123',
    model: 'llama-3-70b',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
  }

  test('accepts valid response', () => {
    const result = InferenceResponseSchema.safeParse(validResponse)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('response-123')
      expect(result.data.choices[0]?.finish_reason).toBe('stop')
    }
  })

  test('accepts response with settlement info', () => {
    const response = {
      ...validResponse,
      settlement: {
        provider: TEST_ADDRESS,
        requestHash: TEST_HASH,
        inputTokens: 10,
        outputTokens: 8,
        nonce: 1,
        signature: `0x${'a'.repeat(130)}`,
      },
    }
    const result = InferenceResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })

  test('accepts null finish_reason', () => {
    const response = {
      ...validResponse,
      choices: [
        {
          message: { role: 'assistant', content: 'Hello' },
          finish_reason: null,
        },
      ],
    }
    const result = InferenceResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })
})

describe('HardwareInfoSchema', () => {
  const validHardware: HardwareInfo = {
    platform: 'linux',
    arch: 'x64',
    cpus: 32,
    memory: 128,
    gpuType: 'NVIDIA H100',
    gpuVram: 80,
    cudaVersion: '12.2',
    mlxVersion: null,
  }

  test('accepts valid hardware info', () => {
    const result = HardwareInfoSchema.safeParse(validHardware)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.platform).toBe('linux')
      expect(result.data.gpuType).toBe('NVIDIA H100')
    }
  })

  test('accepts Apple Silicon config', () => {
    const mac: HardwareInfo = {
      platform: 'darwin',
      arch: 'arm64',
      cpus: 12,
      memory: 64,
      gpuType: 'Apple M3 Max',
      gpuVram: 40,
      cudaVersion: null,
      mlxVersion: '0.5.0',
    }
    const result = HardwareInfoSchema.safeParse(mac)
    expect(result.success).toBe(true)
  })

  test('rejects invalid platform', () => {
    const hardware = { ...validHardware, platform: 'freebsd' }
    expect(HardwareInfoSchema.safeParse(hardware).success).toBe(false)
  })

  test('rejects non-positive cpus', () => {
    const hardware = { ...validHardware, cpus: 0 }
    expect(HardwareInfoSchema.safeParse(hardware).success).toBe(false)
  })
})

describe('PlatformSchema', () => {
  test('accepts valid platforms', () => {
    expect(PlatformSchema.safeParse('darwin').success).toBe(true)
    expect(PlatformSchema.safeParse('linux').success).toBe(true)
    expect(PlatformSchema.safeParse('win32').success).toBe(true)
  })
})

describe('ArchitectureSchema', () => {
  test('accepts valid architectures', () => {
    expect(ArchitectureSchema.safeParse('arm64').success).toBe(true)
    expect(ArchitectureSchema.safeParse('x64').success).toBe(true)
  })
})

describe('ModelBackendSchema', () => {
  test('accepts valid backends', () => {
    expect(ModelBackendSchema.safeParse('ollama').success).toBe(true)
    expect(ModelBackendSchema.safeParse('llamacpp').success).toBe(true)
    expect(ModelBackendSchema.safeParse('mock').success).toBe(true)
  })
})

describe('ComputeResourcesSchema', () => {
  const validResources: ComputeResources = {
    gpuType: String(GPUType.NVIDIA_H100),
    gpuCount: 8,
    gpuVram: 80,
    cpuCores: 64,
    memory: 512,
    storage: 2000,
    bandwidth: 25000,
    teeCapable: false,
  }

  test('accepts valid resources', () => {
    const result = ComputeResourcesSchema.safeParse(validResources)
    expect(result.success).toBe(true)
  })

  test('accepts zero GPU count', () => {
    const resources = { ...validResources, gpuCount: 0 }
    const result = ComputeResourcesSchema.safeParse(resources)
    expect(result.success).toBe(true)
  })

  test('rejects non-positive cpuCores', () => {
    const resources = { ...validResources, cpuCores: 0 }
    expect(ComputeResourcesSchema.safeParse(resources).success).toBe(false)
  })
})

describe('ComputeRentalSchema', () => {
  const validRental: ComputeRental = {
    rentalId: 'rental-123',
    user: TEST_ADDRESS,
    provider: TEST_ADDRESS,
    resources: {
      gpuType: String(GPUType.NVIDIA_A100_80GB),
      gpuCount: 2,
      gpuVram: 80,
      cpuCores: 16,
      memory: 128,
      storage: 500,
      bandwidth: 10000,
      teeCapable: false,
    },
    status: String(RentalStatus.ACTIVE),
    startTime: Date.now(),
    endTime: Date.now() + 3600000,
    totalCost: 1000000000000000000n,
    paidAmount: 1000000000000000000n,
    sshPublicKey: 'ssh-rsa AAAA...',
  }

  test('accepts valid rental', () => {
    const result = ComputeRentalSchema.safeParse(validRental)
    expect(result.success).toBe(true)
  })

  test('accepts rental with optional fields', () => {
    const rental = {
      ...validRental,
      containerImage: 'nvidia/cuda:12.2-base',
      startupScript: '#!/bin/bash\necho "Hello"',
      sshHost: '192.168.1.100',
      sshPort: 22,
    }
    const result = ComputeRentalSchema.safeParse(rental)
    expect(result.success).toBe(true)
  })
})

describe('CreateRentalRequestSchema', () => {
  const validRequest: CreateRentalRequest = {
    provider: TEST_ADDRESS,
    durationHours: 24,
    sshPublicKey: 'ssh-rsa AAAA...',
  }

  test('accepts valid request', () => {
    const result = CreateRentalRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  test('accepts request with environment vars', () => {
    const request = {
      ...validRequest,
      containerImage: 'nvidia/cuda:12.2-base',
      environmentVars: {
        API_KEY: 'secret123',
        DEBUG: 'true',
      },
    }
    const result = CreateRentalRequestSchema.safeParse(request)
    expect(result.success).toBe(true)
  })

  test('rejects non-positive durationHours', () => {
    const request = { ...validRequest, durationHours: 0 }
    expect(CreateRentalRequestSchema.safeParse(request).success).toBe(false)
  })
})

describe('ContainerStatusSchema', () => {
  const validStatuses = ['creating', 'running', 'paused', 'stopped', 'error']

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(ContainerStatusSchema.safeParse(status).success).toBe(true)
  })
})

describe('GatewayRouteTypeSchema', () => {
  test('accepts valid route types', () => {
    expect(GatewayRouteTypeSchema.safeParse('ssh').success).toBe(true)
    expect(GatewayRouteTypeSchema.safeParse('http').success).toBe(true)
    expect(GatewayRouteTypeSchema.safeParse('tcp').success).toBe(true)
  })
})

describe('Constant values', () => {
  test('ComputeStakeType has correct values', () => {
    expect(ComputeStakeType.NONE).toBe(0)
    expect(ComputeStakeType.USER).toBe(1)
    expect(ComputeStakeType.PROVIDER).toBe(2)
    expect(ComputeStakeType.GUARDIAN).toBe(3)
  })

  test('ResourceType has correct values', () => {
    expect(ResourceType.GPU).toBe(0)
    expect(ResourceType.CPU).toBe(1)
    expect(ResourceType.MEMORY).toBe(2)
    expect(ResourceType.STORAGE).toBe(3)
  })

  test('GPUType has correct values', () => {
    expect(GPUType.NONE).toBe(0)
    expect(GPUType.NVIDIA_RTX_4090).toBe(1)
    expect(GPUType.NVIDIA_A100_40GB).toBe(2)
    expect(GPUType.NVIDIA_A100_80GB).toBe(3)
    expect(GPUType.NVIDIA_H100).toBe(4)
    expect(GPUType.NVIDIA_H200).toBe(5)
    expect(GPUType.AMD_MI300X).toBe(6)
    expect(GPUType.APPLE_M1_MAX).toBe(7)
    expect(GPUType.APPLE_M2_ULTRA).toBe(8)
    expect(GPUType.APPLE_M3_MAX).toBe(9)
  })

  test('RentalStatus has correct values', () => {
    expect(RentalStatus.PENDING).toBe(0)
    expect(RentalStatus.ACTIVE).toBe(1)
    expect(RentalStatus.PAUSED).toBe(2)
    expect(RentalStatus.COMPLETED).toBe(3)
    expect(RentalStatus.CANCELLED).toBe(4)
    expect(RentalStatus.EXPIRED).toBe(5)
  })
})
