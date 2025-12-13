/**
 * A2A Server for Jeju Documentation
 * Enables agents to search and query documentation programmatically
 */

import express from 'express';
import cors from 'cors';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.join(__dirname, '..');
const PORT = process.env.DOCUMENTATION_A2A_PORT || 7778;
const EXCLUDED_DIRS = new Set(['node_modules', '.vitepress', 'public', 'api']);
const MAX_SEARCH_RESULTS = 20;

interface A2AMessage {
  messageId: string;
  parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>;
}

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: { message?: A2AMessage };
  id: number | string;
}

interface SearchResult {
  file: string;
  matches: number;
}

interface Topic {
  name: string;
  path: string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

const app = express();
app.use(cors());
app.use(express.json());

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Documentation',
  description: 'Search and query Jeju Network documentation programmatically',
  url: `http://localhost:${PORT}/api/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
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
  const { method, params, id } = req.body as A2ARequest;

  const error = (code: number, message: string) =>
    res.json({ jsonrpc: '2.0', id, error: { code, message } });

  if (method !== 'message/send') return error(-32601, 'Method not found');

  const message = params?.message;
  if (!message?.parts) return error(-32602, 'Invalid params');

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) return error(-32602, 'No data part found');

  const skillId = dataPart.data.skillId as string;
  const skillParams = (dataPart.data.params as Record<string, unknown>) || {};

  try {
    const result = await executeSkill(skillId, skillParams);
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
  } catch (err) {
    error(-32603, err instanceof Error ? err.message : 'Internal error');
  }
});

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
  switch (skillId) {
    case 'search-docs': {
      const query = String(params.query || '').toLowerCase();
      const results = await searchDocumentation(query);
      return { message: `Found ${results.length} results for "${query}"`, data: { results, query } };
    }
    case 'get-page': {
      const pagePath = String(params.page || '');
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

async function searchDocumentation(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const regex = new RegExp(query, 'gi');

  async function searchDir(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await searchDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const matches = (content.match(regex) || []).length;
        if (matches > 0) {
          results.push({ file: path.relative(DOCS_ROOT, fullPath), matches });
        }
      }
    }
  }

  await searchDir(DOCS_ROOT);
  return results.sort((a, b) => b.matches - a.matches).slice(0, MAX_SEARCH_RESULTS);
}

async function listTopics(): Promise<Topic[]> {
  const topics: Topic[] = [];

  async function scanDir(dir: string, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await scanDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        topics.push({ name: entry.name.replace('.md', ''), path: prefix + entry.name });
      }
    }
  }

  await scanDir(DOCS_ROOT);
  return topics;
}

app.listen(PORT, () => {
  console.log(`Documentation A2A server running on http://localhost:${PORT}`);
  console.log(`  Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`  A2A Endpoint: http://localhost:${PORT}/api/a2a`);
});
