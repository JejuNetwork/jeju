/**
 * A2A Server for network Documentation
 * Enables agents to search and query documentation programmatically
 */

import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getNetworkName } from '@jejunetwork/config';
import { searchDocumentation, listTopics, DOCS_ROOT, type SearchResult, type Topic } from '../lib/a2a';

const PORT = process.env.DOCUMENTATION_A2A_PORT || 7778;

const SkillParamsSchema = z.record(z.string(), z.string());

const SkillDataSchema = z.object({
  skillId: z.string(),
  params: SkillParamsSchema.optional(),
});

const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  data: SkillDataSchema.optional(),
});

const A2AMessageSchema = z.object({
  messageId: z.string(),
  parts: z.array(A2AMessagePartSchema),
});

const A2ARequestSchema = z.object({
  jsonrpc: z.string(),
  method: z.string(),
  params: z.object({
    message: A2AMessageSchema.optional(),
  }).optional(),
  id: z.union([z.number(), z.string()]),
});

interface SkillResult {
  message: string;
  data: Record<string, string | number | SearchResult[] | Topic[]>;
}

const app = express();
app.use(cors());
app.use(express.json());

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: `${getNetworkName()} Documentation`,
  description: 'Search and query the network documentation programmatically',
  url: `http://localhost:${PORT}/api/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'the network', url: 'https://jejunetwork.org' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'search-docs',
      name: 'Search Documentation',
      description: 'Search documentation for keywords or topics',
      tags: ['query', 'search', 'documentation'],
      examples: ['Search for oracle', 'Find information about paymasters'],
    },
    {
      id: 'get-page',
      name: 'Get Documentation Page',
      description: 'Retrieve content of a specific documentation page',
      tags: ['query', 'documentation'],
      examples: ['Get contract documentation', 'Show deployment guide'],
    },
    {
      id: 'list-topics',
      name: 'List Documentation Topics',
      description: 'Get organized list of documentation topics',
      tags: ['query', 'navigation'],
      examples: ['List all topics', 'Documentation structure'],
    },
  ],
} as const;

app.get('/.well-known/agent-card.json', (_req, res) => res.json(AGENT_CARD));

app.post('/api/a2a', async (req, res) => {
  const parseResult = A2ARequestSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    res.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request format' } });
    return;
  }

  const { method, params, id } = parseResult.data;
  const error = (code: number, message: string) =>
    res.json({ jsonrpc: '2.0', id, error: { code, message } });

  if (method !== 'message/send') {
    error(-32601, 'Method not found');
    return;
  }

  const message = params?.message;
  if (!message?.parts) {
    error(-32602, 'Invalid params');
    return;
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) {
    error(-32602, 'No data part found');
    return;
  }

  const skillId = dataPart.data.skillId;
  const skillParams = dataPart.data.params ?? {};

  const result = await executeSkill(skillId, skillParams).catch((err: Error) => {
    error(-32603, err.message);
    return null;
  });

  if (!result) return;

  res.json({
    jsonrpc: '2.0',
    id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  });
});

async function executeSkill(skillId: string, params: Record<string, string>): Promise<SkillResult> {
  switch (skillId) {
    case 'search-docs': {
      const query = (params.query || '').toLowerCase();
      const results = await searchDocumentation(query);
      return { message: `Found ${results.length} results for "${query}"`, data: { results, query } };
    }
    case 'get-page': {
      const pagePath = params.page || '';
      const content = await readFile(path.join(DOCS_ROOT, pagePath), 'utf-8');
      return { message: `Retrieved ${pagePath}`, data: { page: pagePath, content } };
    }
    case 'list-topics': {
      const topics = await listTopics();
      return { message: `${topics.length} documentation topics`, data: { topics } };
    }
    default:
      throw new Error(`Unknown skill: ${skillId}`);
  }
}

app.listen(PORT, () => {
  console.log(`Documentation A2A server running on http://localhost:${PORT}`);
  console.log(`  Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`  A2A Endpoint: http://localhost:${PORT}/api/a2a`);
});
