/**
 * Actions for Registry Plugin
 */

import { type Action, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { RegistryService } from './service';

export const discoverAppsAction: Action = {
  name: 'DISCOVER_APPS',
  description: 'Discover apps and services registered in the ERC-8004 registry',
  examples: [[
    {
      name: 'user',
      content: { text: 'What apps are available?' },
    },
    {
      name: 'agent',
      content: { 
        text: 'Let me check the registry...',
        action: 'DISCOVER_APPS',
      },
    },
  ]],
  
  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return (
      text.includes('discover') && text.includes('app') ||
      text.includes('what') && text.includes('available') ||
      text.includes('find') && (text.includes('game') || text.includes('marketplace') || text.includes('service'))
    );
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const registryService = runtime.getService<RegistryService>('registry');
    if (!registryService) {
      runtime.logger.error('[DISCOVER_APPS] Registry service not available');
      return false;
    }

    const text = message.content.text?.toLowerCase() || '';
    
    // Determine if filtering by tag
    let apps = [];
    if (text.includes('game')) {
      apps = registryService.getAppsByTag('game');
    } else if (text.includes('marketplace')) {
      apps = registryService.getAppsByTag('marketplace');
    } else if (text.includes('defi')) {
      apps = registryService.getAppsByTag('defi');
    } else {
      apps = registryService.getDiscoveredApps();
    }

    const responseText = `I found ${apps.length} apps in the registry:\n\n${apps
      .slice(0, 10)
      .map((app, idx) => `${idx + 1}. ${app.name} (${app.tags.join(', ')})${app.a2aEndpoint ? ' ✓ A2A' : ''}`)
      .join('\n')}`;

    await runtime.createMemory({
      userId: runtime.agentId,
      content: {
        text: responseText,
        action: 'DISCOVER_APPS',
        data: { apps: apps.slice(0, 10) },
      },
      roomId: message.roomId,
    }, 'messages');

    return true;
  },
};

export const connectToAppAction: Action = {
  name: 'CONNECT_TO_APP',
  description: 'Connect to an app via A2A protocol to use its capabilities',
  examples: [[
    {
      name: 'user',
      content: { text: 'Connect to the Bazaar marketplace' },
    },
    {
      name: 'agent',
      content: { 
        text: 'Connecting to Bazaar...',
        action: 'CONNECT_TO_APP',
      },
    },
  ]],
  
  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('connect') && (text.includes('app') || text.includes('service'));
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const registryService = runtime.getService<RegistryService>('registry');
    if (!registryService) {
      return false;
    }

    const text = message.content.text?.toLowerCase() || '';
    
    // Try to extract app name from message
    const apps = registryService.getDiscoveredApps();
    const matchedApp = apps.find((app) => 
      text.includes(app.name.toLowerCase())
    );

    if (!matchedApp) {
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: "I couldn't find that app. Try 'discover apps' first to see what's available.",
          action: 'CONNECT_TO_APP',
        },
        roomId: message.roomId,
      }, 'messages');
      return false;
    }

    const connected = await registryService.connectToApp(matchedApp.agentId);
    
    if (connected) {
      const responseText = `Successfully connected to ${connected.name}!\n\nAvailable capabilities:\n${connected.capabilities
        .map((c, idx) => `${idx + 1}. ${c.name}: ${c.description}`)
        .join('\n')}`;

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: responseText,
          action: 'CONNECT_TO_APP',
          data: { connectedApp: connected },
        },
        roomId: message.roomId,
      }, 'messages');
      
      return true;
    }

    return false;
  },
};

export const listServicesAction: Action = {
  name: 'LIST_CONNECTED_SERVICES',
  description: 'List all currently connected apps and their capabilities',
  examples: [[
    {
      name: 'user',
      content: { text: 'What services am I connected to?' },
    },
    {
      name: 'agent',
      content: { 
        text: 'Here are your connected services...',
        action: 'LIST_CONNECTED_SERVICES',
      },
    },
  ]],
  
  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return (
      text.includes('list') && text.includes('service') ||
      text.includes('connected') && text.includes('app') ||
      text.includes('what') && text.includes('can') && text.includes('do')
    );
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const registryService = runtime.getService<RegistryService>('registry');
    if (!registryService) {
      return false;
    }

    const connected = registryService.getConnectedApps();
    
    if (connected.length === 0) {
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: "You're not connected to any services yet. Try 'discover apps' to see what's available.",
          action: 'LIST_CONNECTED_SERVICES',
        },
        roomId: message.roomId,
      }, 'messages');
      return true;
    }

    const responseText = `Connected Services (${connected.length}):\n\n${connected
      .map((app, idx) => {
        const skills = app.capabilities.map((c) => c.name).join(', ');
        return `${idx + 1}. ${app.name}\n   Skills: ${skills}`;
      })
      .join('\n\n')}`;

    await runtime.createMemory({
      userId: runtime.agentId,
      content: {
        text: responseText,
        action: 'LIST_CONNECTED_SERVICES',
        data: { connectedApps: connected },
      },
      roomId: message.roomId,
    }, 'messages');

    return true;
  },
};

