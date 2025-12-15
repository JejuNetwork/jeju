/**
 * TEE Provider Tests
 *
 * Tests for all TEE providers:
 * - MockTEEProvider (local dev)
 * - AWSNitroProvider (simulated)
 * - GCPConfidentialProvider (simulated)
 * - TEEManager (unified interface)
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  createAWSNitroProvider,
  createGCPConfidentialProvider,
  createMockProvider,
  createTEEManager,
  resetTEEManager,
  type AttestationRequest,
} from '../../src/index.js';

describe('TEE Providers', () => {
  afterEach(() => {
    resetTEEManager();
  });

  describe('MockTEEProvider', () => {
    it('should initialize correctly', async () => {
      const provider = createMockProvider();
      await provider.initialize();

      expect(provider.provider).toBe('mock');
      expect(provider.capabilities).toContain('attestation');
    });

    it('should always be available', async () => {
      const provider = createMockProvider();
      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it('should generate attestation', async () => {
      const provider = createMockProvider();
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);

      expect(attestation.provider).toBe('mock');
      expect(attestation.quote.length).toBeGreaterThan(0);
      expect(attestation.measurement).toBeDefined();
      expect(attestation.signature).toBeDefined();
    });

    it('should verify attestation', async () => {
      const provider = createMockProvider();
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);
      const result = await provider.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should convert to TEEAttestation format', async () => {
      const provider = createMockProvider();
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);
      const teeAttestation = provider.toTEEAttestation(attestation);

      expect(teeAttestation.measurement.length).toBe(32);
      expect(teeAttestation.quote.length).toBeGreaterThan(0);
      expect(teeAttestation.timestamp).toBeGreaterThan(0n);
    });

    it('should return status', async () => {
      const provider = createMockProvider();
      await provider.initialize();

      const status = await provider.getStatus();

      expect(status.available).toBe(true);
      expect(status.enclaveId).toBeDefined();
      expect(status.capabilities).toContain('attestation');
    });
  });

  describe('AWSNitroProvider (simulated)', () => {
    it('should initialize in simulated mode', async () => {
      const provider = createAWSNitroProvider({ region: 'us-east-1' });
      await provider.initialize();

      expect(provider.provider).toBe('aws');
      expect(provider.capabilities).toContain('attestation');
    });

    it('should generate simulated attestation', async () => {
      const provider = createAWSNitroProvider({ region: 'us-east-1' });
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);

      expect(attestation.provider).toBe('aws');
      expect(attestation.quote.length).toBeGreaterThan(0);
      expect(attestation.enclaveId).toContain('nitro');
    });

    it('should verify simulated attestation', async () => {
      const provider = createAWSNitroProvider({ region: 'us-east-1' });
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);
      const result = await provider.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
    });

    it('should expose config', async () => {
      const provider = createAWSNitroProvider({
        region: 'us-west-2',
        enclaveMemory: 1024,
      });

      expect(provider.config.region).toBe('us-west-2');
      expect(provider.config.enclaveMemory).toBe(1024);
    });
  });

  describe('GCPConfidentialProvider (simulated)', () => {
    it('should initialize in simulated mode', async () => {
      const provider = createGCPConfidentialProvider({
        project: 'test-project',
        zone: 'us-central1-a',
      });
      await provider.initialize();

      expect(provider.provider).toBe('gcp');
      expect(provider.capabilities).toContain('attestation');
    });

    it('should generate simulated attestation', async () => {
      const provider = createGCPConfidentialProvider({
        project: 'test-project',
        zone: 'us-central1-a',
      });
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);

      expect(attestation.provider).toBe('gcp');
      expect(attestation.quote.length).toBeGreaterThan(0);
      expect(attestation.enclaveId).toContain('gcp');
    });

    it('should verify simulated attestation', async () => {
      const provider = createGCPConfidentialProvider({
        project: 'test-project',
        zone: 'us-central1-a',
      });
      await provider.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await provider.requestAttestation(request);
      const result = await provider.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
    });

    it('should check GPU support', async () => {
      const provider = createGCPConfidentialProvider({
        project: 'test-project',
        zone: 'us-central1-a',
      });
      await provider.initialize();

      // In simulated mode, GPU is not available
      const hasGpu = await provider.hasGPUSupport();
      expect(hasGpu).toBe(false);
    });
  });

  describe('TEEManager', () => {
    it('should initialize and auto-detect mock provider', async () => {
      const manager = createTEEManager();
      await manager.initialize();

      const status = await manager.getStatus();

      expect(status.initialized).toBe(true);
      // Should default to mock in local environment
      expect(status.provider).toBe('mock');
    });

    it('should generate attestation via manager', async () => {
      const manager = createTEEManager();
      await manager.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await manager.requestAttestation(request);

      expect(attestation.quote.length).toBeGreaterThan(0);
      expect(attestation.measurement).toBeDefined();
    });

    it('should verify attestation via manager', async () => {
      const manager = createTEEManager();
      await manager.initialize();

      const request: AttestationRequest = {
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const attestation = await manager.requestAttestation(request);
      const result = await manager.verifyAttestation(attestation);

      expect(result.valid).toBe(true);
    });

    it('should use specified provider', async () => {
      const manager = createTEEManager({ provider: 'aws' });
      await manager.initialize();

      const status = await manager.getStatus();

      expect(status.provider).toBe('aws');
    });

    it('should get environment info', async () => {
      const manager = createTEEManager();
      await manager.initialize();

      const env = manager.getEnvironment();

      expect(env).not.toBeNull();
      expect(env?.provider).toBeDefined();
      expect(env?.capabilities).toBeDefined();
    });

    it('should get underlying provider', async () => {
      const manager = createTEEManager();
      await manager.initialize();

      const provider = manager.getProvider();

      expect(provider).toBeDefined();
      expect(provider.provider).toBe('mock');
    });
  });
});
