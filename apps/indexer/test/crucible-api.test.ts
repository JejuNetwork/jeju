import { describe, it, expect } from 'bun:test';

interface AgentSearchResult {
  agentId: string;
  owner: string;
  name: string;
  metadataUri: string;
  active: boolean;
  registeredAt: string;
  totalExecutions: number;
  totalSpent: string;
  services: string[];
}

interface ServiceSearchResult {
  serviceId: string;
  name: string;
  type: 'mcp' | 'a2a' | 'rest';
  endpoint: string;
  category: string;
  provider: string;
  agentId?: string;
  pricePerCall: string;
  isVerified: boolean;
}

interface CrucibleStats {
  agents: {
    total: number;
    active: number;
    totalExecutions: number;
    totalSpent: string;
  };
  rooms: {
    total: number;
    active: number;
    adversarial: number;
    collaborative: number;
  };
  services: {
    totalMcp: number;
    totalA2a: number;
    totalRest: number;
    verifiedProviders: number;
  };
}

// Mock provider type
interface MockProvider {
  address: string;
  name: string;
  endpoint: string;
  agentId: number | null;
  isActive: boolean;
}

// Helper function matching mapProviderToService
const mapProviderToService = (
  p: MockProvider,
  category: 'compute' | 'storage'
): ServiceSearchResult => ({
  serviceId: `${category}-${p.address}`,
  name: p.name || `${category.charAt(0).toUpperCase() + category.slice(1)} Provider`,
  type: 'rest',
  endpoint: p.endpoint,
  category,
  provider: p.address,
  agentId: p.agentId?.toString(),
  pricePerCall: '0',
  isVerified: (p.agentId ?? 0) > 0,
});

describe('Agent Search Result Transformation', () => {
  it('should transform agent with all fields', () => {
    const mockAgent = {
      agentId: 123n,
      owner: { address: '0x1234567890abcdef1234567890abcdef12345678' },
      name: 'Test Agent',
      tokenURI: 'ipfs://Qm...',
      active: true,
      registeredAt: new Date('2024-01-15T10:30:00Z'),
    };

    const result: AgentSearchResult = {
      agentId: mockAgent.agentId.toString(),
      owner: mockAgent.owner?.address || '',
      name: mockAgent.name || 'Unnamed Agent',
      metadataUri: mockAgent.tokenURI || '',
      active: mockAgent.active,
      registeredAt: mockAgent.registeredAt.toISOString(),
      totalExecutions: 0,
      totalSpent: '0',
      services: [],
    };

    expect(result.agentId).toBe('123');
    expect(result.owner).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.name).toBe('Test Agent');
    expect(result.metadataUri).toBe('ipfs://Qm...');
    expect(result.active).toBe(true);
    expect(result.registeredAt).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should handle agent with null owner', () => {
    const mockAgent = {
      agentId: 1n,
      owner: null,
      name: 'Orphan Agent',
      tokenURI: null,
      active: true,
      registeredAt: new Date(),
    };

    const result: AgentSearchResult = {
      agentId: mockAgent.agentId.toString(),
      owner: mockAgent.owner?.address || '',
      name: mockAgent.name || 'Unnamed Agent',
      metadataUri: mockAgent.tokenURI || '',
      active: mockAgent.active,
      registeredAt: mockAgent.registeredAt.toISOString(),
      totalExecutions: 0,
      totalSpent: '0',
      services: [],
    };

    expect(result.owner).toBe('');
    expect(result.metadataUri).toBe('');
  });

  it('should use default name for unnamed agents', () => {
    const mockAgent = {
      agentId: 1n,
      owner: null,
      name: null,
      tokenURI: null,
      active: true,
      registeredAt: new Date(),
    };

    const name = mockAgent.name || 'Unnamed Agent';
    expect(name).toBe('Unnamed Agent');
  });

  it('should handle very large agent IDs', () => {
    const largeId = BigInt('999999999999999999999999');
    const result = largeId.toString();
    expect(result).toBe('999999999999999999999999');
    expect(BigInt(result)).toBe(largeId);
  });
});

