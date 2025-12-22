/**
 * Provider list utilities
 * Shared business logic for provider list operations
 */

import { ComputeProvider, StorageProvider } from '../model';

export interface ProviderListInfo {
  type: 'compute' | 'storage';
  address: string;
  name: string;
  endpoint: string;
  agentId: number | null;
  isActive: boolean;
}

export function mapComputeProviderToList(provider: ComputeProvider): ProviderListInfo {
  if (!provider) {
    throw new Error('ComputeProvider is required');
  }
  return {
    type: 'compute',
    address: provider.address,
    name: provider.name || 'Compute Provider',
    endpoint: provider.endpoint,
    agentId: provider.agentId ?? null,
    isActive: provider.isActive,
  };
}

export function mapStorageProviderToList(provider: StorageProvider): ProviderListInfo {
  if (!provider) {
    throw new Error('StorageProvider is required');
  }
  return {
    type: 'storage',
    address: provider.address,
    name: provider.name,
    endpoint: provider.endpoint,
    agentId: provider.agentId ?? null,
    isActive: provider.isActive,
  };
}
