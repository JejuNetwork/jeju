/**
 * Container Registry Module
 * 
 * OCI-compatible container registry with decentralized storage.
 */

export * from './oci-registry';
export * from './registry-a2a';
export * from './registry-mcp';

import { Hono } from 'hono';
import { createOCIRegistry, type RegistryConfig } from './oci-registry';
import { createRegistryA2AServer } from './registry-a2a';
import { createRegistryMCPServer } from './registry-mcp';

/**
 * Create complete registry app with OCI API, A2A, and MCP
 */
export function createFullRegistryApp(config?: Partial<RegistryConfig>): Hono {
  const app = new Hono();
  const registry = createOCIRegistry(config);

  // Mount OCI Registry API at /v2
  app.route('/v2', registry.createRouter());

  // Mount A2A server
  app.route('/a2a', createRegistryA2AServer(registry));

  // Mount MCP server
  app.route('/mcp', createRegistryMCPServer(registry));

  // Agent card at well-known location
  app.get('/.well-known/agent-card.json', async (c) => {
    const response = await app.request('/a2a/.well-known/agent-card.json');
    return response;
  });

  // Health check
  app.get('/health', async (c) => {
    const response = await app.request('/v2/_registry/health');
    const data = await response.json();
    return c.json({
      service: 'jeju-container-registry',
      version: '1.0.0',
      ...data,
      endpoints: {
        oci: '/v2',
        a2a: '/a2a',
        mcp: '/mcp',
      },
    });
  });

  // Root info
  app.get('/', (c) => {
    return c.json({
      name: 'Jeju Container Registry',
      version: '1.0.0',
      description: 'Decentralized OCI-compatible container registry',
      features: [
        'Docker Registry V2 API compatible',
        'IPFS and Arweave storage backends',
        'x402 micropayments',
        'Account balance and staking',
        'A2A and MCP interfaces',
      ],
      endpoints: {
        oci: '/v2',
        a2a: '/a2a',
        mcp: '/mcp',
        health: '/health',
        agentCard: '/.well-known/agent-card.json',
      },
    });
  });

  return app;
}