describe('Provider to Service Mapping', () => {
  it('should map compute provider correctly', () => {
    const provider: MockProvider = {
      address: '0xabc123def456789abc123def456789abc123def4',
      name: 'GPU Compute',
      endpoint: 'https://compute.example.com/api',
      agentId: 42,
      isActive: true,
    };

    const service = mapProviderToService(provider, 'compute');

    expect(service.serviceId).toBe('compute-0xabc123def456789abc123def456789abc123def4');
    expect(service.name).toBe('GPU Compute');
    expect(service.type).toBe('rest');
    expect(service.category).toBe('compute');
    expect(service.endpoint).toBe('https://compute.example.com/api');
    expect(service.provider).toBe('0xabc123def456789abc123def456789abc123def4');
    expect(service.agentId).toBe('42');
    expect(service.isVerified).toBe(true);
  });

  it('should map storage provider correctly', () => {
    const provider: MockProvider = {
      address: '0xdef789abc123def456789abc123def456789abc1',
      name: 'IPFS Gateway',
      endpoint: 'https://storage.example.com/api',
      agentId: 100,
      isActive: true,
    };

    const service = mapProviderToService(provider, 'storage');

    expect(service.serviceId).toBe('storage-0xdef789abc123def456789abc123def456789abc1');
    expect(service.category).toBe('storage');
    expect(service.isVerified).toBe(true);
  });

  it('should mark unverified when no agentId', () => {
    const provider: MockProvider = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: 'Unverified Provider',
      endpoint: 'https://unverified.example.com',
      agentId: null,
      isActive: true,
    };

    const service = mapProviderToService(provider, 'compute');
    expect(service.isVerified).toBe(false);
    expect(service.agentId).toBeUndefined();
  });

  it('should mark unverified when agentId is 0', () => {
    const provider: MockProvider = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: 'Zero Agent Provider',
      endpoint: 'https://zero.example.com',
      agentId: 0,
      isActive: true,
    };

    const service = mapProviderToService(provider, 'storage');
    expect(service.isVerified).toBe(false);
    expect(service.agentId).toBe('0');
  });

  it('should provide default name for unnamed providers', () => {
    const provider: MockProvider = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      name: '',
      endpoint: 'https://unnamed.example.com',
      agentId: null,
      isActive: true,
    };

    const computeService = mapProviderToService(provider, 'compute');
    expect(computeService.name).toBe('Compute Provider');

    const storageService = mapProviderToService(provider, 'storage');
    expect(storageService.name).toBe('Storage Provider');
  });
});

