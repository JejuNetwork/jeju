import { describe, it, expect } from 'bun:test';

// Test parameter validation and response structure for cross-service endpoints

interface ContainerParams {
  limit?: string;
  offset?: string;
  verified?: string;
  gpu?: string;
  tee?: string;
}

interface CrossServiceRequestParams {
  limit?: string;
  offset?: string;
  status?: string;
  type?: string;
}

function validateContainerParams(params: ContainerParams): {
  limit: number;
  offset: number;
  verified: boolean;
  gpuRequired: boolean;
  teeRequired: boolean;
} {
  return {
    limit: Math.min(100, parseInt(params.limit || '50') || 50),
    offset: parseInt(params.offset || '0') || 0,
    verified: params.verified === 'true',
    gpuRequired: params.gpu === 'true',
    teeRequired: params.tee === 'true',
  };
}

function validateCrossServiceParams(params: CrossServiceRequestParams): {
  limit: number;
  offset: number;
  status: string | undefined;
  type: string | undefined;
} {
  return {
    limit: Math.min(100, parseInt(params.limit || '50') || 50),
    offset: parseInt(params.offset || '0') || 0,
    status: params.status?.toUpperCase(),
    type: params.type?.toUpperCase(),
  };
}

describe('Container API Parameter Validation', () => {
  it('should default limit to 50', () => {
    const result = validateContainerParams({});
    expect(result.limit).toBe(50);
  });

  it('should cap limit at 100', () => {
    const result = validateContainerParams({ limit: '500' });
    expect(result.limit).toBe(100);
  });

  it('should default offset to 0', () => {
    const result = validateContainerParams({});
    expect(result.offset).toBe(0);
  });

  it('should parse verified flag', () => {
    expect(validateContainerParams({ verified: 'true' }).verified).toBe(true);
    expect(validateContainerParams({ verified: 'false' }).verified).toBe(false);
    expect(validateContainerParams({}).verified).toBe(false);
  });

  it('should parse gpu flag', () => {
    expect(validateContainerParams({ gpu: 'true' }).gpuRequired).toBe(true);
    expect(validateContainerParams({ gpu: 'false' }).gpuRequired).toBe(false);
    expect(validateContainerParams({}).gpuRequired).toBe(false);
  });

  it('should parse tee flag', () => {
    expect(validateContainerParams({ tee: 'true' }).teeRequired).toBe(true);
    expect(validateContainerParams({ tee: 'false' }).teeRequired).toBe(false);
    expect(validateContainerParams({}).teeRequired).toBe(false);
  });

  it('should handle invalid numeric values', () => {
    const result = validateContainerParams({ limit: 'abc', offset: 'xyz' });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });
});

describe('Cross-Service Request Parameter Validation', () => {
  it('should default limit to 50', () => {
    const result = validateCrossServiceParams({});
    expect(result.limit).toBe(50);
  });

  it('should cap limit at 100', () => {
    const result = validateCrossServiceParams({ limit: '200' });
    expect(result.limit).toBe(100);
  });

  it('should uppercase status filter', () => {
    const result = validateCrossServiceParams({ status: 'completed' });
    expect(result.status).toBe('COMPLETED');
  });

  it('should uppercase type filter', () => {
    const result = validateCrossServiceParams({ type: 'container_pull' });
    expect(result.type).toBe('CONTAINER_PULL');
  });

  it('should handle missing filters', () => {
    const result = validateCrossServiceParams({});
    expect(result.status).toBeUndefined();
    expect(result.type).toBeUndefined();
  });
});

