import { Hono } from 'hono';
import type { InferenceRequest } from '../../types';

export function createComputeRouter(): Hono {
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({ service: 'dws-compute', status: 'healthy' });
  });

  app.post('/chat/completions', async (c) => {
    const body = await c.req.json<InferenceRequest>();
    return c.json({
      id: crypto.randomUUID(),
      model: body.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: `Echo: ${(body.messages[0]?.content) ?? ''}` },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
    });
  });

  return app;
}
