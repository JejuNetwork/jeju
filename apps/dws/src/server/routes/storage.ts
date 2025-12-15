/**
 * DWS Storage Routes
 */

import { Hono } from 'hono';
import type { BackendManager } from '../../storage/backends';

export function createStorageRouter(backendManager: BackendManager): Hono {
  const router = new Hono();

  router.get('/health', async (c) => {
    const backends = backendManager.listBackends();
    const health = await backendManager.healthCheck();
    return c.json({
      service: 'dws-storage',
      status: 'healthy',
      backends,
      health,
    });
  });

  router.post('/upload', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'file required' }, 400);
    }
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
    if ('error' in result) {
      return c.json(result, 404);
    }
    return new Response(result.content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${cid}"`,
      },
    });
  });

  router.head('/exists/:cid', async (c) => {
    const cid = c.req.param('cid');
    const exists = await backendManager.exists(cid);
    return exists ? c.body(null, 200) : c.body(null, 404);
  });

  router.get('/exists/:cid', async (c) => {
    const cid = c.req.param('cid');
    const exists = await backendManager.exists(cid);
    return c.json({ cid, exists });
  });

  return router;
}
