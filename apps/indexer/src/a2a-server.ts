/**
 * A2A Server for Jeju Indexer
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const GRAPHQL_URL = process.env.GRAPHQL_URL || 'http://localhost:4350/graphql';
const PAYMENT_RECIPIENT = '0x0000000000000000000000000000000000000000';

app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Indexer',
    description: 'Query blockchain data via GraphQL',
    url: 'http://localhost:4351/api/a2a',
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

app.post('/api/a2a', async (req, res) => {
  const { method, params, id } = req.body;
  if (method !== 'message/send') return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  const message = params?.message;
  if (!message) return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } });
  const dataPart = message.parts.find((p: any) => p.kind === 'data');
  if (!dataPart) return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'No data part' } });
  const skillId = dataPart.data.skillId;

  try {
    let result;
    switch (skillId) {
      case 'query-blocks':
        result = { message: 'Block query', data: { blocks: [] } };
        break;
      case 'query-transactions':
        result = { message: 'Transaction query', data: { transactions: [] } };
        break;
      case 'query-tokens':
        result = { message: 'Token query', data: { tokens: [] } };
        break;
      case 'custom-query':
        result = { message: 'Custom query', data: { note: 'Payment required for custom queries' } };
        break;
      default:
        throw new Error('Unknown skill');
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
  } catch (error) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: (error as Error).message } });
  }
});

const PORT = 4351;
app.listen(PORT, () => console.log(`📊 Indexer A2A: http://localhost:${PORT}`));

