/**
 * Unified Bot API Server
 * 
 * Provides REST, A2A, and MCP APIs for the Unified MEV + LP Bot:
 * - REST API for basic operations and monitoring
 * - A2A (Agent-to-Agent) protocol for autonomous agent communication
 * - MCP (Model Context Protocol) for LLM integration
 * 
 * Endpoints:
 * - GET /health - Health check
 * - GET /stats - Bot statistics
 * - GET /opportunities - Current arbitrage opportunities
 * - GET /positions - Liquidity positions
 * - GET /pools - Pool recommendations
 * - GET /rebalance - Pending rebalance actions
 * - POST /rebalance/:actionId - Execute rebalance action
 * - POST /liquidity/add - Add liquidity
 * - POST /liquidity/remove - Remove liquidity
 * - GET /quotes/:inputMint/:outputMint/:amount - Get Solana swap quotes
 * - POST /swap - Execute swap
 * - GET /trades - Trade history
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { UnifiedBot, type UnifiedBotConfig, type TradeResult } from './unified-bot';
import type { RebalanceAction, UnifiedPosition, PoolAnalysis } from './strategies/liquidity-manager';

// ============ Types ============

interface APIConfig {
  restPort: number;
  a2aPort: number;
  mcpPort: number;
  bot: UnifiedBot;
}

interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: string[];
  endpoints: {
    a2a: string;
    mcp: string;
    rest: string;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// ============ REST API ============

function createRestAPI(bot: UnifiedBot): Hono {
  const app = new Hono();

  app.use('*', cors());

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'unified-bot', timestamp: Date.now() });
  });

  // Bot statistics
  app.get('/stats', (c) => {
    const stats = bot.getStats();
    return c.json(stats);
  });

  // Current opportunities
  app.get('/opportunities', (c) => {
    const opportunities = bot.getOpportunities();
    return c.json(opportunities);
  });

  // Liquidity positions
  app.get('/positions', (c) => {
    const positions = bot.getLiquidityPositions();
    return c.json(positions);
  });

  // Pool recommendations
  app.get('/pools', async (c) => {
    const minTvl = c.req.query('minTvl') ? parseFloat(c.req.query('minTvl')!) : undefined;
    const minApr = c.req.query('minApr') ? parseFloat(c.req.query('minApr')!) : undefined;
    
    const pools = await bot.getPoolRecommendations({ minTvl, minApr });
    return c.json(pools);
  });

  // Pending rebalance actions
  app.get('/rebalance', async (c) => {
    const actions = await bot.getRebalanceActions();
    return c.json(actions);
  });

  // Execute rebalance action
  app.post('/rebalance/:actionId', async (c) => {
    const { actionId } = c.req.param();
    const actions = await bot.getRebalanceActions();
    const action = actions.find(a => a.positionId === actionId);
    
    if (!action) {
      return c.json({ success: false, error: 'Action not found' }, 404);
    }

    const result = await bot.executeRebalance(action);
    return c.json(result);
  });

  // Add liquidity
  app.post('/liquidity/add', async (c) => {
    const body = await c.req.json();
    const result = await bot.addLiquidity({
      chain: body.chain,
      dex: body.dex,
      poolId: body.poolId,
      amountA: body.amountA,
      amountB: body.amountB,
    });
    return c.json(result);
  });

  // Remove liquidity (simplified - would need position ID and percent)
  app.post('/liquidity/remove', async (c) => {
    const body = await c.req.json();
    // This would call liquidityManager.removeLiquidity
    return c.json({ success: false, error: 'Not implemented' });
  });

  // Get Solana swap quotes
  app.get('/quotes/:inputMint/:outputMint/:amount', async (c) => {
    const { inputMint, outputMint, amount } = c.req.param();
    const quotes = await bot.getSolanaQuotes(inputMint, outputMint, amount);
    return c.json(quotes);
  });

  // Execute swap
  app.post('/swap', async (c) => {
    const body = await c.req.json();
    const result = await bot.executeSolanaSwap(
      body.inputMint,
      body.outputMint,
      body.amount
    );
    return c.json(result);
  });

  // Trade history
  app.get('/trades', (c) => {
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 100;
    const trades = bot.getTradeHistory(limit);
    return c.json(trades);
  });

  // Bot control
  app.post('/start', async (c) => {
    await bot.start();
    return c.json({ success: true, message: 'Bot started' });
  });

  app.post('/stop', async (c) => {
    await bot.stop();
    return c.json({ success: true, message: 'Bot stopped' });
  });

  return app;
}

// ============ A2A API ============

function createA2AAPI(bot: UnifiedBot, config: APIConfig): Hono {
  const app = new Hono();

  app.use('*', cors());

  // Agent card
  const agentCard: AgentCard = {
    name: 'unified-mev-lp-bot',
    description: 'Cross-chain MEV and liquidity management bot supporting EVM and Solana',
    url: `http://localhost:${config.a2aPort}`,
    version: '1.0.0',
    capabilities: [
      'arbitrage-detection',
      'cross-chain-arbitrage',
      'solana-arbitrage',
      'liquidity-management',
      'pool-analysis',
      'swap-execution',
    ],
    endpoints: {
      a2a: `http://localhost:${config.a2aPort}`,
      mcp: `http://localhost:${config.mcpPort}`,
      rest: `http://localhost:${config.restPort}`,
    },
  };

  // Well-known agent card
  app.get('/.well-known/agent-card.json', (c) => {
    return c.json(agentCard);
  });

  // Root info
  app.get('/', (c) => {
    return c.json({
      service: 'unified-bot-a2a',
      version: '1.0.0',
      agentCard: '/.well-known/agent-card.json',
    });
  });

  // A2A request handler
  app.post('/a2a', async (c) => {
    const body = await c.req.json();
    const { method, params } = body;

    switch (method) {
      case 'getStats':
        return c.json({ result: bot.getStats() });

      case 'getOpportunities':
        return c.json({ result: bot.getOpportunities() });

      case 'getPositions':
        return c.json({ result: bot.getLiquidityPositions() });

      case 'getPools':
        const pools = await bot.getPoolRecommendations(params);
        return c.json({ result: pools });

      case 'getRebalanceActions':
        const actions = await bot.getRebalanceActions();
        return c.json({ result: actions });

      case 'executeRebalance':
        const action = params as RebalanceAction;
        const result = await bot.executeRebalance(action);
        return c.json({ result });

      case 'getQuotes':
        const quotes = await bot.getSolanaQuotes(
          params.inputMint,
          params.outputMint,
          params.amount
        );
        return c.json({ result: quotes });

      case 'executeSwap':
        const swapResult = await bot.executeSolanaSwap(
          params.inputMint,
          params.outputMint,
          params.amount
        );
        return c.json({ result: swapResult });

      default:
        return c.json({ error: { code: -32601, message: 'Method not found' } }, 404);
    }
  });

  return app;
}

// ============ MCP API ============

function createMCPAPI(bot: UnifiedBot): Hono {
  const app = new Hono();

  app.use('*', cors());

  const tools: MCPTool[] = [
    {
      name: 'get_bot_stats',
      description: 'Get current bot statistics including profit, trades, and uptime',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_opportunities',
      description: 'Get current arbitrage opportunities across all chains',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_positions',
      description: 'Get all liquidity positions across EVM and Solana',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_pool_recommendations',
      description: 'Get pool recommendations for liquidity provision',
      inputSchema: {
        type: 'object',
        properties: {
          minTvl: { type: 'number', description: 'Minimum TVL in USD' },
          minApr: { type: 'number', description: 'Minimum APR percentage' },
        },
      },
    },
    {
      name: 'get_rebalance_actions',
      description: 'Get pending rebalance actions for liquidity optimization',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'execute_rebalance',
      description: 'Execute a specific rebalance action',
      inputSchema: {
        type: 'object',
        properties: {
          positionId: { type: 'string', description: 'Position ID to rebalance' },
        },
        required: ['positionId'],
      },
    },
    {
      name: 'get_swap_quotes',
      description: 'Get swap quotes from Solana DEXs',
      inputSchema: {
        type: 'object',
        properties: {
          inputMint: { type: 'string', description: 'Input token mint address' },
          outputMint: { type: 'string', description: 'Output token mint address' },
          amount: { type: 'string', description: 'Amount in base units' },
        },
        required: ['inputMint', 'outputMint', 'amount'],
      },
    },
    {
      name: 'execute_swap',
      description: 'Execute a swap on Solana',
      inputSchema: {
        type: 'object',
        properties: {
          inputMint: { type: 'string', description: 'Input token mint address' },
          outputMint: { type: 'string', description: 'Output token mint address' },
          amount: { type: 'string', description: 'Amount in base units' },
        },
        required: ['inputMint', 'outputMint', 'amount'],
      },
    },
    {
      name: 'add_liquidity',
      description: 'Add liquidity to a pool',
      inputSchema: {
        type: 'object',
        properties: {
          chain: { type: 'string', description: 'Chain (evm or solana)' },
          dex: { type: 'string', description: 'DEX name' },
          poolId: { type: 'string', description: 'Pool ID' },
          amountA: { type: 'string', description: 'Amount of token A' },
          amountB: { type: 'string', description: 'Amount of token B' },
        },
        required: ['chain', 'dex', 'poolId', 'amountA', 'amountB'],
      },
    },
    {
      name: 'get_trade_history',
      description: 'Get recent trade history',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of trades to return' },
        },
      },
    },
  ];

  const resources: MCPResource[] = [
    { uri: 'bot://stats', name: 'Bot Statistics', description: 'Current bot statistics', mimeType: 'application/json' },
    { uri: 'bot://opportunities', name: 'Opportunities', description: 'Current arbitrage opportunities', mimeType: 'application/json' },
    { uri: 'bot://positions', name: 'Positions', description: 'Liquidity positions', mimeType: 'application/json' },
    { uri: 'bot://pools', name: 'Pool Recommendations', description: 'Recommended pools for LP', mimeType: 'application/json' },
    { uri: 'bot://trades', name: 'Trade History', description: 'Recent trade history', mimeType: 'application/json' },
  ];

  // Root info
  app.get('/', (c) => {
    return c.json({
      server: 'unified-bot-mcp',
      version: '1.0.0',
      description: 'Cross-chain MEV and liquidity management bot',
      tools,
      resources,
      prompts: [
        {
          name: 'analyze_portfolio',
          description: 'Analyze the current portfolio and suggest optimizations',
          arguments: [],
        },
        {
          name: 'find_best_pool',
          description: 'Find the best pool for a given token pair',
          arguments: [
            { name: 'tokenA', description: 'First token symbol', required: true },
            { name: 'tokenB', description: 'Second token symbol', required: true },
          ],
        },
      ],
      capabilities: { resources: true, tools: true, prompts: true },
    });
  });

  // Tool execution
  app.post('/tools/:name', async (c) => {
    const { name } = c.req.param();
    const params = await c.req.json().catch(() => ({}));

    switch (name) {
      case 'get_bot_stats':
        return c.json({ result: bot.getStats() });

      case 'get_opportunities':
        return c.json({ result: bot.getOpportunities() });

      case 'get_positions':
        return c.json({ result: bot.getLiquidityPositions() });

      case 'get_pool_recommendations':
        const pools = await bot.getPoolRecommendations({
          minTvl: params.minTvl,
          minApr: params.minApr,
        });
        return c.json({ result: pools });

      case 'get_rebalance_actions':
        const actions = await bot.getRebalanceActions();
        return c.json({ result: actions });

      case 'execute_rebalance': {
        const actions = await bot.getRebalanceActions();
        const action = actions.find(a => a.positionId === params.positionId);
        if (!action) {
          return c.json({ error: 'Action not found' }, 404);
        }
        const result = await bot.executeRebalance(action);
        return c.json({ result });
      }

      case 'get_swap_quotes': {
        const quotes = await bot.getSolanaQuotes(
          params.inputMint,
          params.outputMint,
          params.amount
        );
        return c.json({ result: quotes });
      }

      case 'execute_swap': {
        const result = await bot.executeSolanaSwap(
          params.inputMint,
          params.outputMint,
          params.amount
        );
        return c.json({ result });
      }

      case 'add_liquidity': {
        const result = await bot.addLiquidity({
          chain: params.chain,
          dex: params.dex,
          poolId: params.poolId,
          amountA: params.amountA,
          amountB: params.amountB,
        });
        return c.json({ result });
      }

      case 'get_trade_history':
        return c.json({ result: bot.getTradeHistory(params.limit ?? 100) });

      default:
        return c.json({ error: 'Tool not found' }, 404);
    }
  });

  // Resource access
  app.get('/resources/:uri', async (c) => {
    const { uri } = c.req.param();
    const fullUri = `bot://${uri}`;

    switch (fullUri) {
      case 'bot://stats':
        return c.json(bot.getStats());
      case 'bot://opportunities':
        return c.json(bot.getOpportunities());
      case 'bot://positions':
        return c.json(bot.getLiquidityPositions());
      case 'bot://pools':
        return c.json(await bot.getPoolRecommendations());
      case 'bot://trades':
        return c.json(bot.getTradeHistory());
      default:
        return c.json({ error: 'Resource not found' }, 404);
    }
  });

  return app;
}

// ============ Start Server ============

export async function startBotAPIServer(config: APIConfig): Promise<void> {
  const { bot, restPort, a2aPort, mcpPort } = config;

  // Create APIs
  const restApp = createRestAPI(bot);
  const a2aApp = createA2AAPI(bot, config);
  const mcpApp = createMCPAPI(bot);

  // Start servers
  serve({ fetch: restApp.fetch, port: restPort });
  console.log(`📡 REST API running on http://localhost:${restPort}`);

  serve({ fetch: a2aApp.fetch, port: a2aPort });
  console.log(`📡 A2A Server running on http://localhost:${a2aPort}`);

  serve({ fetch: mcpApp.fetch, port: mcpPort });
  console.log(`📡 MCP Server running on http://localhost:${mcpPort}`);

  console.log(`
┌─────────────────────────────────────────┐
│     Unified Bot API Servers Running     │
├─────────────────────────────────────────┤
│  REST:    http://localhost:${restPort}         │
│  A2A:     http://localhost:${a2aPort}         │
│  MCP:     http://localhost:${mcpPort}         │
└─────────────────────────────────────────┘
`);
}

// ============ CLI Entry Point ============

export async function main(): Promise<void> {
  const botConfig: UnifiedBotConfig = {
    evmChains: [1, 42161, 10, 8453] as any[], // Ethereum, Arbitrum, Optimism, Base
    solanaNetwork: (process.env.SOLANA_NETWORK as 'mainnet-beta' | 'devnet' | 'localnet') ?? 'mainnet-beta',
    evmPrivateKey: process.env.EVM_PRIVATE_KEY,
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY,
    enableArbitrage: true,
    enableCrossChain: true,
    enableSolanaArb: true,
    enableLiquidity: true,
    enableSandwich: false, // Disabled by default
    enableLiquidation: false,
    enableSolver: false,
    minProfitBps: 50, // 0.5%
    maxPositionSize: BigInt(10e18), // 10 ETH
    maxSlippageBps: 100, // 1%
    maxGasPrice: BigInt(100e9), // 100 gwei
  };

  const bot = new UnifiedBot(botConfig);
  await bot.initialize();
  await bot.start();

  const apiConfig: APIConfig = {
    restPort: parseInt(process.env.BOT_REST_PORT ?? '4020'),
    a2aPort: parseInt(process.env.BOT_A2A_PORT ?? '4021'),
    mcpPort: parseInt(process.env.BOT_MCP_PORT ?? '4022'),
    bot,
  };

  await startBotAPIServer(apiConfig);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await bot.stop();
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.path === Bun.main) {
  main().catch(console.error);
}
