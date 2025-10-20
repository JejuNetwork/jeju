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

const app = express();
app.use(cors());
app.use(express.json());

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{
        kind: string;
        text?: string;
        data?: Record<string, unknown>;
      }>;
    };
  };
  id: number | string;
}

// Agent Card
app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Documentation',
    description: 'Search and query Jeju Network documentation programmatically',
    url: 'http://localhost:7778/api/a2a',
    preferredTransport: 'http',
    provider: {
      organization: 'Jeju Network',
      url: 'https://jeju.network'
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'search-docs',
        name: 'Search Documentation',
        description: 'Search documentation for keywords or topics',
        tags: ['query', 'search', 'documentation'],
        examples: ['Search for oracle', 'Find information about paymasters', 'Documentation on ERC-8004']
      },
      {
        id: 'get-page',
        name: 'Get Documentation Page',
        description: 'Retrieve content of a specific documentation page',
        tags: ['query', 'documentation'],
        examples: ['Get contract documentation', 'Show deployment guide', 'Read whitepaper']
      },
      {
        id: 'list-topics',
        name: 'List Documentation Topics',
        description: 'Get organized list of documentation topics',
        tags: ['query', 'navigation'],
        examples: ['List all topics', 'Documentation structure', 'What topics are available?']
      }
    ]
  });
});

// A2A JSON-RPC endpoint
app.post('/api/a2a', async (req, res) => {
  const body: A2ARequest = req.body;

  if (body.method !== 'message/send') {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' }
    });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' }
    });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' }
    });
  }

  const skillId = dataPart.data.skillId as string;
  const params = (dataPart.data.params as Record<string, unknown>) || {};

  try {
    const result = await executeSkill(skillId, params);

    res.json({
      jsonrpc: '2.0',
      id: body.id,
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
  } catch (error) {
    res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    });
  }
});

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<{
  message: string;
  data: Record<string, unknown>;
}> {
  switch (skillId) {
    case 'search-docs': {
      const query = (params.query as string || '').toLowerCase();
      const results = await searchDocumentation(query);
      return {
        message: `Found ${results.length} results for "${query}"`,
        data: { results, query },
      };
    }

    case 'get-page': {
      const pagePath = params.page as string;
      const content = await getPage(pagePath);
      return {
        message: `Retrieved ${pagePath}`,
        data: { page: pagePath, content },
      };
    }

    case 'list-topics': {
      const topics = await listTopics();
      return {
        message: `${topics.length} documentation topics`,
        data: { topics },
      };
    }

    default:
      throw new Error('Unknown skill');
  }
}

async function searchDocumentation(query: string): Promise<Array<{file: string; matches: number}>> {
  const results: Array<{file: string; matches: number}> = [];
  
  async function searchDir(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.vitepress') {
        await searchDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const matches = (content.toLowerCase().match(new RegExp(query, 'g')) || []).length;
        
        if (matches > 0) {
          const relativePath = path.relative(DOCS_ROOT, fullPath);
          results.push({ file: relativePath, matches });
        }
      }
    }
  }

  await searchDir(DOCS_ROOT);
  return results.sort((a, b) => b.matches - a.matches).slice(0, 20);
}

async function getPage(pagePath: string): Promise<string> {
  const fullPath = path.join(DOCS_ROOT, pagePath);
  const content = await readFile(fullPath, 'utf-8');
  return content;
}

async function listTopics(): Promise<Array<{name: string; path: string}>> {
  const topics: Array<{name: string; path: string}> = [];
  
  async function scanDir(dir: string, prefix: string = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.vitepress' && entry.name !== 'public') {
        await scanDir(path.join(dir, entry.name), prefix + entry.name + '/');
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        topics.push({
          name: entry.name.replace('.md', ''),
          path: prefix + entry.name,
        });
      }
    }
  }

  await scanDir(DOCS_ROOT);
  return topics;
}

const PORT = process.env.DOCUMENTATION_A2A_PORT || 7778;

app.listen(PORT, () => {
  console.log(`📚 Documentation A2A server running on http://localhost:${PORT}`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   A2A Endpoint: http://localhost:${PORT}/api/a2a`);
});

