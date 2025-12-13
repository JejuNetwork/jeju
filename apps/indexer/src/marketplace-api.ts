import { ethers } from 'ethers';
import { DataSource } from 'typeorm';
import {
  ComputeProvider,
  StorageProvider,
  ComputeRental,
  StorageDeal,
  RegisteredAgent,
  IPFSFile,
  FileCategory,
} from './model';

export interface ProviderResult {
  address: string;
  name: string;
  endpoint: string;
  agentId: number | null;
  type: 'compute' | 'storage';
  isActive: boolean;
  stake: string;
  registeredAt: string;
  // Compute-specific
  gpuType?: string;
  gpuCount?: number;
  pricePerHour?: string;
  teeCapable?: boolean;
  // Storage-specific
  providerType?: string;
  totalCapacityGB?: number;
  pricePerGBMonth?: string;
  supportedTiers?: string[];
}

export interface ContainerSearchResult {
  cid: string;
  name: string;
  sizeBytes: string;
  uploadedAt: string;
  storageProvider: string;
  tier: string;
  compatibleComputeProviders: number;
}

export interface MarketplaceStats {
  compute: {
    totalProviders: number;
    activeProviders: number;
    agentLinkedProviders: number;
    totalRentals: number;
    activeRentals: number;
    totalStakedETH: string;
    totalEarningsETH: string;
    avgPricePerHourETH: string;
  };
  storage: {
    totalProviders: number;
    activeProviders: number;
    agentLinkedProviders: number;
    totalDeals: number;
    activeDeals: number;
    totalCapacityTB: number;
    usedCapacityTB: number;
    totalStakedETH: string;
    avgPricePerGBMonthETH: string;
  };
  crossService: {
    totalContainerImages: number;
    fullStackAgents: number;
    crossServiceRequests: number;
  };
  erc8004: {
    totalRegisteredAgents: number;
    computeAgents: number;
    storageAgents: number;
    fullStackAgents: number;
    bannedAgents: number;
  };
  lastUpdated: string;
}

