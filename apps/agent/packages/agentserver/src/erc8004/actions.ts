/**
 * ERC-8004 Service Discovery Actions
 * ElizaOS actions for discovering and connecting to services
 */

import type { Action } from '@elizaos/core';
import { ERC8004RegistryClient } from './registry';
import { ServiceConnectionManager } from './connectionManager';
import type { ServiceFilters } from './types';

let registryClient: ERC8004RegistryClient | null = null;
let connectionManager: ServiceConnectionManager | null = null;

function getRegistryClient(): ERC8004RegistryClient {
  if (!registryClient) {
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
    const privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    registryClient = new ERC8004RegistryClient(rpcUrl, privateKey);
  }
  return registryClient;
}

function getConnectionManager(): ServiceConnectionManager {
  if (!connectionManager) {
    connectionManager = new ServiceConnectionManager(getRegistryClient());
  }
  return connectionManager;
}

export const discoverServicesAction: Action = {
  name: 'DISCOVER_SERVICES',
  description: 'List available ERC-8004 services that the agent can connect to. Can filter by type (game, tool, social, defi, content) and search term.',
  similes: ['list services', 'find services', 'what services are available', 'show services', 'browse services'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'What services can I connect to?' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Let me discover available services...', action: 'DISCOVER_SERVICES' }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Show me available games' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Searching for game services...', action: 'DISCOVER_SERVICES' }
      }
    ]
  ],
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      const client = getRegistryClient();
      await client.initialize();

      // Parse filters from message
      const text = message.content.text.toLowerCase();
      const filters: ServiceFilters = {};
      
      if (text.includes('game')) filters.type = 'game';
      else if (text.includes('tool')) filters.type = 'tool';
      else if (text.includes('social')) filters.type = 'social';
      else if (text.includes('defi')) filters.type = 'defi';
      else if (text.includes('content')) filters.type = 'content';

      const services = await client.listServices(filters);
      
      if (services.length === 0) {
        callback?.({
          text: 'No services found matching your criteria.',
          action: 'DISCOVER_SERVICES',
          source: 'erc8004'
        });
        return false;
      }

      const serviceList = services.map(s => 
        `${s.name} (ID: ${s.id}) - ${s.type}${s.reputation ? ` - Rating: ${s.reputation.score}/100 (${s.reputation.feedbackCount} reviews)` : ''}`
      ).join('\n');

      callback?.({
        text: `Found ${services.length} service(s):\n\n${serviceList}\n\nYou can connect to any service using its ID.`,
        action: 'DISCOVER_SERVICES',
        source: 'erc8004',
        data: { services }
      });

      return true;
    } catch (error) {
      callback?.({
        text: `Failed to discover services: ${error instanceof Error ? error.message : 'Unknown error'}`,
        action: 'DISCOVER_SERVICES',
        source: 'erc8004'
      });
      return false;
    }
  }
};

