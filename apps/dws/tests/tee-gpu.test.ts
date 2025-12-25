/**
 * TEE GPU Provider Tests
 * Tests for H200/H100 GPU provisioning via TEE
 *
 * These tests require TEE credentials to run:
 * - Set PHALA_ENDPOINT and PHALA_API_KEY environment variables
 * - Or skip these tests in CI without TEE access
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createTEEGPUProvider,
  GPU_SPECS,
  type GPUJobRequest,
  GPUType,
  getAvailableGPUNodes,
  getTEEGPUNode,
  getTEEGPUNodes,
  type TEEAttestation,
  type TEEGPUProvider,
  TEEProvider,
} from '../api/containers/tee-gpu-provider'

// Test account
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
const TEST_ENDPOINT = 'http://localhost:4030'

// Check if TEE is available
const TEE_AVAILABLE = !!(
  process.env.PHALA_ENDPOINT && process.env.PHALA_API_KEY
)

describe('TEE GPU Provider', () => {
  // Tests that require TEE credentials
  describe.skipIf(!TEE_AVAILABLE)('With TEE Credentials', () => {
    let provider: TEEGPUProvider

    describe('Initialization', () => {
      test('creates H200 provider', () => {
        provider = createTEEGPUProvider({
          gpuType: GPUType.H200,
          nodeId: `test-h200-${Date.now()}`,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
          teeProvider: TEEProvider.PHALA,
          gpuCount: 8,
        })
        expect(provider).toBeDefined()
      })

      test('creates H100 provider', () => {
        const h100Provider = createTEEGPUProvider({
          gpuType: GPUType.H100,
          nodeId: `test-h100-${Date.now()}`,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
          teeProvider: TEEProvider.PHALA,
          gpuCount: 4,
        })
        expect(h100Provider).toBeDefined()
      })
    })

    describe('Provider Lifecycle', () => {
      let attestation: TEEAttestation

      beforeAll(async () => {
        attestation = await provider.initialize()
      })

      afterAll(async () => {
        await provider.shutdown()
      })

      test('generates attestation on init', () => {
        expect(attestation.mrEnclave).toBeDefined()
        expect(attestation.mrSigner).toBeDefined()
        expect(attestation.quote).toBeDefined()
        expect(attestation.timestamp).toBeGreaterThan(0)
        expect(attestation.provider).toBe(TEEProvider.PHALA)
      })

      test('registers node with scheduler', () => {
        const nodes = getTEEGPUNodes()
        expect(nodes.length).toBeGreaterThan(0)
      })

      test('node has correct GPU config', () => {
        const nodes = getTEEGPUNodes()
        const node = nodes[0]
        expect(node).toBeDefined()
        expect(node?.gpu.gpuType).toBe(GPUType.H200)
        expect(node?.gpu.gpuCount).toBe(8)
        expect(node?.gpu.vramGb).toBe(141)
        expect(node?.capabilities).toContain('gpu')
        expect(node?.capabilities).toContain('tee')
        expect(node?.capabilities).toContain(GPUType.H200)
      })
    })

    describe('Job Execution', () => {
      let provider2: TEEGPUProvider
      let jobRequest: GPUJobRequest

      beforeAll(async () => {
        provider2 = createTEEGPUProvider({
          gpuType: GPUType.H200,
          nodeId: `test-job-${Date.now()}`,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
          teeProvider: TEEProvider.PHALA,
          gpuCount: 8,
        })
        await provider2.initialize()

        jobRequest = {
          jobId: `job-${Date.now()}`,
          imageRef: 'ghcr.io/jeju/training:latest',
          command: ['python', 'train.py'],
          env: { EPOCHS: '10' },
          resources: {
            cpuCores: 16,
            memoryMb: 64 * 1024,
            storageMb: 100 * 1024,
            gpuType: GPUType.H200,
            gpuCount: 1,
          },
          input: {
            trajectoryManifestCID: 'QmTestTrajectory',
            rewardsManifestCID: 'QmTestRewards',
            policyModelCID: 'QmTestPolicy',
            rlConfig: { learningRate: 0.001, batchSize: 32 },
          },
          attestationRequired: true,
        }
      })

      afterAll(async () => {
        await provider2.shutdown()
      })

      test('submits job', async () => {
        const jobId = await provider2.submitJob(jobRequest)
        expect(jobId).toBe(jobRequest.jobId)
      })

      test('gets job status', async () => {
        // Give job time to process
        await new Promise((r) => setTimeout(r, 200))

        const status = provider2.getJobStatus(jobRequest.jobId)
        expect(['pending', 'running', 'completed', 'failed']).toContain(
          status.status,
        )
      })
    })

    describe('Node Management', () => {
      test('getAvailableGPUNodes filters by type', () => {
        const h200Nodes = getAvailableGPUNodes(GPUType.H200)
        const a100Nodes = getAvailableGPUNodes(GPUType.A100)

        // All returned nodes should match the type
        for (const node of h200Nodes) {
          expect(node.gpu.gpuType).toBe(GPUType.H200)
        }
        for (const node of a100Nodes) {
          expect(node.gpu.gpuType).toBe(GPUType.A100)
        }
      })

      test('getTEEGPUNode returns specific node', async () => {
        const nodeId = `test-specific-${Date.now()}`
        const p = createTEEGPUProvider({
          gpuType: GPUType.A100,
          nodeId,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
          teeProvider: TEEProvider.PHALA,
        })
        await p.initialize()

        const node = getTEEGPUNode(nodeId)
        expect(node).toBeDefined()
        expect(node?.nodeId).toBe(nodeId)

        await p.shutdown()
      })

      test('shutdown removes node from registry', async () => {
        const nodeId = `test-shutdown-${Date.now()}`
        const p = createTEEGPUProvider({
          gpuType: GPUType.A100,
          nodeId,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
          teeProvider: TEEProvider.PHALA,
        })
        await p.initialize()
        await p.shutdown()

        const node = getTEEGPUNode(nodeId)
        expect(node).toBeUndefined()
      })
    })
  })

  // Tests that don't require TEE credentials
  describe('GPU Types', () => {
    test('GPUType enum has expected values', () => {
      expect(GPUType.H200).toBe('nvidia-h200')
      expect(GPUType.H100).toBe('nvidia-h100')
      expect(GPUType.A100).toBe('nvidia-a100')
      expect(GPUType.A10G).toBe('nvidia-a10g')
      expect(GPUType.L4).toBe('nvidia-l4')
      expect(GPUType.T4).toBe('nvidia-t4')
    })

    test('TEEProvider enum has expected values', () => {
      expect(TEEProvider.PHALA).toBe('phala')
      expect(TEEProvider.INTEL_TDX).toBe('intel-tdx')
      expect(TEEProvider.AMD_SEV).toBe('amd-sev')
    })

    test('GPU_SPECS has all GPU types', () => {
      expect(GPU_SPECS[GPUType.H200]).toBeDefined()
      expect(GPU_SPECS[GPUType.H100]).toBeDefined()
      expect(GPU_SPECS[GPUType.A100]).toBeDefined()
      expect(GPU_SPECS[GPUType.A10G]).toBeDefined()
      expect(GPU_SPECS[GPUType.L4]).toBeDefined()
      expect(GPU_SPECS[GPUType.T4]).toBeDefined()
    })

    test('GPU_SPECS has correct VRAM values', () => {
      expect(GPU_SPECS[GPUType.H200].vramGb).toBe(141)
      expect(GPU_SPECS[GPUType.H100].vramGb).toBe(80)
      expect(GPU_SPECS[GPUType.A100].vramGb).toBe(80)
      expect(GPU_SPECS[GPUType.A10G].vramGb).toBe(24)
      expect(GPU_SPECS[GPUType.L4].vramGb).toBe(24)
      expect(GPU_SPECS[GPUType.T4].vramGb).toBe(16)
    })
  })

  describe('Factory Function Validation', () => {
    test('throws without TEE endpoint', () => {
      // Clear env vars temporarily
      const savedEndpoint = process.env.PHALA_ENDPOINT
      const savedApiKey = process.env.PHALA_API_KEY
      delete process.env.PHALA_ENDPOINT
      delete process.env.PHALA_API_KEY

      expect(() => {
        createTEEGPUProvider({
          gpuType: GPUType.H200,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
        })
      }).toThrow('TEE endpoint required')

      // Restore
      if (savedEndpoint) process.env.PHALA_ENDPOINT = savedEndpoint
      if (savedApiKey) process.env.PHALA_API_KEY = savedApiKey
    })

    test('throws without TEE API key', () => {
      // Clear env vars temporarily
      const savedEndpoint = process.env.PHALA_ENDPOINT
      const savedApiKey = process.env.PHALA_API_KEY
      process.env.PHALA_ENDPOINT = 'https://test.phala.network'
      delete process.env.PHALA_API_KEY

      expect(() => {
        createTEEGPUProvider({
          gpuType: GPUType.H200,
          address: TEST_ADDRESS,
          endpoint: TEST_ENDPOINT,
        })
      }).toThrow('TEE API key required')

      // Restore
      if (savedEndpoint) {
        process.env.PHALA_ENDPOINT = savedEndpoint
      } else {
        delete process.env.PHALA_ENDPOINT
      }
      if (savedApiKey) process.env.PHALA_API_KEY = savedApiKey
    })
  })
})
