/**
 * MCP Routes
 */

import { Hono } from 'hono';

export function createMCPRouter(): Hono {
  const router = new Hono();

  router.post('/initialize', async (c) => {
    return c.json({ protocolVersion: '2024-11-05', capabilities: { resources: { subscribe: true }, tools: {} }, serverInfo: { name: 'dws-mcp', version: '1.0.0' } });
  });

  router.post('/resources/list', async (c) => {
    return c.json({
      resources: [
        { uri: 'dws://storage/stats', name: 'Storage Stats', mimeType: 'application/json' },
        { uri: 'dws://compute/models', name: 'Available Models', mimeType: 'application/json' },
        { uri: 'dws://cdn/stats', name: 'CDN Stats', mimeType: 'application/json' },
      ],
    });
  });

  router.post('/resources/read', async (c) => {
    const body = await c.req.json<{ uri: string }>();
    switch (body.uri) {
      case 'dws://storage/stats':
        return c.json({ contents: [{ uri: body.uri, mimeType: 'application/json', text: JSON.stringify({ totalPins: 0 }) }] });
      case 'dws://compute/models':
        return c.json({ contents: [{ uri: body.uri, mimeType: 'application/json', text: JSON.stringify({ models: ['mock-model'] }) }] });
      case 'dws://cdn/stats':
        return c.json({ contents: [{ uri: body.uri, mimeType: 'application/json', text: JSON.stringify({ cacheEntries: 0 }) }] });
      default:
        return c.json({ error: { code: -32602, message: 'Unknown resource' } }, 400);
    }
  });

  router.post('/tools/list', async (c) => {
    return c.json({
      tools: [
        { name: 'dws_upload', description: 'Upload file', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
        { name: 'dws_download', description: 'Download file', inputSchema: { type: 'object', properties: { cid: { type: 'string' } }, required: ['cid'] } },
        { name: 'dws_inference', description: 'AI inference', inputSchema: { type: 'object', properties: { model: { type: 'string' }, prompt: { type: 'string' } }, required: ['model', 'prompt'] } },
      ],
    });
  });

  router.post('/tools/call', async (c) => {
    const body = await c.req.json<{ name: string; arguments: Record<string, string> }>();
    if (body.name === 'dws_inference') {
      return c.json({ content: [{ type: 'text', text: JSON.stringify({ response: `Mock response to: ${body.arguments.prompt?.slice(0, 100)}...` }) }] });
    }
    return c.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Use HTTP endpoints directly' }) }] });
  });

  return router;
}