describe('Container Response Transformation', () => {
  interface ContainerImage {
    cid: string;
    name: string;
    tag: string;
    sizeBytes: bigint;
    uploadedAt: Date;
    uploadedBy?: { address: string };
    storageProvider?: { address: string };
    tier: number;
    architecture: string;
    gpuRequired: boolean;
    minGpuVram: number;
    teeRequired: boolean;
    verified: boolean;
    pullCount: number;
    lastPulledAt?: Date;
  }

  function transformContainer(c: ContainerImage) {
    return {
      cid: c.cid,
      name: c.name,
      tag: c.tag,
      sizeBytes: c.sizeBytes.toString(),
      uploadedAt: c.uploadedAt.toISOString(),
      uploadedBy: c.uploadedBy?.address,
      storageProvider: c.storageProvider?.address,
      tier: c.tier,
      architecture: c.architecture,
      gpuRequired: c.gpuRequired,
      minGpuVram: c.minGpuVram,
      teeRequired: c.teeRequired,
      verified: c.verified,
      pullCount: c.pullCount,
      lastPulledAt: c.lastPulledAt?.toISOString(),
    };
  }

  it('should transform bigint sizeBytes to string', () => {
    const container: ContainerImage = {
      cid: 'QmTest123',
      name: 'test-container',
      tag: 'latest',
      sizeBytes: 1234567890n,
      uploadedAt: new Date('2024-01-01'),
      tier: 1,
      architecture: 'amd64',
      gpuRequired: false,
      minGpuVram: 0,
      teeRequired: false,
      verified: true,
      pullCount: 100,
    };

    const result = transformContainer(container);
    expect(result.sizeBytes).toBe('1234567890');
    expect(typeof result.sizeBytes).toBe('string');
  });

  it('should format dates as ISO strings', () => {
    const container: ContainerImage = {
      cid: 'QmTest123',
      name: 'test',
      tag: 'v1',
      sizeBytes: 100n,
      uploadedAt: new Date('2024-06-15T10:30:00Z'),
      tier: 1,
      architecture: 'amd64',
      gpuRequired: false,
      minGpuVram: 0,
      teeRequired: false,
      verified: false,
      pullCount: 0,
      lastPulledAt: new Date('2024-06-16T12:00:00Z'),
    };

    const result = transformContainer(container);
    expect(result.uploadedAt).toBe('2024-06-15T10:30:00.000Z');
    expect(result.lastPulledAt).toBe('2024-06-16T12:00:00.000Z');
  });

  it('should handle null relations', () => {
    const container: ContainerImage = {
      cid: 'QmTest123',
      name: 'test',
      tag: 'v1',
      sizeBytes: 100n,
      uploadedAt: new Date(),
      tier: 1,
      architecture: 'amd64',
      gpuRequired: false,
      minGpuVram: 0,
      teeRequired: false,
      verified: false,
      pullCount: 0,
    };

    const result = transformContainer(container);
    expect(result.uploadedBy).toBeUndefined();
    expect(result.storageProvider).toBeUndefined();
    expect(result.lastPulledAt).toBeUndefined();
  });
});

describe('Cross-Service Request Response Transformation', () => {
  interface CrossServiceRequest {
    requestId: string;
    requester?: { address: string };
    requestType: string;
    sourceCid: string;
    sourceProvider?: { address: string };
    destinationProvider?: { address: string };
    status: string;
    createdAt: Date;
    completedAt?: Date;
    storageCost: bigint;
    bandwidthCost: bigint;
    totalCost: bigint;
    error?: string;
    txHash?: string;
    blockNumber?: number;
  }

  function transformRequest(r: CrossServiceRequest) {
    return {
      requestId: r.requestId,
      requester: r.requester?.address,
      type: r.requestType,
      sourceCid: r.sourceCid,
      sourceProvider: r.sourceProvider?.address,
      destinationProvider: r.destinationProvider?.address,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString(),
      storageCost: r.storageCost.toString(),
      bandwidthCost: r.bandwidthCost.toString(),
      totalCost: r.totalCost.toString(),
      error: r.error,
      txHash: r.txHash,
      blockNumber: r.blockNumber,
    };
  }

  it('should transform all cost fields to strings', () => {
    const request: CrossServiceRequest = {
      requestId: 'req-123',
      requestType: 'CONTAINER_PULL',
      sourceCid: 'QmTest',
      status: 'COMPLETED',
      createdAt: new Date(),
      storageCost: 1000000000000000000n,
      bandwidthCost: 500000000000000000n,
      totalCost: 1500000000000000000n,
    };

    const result = transformRequest(request);
    expect(result.storageCost).toBe('1000000000000000000');
    expect(result.bandwidthCost).toBe('500000000000000000');
    expect(result.totalCost).toBe('1500000000000000000');
  });

  it('should handle pending request without completion', () => {
    const request: CrossServiceRequest = {
      requestId: 'req-456',
      requestType: 'CONTAINER_PUSH',
      sourceCid: 'QmTest',
      status: 'PENDING',
      createdAt: new Date(),
      storageCost: 0n,
      bandwidthCost: 0n,
      totalCost: 0n,
    };

    const result = transformRequest(request);
    expect(result.completedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.txHash).toBeUndefined();
  });

  it('should include error for failed requests', () => {
    const request: CrossServiceRequest = {
      requestId: 'req-789',
      requestType: 'CONTAINER_PULL',
      sourceCid: 'QmTest',
      status: 'FAILED',
      createdAt: new Date(),
      storageCost: 0n,
      bandwidthCost: 0n,
      totalCost: 0n,
      error: 'Storage provider unavailable',
    };

    const result = transformRequest(request);
    expect(result.error).toBe('Storage provider unavailable');
  });
});

