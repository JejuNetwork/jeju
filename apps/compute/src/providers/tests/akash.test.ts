/**
 * Akash Provider Tests
 */

import { describe, test, expect, mock } from 'bun:test';
import { generateSDL, sdlToYaml, validateSDL } from '../akash/sdl-generator';
import type { DeploymentConfig } from './types';
import { GPUTypes } from './types';
import type { SDLGeneratorOptions } from '../akash/sdl-generator';

describe('SDL Generator', () => {
  const baseDeploymentConfig: DeploymentConfig = {
    deploymentId: 'test-deployment-1',
    container: {
      image: 'nginx:latest',
      isChainRegistry: false,
      resources: {
        cpuCores: 2,
        memoryGb: 4,
        storageGb: 20,
        gpuType: GPUTypes.NONE,
        gpuCount: 0,
        gpuMemoryGb: 0,
        bandwidthMbps: 100,
        teeRequired: false,
      },
      ports: [{ containerPort: 80, protocol: 'tcp', expose: true }],
    },
    durationHours: 24,
    autoRenew: false,
    userAddress: '0x1234567890123456789012345678901234567890',
  };

  const defaultOptions: SDLGeneratorOptions = {
    network: 'testnet',
  };

  test('generates valid SDL for basic container', () => {
    const sdl = generateSDL(baseDeploymentConfig, defaultOptions);

    expect(sdl.version).toBe('2.0');
    expect(sdl.services).toBeDefined();
    expect(Object.keys(sdl.services).length).toBe(1);
    expect(sdl.profiles).toBeDefined();
    expect(sdl.deployment).toBeDefined();
  });

  test('includes correct service configuration', () => {
    const sdl = generateSDL(baseDeploymentConfig, defaultOptions);
    const service = sdl.services.app;

    expect(service.image).toBe('nginx:latest');
    expect(service.expose).toBeDefined();
    expect(service.expose.length).toBeGreaterThan(0);
    expect(service.expose[0].port).toBe(80);
  });

  test('includes SSH port when sshPublicKey provided', () => {
    const configWithSsh: DeploymentConfig = {
      ...baseDeploymentConfig,
      sshPublicKey: 'ssh-rsa AAAAB3...',
    };

    const sdl = generateSDL(configWithSsh, defaultOptions);
    const service = sdl.services.app;

    const sshExpose = service.expose.find((e) => e.port === 22);
    expect(sshExpose).toBeDefined();

    const sshKeyEnv = service.env?.find((e) => e.name === 'SSH_AUTHORIZED_KEYS');
    expect(sshKeyEnv).toBeDefined();
    expect(sshKeyEnv?.value).toBe('ssh-rsa AAAAB3...');
  });

  test('generates correct resource profile', () => {
    const sdl = generateSDL(baseDeploymentConfig, defaultOptions);
    const profile = sdl.profiles.compute.compute;

    expect(profile.resources.cpu.units).toBe(2000); // 2 cores = 2000 millicpu
    expect(profile.resources.memory.size).toBe('4Gi');
    expect(profile.resources.storage[0].size).toBe('20Gi');
  });

  test('includes GPU configuration when requested', () => {
    const gpuConfig: DeploymentConfig = {
      ...baseDeploymentConfig,
      container: {
        ...baseDeploymentConfig.container,
        resources: {
          ...baseDeploymentConfig.container.resources,
          gpuType: GPUTypes.NVIDIA_RTX_4090,
          gpuCount: 1,
          gpuMemoryGb: 24,
        },
      },
    };

    const sdl = generateSDL(gpuConfig, defaultOptions);
    const profile = sdl.profiles.compute.compute;

    expect(profile.resources.gpu).toBeDefined();
    expect(profile.resources.gpu?.units).toBe(1);
  });

  test('validates SDL structure', () => {
    const sdl = generateSDL(baseDeploymentConfig, defaultOptions);
    const result = validateSDL(sdl);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('converts SDL to YAML string', () => {
    const sdl = generateSDL(baseDeploymentConfig, defaultOptions);
    const yaml = sdlToYaml(sdl);

    expect(yaml).toContain('version: 2.0');
    expect(yaml).toContain('services:');
    expect(yaml).toContain('profiles:');
    expect(yaml).toContain('deployment:');
    // Image may be quoted in YAML output
    expect(yaml).toContain('nginx:latest');
  });

  test('includes environment variables', () => {
    const configWithEnv: DeploymentConfig = {
      ...baseDeploymentConfig,
      container: {
        ...baseDeploymentConfig.container,
        env: {
          NODE_ENV: 'production',
          API_KEY: 'test123',
        },
      },
    };

    const sdl = generateSDL(configWithEnv, defaultOptions);
    const service = sdl.services.app;

    expect(service.env).toBeDefined();
    expect(service.env?.length).toBe(2);
    expect(service.env?.find((e) => e.name === 'NODE_ENV')?.value).toBe('production');
    expect(service.env?.find((e) => e.name === 'API_KEY')?.value).toBe('test123');
  });

  test('respects placement region option', () => {
    const optionsWithRegion: SDLGeneratorOptions = {
      network: 'testnet',
      placementRegion: 'us-west',
    };

    const sdl = generateSDL(baseDeploymentConfig, optionsWithRegion);
    const placement = sdl.profiles.placement.jeju;

    expect(placement.attributes).toBeDefined();
    expect(placement.attributes?.region).toBe('us-west');
  });
});

// Akash Provider tests require workspace dependencies
// Run these with: bun test:bridge after workspace is properly linked
describe.skip('Akash Provider', () => {
  test('should check availability', async () => {
    const { getAkashProvider } = await import('../akash/provider');
    const provider = getAkashProvider({ network: 'testnet' });
    const available = await provider.isAvailable();
    expect(available).toBeDefined();
  });

  test('should list offerings', async () => {
    const { getAkashProvider } = await import('../akash/provider');
    const provider = getAkashProvider({ network: 'testnet' });
    const offerings = await provider.listOfferings();
    expect(Array.isArray(offerings)).toBe(true);
  });
});

describe('Container Registry', () => {
  test('should identify JNS names', async () => {
    const { getContainerRegistry, resetContainerRegistry } = await import('../container-registry');
    resetContainerRegistry();

    const registry = getContainerRegistry();

    // JNS names should resolve via JNS (would need mocked JNS registry)
    // For now, test that non-JNS references work
    const dockerRef = await registry.resolve('library/nginx:latest');
    expect(dockerRef.backend).toBe('docker-hub');
    expect(dockerRef.jnsResolved).toBe(false);
  });

  test('should resolve IPFS CIDs', async () => {
    const { getContainerRegistry, resetContainerRegistry } = await import('../container-registry');
    resetContainerRegistry();

    const registry = getContainerRegistry();

    const ipfsRef = await registry.resolve('ipfs://QmTest123');
    expect(ipfsRef.backend).toBe('ipfs');
    expect(ipfsRef.cid).toBe('QmTest123');
  });

  test('should resolve Docker Hub references', async () => {
    const { getContainerRegistry, resetContainerRegistry } = await import('../container-registry');
    resetContainerRegistry();

    const registry = getContainerRegistry();

    const ref = await registry.resolve('nginx:alpine');
    expect(ref.backend).toBe('docker-hub');
    expect(ref.resolvedUrl).toContain('library/nginx:alpine');
  });

  test('should convert references for Akash', async () => {
    const { getContainerRegistry, resetContainerRegistry } = await import('../container-registry');
    resetContainerRegistry();

    const registry = getContainerRegistry();

    const akashImage = await registry.toExternalFormat('nginx:latest', 'akash');
    expect(akashImage).toContain('nginx');
  });
});

// Unified Compute tests require workspace dependencies
// Run these with: bun test:bridge after workspace is properly linked
describe.skip('Unified Compute', () => {
  test('should list offerings from all providers', async () => {
    const { getUnifiedCompute, resetUnifiedCompute } = await import('../unified-compute');
    resetUnifiedCompute();
    const compute = getUnifiedCompute();
    const offerings = await compute.listOfferings();
    expect(Array.isArray(offerings)).toBe(true);
  });
});

