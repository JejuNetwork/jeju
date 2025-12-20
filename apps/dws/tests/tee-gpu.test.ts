/**
 * TEE GPU Provider Tests
 * Tests for H200/H100 GPU provisioning via TEE
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  TEEGPUProvider,
  createH200Provider,
  createH100Provider,
  getTEEGPUNodes,
  getTEEGPUNode,
  getAvailableGPUNodes,
  GPUType,
  TEEProvider,
  type GPUCapabilities,
  type TEEAttestation,
  type TEEGPUNode,
  type GPUJobRequest,
  type GPUJobResult,
} from '../src/containers/tee-gpu-provider';

// Test account
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const TEST_ENDPOINT = 'http://localhost:4030';

describe('TEE GPU Provider', () => {
  let provider: TEEGPUProvider;

  describe('Initialization', () => {
    test('creates H200 provider', () => {
      provider = createH200Provider({
        nodeId: `test-h200-${Date.now()}`,
        address: TEST_ADDRESS,
        endpoint: TEST_ENDPOINT,
        teeProvider: TEEProvider.LOCAL,
        gpuCount: 8,
      });
      expect(provider).toBeDefined();
    });

    test('creates H100 provider', () => {
      const h100Provider = createH100Provider({
        nodeId: `test-h100-${Date.now()}`,
        address: TEST_ADDRESS,
        endpoint: TEST_ENDPOINT,
        teeProvider: TEEProvider.LOCAL,
        gpuCount: 4,
      });
      expect(h100Provider).toBeDefined();
    });
  });

  describe('Provider Lifecycle', () => {
    let attestation: TEEAttestation;

    beforeAll(async () => {
      attestation = await provider.initialize();
    });

    afterAll(async () => {
      await provider.shutdown();
    });

    test('generates attestation on init', () => {
      expect(attestation.mrEnclave).toBeDefined();
      expect(attestation.mrSigner).toBeDefined();
      expect(attestation.quote).toBeDefined();
      expect(attestation.timestamp).toBeGreaterThan(0);
      expect(attestation.provider).toBe(TEEProvider.LOCAL);
    });

    test('registers node with scheduler', () => {
      const nodes = getTEEGPUNodes();
      expect(nodes.length).toBeGreaterThan(0);
    });

    test('node has correct GPU config', () => {
      const nodes = getTEEGPUNodes();
      const node = nodes[0];
      expect(node).toBeDefined();
      expect(node?.gpu.gpuType).toBe(GPUType.H200);
      expect(node?.gpu.gpuCount).toBe(8);
      expect(node?.gpu.vramGb).toBe(80);
      expect(node?.gpu.tensorCoreSupport).toBe(true);
      expect(node?.gpu.fp8Support).toBe(true);
    });

    test('node has correct TEE config', () => {
      const nodes = getTEEGPUNodes();
      const node = nodes[0];
      expect(node?.teeProvider).toBe(TEEProvider.LOCAL);
      expect(node?.attestation).toBeDefined();
    });
  });

  describe('Job Execution', () => {
    let provider2: TEEGPUProvider;

    beforeAll(async () => {
      provider2 = createH200Provider({
        nodeId: `test-job-${Date.now()}`,
        address: TEST_ADDRESS,
        endpoint: TEST_ENDPOINT,
        teeProvider: TEEProvider.LOCAL,
        gpuCount: 4,
      });
      await provider2.initialize();
    });

    afterAll(async () => {
      await provider2.shutdown();
    });

    test('submits job successfully', async () => {
      const jobId = `test-${Date.now()}`;
      const request: GPUJobRequest = {
        jobId,
        imageRef: 'test:latest',
        command: ['echo', 'hello'],
        env: {},
        resources: {
          cpuCores: 4,
          memoryMb: 16384,
          storageMb: 10240,
          gpuType: GPUType.H200,
          gpuCount: 1,
        },
        input: {
          trajectoryManifestCID: 'test-cid',
          rewardsManifestCID: 'test-rewards',
          policyModelCID: 'test-policy',
          rlConfig: { batchSize: 32 },
        },
        attestationRequired: true,
      };

      const submittedJobId = await provider2.submitJob(request);
      expect(submittedJobId).toBe(jobId);
    });

    test('job completes with result', { timeout: 10000 }, async () => {
      const jobId = `complete-${Date.now()}`;
      const request: GPUJobRequest = {
        jobId,
        imageRef: 'test:latest',
        command: ['python', 'train.py'],
        env: {},
        resources: {
          cpuCores: 8,
          memoryMb: 32768,
          storageMb: 20480,
          gpuType: GPUType.H200,
          gpuCount: 2,
        },
        input: {
          trajectoryManifestCID: 'test-cid',
          rewardsManifestCID: 'test-rewards',
          policyModelCID: 'test-policy',
          rlConfig: { batchSize: 64, learningRate: 0.0001 },
        },
        attestationRequired: true,
      };

      await provider2.submitJob(request);

      // Wait for completion (local mode is fast)
      await new Promise((r) => setTimeout(r, 6000));

      const status = provider2.getJobStatus(jobId);
      expect(status.status).toBe('completed');
      expect(status.result).toBeDefined();
      expect(status.result?.attestation).toBeDefined();
      expect(status.result?.metrics).toBeDefined();
    });

    test('job result has metrics', { timeout: 10000 }, async () => {
      const jobId = `metrics-${Date.now()}`;
      const request: GPUJobRequest = {
        jobId,
        imageRef: 'test:latest',
        command: ['train'],
        env: {},
        resources: {
          cpuCores: 4,
          memoryMb: 16384,
          storageMb: 10240,
          gpuType: GPUType.H200,
          gpuCount: 1,
        },
        input: {
          trajectoryManifestCID: 'test',
          rewardsManifestCID: 'test',
          policyModelCID: 'test',
          rlConfig: {},
        },
        attestationRequired: false,
      };

      await provider2.submitJob(request);
      await new Promise((r) => setTimeout(r, 6000));

      const status = provider2.getJobStatus(jobId);
      if (status.status === 'completed' && status.result?.metrics) {
        expect(typeof status.result.metrics.trainingLoss).toBe('number');
        expect(typeof status.result.metrics.gpuUtilization).toBe('number');
        expect(typeof status.result.metrics.vramUsedGb).toBe('number');
        expect(typeof status.result.metrics.durationSeconds).toBe('number');
      }
    });
  });

  describe('Node Management', () => {
    test('getAvailableGPUNodes filters by type', () => {
      const h200Nodes = getAvailableGPUNodes(GPUType.H200);
      expect(h200Nodes.every((n) => n.gpu.gpuType === GPUType.H200)).toBe(true);
    });

    test('getTEEGPUNode returns specific node', async () => {
      const nodeId = `lookup-${Date.now()}`;
      const p = createH200Provider({
        nodeId,
        address: TEST_ADDRESS,
        endpoint: TEST_ENDPOINT,
        teeProvider: TEEProvider.LOCAL,
      });
      await p.initialize();

      const node = getTEEGPUNode(nodeId);
      expect(node).toBeDefined();
      expect(node?.nodeId).toBe(nodeId);

      await p.shutdown();
    });

    test('shutdown removes node from registry', async () => {
      const nodeId = `shutdown-${Date.now()}`;
      const p = createH200Provider({
        nodeId,
        address: TEST_ADDRESS,
        endpoint: TEST_ENDPOINT,
        teeProvider: TEEProvider.LOCAL,
      });
      await p.initialize();

      expect(getTEEGPUNode(nodeId)).toBeDefined();

      await p.shutdown();

      expect(getTEEGPUNode(nodeId)).toBeUndefined();
    });
  });

  describe('GPU Types', () => {
    test('GPUType enum has expected values', () => {
      expect(GPUType.H200).toBe('nvidia-h200');
      expect(GPUType.H100).toBe('nvidia-h100');
      expect(GPUType.A100).toBe('nvidia-a100');
      expect(GPUType.A10G).toBe('nvidia-a10g');
      expect(GPUType.L4).toBe('nvidia-l4');
      expect(GPUType.T4).toBe('nvidia-t4');
    });

    test('TEEProvider enum has expected values', () => {
      expect(TEEProvider.PHALA).toBe('phala');
      expect(TEEProvider.INTEL_TDX).toBe('intel-tdx');
      expect(TEEProvider.AMD_SEV).toBe('amd-sev');
      expect(TEEProvider.LOCAL).toBe('local');
    });
  });
});

