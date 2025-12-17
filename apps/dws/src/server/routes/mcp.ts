/**
 * MCP Routes - Model Context Protocol implementation for DWS
 * Enables AI agents to interact with DWS services
 */

import { Hono } from 'hono';
import type { BackendManager } from '../../storage/backends';

interface MCPContext {
  backend?: BackendManager;
}

export function createMCPRouter(ctx: MCPContext = {}): Hono {
  const router = new Hono();
  const { backend: _backend } = ctx;

  // Initialize MCP connection
  router.post('/initialize', async (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: {},
        prompts: {},
      },
      serverInfo: {
        name: 'dws-mcp',
        version: '1.0.0',
        description: 'Decentralized Web Services - Storage, Compute, CDN, Git, Pkg',
      },
    });
  });

  // List available resources
  router.post('/resources/list', async (c) => {
    return c.json({
      resources: [
        { uri: 'dws://storage/stats', name: 'Storage Statistics', mimeType: 'application/json', description: 'Current storage usage and health' },
        { uri: 'dws://compute/status', name: 'Compute Status', mimeType: 'application/json', description: 'Compute marketplace status and active jobs' },
        { uri: 'dws://cdn/stats', name: 'CDN Statistics', mimeType: 'application/json', description: 'CDN cache hit rates and edge node status' },
        { uri: 'dws://git/repos', name: 'Git Repositories', mimeType: 'application/json', description: 'List of Git repositories' },
        { uri: 'dws://pkg/packages', name: 'Packages', mimeType: 'application/json', description: 'Published packages' },
        { uri: 'dws://ci/runs', name: 'CI/CD Runs', mimeType: 'application/json', description: 'Recent workflow runs' },
      ],
    });
  });

  // Read resource content
  router.post('/resources/read', async (c) => {
    const body = await c.req.json<{ uri: string }>();
    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030';

    const fetchResource = async (path: string): Promise<Record<string, unknown>> => {
      const response = await fetch(`${baseUrl}${path}`);
      if (!response.ok) return { error: `Failed to fetch: ${response.status}` };
      return response.json() as Promise<Record<string, unknown>>;
    };

    let data: Record<string, unknown>;

    switch (body.uri) {
      case 'dws://storage/stats':
        data = await fetchResource('/storage/health');
        break;
      case 'dws://compute/status':
        data = await fetchResource('/compute/health');
        break;
      case 'dws://cdn/stats':
        data = await fetchResource('/cdn/stats');
        break;
      case 'dws://git/repos':
        data = await fetchResource('/git/repos');
        break;
      case 'dws://pkg/packages':
        data = await fetchResource('/pkg/-/v1/search?text=');
        break;
      case 'dws://ci/runs':
        data = { runs: [], total: 0 }; // CI runs need repo context
        break;
      default:
        return c.json({ error: { code: -32602, message: `Unknown resource: ${body.uri}` } }, 400);
    }

    return c.json({
      contents: [{
        uri: body.uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      }],
    });
  });

  // List available tools
  router.post('/tools/list', async (c) => {
    return c.json({
      tools: [
        {
          name: 'dws_upload',
          description: 'Upload content to decentralized storage (IPFS)',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Content to upload (string or base64)' },
              filename: { type: 'string', description: 'Optional filename' },
              encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Content encoding' },
            },
            required: ['content'],
          },
        },
        {
          name: 'dws_download',
          description: 'Download content from decentralized storage by CID',
          inputSchema: {
            type: 'object',
            properties: {
              cid: { type: 'string', description: 'Content identifier (CID)' },
            },
            required: ['cid'],
          },
        },
        {
          name: 'dws_create_repo',
          description: 'Create a new Git repository',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Repository name' },
              description: { type: 'string', description: 'Repository description' },
              visibility: { type: 'string', enum: ['public', 'private'] },
            },
            required: ['name'],
          },
        },
        {
          name: 'dws_run_compute',
          description: 'Submit a compute job to the marketplace',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to execute' },
              shell: { type: 'string', enum: ['bash', 'sh', 'pwsh'], description: 'Shell type' },
              timeout: { type: 'number', description: 'Timeout in milliseconds' },
            },
            required: ['command'],
          },
        },
        {
          name: 'dws_chat',
          description: 'Send a chat completion request to available LLM providers',
          inputSchema: {
            type: 'object',
            properties: {
              model: { type: 'string', description: 'Model name' },
              prompt: { type: 'string', description: 'User prompt' },
              systemPrompt: { type: 'string', description: 'System prompt' },
            },
            required: ['prompt'],
          },
        },
      ],
    });
  });

  // Execute tool
  router.post('/tools/call', async (c) => {
    const body = await c.req.json<{ name: string; arguments: Record<string, string | number> }>();
    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030';
    const address = c.req.header('x-jeju-address') || '0x0000000000000000000000000000000000000000';

    switch (body.name) {
      case 'dws_upload': {
        const content = body.arguments.encoding === 'base64'
          ? Buffer.from(body.arguments.content as string, 'base64')
          : Buffer.from(body.arguments.content as string);
        
        const formData = new FormData();
        formData.append('file', new Blob([content]), (body.arguments.filename as string) || 'upload');
        
        const response = await fetch(`${baseUrl}/storage/upload`, {
          method: 'POST',
          body: formData,
        });
        
        const result = await response.json() as { cid: string };
        return c.json({ content: [{ type: 'text', text: JSON.stringify({ success: true, cid: result.cid }) }] });
      }

      case 'dws_download': {
        const response = await fetch(`${baseUrl}/storage/download/${body.arguments.cid}`);
        if (!response.ok) {
          return c.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Content not found' }) }] });
        }
        const content = await response.text();
        return c.json({ content: [{ type: 'text', text: content }] });
      }

      case 'dws_create_repo': {
        const response = await fetch(`${baseUrl}/git/repos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-jeju-address': address },
          body: JSON.stringify({
            name: body.arguments.name,
            description: body.arguments.description || '',
            visibility: body.arguments.visibility || 'public',
          }),
        });
        const result = await response.json();
        return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      }

      case 'dws_run_compute': {
        const response = await fetch(`${baseUrl}/compute/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-jeju-address': address },
          body: JSON.stringify({
            command: body.arguments.command,
            shell: body.arguments.shell || 'bash',
            timeout: body.arguments.timeout || 60000,
          }),
        });
        const result = await response.json();
        return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      }

      case 'dws_chat': {
        const response = await fetch(`${baseUrl}/compute/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: body.arguments.model || 'default',
            messages: [
              ...(body.arguments.systemPrompt ? [{ role: 'system', content: body.arguments.systemPrompt }] : []),
              { role: 'user', content: body.arguments.prompt },
            ],
          }),
        });
        const result = await response.json() as { choices: Array<{ message: { content: string } }> };
        return c.json({ content: [{ type: 'text', text: result.choices[0]?.message.content || '' }] });
      }

      default:
        return c.json({ error: { code: -32602, message: `Unknown tool: ${body.name}` } }, 400);
    }
  });

  return router;
}
