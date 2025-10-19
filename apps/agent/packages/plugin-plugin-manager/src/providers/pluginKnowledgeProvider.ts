import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';
import { getAllPlugins } from '../services/pluginRegistryService';

export const pluginKnowledgeProvider: Provider = {
  name: 'pluginKnowledge',

  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<ProviderResult> => {
    elizaLogger.info('[pluginKnowledgeProvider] Fetching plugin knowledge');

    try {
      // Fetch all plugins from the API-based registry
      const plugins = await getAllPlugins();

      if (plugins.length === 0) {
        return {
          values: {},
          text: 'No plugins available in the registry.',
        };
      }

      // Format plugin knowledge
      let knowledge = `Available ElizaOS Plugins (${plugins.length} total):\n\n`;

      plugins.forEach((plugin) => {
        knowledge += `**${plugin.name}**\n`;
        if (plugin.description) {
          knowledge += `Description: ${plugin.description}\n`;
        }
        if (plugin.tags && plugin.tags.length > 0) {
          knowledge += `Tags: ${plugin.tags.join(', ')}\n`;
        }
        // Remove features and requiredConfig - these properties don't exist on PluginMetadata
        knowledge += '\n';
      });

      return {
        values: {},
        text: knowledge,
      };
    } catch (error) {
      elizaLogger.error('[pluginKnowledgeProvider] Failed to fetch plugin knowledge:', error);
      return {
        values: {},
        text: 'Unable to fetch plugin knowledge at this time.',
      };
    }
  },
};