describe('Service ID Parsing', () => {
  const parseServiceId = (serviceId: string): { type: 'compute' | 'storage' | null; address: string | null } => {
    const [type, address] = serviceId.split('-');
    if (!address) return { type: null, address: null };
    if (type !== 'compute' && type !== 'storage') return { type: null, address: null };
    return { type, address: address.toLowerCase() };
  };

  it('should parse compute service ID', () => {
    const result = parseServiceId('compute-0x1234567890abcdef1234567890abcdef12345678');
    expect(result.type).toBe('compute');
    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('should parse storage service ID', () => {
    const result = parseServiceId('storage-0xabcdef1234567890abcdef1234567890abcdef12');
    expect(result.type).toBe('storage');
    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('should lowercase address in result', () => {
    const result = parseServiceId('compute-0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(result.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('should return null for invalid format', () => {
    expect(parseServiceId('invalid').type).toBeNull();
    expect(parseServiceId('').type).toBeNull();
    expect(parseServiceId('compute').type).toBeNull();
    expect(parseServiceId('unknown-0x123').type).toBeNull();
  });
});

describe('Crucible Stats Calculation', () => {
  it('should aggregate stats correctly', () => {
    const mockData = {
      totalAgents: 100,
      activeAgents: 75,
      activeCompute: 20,
      activeStorage: 15,
    };

    const stats: CrucibleStats = {
      agents: {
        total: mockData.totalAgents,
        active: mockData.activeAgents,
        totalExecutions: 0,
        totalSpent: '0',
      },
      rooms: { total: 0, active: 0, adversarial: 0, collaborative: 0 },
      services: {
        totalMcp: 0,
        totalA2a: 0,
        totalRest: mockData.activeCompute + mockData.activeStorage,
        verifiedProviders: mockData.activeCompute + mockData.activeStorage,
      },
    };

    expect(stats.agents.total).toBe(100);
    expect(stats.agents.active).toBe(75);
    expect(stats.services.totalRest).toBe(35);
    expect(stats.services.verifiedProviders).toBe(35);
  });

  it('should handle zero counts', () => {
    const stats: CrucibleStats = {
      agents: { total: 0, active: 0, totalExecutions: 0, totalSpent: '0' },
      rooms: { total: 0, active: 0, adversarial: 0, collaborative: 0 },
      services: { totalMcp: 0, totalA2a: 0, totalRest: 0, verifiedProviders: 0 },
    };

    expect(stats.agents.total).toBe(0);
    expect(stats.services.totalRest).toBe(0);
  });
});

describe('Agent Search Filter Application', () => {
  interface MockAgent {
    id: string;
    name: string | null;
    owner: string;
    active: boolean;
    serviceCount: number;
  }

  interface AgentSearchFilter {
    name?: string;
    owner?: string;
    active?: boolean;
    hasServices?: boolean;
  }

  const filterAgents = (agents: MockAgent[], filter: AgentSearchFilter): MockAgent[] => {
    return agents.filter(a => {
      if (filter.active !== undefined && a.active !== filter.active) return false;
      if (filter.name && !a.name?.toLowerCase().includes(filter.name.toLowerCase())) return false;
      if (filter.owner && a.owner.toLowerCase() !== filter.owner.toLowerCase()) return false;
      if (filter.hasServices && a.serviceCount === 0) return false;
      return true;
    });
  };

  const testAgents: MockAgent[] = [
    { id: '1', name: 'Trading Bot', owner: '0xaaa', active: true, serviceCount: 3 },
    { id: '2', name: 'Data Analyzer', owner: '0xbbb', active: true, serviceCount: 0 },
    { id: '3', name: 'NFT Minter', owner: '0xaaa', active: false, serviceCount: 1 },
    { id: '4', name: null, owner: '0xccc', active: true, serviceCount: 2 },
  ];

  it('should filter by active status', () => {
    const result = filterAgents(testAgents, { active: true });
    expect(result.length).toBe(3);
    expect(result.every(a => a.active)).toBe(true);
  });

  it('should filter by inactive status', () => {
    const result = filterAgents(testAgents, { active: false });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('3');
  });

  it('should filter by name (case insensitive)', () => {
    const result = filterAgents(testAgents, { name: 'bot' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Trading Bot');
  });

  it('should filter by owner (case insensitive)', () => {
    const result = filterAgents(testAgents, { owner: '0xAAA' });
    expect(result.length).toBe(2);
  });

  it('should filter by hasServices', () => {
    const result = filterAgents(testAgents, { hasServices: true });
    expect(result.length).toBe(3);
    expect(result.every(a => a.serviceCount > 0)).toBe(true);
  });

  it('should combine multiple filters', () => {
    const result = filterAgents(testAgents, { active: true, owner: '0xaaa' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('should handle agents with null names in name filter', () => {
    const result = filterAgents(testAgents, { name: 'anything' });
    // Should not include agent with null name
    expect(result.every(a => a.name !== null)).toBe(true);
  });

  it('should return all when no filters', () => {
    const result = filterAgents(testAgents, {});
    expect(result.length).toBe(4);
  });
});

describe('Service Search Filter Application', () => {
  interface MockService {
    id: string;
    type: 'mcp' | 'a2a' | 'rest';
    category: string;
    name: string;
    endpoint: string;
    isVerified: boolean;
  }

  interface ServiceSearchFilter {
    type?: 'mcp' | 'a2a' | 'rest';
    category?: string;
    query?: string;
    verifiedOnly?: boolean;
  }

  const filterServices = (services: MockService[], filter: ServiceSearchFilter): MockService[] => {
    return services.filter(s => {
      if (filter.type && s.type !== filter.type) return false;
      if (filter.category && s.category !== filter.category) return false;
      if (filter.verifiedOnly && !s.isVerified) return false;
      if (filter.query) {
        const q = filter.query.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.endpoint.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  };

  const testServices: MockService[] = [
    { id: '1', type: 'rest', category: 'compute', name: 'GPU Provider', endpoint: 'https://gpu.example.com', isVerified: true },
    { id: '2', type: 'rest', category: 'storage', name: 'IPFS Node', endpoint: 'https://ipfs.example.com', isVerified: true },
    { id: '3', type: 'rest', category: 'compute', name: 'CPU Farm', endpoint: 'https://cpu.example.com', isVerified: false },
    { id: '4', type: 'mcp', category: 'oracle', name: 'Price Feed', endpoint: 'mcp://prices', isVerified: true },
  ];

  it('should filter by type', () => {
    const result = filterServices(testServices, { type: 'rest' });
    expect(result.length).toBe(3);
  });

  it('should filter by category', () => {
    const result = filterServices(testServices, { category: 'compute' });
    expect(result.length).toBe(2);
  });

  it('should filter by verified only', () => {
    const result = filterServices(testServices, { verifiedOnly: true });
    expect(result.length).toBe(3);
    expect(result.every(s => s.isVerified)).toBe(true);
  });

  it('should filter by query in name', () => {
    const result = filterServices(testServices, { query: 'gpu' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('GPU Provider');
  });

  it('should filter by query in endpoint', () => {
    const result = filterServices(testServices, { query: 'ipfs' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('IPFS Node');
  });

  it('should combine type and verified filters', () => {
    const result = filterServices(testServices, { type: 'rest', verifiedOnly: true });
    expect(result.length).toBe(2);
  });
});

describe('Agent Services Lookup', () => {
  interface MockProviderWithAgentId extends MockProvider {
    agentId: number | null;
  }

  const getAgentServices = (
    computeProviders: MockProviderWithAgentId[],
    storageProviders: MockProviderWithAgentId[],
    agentId: number
  ): ServiceSearchResult[] => {
    const results: ServiceSearchResult[] = [];

    for (const p of computeProviders) {
      if (p.agentId === agentId && p.isActive) {
        results.push(mapProviderToService(p, 'compute'));
      }
    }

    for (const p of storageProviders) {
      if (p.agentId === agentId && p.isActive) {
        results.push(mapProviderToService(p, 'storage'));
      }
    }

    return results;
  };

  const computeProviders: MockProviderWithAgentId[] = [
    { address: '0x111', name: 'Compute 1', endpoint: 'http://1', agentId: 1, isActive: true },
    { address: '0x222', name: 'Compute 2', endpoint: 'http://2', agentId: 1, isActive: true },
    { address: '0x333', name: 'Compute 3', endpoint: 'http://3', agentId: 2, isActive: true },
    { address: '0x444', name: 'Inactive Compute', endpoint: 'http://4', agentId: 1, isActive: false },
  ];

  const storageProviders: MockProviderWithAgentId[] = [
    { address: '0x555', name: 'Storage 1', endpoint: 'http://5', agentId: 1, isActive: true },
    { address: '0x666', name: 'Storage 2', endpoint: 'http://6', agentId: 3, isActive: true },
  ];

  it('should find all services for agent', () => {
    const result = getAgentServices(computeProviders, storageProviders, 1);
    expect(result.length).toBe(3); // 2 compute + 1 storage (inactive excluded)
  });

  it('should not include inactive services', () => {
    const result = getAgentServices(computeProviders, storageProviders, 1);
    const inactiveService = result.find(s => s.serviceId === 'compute-0x444');
    expect(inactiveService).toBeUndefined();
  });

  it('should return empty array for agent with no services', () => {
    const result = getAgentServices(computeProviders, storageProviders, 999);
    expect(result.length).toBe(0);
  });

  it('should categorize services correctly', () => {
    const result = getAgentServices(computeProviders, storageProviders, 1);
    const computeCount = result.filter(s => s.category === 'compute').length;
    const storageCount = result.filter(s => s.category === 'storage').length;
    expect(computeCount).toBe(2);
    expect(storageCount).toBe(1);
  });
});
