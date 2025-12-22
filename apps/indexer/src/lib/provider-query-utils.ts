/**
 * Provider query utilities
 * Shared utilities for querying providers
 */

import { DataSource } from 'typeorm';
import { ComputeProvider, StorageProvider } from '../model';

export interface ProvidersQueryOptions {
  type?: 'compute' | 'storage';
  limit: number;
}

export interface ProviderListResult {
  providers: Array<{
    type: 'compute' | 'storage';
    address: string;
    name: string;
    endpoint: string;
    agentId: number | null;
    isActive: boolean;
  }>;
  total: number;
}

export async function getProviders(
  dataSource: DataSource,
  options: ProvidersQueryOptions
): Promise<ProviderListResult> {
  if (!dataSource) {
    throw new Error('DataSource is required');
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(`Invalid limit: ${options.limit}. Must be a positive number.`);
  }

  const providers: Array<{
    type: 'compute' | 'storage';
    address: string;
    name: string;
    endpoint: string;
    agentId: number | null;
    isActive: boolean;
  }> = [];

  if (!options.type || options.type === 'compute') {
    const compute = await dataSource.getRepository(ComputeProvider).find({
      where: { isActive: true },
      take: options.limit,
    });
    providers.push(...compute.map(p => ({
      type: 'compute' as const,
      address: p.address,
      name: p.name || 'Compute Provider',
      endpoint: p.endpoint,
      agentId: p.agentId ?? null,
      isActive: p.isActive,
    })));
  }

  if (!options.type || options.type === 'storage') {
    const storage = await dataSource.getRepository(StorageProvider).find({
      where: { isActive: true },
      take: options.limit,
    });
    providers.push(...storage.map(p => ({
      type: 'storage' as const,
      address: p.address,
      name: p.name,
      endpoint: p.endpoint,
      agentId: p.agentId ?? null,
      isActive: p.isActive,
    })));
  }

  return {
    providers,
    total: providers.length,
  };
}
