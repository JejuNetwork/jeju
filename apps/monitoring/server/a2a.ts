/**
 * A2A Server for Monitoring - Exposes metrics programmatically
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Monitoring',
    description: 'Query system metrics and alerts',
    url: 'http://localhost:9091/api/a2a',
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { id: 'get-metrics', name: 'Get Metrics', description: 'Query Prometheus metrics', tags: ['query'], examples: ['Show metrics'] },
      { id: 'query-prometheus', name: 'Query Prometheus', description: 'Execute PromQL query', tags: ['query'], examples: ['Query Prometheus'] },
      { id: 'get-alerts', name: 'Get Alerts', description: 'Get active alerts', tags: ['query'], examples: ['Show alerts'] }
    ]
  });
});

app.post('/api/a2a', async (req, res) => {
  const { method, params, id } = req.body;
  if (method !== 'message/send') return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  const message = params?.message;
  const dataPart = message?.parts.find((p: any) => p.kind === 'data');
  const skillId = dataPart?.data?.skillId;

  let result;
  switch (skillId) {
    case 'get-metrics': result = { message: 'Metrics', data: { metrics: [] } }; break;
    case 'query-prometheus': result = { message: 'PromQL result', data: { result: [] } }; break;
    case 'get-alerts': result = { message: 'Alerts', data: { alerts: [] } }; break;
    default: result = { message: 'Unknown skill', data: {} };
  }

  res.json({
    jsonrpc: '2.0',
    id,
    result: { role: 'agent', parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }], messageId: message.messageId, kind: 'message' }
  });
});

const PORT = 9091;
app.listen(PORT, () => console.log(`📊 Monitoring A2A: http://localhost:${PORT}`));

