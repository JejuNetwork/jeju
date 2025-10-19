/**
 * A2A Server for Gateway Portal
 * Standalone Express server for agent-to-agent communication
 * Run alongside the Vite dev server on port 4001
 */

import express, { Request, Response, Router } from 'express';
import cors from 'cors';

const app = express();
const PORT = 4003; // Separate port for A2A

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
        data?: Record<string, string>;
      }>;
    };
  };
  id: number | string;
}

async function executeSkill(skillId: string): Promise<{ message: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'list-protocol-tokens': {
      // In production, this would query the TokenRegistry contract
      return {
        message: 'Protocol tokens: elizaOS, CLANKER, VIRTUAL, CLANKERMON',
        data: {
          tokens: [
            { symbol: 'elizaOS', hasPaymaster: true, origin: 'jeju' },
            { symbol: 'CLANKER', hasPaymaster: true, origin: 'base' },
            { symbol: 'VIRTUAL', hasPaymaster: true, origin: 'base' },
            { symbol: 'CLANKERMON', hasPaymaster: true, origin: 'base' },
          ],
        },
      };
    }

    case 'get-node-stats': {
      return {
        message: 'Node statistics available via NodeStakingManager contract',
        data: {
          note: 'Query NodeStakingManager.getNetworkStats() for live data',
        },
      };
    }

    case 'list-nodes': {
      return {
        message: 'Node listing available',
        data: {
          note: 'Query NodeStakingManager for registered nodes',
        },
      };
    }

    case 'list-registered-apps': {
      return {
        message: 'App registry available',
        data: {
          note: 'Query IdentityRegistry.getAllAgents() for registered apps',
        },
      };
    }

    case 'get-app-by-tag': {
      return {
        message: 'App discovery by tag available',
        data: {
          note: 'Provide tag parameter to filter apps',
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found' },
      };
  }
}

// Serve agent card at /.well-known/agent-card.json
app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
  res.json({
    protocolVersion: '0.3.0',
    name: 'Gateway Portal - Protocol Infrastructure Hub',
    description: 'Multi-token paymaster system, node staking, app registry, and protocol infrastructure',
    url: `http://localhost:${PORT}/a2a`,
    preferredTransport: 'http',
    provider: {
      organization: 'Jeju Network',
      url: 'https://jeju.network',
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'list-protocol-tokens',
        name: 'List Protocol Tokens',
        description: 'Get all tokens with deployed paymasters',
        tags: ['query', 'tokens', 'paymaster'],
        examples: ['Show protocol tokens', 'Which tokens can pay gas?'],
      },
      {
        id: 'get-node-stats',
        name: 'Get Node Statistics',
        description: 'Get network node statistics and health',
        tags: ['query', 'nodes', 'network'],
        examples: ['Show node stats', 'Network health'],
      },
      {
        id: 'list-nodes',
        name: 'List Registered Nodes',
        description: 'Get all registered node operators',
        tags: ['query', 'nodes'],
        examples: ['Show nodes', 'List node operators'],
      },
      {
        id: 'list-registered-apps',
        name: 'List Registered Apps',
        description: 'Get all apps registered in the ERC-8004 registry',
        tags: ['query', 'registry', 'apps'],
        examples: ['Show registered apps', 'What apps are available?'],
      },
      {
        id: 'get-app-by-tag',
        name: 'Get Apps by Tag',
        description: 'Find apps by category tag (game, marketplace, defi, etc.)',
        tags: ['query', 'registry', 'discovery'],
        examples: ['Show me games', 'List marketplaces', 'Find DeFi apps'],
      },
    ],
  });
});

// A2A JSON-RPC endpoint
app.post('/a2a', async (req: Request, res: Response) => {
  const body: A2ARequest = req.body;

  if (body.method !== 'message/send') {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' },
    });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    });
  }

  const skillId = dataPart.data.skillId;
  if (!skillId) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    });
  }

  const result = await executeSkill(skillId);

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
});

app.listen(PORT, () => {
  console.log(`🌉 Gateway A2A Server running on http://localhost:${PORT}`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   A2A Endpoint: http://localhost:${PORT}/a2a`);
});