export interface ProviderSearchOptions {
  type?: 'compute' | 'storage';
  agentLinkedOnly?: boolean;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array | null | undefined): string {
  if (!bytes) return '';
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function searchProviders(
  dataSource: DataSource,
  options: ProviderSearchOptions = {}
): Promise<ProviderResult[]> {
  const {
    type,
    agentLinkedOnly = false,
    activeOnly = true,
    limit = 50,
    offset = 0,
  } = options;

  const results: ProviderResult[] = [];

  // Query compute providers
  if (!type || type === 'compute') {
    const computeRepo = dataSource.getRepository(ComputeProvider);
    let query = computeRepo.createQueryBuilder('p');
    
    if (activeOnly) query = query.where('p.isActive = :active', { active: true });
    if (agentLinkedOnly) query = query.andWhere('p.agentId > 0');
    
    const computeProviders = await query
      .orderBy('p.totalEarnings', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();

    for (const p of computeProviders) {
      results.push({
        address: p.address,
        name: p.name || 'Compute Provider',
        endpoint: p.endpoint,
        agentId: p.agentId || null,
        type: 'compute',
        isActive: p.isActive,
        stake: ethers.formatEther(p.stakeAmount || 0n),
        registeredAt: p.registeredAt.toISOString(),
        teeCapable: false,
      });
    }
  }

  // Query storage providers
  if (!type || type === 'storage') {
    const storageRepo = dataSource.getRepository(StorageProvider);
    let query = storageRepo.createQueryBuilder('p');
    
    if (activeOnly) query = query.where('p.isActive = :active', { active: true });
    if (agentLinkedOnly) query = query.andWhere('p.agentId > 0');
    
    const storageProviders = await query
      .orderBy('p.totalEarnings', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();

    for (const p of storageProviders) {
      results.push({
        address: p.address,
        name: p.name,
        endpoint: p.endpoint,
        agentId: p.agentId || null,
        type: 'storage',
        isActive: p.isActive,
        stake: ethers.formatEther(p.stakeAmount || 0n),
        registeredAt: p.registeredAt.toISOString(),
        providerType: p.providerType,
        totalCapacityGB: Number(p.totalCapacityGB || 0n),
        pricePerGBMonth: ethers.formatEther(p.pricePerGBMonth || 0n),
        supportedTiers: p.supportedTiers || [],
      });
    }
  }

  // Sort by stake descending
  results.sort((a, b) => parseFloat(b.stake) - parseFloat(a.stake));

  return results.slice(0, limit);
}

/**
 * Get provider info by address (compute + storage combined)
 */
export async function getProviderByAddress(
  dataSource: DataSource,
  address: string
): Promise<{
  address: string;
  compute?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  isFullStack: boolean;
  agentId?: number;
} | null> {
  const normalizedAddress = address.toLowerCase();

  const computeRepo = dataSource.getRepository(ComputeProvider);
  const storageRepo = dataSource.getRepository(StorageProvider);

  const computeProvider = await computeRepo.findOne({ where: { address: normalizedAddress } });
  const storageProvider = await storageRepo.findOne({ where: { address: normalizedAddress } });

  if (!computeProvider && !storageProvider) return null;

  const result: {
    address: string;
    compute?: Record<string, unknown>;
    storage?: Record<string, unknown>;
    isFullStack: boolean;
    agentId?: number;
  } = { address: normalizedAddress, isFullStack: false };

  if (computeProvider) {
    result.compute = {
      name: computeProvider.name,
      endpoint: computeProvider.endpoint,
      agentId: computeProvider.agentId,
      isActive: computeProvider.isActive,
      stake: ethers.formatEther(computeProvider.stakeAmount || 0n),
      totalRentals: computeProvider.totalRentals,
      totalEarnings: ethers.formatEther(computeProvider.totalEarnings || 0n),
      registeredAt: computeProvider.registeredAt.toISOString(),
    };
  }

  if (storageProvider) {
    result.storage = {
      name: storageProvider.name,
      endpoint: storageProvider.endpoint,
      providerType: storageProvider.providerType,
      agentId: storageProvider.agentId,
      isActive: storageProvider.isActive,
      stake: ethers.formatEther(storageProvider.stakeAmount || 0n),
      totalCapacityGB: Number(storageProvider.totalCapacityGB || 0n),
      usedCapacityGB: Number(storageProvider.usedCapacityGB || 0n),
      pricePerGBMonth: ethers.formatEther(storageProvider.pricePerGBMonth || 0n),
      totalDeals: storageProvider.totalDeals,
      totalEarnings: ethers.formatEther(storageProvider.totalEarnings || 0n),
      registeredAt: storageProvider.registeredAt.toISOString(),
    };
  }

  // Check if full-stack (both services with same agent)
  if (computeProvider?.agentId && storageProvider?.agentId && 
      computeProvider.agentId === storageProvider.agentId) {
    result.isFullStack = true;
    result.agentId = computeProvider.agentId;
  }

  return result;
}

/**
 * Get providers linked to an ERC-8004 agent
 */
export async function getProvidersByAgentId(
  dataSource: DataSource,
  agentId: number
): Promise<{
  agentId: number;
  compute: Array<{ address: string; name: string; endpoint: string; isActive: boolean }>;
  storage: Array<{ address: string; name: string; endpoint: string; providerType: string; isActive: boolean }>;
  isFullStack: boolean;
}> {
  const computeRepo = dataSource.getRepository(ComputeProvider);
  const storageRepo = dataSource.getRepository(StorageProvider);

  const computeProviders = await computeRepo.find({ where: { agentId } });
  const storageProviders = await storageRepo.find({ where: { agentId } });

  return {
    agentId,
    compute: computeProviders.map(p => ({
      address: p.address,
      name: p.name || 'Compute Provider',
      endpoint: p.endpoint,
      isActive: p.isActive,
    })),
    storage: storageProviders.map(p => ({
      address: p.address,
      name: p.name,
      endpoint: p.endpoint,
      providerType: p.providerType,
      isActive: p.isActive,
    })),
    isFullStack: computeProviders.length > 0 && storageProviders.length > 0,
  };
}

/**
 * Search container images stored for compute use
 */
export async function searchContainers(
  dataSource: DataSource,
  options: { category?: FileCategory; limit?: number; offset?: number } = {}
): Promise<ContainerSearchResult[]> {
  const { category = FileCategory.GAME_ASSET, limit = 50, offset = 0 } = options;

  const fileRepo = dataSource.getRepository(IPFSFile);
  const files = await fileRepo.find({
    where: { category, isPinned: true },
    order: { createdAt: 'DESC' },
    take: limit,
    skip: offset,
  });

  // Get compute provider count
  const computeRepo = dataSource.getRepository(ComputeProvider);
  const activeComputeCount = await computeRepo.count({ where: { isActive: true } });

  return files.map(f => ({
    cid: f.cid,
    name: f.filename || f.cid.slice(0, 12),
    sizeBytes: f.sizeBytes.toString(),
    uploadedAt: f.createdAt.toISOString(),
    storageProvider: bytesToHex(f.relatedContract) || 'unknown',
    tier: 'warm',
    compatibleComputeProviders: activeComputeCount,
  }));
}

/**
 * Find compute providers compatible with a container
 */
export async function findComputeForContainer(
  dataSource: DataSource,
  cid: string,
  _options: { minGpuVram?: number; requireTee?: boolean } = {}
): Promise<{
  container: { cid: string; sizeBytes: string; storageProvider: string } | null;
  compatibleProviders: Array<{
    address: string;
    name: string;
    endpoint: string;
    agentId: number | null;
    score: number;
    totalRentals: number;
  }>;
}> {
  const fileRepo = dataSource.getRepository(IPFSFile);
  const file = await fileRepo.findOne({ where: { cid } });

  if (!file) {
    return { container: null, compatibleProviders: [] };
  }

  const computeRepo = dataSource.getRepository(ComputeProvider);
  const providers = await computeRepo.find({
    where: { isActive: true },
    order: { totalEarnings: 'DESC' },
    take: 20,
  });

  // Score and rank providers
  const scoredProviders = providers.map(p => {
    let score = 50; // Base score
    if (p.agentId && p.agentId > 0) score += 30; // ERC-8004 bonus
    score += Math.min(20, p.totalRentals); // Experience bonus
    return {
      address: p.address,
      name: p.name || 'Compute Provider',
      endpoint: p.endpoint,
      agentId: p.agentId || null,
      score,
      totalRentals: p.totalRentals,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    container: {
      cid: file.cid,
      sizeBytes: file.sizeBytes.toString(),
      storageProvider: bytesToHex(file.relatedContract) || 'unknown',
    },
    compatibleProviders: scoredProviders,
  };
}

/**
 * Get marketplace statistics
 */
export async function getMarketplaceStats(dataSource: DataSource): Promise<MarketplaceStats> {
  const computeRepo = dataSource.getRepository(ComputeProvider);
  const storageRepo = dataSource.getRepository(StorageProvider);
  const rentalRepo = dataSource.getRepository(ComputeRental);
  const dealRepo = dataSource.getRepository(StorageDeal);
  const agentRepo = dataSource.getRepository(RegisteredAgent);
  const fileRepo = dataSource.getRepository(IPFSFile);

  // Compute stats
  const computeProviders = await computeRepo.find();
  const activeCompute = computeProviders.filter(p => p.isActive);
  const agentLinkedCompute = computeProviders.filter(p => p.agentId && p.agentId > 0);
  const totalComputeStake = computeProviders.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
  const totalComputeEarnings = computeProviders.reduce((sum, p) => sum + (p.totalEarnings || 0n), 0n);

  const totalRentals = await rentalRepo.count();
  const activeRentals = await rentalRepo.count({ where: { status: 'ACTIVE' as never } });

  // Storage stats
  const storageProviders = await storageRepo.find();
  const activeStorage = storageProviders.filter(p => p.isActive);
  const agentLinkedStorage = storageProviders.filter(p => p.agentId && p.agentId > 0);
  const totalStorageStake = storageProviders.reduce((sum, p) => sum + (p.stakeAmount || 0n), 0n);
  const totalCapacity = storageProviders.reduce((sum, p) => sum + Number(p.totalCapacityGB || 0n), 0);
  const usedCapacity = storageProviders.reduce((sum, p) => sum + Number(p.usedCapacityGB || 0n), 0);

  const totalDeals = await dealRepo.count();
  const activeDeals = await dealRepo.count({ where: { status: 'ACTIVE' as never } });

  // Agent stats
  const totalAgents = await agentRepo.count({ where: { active: true } });
  const bannedAgents = await agentRepo.count({ where: { isBanned: true } });

  // Cross-service stats
  const containerFiles = await fileRepo.count({ where: { category: FileCategory.GAME_ASSET } });

  // Find full-stack agents
  const computeAgentIds = new Set(agentLinkedCompute.map(p => p.agentId));
  const fullStackCount = agentLinkedStorage.filter(p => p.agentId && computeAgentIds.has(p.agentId)).length;

  return {
    compute: {
      totalProviders: computeProviders.length,
      activeProviders: activeCompute.length,
      agentLinkedProviders: agentLinkedCompute.length,
      totalRentals,
      activeRentals,
      totalStakedETH: ethers.formatEther(totalComputeStake),
      totalEarningsETH: ethers.formatEther(totalComputeEarnings),
      avgPricePerHourETH: '0',
    },
    storage: {
      totalProviders: storageProviders.length,
      activeProviders: activeStorage.length,
      agentLinkedProviders: agentLinkedStorage.length,
      totalDeals,
      activeDeals,
      totalCapacityTB: totalCapacity / 1024,
      usedCapacityTB: usedCapacity / 1024,
      totalStakedETH: ethers.formatEther(totalStorageStake),
      avgPricePerGBMonthETH: '0',
    },
    crossService: {
      totalContainerImages: containerFiles,
      fullStackAgents: fullStackCount,
      crossServiceRequests: 0,
    },
    erc8004: {
      totalRegisteredAgents: totalAgents,
      computeAgents: agentLinkedCompute.length,
      storageAgents: agentLinkedStorage.length,
      fullStackAgents: fullStackCount,
      bannedAgents,
    },
    lastUpdated: new Date().toISOString(),
  };
}
