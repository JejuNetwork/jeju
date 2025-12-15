/**
 * DWS Trigger Service
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

interface Trigger {
  id: string;
  type: 'cron' | 'event' | 'webhook';
  config: Record<string, string>;
  target: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

const triggers = new Map<string, Trigger>();

app.get('/health', (c) => {
  return c.json({ status: 'healthy', service: 'dws-triggers', activeTriggers: triggers.size });
});

app.get('/triggers', (c) => {
  return c.json({ triggers: Array.from(triggers.values()) });
});

app.post('/triggers', async (c) => {
  const body = await c.req.json<Omit<Trigger, 'id'>>();
  const id = crypto.randomUUID();
  const trigger: Trigger = { id, ...body, lastRun: undefined, nextRun: Date.now() + 60000 };
  triggers.set(id, trigger);
  return c.json({ success: true, trigger });
});

app.delete('/triggers/:id', (c) => {
  const id = c.req.param('id');
  if (triggers.delete(id)) {
    return c.json({ success: true });
  }
  return c.json({ error: 'Trigger not found' }, 404);
});

app.post('/triggers/:id/run', async (c) => {
  const id = c.req.param('id');
  const trigger = triggers.get(id);
  if (!trigger) return c.json({ error: 'Trigger not found' }, 404);

  trigger.lastRun = Date.now();
  trigger.nextRun = Date.now() + 60000;

  return c.json({ success: true, executedAt: trigger.lastRun });
});

const PORT = parseInt(process.env.TRIGGER_PORT || '4016', 10);

if (import.meta.main) {
  console.log(`[DWS Triggers] Running at http://localhost:${PORT}`);
  Bun.serve({ port: PORT, fetch: app.fetch });
}

export { app as triggerApp };



