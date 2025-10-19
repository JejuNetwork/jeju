/**
 * Providers for Registry Plugin
 */

import { type Provider, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { RegistryService } from './service';

export const availableAppsProvider: Provider = {
  name: 'AVAILABLE_APPS',
  description: 'Provides list of discovered apps and services from the registry',
  
  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    const registryService = runtime.getService<RegistryService>('registry');
    if (!registryService) {
      return { text: '' };
    }

    const apps = registryService.getDiscoveredApps();
    const connected = registryService.getConnectedApps();

    if (apps.length === 0) {
      return { text: '' };
    }

    const text = `[AVAILABLE APPS FROM REGISTRY]
Total Discovered: ${apps.length}
Connected: ${connected.length}

Apps by Category:
${['game', 'marketplace', 'defi', 'social', 'info-provider', 'service', 'app']
  .map((tag) => {
    const tagApps = apps.filter((a) => a.tags.includes(tag));
    if (tagApps.length === 0) return '';
    return `  ${tag}: ${tagApps.map((a) => a.name).join(', ')}`;
  })
  .filter((line) => line)
  .join('\n')}

Connected Services:
${connected.map((c) => `  - ${c.name}: ${c.capabilities.length} skills`).join('\n')}

[/AVAILABLE_APPS FROM REGISTRY]`;

    return {
      text,
      data: {
        discoveredApps: apps,
        connectedApps: connected,
      },
    };
  },
};

