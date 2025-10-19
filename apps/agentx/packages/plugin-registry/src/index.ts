/**
 * @elizaos/plugin-registry
 * ERC-8004 Registry Integration for Agent Discovery
 * 
 * Enables autonomous agents to:
 * - Discover apps, games, marketplaces, and services
 * - Connect to A2A endpoints
 * - Query capabilities
 * - Interact with registered applications
 */

import { Plugin } from '@elizaos/core';
import { RegistryService } from './service';
import { discoverAppsAction, connectToAppAction, listServicesAction } from './actions';
import { availableAppsProvider } from './providers';

export const registryPlugin: Plugin = {
  name: '@elizaos/plugin-registry',
  description: 'ERC-8004 registry integration for discovering and connecting to apps and services',
  
  services: [RegistryService],
  actions: [discoverAppsAction, connectToAppAction, listServicesAction],
  providers: [availableAppsProvider],
  
  async init(config, runtime) {
    const registryAddress = config.IDENTITY_REGISTRY_ADDRESS || process.env.IDENTITY_REGISTRY_ADDRESS;
    const rpcUrl = config.RPC_URL || process.env.RPC_URL || 'http://localhost:9545';
    
    if (!registryAddress) {
      runtime.logger.warn('[Registry Plugin] No registry address configured, using default');
    }
    
    runtime.logger.info('[Registry Plugin] Initialized with registry at', registryAddress);
  },
};

export default registryPlugin;

// Export types and utilities
export * from './types';
export { RegistryService } from './service';

