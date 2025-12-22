/**
 * MCP Server Factory - Model Context Protocol
 * 
 * Creates MCP servers for dApps.
 * Note: For new implementations, prefer createUnifiedServer from './server'
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address } from 'viem';
import type { ProtocolData, ProtocolValue } from '../types';
import type { MCPResource, MCPTool, MCPPrompt } from './server';

export type { MCPResource, MCPTool, MCPPrompt };

export interface MCPConfig {
  name: string;
  description: string;
  version?: string;
  resources: MCPResource[];
  tools: MCPTool[];
  prompts?: MCPPrompt[];
  readResource: (uri: string, address: Address) => Promise<ProtocolValue>;
  callTool: (name: string, args: ProtocolData, address: Address) => Promise<{ result: ProtocolValue; isError: boolean }>;
  getPrompt?: (name: string, args: Record<string, string>, address: Address) => Promise<MCPPromptResult>;
}

export interface MCPPromptResult {
  messages: Array<{ role: string; content: { type: string; text: string } }>;
}

export function createMCPServer(config: MCPConfig): Hono {
  const app = new Hono();
  app.use('/*', cors());

  const serverInfo = {
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description,
    capabilities: {
      resources: true,
      tools: true,
      prompts: config.prompts ? true : false,
    },
  };

  // Initialize
  app.post('/initialize', (c) => c.json({
    protocolVersion: '2024-11-05',
    serverInfo,
    capabilities: serverInfo.capabilities,
  }));

  // List resources
  app.post('/resources/list', (c) => c.json({ resources: config.resources }));

  // Read resource
  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    const address = c.req.header('x-jeju-address') as Address;

    if (!address) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const contents = await config.readResource(uri, address);
    const resource = config.resources.find(r => r.uri === uri);

    return c.json({
      contents: [{
        uri,
        mimeType: resource?.mimeType || 'application/json',
        text: JSON.stringify(contents),
      }],
    });
  });

  // List tools
  app.post('/tools/list', (c) => c.json({ tools: config.tools }));

  // Call tool
  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: ProtocolData };
    const address = c.req.header('x-jeju-address') as Address;

    if (!address) {
      return c.json({ content: [{ type: 'text', text: 'Authentication required' }], isError: true });
    }

    const { result, isError } = await config.callTool(name, args, address);

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError,
    });
  });

  // List prompts
  if (config.prompts) {
    app.post('/prompts/list', (c) => c.json({ prompts: config.prompts }));

    // Get prompt
    app.post('/prompts/get', async (c) => {
      const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, string> };
      const address = c.req.header('x-jeju-address') as Address;

      if (!address) {
        return c.json({ error: 'Authentication required' }, 401);
      }

      if (!config.getPrompt) {
        return c.json({ error: 'Prompts not configured' }, 404);
      }

      const result = await config.getPrompt(name, args, address);
      return c.json(result);
    });
  }

  // Root info
  app.get('/', (c) => c.json({
    ...serverInfo,
    resources: config.resources,
    tools: config.tools,
    prompts: config.prompts,
  }));

  return app;
}