export const connectToServiceAction: Action = {
  name: 'CONNECT_TO_SERVICE',
  description: 'Connect to an ERC-8004 service by its ID. This establishes a WebSocket or REST connection to the service.',
  similes: ['connect to service', 'join service', 'connect service', 'open connection'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Connect to service 1' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Connecting to service...', action: 'CONNECT_TO_SERVICE' }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: { text: 'Join Caliguland' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Looking up and connecting to Caliguland...', action: 'CONNECT_TO_SERVICE' }
      }
    ]
  ],
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      const text = message.content.text;
      
      // Extract service ID from message
      const idMatch = text.match(/\b(\d+)\b/);
      if (!idMatch) {
        callback?.({
          text: 'Please provide a service ID to connect to. Use DISCOVER_SERVICES to find available services.',
          action: 'CONNECT_TO_SERVICE',
          source: 'erc8004'
        });
        return false;
      }

      const serviceId = BigInt(idMatch[1]);
      const manager = getConnectionManager();
      
      const connection = await manager.connect(serviceId);
      
      callback?.({
        text: `Successfully connected to ${connection.service.name}! You can now send messages to this service.`,
        action: 'CONNECT_TO_SERVICE',
        source: 'erc8004',
        data: { connection }
      });

      return true;
    } catch (error) {
      callback?.({
        text: `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        action: 'CONNECT_TO_SERVICE',
        source: 'erc8004'
      });
      return false;
    }
  }
};

export const sendToServiceAction: Action = {
  name: 'SEND_TO_SERVICE',
  description: 'Send a message to a connected ERC-8004 service. Must be connected to the service first.',
  similes: ['send to service', 'message service', 'tell service', 'ask service'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Send "hello" to service 1' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Sending message...', action: 'SEND_TO_SERVICE' }
      }
    ]
  ],
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      const text = message.content.text;
      
      // Extract service ID and message
      const match = text.match(/(?:send|tell|ask)\s+"([^"]+)"\s+to\s+service\s+(\d+)/i) ||
                    text.match(/service\s+(\d+)[:\s]+(.+)/i);
      
      if (!match) {
        callback?.({
          text: 'Please specify a service ID and message. Example: "Send hello to service 1"',
          action: 'SEND_TO_SERVICE',
          source: 'erc8004'
        });
        return false;
      }

      const serviceId = BigInt(match[2] || match[1]);
      const messageText = match[1] || match[2];
      
      const manager = getConnectionManager();
      
      if (!manager.isConnected(serviceId)) {
        callback?.({
          text: `Not connected to service ${serviceId}. Use CONNECT_TO_SERVICE first.`,
          action: 'SEND_TO_SERVICE',
          source: 'erc8004'
        });
        return false;
      }

      const response = await manager.sendMessage(serviceId, messageText);
      const responseText = response ? await response.text() : 'No response';
      
      callback?.({
        text: `Sent message to service ${serviceId}.\n\nResponse: ${responseText}`,
        action: 'SEND_TO_SERVICE',
        source: 'erc8004',
        data: { serviceId, messageText, responseText }
      });

      return true;
    } catch (error) {
      callback?.({
        text: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        action: 'SEND_TO_SERVICE',
        source: 'erc8004'
      });
      return false;
    }
  }
};

export const disconnectFromServiceAction: Action = {
  name: 'DISCONNECT_FROM_SERVICE',
  description: 'Disconnect from an ERC-8004 service.',
  similes: ['disconnect from service', 'leave service', 'close connection', 'exit service'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'Disconnect from service 1' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Disconnecting...', action: 'DISCONNECT_FROM_SERVICE' }
      }
    ]
  ],
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      const text = message.content.text;
      const idMatch = text.match(/\b(\d+)\b/);
      
      if (!idMatch) {
        callback?.({
          text: 'Please provide a service ID to disconnect from.',
          action: 'DISCONNECT_FROM_SERVICE',
          source: 'erc8004'
        });
        return false;
      }

      const serviceId = BigInt(idMatch[1]);
      const manager = getConnectionManager();
      
      await manager.disconnect(serviceId);
      
      callback?.({
        text: `Disconnected from service ${serviceId}.`,
        action: 'DISCONNECT_FROM_SERVICE',
        source: 'erc8004'
      });

      return true;
    } catch (error) {
      callback?.({
        text: `Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        action: 'DISCONNECT_FROM_SERVICE',
        source: 'erc8004'
      });
      return false;
    }
  }
};

export const listConnectionsAction: Action = {
  name: 'LIST_CONNECTIONS',
  description: 'List all active service connections.',
  similes: ['list connections', 'show connections', 'active services', 'connected services'],
  examples: [
    [
      {
        user: '{{user1}}',
        content: { text: 'What services am I connected to?' }
      },
      {
        user: '{{agentName}}',
        content: { text: 'Checking active connections...', action: 'LIST_CONNECTIONS' }
      }
    ]
  ],
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      const manager = getConnectionManager();
      const connections = manager.getAllConnections();
      
      if (connections.length === 0) {
        callback?.({
          text: 'No active service connections.',
          action: 'LIST_CONNECTIONS',
          source: 'erc8004'
        });
        return true;
      }

      const connectionList = connections.map(c => 
        `${c.service.name} (ID: ${c.serviceId}) - Connected ${c.connectedAt ? 'since ' + c.connectedAt.toLocaleTimeString() : ''}`
      ).join('\n');

      callback?.({
        text: `Active connections (${connections.length}):\n\n${connectionList}`,
        action: 'LIST_CONNECTIONS',
        source: 'erc8004',
        data: { connections }
      });

      return true;
    } catch (error) {
      callback?.({
        text: `Failed to list connections: ${error instanceof Error ? error.message : 'Unknown error'}`,
        action: 'LIST_CONNECTIONS',
        source: 'erc8004'
      });
      return false;
    }
  }
};

// Export all actions
export const erc8004Actions = [
  discoverServicesAction,
  connectToServiceAction,
  sendToServiceAction,
  disconnectFromServiceAction,
  listConnectionsAction
];

