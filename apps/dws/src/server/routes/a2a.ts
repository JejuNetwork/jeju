import { Hono } from 'hono';

export function createA2ARouter(): Hono {
  const app = new Hono();

  app.get('/capabilities', (c) => {
    return c.json({ capabilities: ['storage', 'compute', 'cdn'] });
  });

  return app;
}
