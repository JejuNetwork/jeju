/**
 * A2A Server for Jeju Indexer
 * Also serves the custom styled GraphQL playground
 */

import express from 'express';
import cors from 'cors';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4351;

// Serve static files from public directory
app.use('/static', express.static(path.join(__dirname, '../public')));

// Custom styled GraphQL playground
app.get('/playground', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/playground.html'));
});

// Root redirect to playground
app.get('/', (_req, res) => {
  res.redirect('/playground');
});

app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Indexer',
    description: 'Query blockchain data via GraphQL',
    url: `http://localhost:${PORT}/api/a2a`,
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { id: 'query-blocks', name: 'Query Blocks', description: 'Query block data', tags: ['query'], examples: ['Show recent blocks'] },
      { id: 'query-transactions', name: 'Query Transactions', description: 'Query transactions', tags: ['query'], examples: ['Recent transactions'] },
      { id: 'query-tokens', name: 'Query Tokens', description: 'Query token data', tags: ['query'], examples: ['List tokens'] },
      { id: 'custom-query', name: 'Custom Query', description: 'Execute custom GraphQL (PAID)', tags: ['query', 'premium'], examples: ['Custom GraphQL query'] }
    ]
  });
});

interface A2ARequest {
  method: string;
  params?: { message?: { messageId: string; parts: Array<{ kind: string; data?: { skillId: string } }> } };
  id: string | number;
}

app.post('/api/a2a', (req, res) => {
  const { method, params, id } = req.body as A2ARequest;
  
  if (method !== 'message/send') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
  
  const message = params?.message;
  if (!message) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } });
  }
  
  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'No data part' } });
  }
  
  const skillId = dataPart.data.skillId;

  const skillResponses: Record<string, { message: string; data: Record<string, unknown> }> = {
    'query-blocks': { message: 'Block query', data: { blocks: [] } },
    'query-transactions': { message: 'Transaction query', data: { transactions: [] } },
    'query-tokens': { message: 'Token query', data: { tokens: [] } },
    'custom-query': { message: 'Custom query', data: { note: 'Payment required for custom queries' } }
  };

  const result = skillResponses[skillId];
  if (!result) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown skill' } });
  }

  res.json({
    jsonrpc: '2.0',
    id,
    result: {
      role: 'agent',
      parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
      messageId: message.messageId,
      kind: 'message'
    }
  });
});

app.listen(PORT, () => console.log(`Indexer A2A: http://localhost:${PORT}`));
