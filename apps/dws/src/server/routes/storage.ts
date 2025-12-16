/**
 * Storage Routes - native DWS API and IPFS-compatible API
 */

import { Hono } from 'hono';
import type { BackendManager } from '../../storage/backends';

export function createStorageRouter(backendManager: BackendManager): Hono {
  const router = new Hono();

  router.get('/health', async (c) => {
    const backends = backendManager.listBackends();
    const health = await backendManager.healthCheck();
    return c.json({ service: 'dws-storage', status: 'healthy', backends, health });
  });

  router.post('/upload', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file required' }, 400);
    const content = Buffer.from(await file.arrayBuffer());
    const result = await backendManager.upload(content, { filename: file.name });
    return c.json({ ...result, size: content.length });
  });

  router.post('/upload/raw', async (c) => {
    const body = await c.req.arrayBuffer();
    const content = Buffer.from(body);
    const filename = c.req.header('x-filename') || 'file';
    const result = await backendManager.upload(content, { filename });
    return c.json({ ...result, size: content.length });
  });

  router.get('/download/:cid', async (c) => {
    const cid = c.req.param('cid');
    const result = await backendManager.download(cid).catch((e: Error) => ({ error: e.message }));
    if ('error' in result) return c.json(result, 404);
    return new Response(result.content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${cid}"`,
      },
    });
  });

  router.get('/exists/:cid', async (c) => {
    const cid = c.req.param('cid');
    const exists = await backendManager.exists(cid);
    return c.json({ cid, exists });
  });

  // IPFS-compatible API
  router.post('/api/v0/add', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file required' }, 400);
    const content = Buffer.from(await file.arrayBuffer());
    const result = await backendManager.upload(content, { filename: file.name });
    return c.json({ Hash: result.cid, Size: String(content.length), Name: file.name });
  });

  router.post('/api/v0/id', async (c) => {
    const health = await backendManager.healthCheck();
    const allHealthy = Object.values(health).every((h) => h);
    if (!allHealthy) return c.json({ error: 'Storage backends unhealthy' }, 503);
    return c.json({ ID: 'dws-storage', AgentVersion: 'dws/1.0.0', Addresses: [] });
  });

  router.post('/api/v0/pin/rm', async (c) => {
    const arg = c.req.query('arg');
    if (!arg) return c.json({ error: 'arg required' }, 400);
    return c.json({ Pins: [arg] });
  });

  router.get('/ipfs/:cid', async (c) => {
    const cid = c.req.param('cid');
    const result = await backendManager.download(cid).catch((e: Error) => ({ error: e.message }));
    if ('error' in result) return c.json({ error: 'Not found' }, 404);
    return new Response(result.content, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Ipfs-Path': `/ipfs/${cid}` },
    });
  });

  return router;
}
