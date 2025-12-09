/**
 * @fileoverview A2A (Agent-to-Agent) Server for OIF Aggregator
 * Exposes intent creation, routing, and tracking via A2A protocol
 */

import express, { Request, Response } from 'express';
import { IntentService } from './services/intent-service';
import { RouteService } from './services/route-service';
import { SolverService } from './services/solver-service';

const router: express.Router = express.Router();

// Initialize services
const intentService = new IntentService();
const routeService = new RouteService();
const solverService = new SolverService();

// A2A Agent Card
export const A2A_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Open Intents Aggregator',
  description: 'Cross-chain intent creation, routing, and tracking via OIF/EIL. Create intents, get quotes, and track fulfillment across chains.',
  url: `http://localhost:${process.env.AGGREGATOR_PORT || 4010}/a2a`,
  preferredTransport: 'http',
  provider: {
    organization: 'Jeju Network',
    url: 'https://jeju.network',
  },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: true,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Intent Management
    {
      id: 'create-intent',
      name: 'Create Cross-Chain Intent',
      description: 'Create a new intent for cross-chain swap/transfer',
      tags: ['intents', 'create', 'swap', 'bridge'],
      examples: ['Swap 1 ETH on Ethereum for USDC on Arbitrum', 'Bridge 100 USDC from Ethereum to Jeju'],
    },
    {
      id: 'get-quote',
      name: 'Get Intent Quote',
      description: 'Get best price quote for an intent from active solvers',
      tags: ['quote', 'pricing', 'intents'],
      examples: ['Quote for 1 ETH to USDC cross-chain', 'Best price for Base to Arbitrum swap'],
    },
    {
      id: 'track-intent',
      name: 'Track Intent Status',
      description: 'Get current status and execution details of an intent',
      tags: ['intents', 'status', 'tracking'],
      examples: ['Check status of intent 0x...', 'Is my swap complete?'],
    },
    {
      id: 'cancel-intent',
      name: 'Cancel Intent',
      description: 'Cancel an open intent (before solver claims)',
      tags: ['intents', 'cancel'],
      examples: ['Cancel my pending intent', 'Stop cross-chain transfer'],
    },
    // Route Discovery
    {
      id: 'list-routes',
      name: 'List Available Routes',
      description: 'Get all supported cross-chain routes with stats',
      tags: ['routes', 'discovery'],
      examples: ['What chains can I bridge to?', 'Show available routes'],
    },
    {
      id: 'get-best-route',
      name: 'Get Best Route',
      description: 'Find optimal route for a specific swap',
      tags: ['routes', 'optimization'],
      examples: ['Best route for ETH to USDC', 'Fastest path from Ethereum to Arbitrum'],
    },
    // Solver Operations
    {
      id: 'list-solvers',
      name: 'List Active Solvers',
      description: 'Get all active solvers with reputation and liquidity',
      tags: ['solvers', 'liquidity'],
      examples: ['Show active solvers', 'Who can fill my intent?'],
    },
    {
      id: 'get-solver-liquidity',
      name: 'Get Solver Liquidity',
      description: 'Check available liquidity for a specific solver',
      tags: ['solvers', 'liquidity'],
      examples: ['Check solver 0x... liquidity', 'How much can solver fill?'],
    },
    // Analytics
    {
      id: 'get-stats',
      name: 'Get OIF Statistics',
      description: 'Get global intent framework statistics',
      tags: ['analytics', 'stats'],
      examples: ['Show OIF stats', 'Total volume today?'],
    },
    {
      id: 'get-volume',
      name: 'Get Route Volume',
      description: 'Get volume statistics for a specific route',
      tags: ['analytics', 'volume'],
      examples: ['Volume on Ethereum to Arbitrum route', 'Route statistics'],
    },
  ],
};

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{
        kind: string;
        text?: string;
        data?: Record<string, string | number | boolean>;
      }>;
    };
  };
  id: number | string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
  switch (skillId) {
    // Intent Management
    case 'create-intent': {
      const intent = await intentService.createIntent({
        sourceChain: params.sourceChain as number,
        destinationChain: params.destinationChain as number,
        sourceToken: params.sourceToken as string,
        destinationToken: params.destinationToken as string,
        amount: params.amount as string,
        recipient: params.recipient as string,
        maxFee: params.maxFee as string,
      });
      return {
        message: `Intent created successfully. ID: ${intent.intentId}`,
        data: { intent },
      };
    }

    case 'get-quote': {
      const quotes = await intentService.getQuotes({
        sourceChain: params.sourceChain as number,
        destinationChain: params.destinationChain as number,
        sourceToken: params.sourceToken as string,
        destinationToken: params.destinationToken as string,
        amount: params.amount as string,
      });
      return {
        message: `Found ${quotes.length} quotes for your intent`,
        data: { quotes, bestQuote: quotes[0] },
      };
    }

    case 'track-intent': {
      const intentId = params.intentId as string;
      const intent = await intentService.getIntent(intentId);
      if (!intent) {
        return { message: 'Intent not found', data: { error: 'Intent not found' } };
      }
      return {
        message: `Intent ${intentId} status: ${intent.status}`,
        data: intent,
      };
    }

    case 'cancel-intent': {
      const intentId = params.intentId as string;
      const user = params.user as string;
      if (!user) {
        return { message: 'User address required', data: { error: 'Missing user parameter' } };
      }
      const result = await intentService.cancelIntent(intentId, user);
      return {
        message: result.success ? 'Intent cancelled successfully' : result.message,
        data: result,
      };
    }

    // Route Discovery
    case 'list-routes': {
      const routes = await routeService.listRoutes();
      return {
        message: `Found ${routes.length} active routes`,
        data: { routes, totalRoutes: routes.length },
      };
    }

    case 'get-best-route': {
      const route = await routeService.getBestRoute({
        sourceChain: params.sourceChain as number,
        destinationChain: params.destinationChain as number,
        prioritize: (params.prioritize as 'speed' | 'cost') || 'cost',
      });
      return {
        message: route ? `Best route found via ${route.oracle}` : 'No route available',
        data: { route },
      };
    }

    // Solver Operations
    case 'list-solvers': {
      const solvers = await solverService.listSolvers();
      return {
        message: `${solvers.length} active solvers`,
        data: { solvers, activeSolvers: solvers.length },
      };
    }

    case 'get-solver-liquidity': {
      const solverAddress = params.solver as string;
      const liquidity = await solverService.getSolverLiquidity(solverAddress);
      return {
        message: `Solver ${solverAddress.slice(0, 10)}... liquidity retrieved`,
        data: { solver: solverAddress, liquidity },
      };
    }

    // Analytics
    case 'get-stats': {
      const stats = await intentService.getStats();
      return {
        message: `OIF Stats: ${stats.totalIntents} intents, $${stats.totalVolumeUsd} volume`,
        data: stats,
      };
    }

    case 'get-volume': {
      const volume = await routeService.getVolume({
        sourceChain: params.sourceChain as number,
        destinationChain: params.destinationChain as number,
        period: (params.period as '24h' | '7d' | '30d' | 'all') || 'all',
      });
      return {
        message: `Route volume: $${volume.totalVolumeUsd}`,
        data: volume,
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: {
          error: 'Skill not found',
          availableSkills: A2A_AGENT_CARD.skills.map(s => s.id),
        },
      };
  }
}

router.post('/', async (req: Request, res: Response) => {
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

  const dataPart = message.parts.find(p => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    });
  }

  const skillId = dataPart.data.skillId as string;
  if (!skillId) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    });
  }

  let result: { message: string; data: unknown };
  try {
    result = await executeSkill(skillId, dataPart.data);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message: `Skill execution failed: ${errorMessage}` },
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
});

export { router as a2aRouter };