describe('Marketplace Stats Calculation', () => {
  interface Provider {
    isActive: boolean;
    agentId?: number;
    stakeAmount?: bigint;
    totalEarnings?: bigint;
    totalCapacityGB?: bigint;
    usedCapacityGB?: bigint;
  }

  function calculateComputeStats(providers: Provider[]) {
    const active = providers.filter(p => p.isActive);
    const agentLinked = providers.filter(p => p.agentId && p.agentId > 0);
    const totalStake = providers.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
    const totalEarnings = providers.reduce((sum, p) => sum + (p.totalEarnings || 0n), 0n);

    return {
      totalProviders: providers.length,
      activeProviders: active.length,
      agentLinkedProviders: agentLinked.length,
      totalStake,
      totalEarnings,
    };
  }

  function calculateStorageStats(providers: Provider[]) {
    const active = providers.filter(p => p.isActive);
    const agentLinked = providers.filter(p => p.agentId && p.agentId > 0);
    const totalStake = providers.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
    const totalCapacity = providers.reduce((sum, p) => sum + Number(p.totalCapacityGB || 0n), 0);
    const usedCapacity = providers.reduce((sum, p) => sum + Number(p.usedCapacityGB || 0n), 0);

    return {
      totalProviders: providers.length,
      activeProviders: active.length,
      agentLinkedProviders: agentLinked.length,
      totalStake,
      totalCapacityTB: (totalCapacity / 1024).toFixed(2),
      usedCapacityTB: (usedCapacity / 1024).toFixed(2),
    };
  }

  it('should calculate compute provider stats', () => {
    const providers: Provider[] = [
      { isActive: true, agentId: 1, stakeAmount: 1000000000000000000n, totalEarnings: 500000000000000000n },
      { isActive: true, agentId: 2, stakeAmount: 2000000000000000000n, totalEarnings: 1000000000000000000n },
      { isActive: false, stakeAmount: 500000000000000000n },
    ];

    const stats = calculateComputeStats(providers);
    expect(stats.totalProviders).toBe(3);
    expect(stats.activeProviders).toBe(2);
    expect(stats.agentLinkedProviders).toBe(2);
    expect(stats.totalStake).toBe(3500000000000000000n);
    expect(stats.totalEarnings).toBe(1500000000000000000n);
  });

  it('should calculate storage provider stats', () => {
    const providers: Provider[] = [
      { isActive: true, agentId: 1, totalCapacityGB: 1024n, usedCapacityGB: 512n },
      { isActive: true, totalCapacityGB: 2048n, usedCapacityGB: 1024n },
    ];

    const stats = calculateStorageStats(providers);
    expect(stats.totalProviders).toBe(2);
    expect(stats.activeProviders).toBe(2);
    expect(stats.agentLinkedProviders).toBe(1);
    expect(stats.totalCapacityTB).toBe('3.00');
    expect(stats.usedCapacityTB).toBe('1.50');
  });

  it('should handle empty provider list', () => {
    const stats = calculateComputeStats([]);
    expect(stats.totalProviders).toBe(0);
    expect(stats.activeProviders).toBe(0);
    expect(stats.totalStake).toBe(0n);
  });
});

