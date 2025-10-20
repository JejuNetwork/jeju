/**
 * A2A Server for Gateway Portal
 * Standalone Express server for agent-to-agent communication
 * Run alongside the Vite dev server on port 4001
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createPaymentRequirement, checkPayment, PAYMENT_TIERS } from './lib/x402.js';
import { Address } from 'viem';

const app = express();
const PORT = 4003;
const PAYMENT_RECIPIENT = (process.env.GATEWAY_PAYMENT_RECIPIENT || '0x0000000000000000000000000000000000000000') as Address;

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

async function executeSkill(skillId: string, params: Record<string, unknown>, paymentHeader: string | null): Promise<{ message: string; data: Record<string, unknown>; requiresPayment?: any }> {
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

    case 'deploy-paymaster': {
      const paymentCheck = await checkPayment(paymentHeader, PAYMENT_TIERS.PAYMASTER_DEPLOYMENT, PAYMENT_RECIPIENT);
      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement('/a2a', PAYMENT_TIERS.PAYMASTER_DEPLOYMENT, 'Paymaster deployment fee', PAYMENT_RECIPIENT),
        };
      }
      return {
        message: 'Paymaster deployment authorized',
        data: {
          token: params.token,
          fee: PAYMENT_TIERS.PAYMASTER_DEPLOYMENT.toString(),
        },
      };
    }

    case 'add-liquidity': {
      const paymentCheck = await checkPayment(paymentHeader, PAYMENT_TIERS.LIQUIDITY_ADD, PAYMENT_RECIPIENT);
      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement('/a2a', PAYMENT_TIERS.LIQUIDITY_ADD, 'Liquidity provision fee', PAYMENT_RECIPIENT),
        };
      }
      return {
        message: 'Liquidity addition prepared',
        data: {
          paymaster: params.paymaster,
          amount: params.amount,
        },
      };
    }

    case 'get-paymaster-stats': {
      return {
        message: 'Paymaster statistics',
        data: {
          totalPaymasters: 0,
          totalStaked: '0 ETH',
          note: 'Query PaymasterFactory contract for live stats',
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

// Serve main agent card at /.well-known/agent-card.json
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

// Serve governance agent card
app.get('/.well-known/governance-agent-card.json', (_req: Request, res: Response) => {
  res.json({
    id: 'jeju-futarchy-governance',
    name: 'Jeju Futarchy Governance',
    description: 'Market-based governance using prediction markets for parameter decisions',
    version: '1.0.0',
    protocol: 'a2a',
    protocolVersion: '0.3.0',
    capabilities: {
      governance: true,
      futarchy: true,
      predictionMarkets: true,
    },
    skills: [
      {
        id: 'get-active-quests',
        name: 'Get Active Governance Quests',
        description: 'Returns all active futarchy governance quests with their prediction markets',
        inputs: [],
        outputs: { quests: 'array' },
        endpoint: '/a2a/governance',
      },
      {
        id: 'get-voting-power',
        name: 'Get Voting Power',
        description: 'Calculate voting power from node stakes, LP positions, and governance locks',
        inputs: [{ name: 'address', type: 'string', required: true }],
        outputs: { breakdown: 'object' },
        endpoint: '/a2a/governance',
      },
      {
        id: 'create-quest',
        name: 'Create Governance Quest',
        description: 'Propose new governance change with futarchy markets',
        inputs: [
          { name: 'title', type: 'string', required: true },
          { name: 'objective', type: 'string', required: true },
          { name: 'targetContract', type: 'string', required: true },
          { name: 'calldata', type: 'string', required: true },
        ],
        outputs: { questId: 'string', yesMarketId: 'string', noMarketId: 'string' },
        endpoint: '/a2a/governance',
      },
      {
        id: 'vote-on-quest',
        name: 'Vote on Quest',
        description: 'Trade on governance prediction markets using voting power',
        inputs: [
          { name: 'questId', type: 'string', required: true },
          { name: 'supportChange', type: 'boolean', required: true },
          { name: 'amount', type: 'number', required: true },
        ],
        outputs: { success: 'boolean', transactionHash: 'string' },
        endpoint: '/a2a/governance',
      },
    ],
    endpoints: {
      jsonrpc: `http://localhost:${PORT}/a2a/governance`,
      rest: `http://localhost:${PORT}/api/governance`,
    },
    metadata: {
      governance_type: 'futarchy',
      voting_mechanism: 'stake_weighted',
      supported_tokens: ['elizaOS', 'CLANKER', 'VIRTUAL', 'CLANKERMON'],
      min_voting_period: '7 days',
      timelock_period: '7 days',
    },
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
  const skillParams = (dataPart.data.params as Record<string, unknown>) || {};
  const paymentHeader = req.headers['x-payment'] as string | undefined;

  if (!skillId) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    });
  }

  try {
    const result = await executeSkill(skillId, skillParams, paymentHeader || null);

    if (result.requiresPayment) {
      return res.status(402).json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: 402,
          message: 'Payment Required',
          data: result.requiresPayment,
        },
      });
    }

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
        message: error instanceof Error ? error.message : 'Internal error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🌉 Gateway A2A Server running on http://localhost:${PORT}`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   A2A Endpoint: http://localhost:${PORT}/a2a`);
});