describe('Full-Stack Provider Detection', () => {
  interface ComputeProvider {
    address: string;
    name: string;
    endpoint: string;
    agentId?: number;
    isActive: boolean;
  }

  interface StorageProvider {
    address: string;
    name: string;
    endpoint: string;
    providerType: string;
    agentId?: number;
    isActive: boolean;
  }

  function findFullStackProviders(
    computeProviders: ComputeProvider[],
    storageProviders: StorageProvider[]
  ) {
    const computeByAgent = new Map<number, ComputeProvider[]>();
    for (const p of computeProviders) {
      if (p.agentId && p.isActive) {
        const existing = computeByAgent.get(p.agentId) || [];
        existing.push(p);
        computeByAgent.set(p.agentId, existing);
      }
    }

    const fullStack: Array<{
      agentId: number;
      compute: ComputeProvider[];
      storage: StorageProvider[];
    }> = [];

    const seen = new Set<number>();
    for (const storage of storageProviders) {
      if (storage.agentId && storage.isActive && computeByAgent.has(storage.agentId)) {
        if (!seen.has(storage.agentId)) {
          seen.add(storage.agentId);
          fullStack.push({
            agentId: storage.agentId,
            compute: computeByAgent.get(storage.agentId) || [],
            storage: [],
          });
        }
        fullStack.find(f => f.agentId === storage.agentId)?.storage.push(storage);
      }
    }

    return fullStack;
  }

  it('should find agents with both compute and storage', () => {
    const compute: ComputeProvider[] = [
      { address: '0x1', name: 'Compute 1', endpoint: 'http://c1', agentId: 1, isActive: true },
    ];
    const storage: StorageProvider[] = [
      { address: '0x2', name: 'Storage 1', endpoint: 'http://s1', providerType: 'HOT', agentId: 1, isActive: true },
    ];

    const fullStack = findFullStackProviders(compute, storage);
    expect(fullStack.length).toBe(1);
    expect(fullStack[0].agentId).toBe(1);
    expect(fullStack[0].compute.length).toBe(1);
    expect(fullStack[0].storage.length).toBe(1);
  });

  it('should not include agents with only compute', () => {
    const compute: ComputeProvider[] = [
      { address: '0x1', name: 'Compute 1', endpoint: 'http://c1', agentId: 1, isActive: true },
    ];
    const storage: StorageProvider[] = [];

    const fullStack = findFullStackProviders(compute, storage);
    expect(fullStack.length).toBe(0);
  });

  it('should not include agents with only storage', () => {
    const compute: ComputeProvider[] = [];
    const storage: StorageProvider[] = [
      { address: '0x1', name: 'Storage 1', endpoint: 'http://s1', providerType: 'HOT', agentId: 1, isActive: true },
    ];

    const fullStack = findFullStackProviders(compute, storage);
    expect(fullStack.length).toBe(0);
  });

  it('should group multiple providers under same agent', () => {
    const compute: ComputeProvider[] = [
      { address: '0x1', name: 'Compute 1', endpoint: 'http://c1', agentId: 1, isActive: true },
      { address: '0x2', name: 'Compute 2', endpoint: 'http://c2', agentId: 1, isActive: true },
    ];
    const storage: StorageProvider[] = [
      { address: '0x3', name: 'Storage 1', endpoint: 'http://s1', providerType: 'HOT', agentId: 1, isActive: true },
      { address: '0x4', name: 'Storage 2', endpoint: 'http://s2', providerType: 'COLD', agentId: 1, isActive: true },
    ];

    const fullStack = findFullStackProviders(compute, storage);
    expect(fullStack.length).toBe(1);
    expect(fullStack[0].compute.length).toBe(2);
    expect(fullStack[0].storage.length).toBe(2);
  });

  it('should exclude inactive providers', () => {
    const compute: ComputeProvider[] = [
      { address: '0x1', name: 'Compute 1', endpoint: 'http://c1', agentId: 1, isActive: false },
    ];
    const storage: StorageProvider[] = [
      { address: '0x2', name: 'Storage 1', endpoint: 'http://s1', providerType: 'HOT', agentId: 1, isActive: true },
    ];

    const fullStack = findFullStackProviders(compute, storage);
    expect(fullStack.length).toBe(0);
  });
});
