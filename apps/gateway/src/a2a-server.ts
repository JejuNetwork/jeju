import { getProviderInfo } from '@jejunetwork/shared'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { type Address, isAddress } from 'viem'
import {
  getChainName,
  IS_TESTNET,
  JEJU_CHAIN_ID,
  PORTS,
} from './config/networks.js'
import {
  estimateYield,
  getDefaultStrategy,
  getLiquidityRouterAddress,
  getRiskSleeveAddress,
  getRiskTiers,
  getRouterPosition,
  getSleevePosition,
  getSleeveStats,
  RiskTier,
} from './lib/liquidity-api.js'
import {
  checkBanStatus,
  getAgentLabels,
  getModerationCase,
  getModerationCases,
  getModerationStats,
  getModeratorProfile,
  getReports,
  prepareAppealTransaction,
  prepareChallengeTransaction,
  prepareReportTransaction,
  prepareStakeTransaction,
  prepareVoteTransaction,
} from './lib/moderation-api.js'
import {
  A2ARequestSchema,
  AgentIdSchema,
  CancelIntentRequestSchema,
  CaseIdSchema,
  CheckBanStatusRequestSchema,
  CreateIntentRequestSchema,
  expect,
  expectAddress,
  expectChainId,
  FaucetClaimRequestSchema,
  FaucetStatusRequestSchema,
  GetBestRouteRequestSchema,
  GetModerationCasesQuerySchema,
  GetModeratorProfileRequestSchema,
  GetQuoteRequestSchema,
  GetReportsQuerySchema,
  GetVolumeQuerySchema,
  IntentIdSchema,
  ListIntentsQuerySchema,
  ListPoolsQuerySchema,
  ListRoutesQuerySchema,
  ListSolversQuerySchema,
  McpResourceReadRequestSchema,
  McpToolCallRequestSchema,
  PrepareAppealRequestSchema,
  PrepareChallengeRequestSchema,
  PrepareReportRequestSchema,
  PrepareStakeRequestSchema,
  PrepareVoteRequestSchema,
  RouteIdSchema,
  SolverLeaderboardQuerySchema,
  SwapQuoteRequestSchema,
  TokenPairSchema,
  toResponseData,
  validateBody,
  validateQuery,
} from './lib/validation.js'
import {
  checkPayment,
  createPaymentRequirement,
  PAYMENT_TIERS,
  type PaymentRequirements,
} from './lib/x402.js'
import { banCheck } from './middleware/ban-check.js'
import {
  agentRateLimit,
  rateLimit,
  strictRateLimit,
} from './middleware/rate-limit.js'
import {
  createApiKey,
  getApiKeysForAddress,
  RATE_LIMITS,
  CHAINS as RPC_CHAINS,
} from './rpc/index.js'
import { faucetService } from './services/faucet-service.js'
import { intentService } from './services/intent-service.js'
import {
  type PaymasterPool,
  poolService,
  type V2Pool,
} from './services/pool-service.js'
import { routeService } from './services/route-service.js'
import { solverService } from './services/solver-service.js'
import { getWebSocketServer } from './services/websocket.js'

const app = express()
const PORT = PORTS.a2a
const WS_PORT = PORTS.websocket
// Only env var needed: payment recipient address (optional)
const PAYMENT_RECIPIENT = (process.env.GATEWAY_PAYMENT_RECIPIENT ||
  '0x0000000000000000000000000000000000000000') as Address

// SECURITY: Configure CORS based on environment
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'
const corsOptions =
  isProduction && CORS_ORIGINS?.length ? { origin: CORS_ORIGINS } : {}

app.use(cors(corsOptions))
// SECURITY: Limit request body size to prevent DoS attacks
app.use(express.json({ limit: '1mb' }))
app.use(rateLimit())
app.use(banCheck({ skipPaths: ['/health', '/.well-known', '/public', '/a2a'] })) // Ban check for API routes

const GATEWAY_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Gateway Portal - Protocol Infrastructure Hub',
  description:
    'Multi-token paymaster system, node staking, app registry, cross-chain intents, and protocol infrastructure',
  url: `http://localhost:${PORT}/a2a`,
  preferredTransport: 'http',
  provider: getProviderInfo(),
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: true,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Protocol Infrastructure
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
      description: 'Find apps by category tag',
      tags: ['query', 'registry', 'discovery'],
      examples: ['Show me games', 'List marketplaces'],
    },
    // Cross-Chain Intents
    {
      id: 'create-intent',
      name: 'Create Cross-Chain Intent',
      description: 'Create a new intent for cross-chain swap/transfer',
      tags: ['intents', 'create', 'swap', 'bridge'],
      examples: ['Swap 1 ETH on Ethereum for USDC on Arbitrum'],
    },
    {
      id: 'get-quote',
      name: 'Get Intent Quote',
      description: 'Get best price quote for an intent from active solvers',
      tags: ['quote', 'pricing', 'intents'],
      examples: ['Quote for 1 ETH to USDC cross-chain'],
    },
    {
      id: 'track-intent',
      name: 'Track Intent Status',
      description: 'Get current status and execution details of an intent',
      tags: ['intents', 'status', 'tracking'],
      examples: ['Check status of intent 0x...'],
    },
    {
      id: 'cancel-intent',
      name: 'Cancel Intent',
      description: 'Cancel an open intent before solver claims',
      tags: ['intents', 'cancel'],
      examples: ['Cancel my pending intent'],
    },
    {
      id: 'list-routes',
      name: 'List Available Routes',
      description: 'Get all supported cross-chain routes',
      tags: ['routes', 'discovery'],
      examples: ['What chains can I bridge to?'],
    },
    {
      id: 'get-best-route',
      name: 'Get Best Route',
      description: 'Find optimal route for a specific swap',
      tags: ['routes', 'optimization'],
      examples: ['Best route for ETH to USDC'],
    },
    {
      id: 'list-solvers',
      name: 'List Active Solvers',
      description: 'Get all active solvers with reputation and liquidity',
      tags: ['solvers', 'liquidity'],
      examples: ['Show active solvers'],
    },
    {
      id: 'get-solver-liquidity',
      name: 'Get Solver Liquidity',
      description: 'Check available liquidity for a specific solver',
      tags: ['solvers', 'liquidity'],
      examples: ['Check solver 0x... liquidity'],
    },
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
      examples: ['Volume on Ethereum to Arbitrum route'],
    },
    // XLP Pools
    {
      id: 'list-v2-pools',
      name: 'List V2 Pools',
      description: 'Get all XLP V2 constant-product AMM pools',
      tags: ['pools', 'v2', 'query'],
      examples: ['Show V2 pools', 'List XLP pairs'],
    },
    {
      id: 'list-v3-pools',
      name: 'List V3 Pools',
      description: 'Get all XLP V3 concentrated liquidity pools',
      tags: ['pools', 'v3', 'query'],
      examples: ['Show V3 pools', 'List concentrated liquidity'],
    },
    {
      id: 'get-pool-reserves',
      name: 'Get Pool Reserves',
      description: 'Get reserves for a specific pool',
      tags: ['pools', 'reserves', 'query'],
      examples: ['ETH/USDC reserves', 'Pool reserves'],
    },
    {
      id: 'get-swap-quote',
      name: 'Get Swap Quote',
      description: 'Get best swap quote across V2, V3, and Paymaster AMM',
      tags: ['pools', 'swap', 'quote'],
      examples: ['Quote 1 ETH to USDC', 'Best swap route'],
    },
    {
      id: 'get-all-swap-quotes',
      name: 'Get All Swap Quotes',
      description: 'Get quotes from all liquidity sources',
      tags: ['pools', 'swap', 'quotes'],
      examples: ['Compare all swap routes'],
    },
    {
      id: 'get-pool-stats',
      name: 'Get Pool Statistics',
      description: 'Get aggregated XLP pool statistics',
      tags: ['pools', 'stats', 'analytics'],
      examples: ['Pool TVL', 'XLP stats'],
    },
    {
      id: 'list-pools-for-pair',
      name: 'List Pools for Pair',
      description: 'Get all pools (V2/V3/Paymaster) for a token pair',
      tags: ['pools', 'discovery'],
      examples: ['All ETH/USDC pools', 'Available liquidity for pair'],
    },
    // Moderation & Governance
    {
      id: 'check-ban-status',
      name: 'Check Ban Status',
      description: 'Check if an address is banned or on notice',
      tags: ['moderation', 'ban', 'query'],
      examples: ['Is 0x... banned?', 'Check my ban status'],
    },
    {
      id: 'get-moderator-profile',
      name: 'Get Moderator Profile',
      description:
        'Get full moderator profile including reputation, P&L, and voting power',
      tags: ['moderation', 'reputation', 'query'],
      examples: ['My moderator stats', 'Show reputation for 0x...'],
    },
    {
      id: 'get-moderation-cases',
      name: 'Get Moderation Cases',
      description: 'List all moderation cases with voting status',
      tags: ['moderation', 'governance', 'query'],
      examples: ['Show active cases', 'List pending bans'],
    },
    {
      id: 'get-moderation-case',
      name: 'Get Case Details',
      description: 'Get full details of a specific moderation case',
      tags: ['moderation', 'query'],
      examples: ['Show case 0x...', 'Case details'],
    },
    {
      id: 'get-reports',
      name: 'Get Reports',
      description: 'List submitted reports with status',
      tags: ['moderation', 'reports', 'query'],
      examples: ['Show pending reports', 'List all reports'],
    },
    {
      id: 'get-agent-labels',
      name: 'Get Agent Labels',
      description:
        'Get reputation labels for an agent (HACKER, SCAMMER, TRUSTED)',
      tags: ['moderation', 'labels', 'query'],
      examples: ['What labels does agent #123 have?'],
    },
    {
      id: 'get-moderation-stats',
      name: 'Get Moderation Stats',
      description: 'Get system-wide moderation statistics',
      tags: ['moderation', 'analytics', 'query'],
      examples: ['Moderation stats', 'How many bans?'],
    },
    {
      id: 'prepare-moderation-stake',
      name: 'Prepare Moderation Stake',
      description: 'Prepare transaction to stake and become a moderator',
      tags: ['moderation', 'stake', 'action'],
      examples: ['Stake 0.1 ETH for moderation'],
    },
    {
      id: 'prepare-report',
      name: 'Prepare Report',
      description: 'Prepare transaction to report a user',
      tags: ['moderation', 'report', 'action'],
      examples: ['Report 0x... for scamming'],
    },
    {
      id: 'prepare-vote',
      name: 'Prepare Vote',
      description: 'Prepare transaction to vote on a moderation case',
      tags: ['moderation', 'vote', 'action'],
      examples: ['Vote BAN on case 0x...'],
    },
    {
      id: 'prepare-challenge',
      name: 'Prepare Challenge',
      description: 'Prepare transaction to challenge a ban',
      tags: ['moderation', 'challenge', 'action'],
      examples: ['Challenge my ban'],
    },
    {
      id: 'prepare-appeal',
      name: 'Prepare Appeal',
      description: 'Prepare transaction to appeal a resolved ban',
      tags: ['moderation', 'appeal', 'action'],
      examples: ['Appeal case 0x...'],
    },
    // RPC Gateway
    {
      id: 'rpc-list-chains',
      name: 'List RPC Chains',
      description: 'Get all supported blockchain networks',
      tags: ['rpc', 'chains', 'query'],
      examples: ['What chains are supported?', 'List RPC endpoints'],
    },
    {
      id: 'rpc-get-limits',
      name: 'Check RPC Limits',
      description: 'Check rate limits and tier for an address',
      tags: ['rpc', 'limits', 'query'],
      examples: ['What are my RPC limits?', 'Check rate limit for 0x...'],
    },
    {
      id: 'rpc-get-usage',
      name: 'Get RPC Usage',
      description: 'Get usage statistics for an address',
      tags: ['rpc', 'usage', 'query'],
      examples: ['Show my RPC usage', 'How many requests have I made?'],
    },
    {
      id: 'rpc-create-key',
      name: 'Create API Key',
      description: 'Generate a new RPC API key',
      tags: ['rpc', 'apikey', 'action'],
      examples: ['Create new API key', 'Generate RPC key'],
    },
    {
      id: 'rpc-staking-info',
      name: 'RPC Staking Info',
      description: 'Get staking tiers and requirements',
      tags: ['rpc', 'staking', 'query'],
      examples: ['How do I get higher rate limits?', 'RPC staking tiers'],
    },
    // Risk-Based Liquidity
    {
      id: 'get-risk-tiers',
      name: 'Get Risk Tiers',
      description:
        'Get available risk tiers (Conservative, Balanced, Aggressive) with expected APYs',
      tags: ['liquidity', 'risk', 'query'],
      examples: ['Show risk tiers', 'What yield options exist?'],
    },
    {
      id: 'get-sleeve-stats',
      name: 'Get Sleeve Stats',
      description: 'Get statistics for a specific risk sleeve tier',
      tags: ['liquidity', 'risk', 'stats'],
      examples: ['Conservative sleeve stats', 'Aggressive pool TVL'],
    },
    {
      id: 'get-sleeve-position',
      name: 'Get My Sleeve Position',
      description: 'Get your deposits and pending yield in a risk sleeve',
      tags: ['liquidity', 'position', 'query'],
      examples: ['My conservative position', 'Check my sleeve deposits'],
    },
    {
      id: 'prepare-sleeve-deposit',
      name: 'Deposit to Risk Sleeve',
      description: 'Prepare transaction to deposit ETH into a risk sleeve',
      tags: ['liquidity', 'deposit', 'action'],
      examples: ['Deposit 1 ETH to balanced sleeve', 'Add to aggressive pool'],
    },
    {
      id: 'prepare-sleeve-withdraw',
      name: 'Withdraw from Risk Sleeve',
      description: 'Prepare transaction to withdraw from a risk sleeve',
      tags: ['liquidity', 'withdraw', 'action'],
      examples: ['Withdraw from conservative', 'Exit aggressive sleeve'],
    },
    {
      id: 'get-allocation-strategy',
      name: 'Get Allocation Strategy',
      description: 'Get the default liquidity allocation strategy',
      tags: ['liquidity', 'strategy', 'query'],
      examples: ['Default allocation', 'How is liquidity distributed?'],
    },
    {
      id: 'estimate-yield',
      name: 'Estimate Yield',
      description: 'Estimate yearly yield based on current allocations',
      tags: ['liquidity', 'yield', 'query'],
      examples: ['Expected yearly yield', 'Estimate my returns'],
    },
    // Faucet (testnet only - added dynamically)
  ].concat(
    IS_TESTNET
      ? [
          {
            id: 'faucet-status',
            name: 'Check Faucet Status',
            description: 'Check eligibility and cooldown for JEJU faucet',
            tags: ['faucet', 'query'],
            examples: ['Am I eligible for faucet?', 'Check my faucet status'],
          },
          {
            id: 'faucet-claim',
            name: 'Claim from Faucet',
            description:
              'Claim JEJU tokens from testnet faucet (requires ERC-8004 registration)',
            tags: ['faucet', 'claim', 'action'],
            examples: ['Claim JEJU from faucet', 'Get testnet tokens'],
          },
          {
            id: 'faucet-info',
            name: 'Get Faucet Info',
            description: 'Get faucet configuration and requirements',
            tags: ['faucet', 'info', 'query'],
            examples: ['Faucet info', 'How does faucet work?'],
          },
        ]
      : [],
  ),
}

const MCP_SERVER_INFO = {
  name: 'jeju-gateway',
  version: '1.0.0',
  description:
    'Gateway Portal - Protocol infrastructure and cross-chain intents',
  capabilities: { resources: true, tools: true, prompts: false },
}

const MCP_RESOURCES = [
  // Intent Framework
  {
    uri: 'oif://routes',
    name: 'Intent Routes',
    description: 'All available cross-chain routes',
    mimeType: 'application/json',
  },
  {
    uri: 'oif://solvers',
    name: 'Active Solvers',
    description: 'All registered solvers with reputation',
    mimeType: 'application/json',
  },
  {
    uri: 'oif://intents/recent',
    name: 'Recent Intents',
    description: 'Last 100 intents across all chains',
    mimeType: 'application/json',
  },
  {
    uri: 'oif://stats',
    name: 'OIF Statistics',
    description: 'Global intent framework statistics',
    mimeType: 'application/json',
  },
  // XLP Pools
  {
    uri: 'xlp://pools/v2',
    name: 'V2 Pools',
    description: 'All XLP V2 constant-product AMM pools',
    mimeType: 'application/json',
  },
  {
    uri: 'xlp://pools/v3',
    name: 'V3 Pools',
    description:
      'All XLP V3 concentrated liquidity pools (not directly enumerable)',
    mimeType: 'application/json',
  },
  {
    uri: 'xlp://pools/stats',
    name: 'Pool Statistics',
    description: 'Aggregated XLP pool statistics',
    mimeType: 'application/json',
  },
  {
    uri: 'xlp://tokens',
    name: 'Supported Tokens',
    description: 'Tokens available for XLP swaps',
    mimeType: 'application/json',
  },
  {
    uri: 'xlp://contracts',
    name: 'Contract Addresses',
    description: 'XLP contract deployment addresses',
    mimeType: 'application/json',
  },
  // Moderation & Governance
  {
    uri: 'moderation://cases',
    name: 'Moderation Cases',
    description: 'All active and recent moderation cases',
    mimeType: 'application/json',
  },
  {
    uri: 'moderation://cases/active',
    name: 'Active Cases',
    description: 'Cases currently open for voting',
    mimeType: 'application/json',
  },
  {
    uri: 'moderation://reports',
    name: 'Reports',
    description: 'All submitted moderation reports',
    mimeType: 'application/json',
  },
  {
    uri: 'moderation://stats',
    name: 'Moderation Stats',
    description: 'System-wide moderation statistics',
    mimeType: 'application/json',
  },
  // Risk-Based Liquidity
  {
    uri: 'risk://tiers',
    name: 'Risk Tiers',
    description: 'Available risk tiers with expected yields',
    mimeType: 'application/json',
  },
  {
    uri: 'risk://stats',
    name: 'Risk Sleeve Stats',
    description: 'Aggregated statistics across all risk sleeves',
    mimeType: 'application/json',
  },
  {
    uri: 'risk://allocations',
    name: 'Allocation Strategies',
    description: 'Available liquidity allocation strategies',
    mimeType: 'application/json',
  },
  // Faucet (testnet only - added dynamically)
].concat(
  IS_TESTNET
    ? [
        {
          uri: 'faucet://info',
          name: 'Faucet Info',
          description: 'Faucet configuration and requirements',
          mimeType: 'application/json',
        },
      ]
    : [],
)

const MCP_TOOLS = [
  // Intent Tools
  {
    name: 'create_intent',
    description: 'Create a cross-chain swap intent',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'number' },
        destinationChain: { type: 'number' },
        sourceToken: { type: 'string' },
        destinationToken: { type: 'string' },
        amount: { type: 'string' },
        recipient: { type: 'string' },
        maxFee: { type: 'string' },
      },
      required: [
        'sourceChain',
        'destinationChain',
        'sourceToken',
        'destinationToken',
        'amount',
      ],
    },
  },
  {
    name: 'get_quote',
    description: 'Get best price quote for an intent',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'number' },
        destinationChain: { type: 'number' },
        sourceToken: { type: 'string' },
        destinationToken: { type: 'string' },
        amount: { type: 'string' },
      },
      required: [
        'sourceChain',
        'destinationChain',
        'sourceToken',
        'destinationToken',
        'amount',
      ],
    },
  },
  {
    name: 'track_intent',
    description: 'Track the status of an intent',
    inputSchema: {
      type: 'object',
      properties: { intentId: { type: 'string' } },
      required: ['intentId'],
    },
  },
  {
    name: 'list_routes',
    description: 'List all available cross-chain routes',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'number' },
        destinationChain: { type: 'number' },
      },
    },
  },
  {
    name: 'list_solvers',
    description: 'List all active solvers',
    inputSchema: {
      type: 'object',
      properties: {
        chainId: { type: 'number' },
        minReputation: { type: 'number' },
      },
    },
  },
  // XLP Pool Tools
  {
    name: 'list_v2_pools',
    description: 'List all XLP V2 pools',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pool_reserves',
    description: 'Get reserves for a token pair across all pool types',
    inputSchema: {
      type: 'object',
      properties: {
        token0: { type: 'string', description: 'First token address' },
        token1: { type: 'string', description: 'Second token address' },
      },
      required: ['token0', 'token1'],
    },
  },
  {
    name: 'get_swap_quote',
    description: 'Get best swap quote from all liquidity sources',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token address' },
        tokenOut: { type: 'string', description: 'Output token address' },
        amountIn: {
          type: 'string',
          description: 'Amount to swap (in ether units)',
        },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  {
    name: 'get_all_swap_quotes',
    description: 'Get quotes from all liquidity sources',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token address' },
        tokenOut: { type: 'string', description: 'Output token address' },
        amountIn: {
          type: 'string',
          description: 'Amount to swap (in ether units)',
        },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  {
    name: 'get_pool_stats',
    description: 'Get aggregated XLP pool statistics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_pools_for_pair',
    description: 'List all pools for a token pair',
    inputSchema: {
      type: 'object',
      properties: { token0: { type: 'string' }, token1: { type: 'string' } },
      required: ['token0', 'token1'],
    },
  },
  // Moderation Tools
  {
    name: 'check_ban_status',
    description: 'Check if an address is banned',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address to check' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_moderator_profile',
    description: 'Get moderator profile with reputation and P&L',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Moderator address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_moderation_cases',
    description: 'List moderation cases',
    inputSchema: {
      type: 'object',
      properties: {
        activeOnly: { type: 'boolean' },
        resolvedOnly: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_moderation_case',
    description: 'Get details of a specific case',
    inputSchema: {
      type: 'object',
      properties: { caseId: { type: 'string' } },
      required: ['caseId'],
    },
  },
  {
    name: 'get_reports',
    description: 'List submitted reports',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        pendingOnly: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_agent_labels',
    description: 'Get labels for an agent',
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'number' } },
      required: ['agentId'],
    },
  },
  {
    name: 'get_moderation_stats',
    description: 'Get system-wide moderation statistics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'prepare_stake',
    description: 'Prepare moderation stake transaction',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'ETH amount to stake' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'prepare_report',
    description: 'Prepare report transaction',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        reason: { type: 'string' },
        evidenceHash: { type: 'string' },
      },
      required: ['target', 'reason', 'evidenceHash'],
    },
  },
  {
    name: 'prepare_vote',
    description: 'Prepare vote transaction',
    inputSchema: {
      type: 'object',
      properties: { caseId: { type: 'string' }, voteYes: { type: 'boolean' } },
      required: ['caseId', 'voteYes'],
    },
  },
  {
    name: 'prepare_challenge',
    description: 'Prepare challenge transaction',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        stakeAmount: { type: 'string' },
      },
      required: ['caseId', 'stakeAmount'],
    },
  },
  {
    name: 'prepare_appeal',
    description: 'Prepare appeal transaction',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        stakeAmount: { type: 'string' },
      },
      required: ['caseId', 'stakeAmount'],
    },
  },
  // Risk Sleeve & Liquidity Router Tools
  {
    name: 'get_risk_tiers',
    description:
      'Get available risk tiers (Conservative, Balanced, Aggressive) with expected APYs',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_sleeve_stats',
    description:
      'Get statistics for a risk tier (deposited, utilized, available, yield)',
    inputSchema: {
      type: 'object',
      properties: {
        tier: {
          type: 'number',
          description: 'Risk tier: 0=Conservative, 1=Balanced, 2=Aggressive',
        },
      },
      required: ['tier'],
    },
  },
  {
    name: 'get_sleeve_position',
    description: 'Get user position in a risk sleeve',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' }, tier: { type: 'number' } },
      required: ['address', 'tier'],
    },
  },
  {
    name: 'prepare_sleeve_deposit',
    description: 'Prepare transaction to deposit ETH into a risk sleeve',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'ETH amount to deposit' },
        tier: {
          type: 'number',
          description: 'Risk tier: 0=Conservative, 1=Balanced, 2=Aggressive',
        },
      },
      required: ['amount', 'tier'],
    },
  },
  {
    name: 'prepare_sleeve_withdraw',
    description: 'Prepare transaction to withdraw from a risk sleeve',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'ETH amount to withdraw' },
        tier: { type: 'number', description: 'Risk tier' },
      },
      required: ['amount', 'tier'],
    },
  },
  {
    name: 'get_allocation_strategy',
    description: 'Get default liquidity allocation strategy',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'prepare_router_deposit',
    description:
      'Prepare transaction to deposit via liquidity router with custom strategy',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        strategy: {
          type: 'object',
          properties: {
            ethVaultBps: { type: 'number' },
            tokenVaultBps: { type: 'number' },
            nodeStakeBps: { type: 'number' },
            xlpStakeBps: { type: 'number' },
          },
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'get_router_position',
    description: 'Get user position in the liquidity router',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
  },
  {
    name: 'estimate_yield',
    description: 'Estimate yearly yield for an address',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
  },
  // Faucet Tools (testnet only - added dynamically)
].concat(
  IS_TESTNET
    ? [
        {
          name: 'faucet_status',
          description: 'Check faucet eligibility and cooldown for an address',
          inputSchema: {
            type: 'object',
            properties: {
              address: {
                type: 'string',
                description: 'Wallet address to check',
              },
            },
            required: ['address'],
          },
        },
        {
          name: 'faucet_claim',
          description:
            'Claim JEJU tokens from faucet (requires ERC-8004 registration)',
          inputSchema: {
            type: 'object',
            properties: {
              address: {
                type: 'string',
                description: 'Wallet address to receive tokens',
              },
            },
            required: ['address'],
          },
        },
        {
          name: 'faucet_info',
          description: 'Get faucet configuration and requirements',
          inputSchema: { type: 'object', properties: {} },
        },
      ]
    : [],
)

import type { A2ARequest, JsonValue } from './lib/validation.js'

/**
 * Result of executing an A2A skill.
 * The data field accepts any object that can be JSON-serialized.
 */
interface SkillResult {
  message: string
  /** Skill result data - must be JSON-serializable (serialized in response handler) */
  data: object
  requiresPayment?: PaymentRequirements
}

async function executeSkill(
  skillId: string,
  params: Record<string, JsonValue>,
  paymentHeader: string | null,
): Promise<SkillResult> {
  switch (skillId) {
    case 'list-protocol-tokens':
      return {
        message: 'Protocol tokens: elizaOS, CLANKER, VIRTUAL, CLANKERMON',
        data: {
          tokens: [
            { symbol: 'elizaOS', hasPaymaster: true },
            { symbol: 'CLANKER', hasPaymaster: true },
            { symbol: 'VIRTUAL', hasPaymaster: true },
            { symbol: 'CLANKERMON', hasPaymaster: true },
          ],
        },
      }
    case 'get-node-stats':
      return {
        message: 'Node statistics available via NodeStakingManager contract',
        data: {
          note: 'Query NodeStakingManager.getNetworkStats() for live data',
        },
      }
    case 'list-nodes':
      return {
        message: 'Node listing available',
        data: { note: 'Query NodeStakingManager for registered nodes' },
      }
    case 'list-registered-apps':
      return {
        message: 'App registry available',
        data: {
          note: 'Query IdentityRegistry.getAllAgents() for registered apps',
        },
      }
    case 'get-app-by-tag':
      return {
        message: 'App discovery by tag available',
        data: { note: 'Provide tag parameter to filter apps' },
      }
    case 'deploy-paymaster': {
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.PAYMASTER_DEPLOYMENT,
        PAYMENT_RECIPIENT,
      )
      if (!paymentCheck.paid)
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/a2a',
            PAYMENT_TIERS.PAYMASTER_DEPLOYMENT,
            'Paymaster deployment fee',
            PAYMENT_RECIPIENT,
          ),
        }
      return {
        message: 'Paymaster deployment authorized',
        data: {
          token: params.token,
          fee: PAYMENT_TIERS.PAYMASTER_DEPLOYMENT.toString(),
        },
      }
    }
    case 'add-liquidity': {
      const validated = expect(
        params,
        CreateIntentRequestSchema,
        'add-liquidity params',
      )
      const intent = await intentService.createIntent({
        ...validated,
        sourceToken: validated.sourceToken as Address,
        destinationToken: validated.destinationToken as Address,
        recipient: validated.recipient as Address | undefined,
      })
      return {
        message: `Intent created successfully. ID: ${intent.intentId}`,
        data: { intent },
      }
    }
    case 'track-intent': {
      const intentId = expect(
        params.intentId,
        IntentIdSchema,
        'track-intent intentId',
      )
      const intent = await intentService.getIntent(intentId)
      if (!intent) {
        throw new Error(`Intent not found: ${intentId}`)
      }
      return {
        message: `Intent ${intentId} status: ${intent.status}`,
        data: intent,
      }
    }
    case 'cancel-intent': {
      if (!params.intentId || !params.user) {
        throw new Error('intentId and user required')
      }
      const intentId = expect(
        params.intentId,
        IntentIdSchema,
        'cancel-intent intentId',
      )
      const user = expectAddress(params.user, 'cancel-intent user')
      const result = await intentService.cancelIntent(intentId, user)
      return {
        message: result.success
          ? 'Intent cancelled successfully'
          : result.message,
        data: result,
      }
    }
    case 'list-routes': {
      const routes = await routeService.listRoutes()
      return {
        message: `Found ${routes.length} active routes`,
        data: { routes, totalRoutes: routes.length },
      }
    }
    case 'get-best-route': {
      if (!params.sourceChain || !params.destinationChain) {
        throw new Error('sourceChain and destinationChain required')
      }
      const validated = expect(
        params,
        GetBestRouteRequestSchema,
        'get-best-route params',
      )
      const route = await routeService.getBestRoute(validated)
      if (!route) {
        throw new Error('No route available')
      }
      return {
        message: `Best route found via ${route.oracle}`,
        data: { route },
      }
    }
    case 'list-solvers': {
      const validated =
        params && Object.keys(params).length > 0
          ? expect(params, ListSolversQuerySchema, 'list-solvers params')
          : undefined
      const solvers = await solverService.listSolvers(validated)
      return {
        message: `${solvers.length} active solvers`,
        data: { solvers, activeSolvers: solvers.length },
      }
    }
    case 'get-solver-liquidity': {
      const solver = expectAddress(params.solver, 'get-solver-liquidity solver')
      const liquidity = await solverService.getSolverLiquidity(solver)
      return {
        message: `Solver ${solver.slice(0, 10)}... liquidity retrieved`,
        data: { solver, liquidity },
      }
    }
    case 'get-stats': {
      const stats = await intentService.getStats()
      return {
        message: `OIF Stats: ${stats.totalIntents} intents, $${stats.totalVolumeUsd} volume`,
        data: stats,
      }
    }
    case 'get-volume': {
      const validated =
        params && Object.keys(params).length > 0
          ? expect(params, GetVolumeQuerySchema, 'get-volume params')
          : {}
      const volume = await routeService.getVolume(validated)
      return {
        message: `Route volume: $${volume.totalVolumeUsd}`,
        data: volume,
      }
    }
    // XLP Pool Skills
    case 'list-v2-pools': {
      const pools = await poolService.listV2Pools()
      return {
        message: `Found ${pools.length} V2 pools`,
        data: { pools, count: pools.length },
      }
    }
    case 'list-v3-pools': {
      const validated = expect(
        params,
        TokenPairSchema,
        'get-pool-reserves params',
      )
      const pools = await poolService.listPoolsForPair(
        validated.token0 as Address,
        validated.token1 as Address,
      )
      const totalReserve0 = pools.reduce(
        (sum, p) =>
          sum +
          Number(
            p.type === 'V2'
              ? (p as V2Pool).reserve0
              : p.type === 'PAYMASTER'
                ? (p as PaymasterPool).reserve0
                : '0',
          ),
        0,
      )
      const totalReserve1 = pools.reduce(
        (sum, p) =>
          sum +
          Number(
            p.type === 'V2'
              ? (p as V2Pool).reserve1
              : p.type === 'PAYMASTER'
                ? (p as PaymasterPool).reserve1
                : '0',
          ),
        0,
      )
      return {
        message: `Found ${pools.length} pools with reserves`,
        data: {
          pools,
          aggregatedReserves: {
            reserve0: totalReserve0.toString(),
            reserve1: totalReserve1.toString(),
          },
        },
      }
    }
    case 'get-swap-quote': {
      const validated = expect(
        params,
        SwapQuoteRequestSchema,
        'get-swap-quote params',
      )
      const quote = await poolService.getSwapQuote(
        validated.tokenIn as Address,
        validated.tokenOut as Address,
        validated.amountIn,
      )
      if (!quote) {
        throw new Error(
          `No liquidity available for swap: ${validated.tokenIn} -> ${validated.tokenOut}`,
        )
      }
      return {
        message: `Best quote: ${validated.amountIn} → ${quote.amountOut} via ${quote.poolType} pool (${quote.priceImpactBps / 100}% impact)`,
        data: { quote },
      }
    }
    case 'get-all-swap-quotes': {
      const validated = expect(
        params,
        SwapQuoteRequestSchema,
        'get-all-swap-quotes params',
      )
      const quotes = await poolService.getAllSwapQuotes(
        validated.tokenIn as Address,
        validated.tokenOut as Address,
        validated.amountIn,
      )
      return {
        message: `Found ${quotes.length} quotes`,
        data: { quotes, bestQuote: quotes[0] },
      }
    }
    case 'list-pools-for-pair': {
      const validated = expect(
        params,
        TokenPairSchema,
        'list-pools-for-pair params',
      )
      const pools = await poolService.listPoolsForPair(
        validated.token0 as Address,
        validated.token1 as Address,
      )
      return {
        message: `Found ${pools.length} pools for pair`,
        data: {
          pools,
          v2Count: pools.filter((p) => p.type === 'V2').length,
          v3Count: pools.filter((p) => p.type === 'V3').length,
          paymasterAvailable: pools.some((p) => p.type === 'PAYMASTER'),
        },
      }
    }
    case 'check-ban-status': {
      const validated = expect(
        params,
        CheckBanStatusRequestSchema,
        'check-ban-status params',
      )
      const status = await checkBanStatus(validated.address as Address)
      return {
        message: status.isBanned
          ? `Address is ${status.isOnNotice ? 'on notice' : 'banned'}: ${status.reason}`
          : 'Address is not banned',
        data: toResponseData(status),
      }
    }
    case 'get-moderator-profile': {
      const validated = expect(
        params,
        GetModeratorProfileRequestSchema,
        'get-moderator-profile params',
      )
      const profile = await getModeratorProfile(validated.address as Address)
      if (!profile) {
        throw new Error(
          `Moderator profile not found for address: ${validated.address}`,
        )
      }
      return {
        message: `${profile.tier} tier moderator with ${profile.winRate}% win rate and ${profile.netPnL} ETH P&L`,
        data: toResponseData(profile),
      }
    }
    case 'get-moderation-cases': {
      const validated =
        params && Object.keys(params).length > 0
          ? expect(
              params,
              GetModerationCasesQuerySchema,
              'get-moderation-cases params',
            )
          : {}
      const cases = await getModerationCases(validated)
      return {
        message: `Found ${cases.length} moderation cases`,
        data: { cases, count: cases.length },
      }
    }
    case 'get-moderation-case': {
      const caseId = expect(
        params.caseId,
        CaseIdSchema,
        'get-moderation-case caseId',
      )
      const caseData = await getModerationCase(caseId)
      if (!caseData) {
        throw new Error(`Moderation case not found: ${caseId}`)
      }
      return {
        message: `Case ${caseData.status}: ${caseData.target.slice(0, 10)}... - ${caseData.reason.slice(0, 50)}`,
        data: toResponseData(caseData),
      }
    }
    case 'get-reports': {
      const validated =
        params && Object.keys(params).length > 0
          ? expect(params, GetReportsQuerySchema, 'get-reports params')
          : {}
      const reports = await getReports(validated)
      return {
        message: `Found ${reports.length} reports`,
        data: { reports, count: reports.length },
      }
    }
    case 'get-agent-labels': {
      const agentId = expect(
        params.agentId,
        AgentIdSchema,
        'get-agent-labels agentId',
      )
      const labels = await getAgentLabels(agentId)
      return {
        message:
          labels.labels.length > 0
            ? `Agent has labels: ${labels.labels.join(', ')}`
            : 'Agent has no labels',
        data: toResponseData(labels),
      }
    }
    case 'get-moderation-stats': {
      const stats = await getModerationStats()
      return {
        message: `${stats.totalCases} total cases, ${stats.activeCases} active, ${stats.totalStaked} ETH staked, ${stats.banRate}% ban rate`,
        data: toResponseData(stats),
      }
    }
    case 'prepare-moderation-stake': {
      const validated = expect(
        params,
        PrepareStakeRequestSchema,
        'prepare-moderation-stake params',
      )
      const tx = prepareStakeTransaction(validated.amount)
      return {
        message: `Prepared stake transaction for ${validated.amount} ETH`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          note: 'Wait 24h after staking before voting power activates',
        },
      }
    }
    case 'prepare-report': {
      const validated = expect(
        params,
        PrepareReportRequestSchema,
        'prepare-report params',
      )
      const tx = prepareReportTransaction(
        validated.target as Address,
        validated.reason,
        validated.evidenceHash as `0x${string}`,
      )
      return {
        message: `Prepared report transaction`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          warning: 'Your stake is at risk if community votes to clear',
        },
      }
    }
    case 'prepare-vote': {
      const validated = expect(
        params,
        PrepareVoteRequestSchema,
        'prepare-vote params',
      )
      const tx = prepareVoteTransaction(validated.caseId, validated.voteYes)
      return {
        message: `Prepared vote ${validated.voteYes ? 'BAN' : 'CLEAR'} transaction`,
        data: { action: 'sign-and-send', transaction: tx },
      }
    }
    case 'prepare-challenge': {
      const validated = expect(
        params,
        PrepareChallengeRequestSchema,
        'prepare-challenge params',
      )
      const tx = prepareChallengeTransaction(
        validated.caseId,
        validated.stakeAmount,
      )
      return {
        message: `Prepared challenge transaction`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          warning: 'Stake at risk if ban upheld',
        },
      }
    }
    case 'prepare-appeal': {
      const validated = expect(
        params,
        PrepareAppealRequestSchema,
        'prepare-appeal params',
      )
      const tx = prepareAppealTransaction(
        validated.caseId,
        validated.stakeAmount,
      )
      return {
        message: `Prepared appeal transaction`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          note: 'Appeals require 10x the original stake',
        },
      }
    }
    // Faucet skills (testnet only)
    case 'faucet-status': {
      if (!IS_TESTNET) {
        throw new Error('Faucet is only available on testnet')
      }
      const validated = expect(
        params,
        FaucetStatusRequestSchema,
        'faucet-status params',
      )
      const status = await faucetService.getFaucetStatus(
        validated.address as Address,
      )
      const message = status.eligible
        ? `You are eligible to claim ${status.amountPerClaim} JEJU`
        : status.isRegistered
          ? `Cooldown active: ${Math.ceil(status.cooldownRemaining / 3600000)}h remaining`
          : 'You must register in the ERC-8004 Identity Registry first'
      return { message, data: toResponseData(status) }
    }
    case 'faucet-claim': {
      if (!IS_TESTNET) {
        throw new Error('Faucet is only available on testnet')
      }
      const validated = expect(
        params,
        FaucetClaimRequestSchema,
        'faucet-claim params',
      )
      const result = await faucetService.claimFromFaucet(
        validated.address as Address,
      )
      if (!result.success) {
        throw new Error(result.error || 'Claim failed')
      }
      const message = `Successfully claimed ${result.amount} JEJU. TX: ${result.txHash}`
      return { message, data: toResponseData(result) }
    }
    case 'faucet-info': {
      if (!IS_TESTNET)
        return {
          message: 'Faucet is only available on testnet',
          data: { error: 'Faucet disabled on mainnet' },
        }
      const info = faucetService.getFaucetInfo()
      return {
        message: `${info.name}: Claim ${info.amountPerClaim} ${info.tokenSymbol} every ${info.cooldownHours}h`,
        data: toResponseData(info),
      }
    }
    // RPC Gateway Skills (using local imports)
    case 'rpc-list-chains': {
      const chains = Object.values(RPC_CHAINS).map((c) => ({
        chainId: c.chainId,
        name: c.name,
        shortName: c.shortName,
        isTestnet: c.isTestnet,
        rpcEndpoint: `/v1/rpc/${c.chainId}`,
      }))
      return { message: `${chains.length} chains supported`, data: { chains } }
    }
    case 'rpc-get-limits': {
      const address = expectAddress(params.address, 'rpc-get-limits address')
      const keys = await getApiKeysForAddress(address)
      const activeKeys = keys.filter((k) => k.isActive)
      return {
        message: `Tier: FREE, Limit: ${RATE_LIMITS.FREE}/min`,
        data: {
          currentTier: 'FREE',
          rateLimit: RATE_LIMITS.FREE,
          apiKeys: activeKeys.length,
          tiers: RATE_LIMITS,
        },
      }
    }
    case 'rpc-get-usage': {
      const address = expectAddress(params.address, 'rpc-get-usage address')
      const keys = await getApiKeysForAddress(address)
      const totalRequests = keys.reduce((sum, k) => sum + k.requestCount, 0)
      return {
        message: `${totalRequests} total requests, ${keys.length} API keys`,
        data: { totalRequests, apiKeys: keys.length },
      }
    }
    case 'rpc-create-key': {
      const address = expectAddress(params.address, 'rpc-create-key address')
      const name = (
        typeof params.name === 'string' ? params.name : 'A2A Generated'
      ).slice(0, 100)
      const existingKeys = await getApiKeysForAddress(address)
      if (existingKeys.filter((k) => k.isActive).length >= 10) {
        throw new Error('Maximum API keys reached (10)')
      }
      const { key, record } = await createApiKey(address, name)
      return {
        message: `API key created: ${key.slice(0, 15)}...`,
        data: {
          key,
          id: record.id,
          tier: record.tier,
          warning: 'Store this key securely - it will not be shown again',
        },
      }
    }
    case 'rpc-staking-info': {
      return {
        message:
          'RPC rate limits based on staked JEJU. Higher stake = higher limits. 7-day unbonding period.',
        data: {
          contract: process.env.RPC_STAKING_ADDRESS || 'Not deployed',
          tiers: {
            FREE: {
              minUsd: 0,
              rateLimit: 10,
              description: '10 requests/minute',
            },
            BASIC: {
              minUsd: 10,
              rateLimit: 100,
              description: '100 requests/minute',
            },
            PRO: {
              minUsd: 100,
              rateLimit: 1000,
              description: '1,000 requests/minute',
            },
            UNLIMITED: {
              minUsd: 1000,
              rateLimit: 'unlimited',
              description: 'Unlimited requests',
            },
          },
          unbondingPeriod: '7 days',
        },
      }
    }
    default:
      return {
        message: 'Unknown skill',
        data: {
          error: 'Skill not found',
          availableSkills: GATEWAY_AGENT_CARD.skills.map((s) => s.id),
        },
      }
  }
}

app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
  res.json(GATEWAY_AGENT_CARD)
})

app.get(
  '/.well-known/governance-agent-card.json',
  (_req: Request, res: Response) => {
    res.json({
      id: 'jeju-futarchy-governance',
      name: `${getChainName(JEJU_CHAIN_ID)} Futarchy Governance`,
      description:
        'Market-based governance using prediction markets for parameter decisions',
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
          description: 'Returns all active futarchy governance quests',
          inputs: [],
          outputs: { quests: 'array' },
          endpoint: '/a2a/governance',
        },
        {
          id: 'get-voting-power',
          name: 'Get Voting Power',
          description: 'Calculate voting power from stakes',
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
          ],
          outputs: { questId: 'string' },
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
      },
    })
  },
)

app.post('/a2a', agentRateLimit(), async (req: Request, res: Response) => {
  let body: A2ARequest
  try {
    body = validateBody(A2ARequestSchema, req.body, 'A2A request')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return res.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message },
    })
  }

  const message = body.params.message
  const dataPart = message.parts.find((p) => p.kind === 'data')
  if (!dataPart?.data) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    })
  }

  const skillId = dataPart.data.skillId
  if (typeof skillId !== 'string' || !skillId) {
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    })
  }

  let result: SkillResult
  try {
    result = await executeSkill(
      skillId,
      dataPart.data as Record<string, JsonValue>,
      (req.headers['x-payment'] as string) || null,
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Skill execution failed'
    return res.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message },
    })
  }

  if (result.requiresPayment) {
    return res.status(402).json({
      jsonrpc: '2.0',
      id: body.id,
      error: {
        code: 402,
        message: 'Payment Required',
        data: result.requiresPayment,
      },
    })
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
  })
})

app.post(
  '/mcp/initialize',
  agentRateLimit(),
  (_req: Request, res: Response) => {
    res.json({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    })
  },
)

app.post(
  '/mcp/resources/list',
  agentRateLimit(),
  (_req: Request, res: Response) => {
    res.json({ resources: MCP_RESOURCES })
  },
)

app.post(
  '/mcp/resources/read',
  agentRateLimit(),
  async (req: Request, res: Response) => {
    let validated: { uri: string }
    try {
      validated = validateBody(
        McpResourceReadRequestSchema,
        req.body,
        'MCP resource read',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      return res.status(400).json({ error: message })
    }

    const { uri } = validated

    // Helper to send MCP resource response with JSON-serialized content
    const sendResource = (data: object) => {
      res.json({
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      })
    }

    switch (uri) {
      // Intent Framework
      case 'oif://routes':
        return sendResource(await routeService.listRoutes())
      case 'oif://solvers':
        return sendResource(await solverService.listSolvers())
      case 'oif://intents/recent':
        return sendResource(await intentService.listIntents({ limit: 100 }))
      case 'oif://stats':
        return sendResource(await intentService.getStats())
      // XLP Pools
      case 'xlp://pools/v2':
        return sendResource(await poolService.listV2Pools())
      case 'xlp://pools/v3':
        return sendResource({
          note: 'V3 pools require specific token pair query',
          stats: await poolService.getPoolStats(),
        })
      case 'xlp://pools/stats':
        return sendResource(await poolService.getPoolStats())
      case 'xlp://tokens':
        return sendResource(poolService.getTokens())
      case 'xlp://contracts':
        return sendResource(poolService.getContracts())
      // Moderation
      case 'moderation://cases':
        return sendResource(await getModerationCases({ limit: 100 }))
      case 'moderation://cases/active':
        return sendResource(
          await getModerationCases({ activeOnly: true, limit: 50 }),
        )
      case 'moderation://reports':
        return sendResource(await getReports({ limit: 100 }))
      case 'moderation://stats':
        return sendResource(await getModerationStats())
      // Risk Pools
      case 'risk://tiers':
        return sendResource(getRiskTiers())
      case 'risk://stats': {
        // Query all tiers for aggregated stats
        const [conservative, balanced, aggressive] = await Promise.all([
          getSleeveStats(RiskTier.CONSERVATIVE),
          getSleeveStats(RiskTier.BALANCED),
          getSleeveStats(RiskTier.AGGRESSIVE),
        ])

        if ('status' in conservative) {
          return sendResource({
            status: 'not_deployed',
            message: 'RiskSleeve contract pending deployment',
          })
        }

        return sendResource({
          deployed: true,
          contractAddress: getRiskSleeveAddress(),
          tiers: { conservative, balanced, aggressive },
        })
      }
      case 'risk://allocations': {
        const strategy = await getDefaultStrategy()
        if ('status' in strategy) {
          return sendResource({
            status: 'not_deployed',
            message: 'LiquidityRouter contract pending deployment',
            plannedDefaults: {
              ethVaultBps: 3000,
              tokenVaultBps: 2000,
              nodeStakeBps: 2000,
              xlpStakeBps: 2000,
              paymasterStakeBps: 500,
              governanceStakeBps: 500,
            },
          })
        }
        return sendResource({
          deployed: true,
          contractAddress: getLiquidityRouterAddress(),
          defaultStrategy: strategy,
          description:
            'Default allocation distributes across ETH vault, token vault, node staking, XLP staking, paymaster, and governance',
        })
      }
      // Faucet (testnet only)
      case 'faucet://info':
        if (!IS_TESTNET)
          return res
            .status(403)
            .json({ error: 'Faucet is only available on testnet' })
        return sendResource(faucetService.getFaucetInfo())
      default:
        return res.status(404).json({ error: 'Resource not found' })
    }
  },
)

app.post(
  '/mcp/tools/list',
  agentRateLimit(),
  (_req: Request, res: Response) => {
    res.json({ tools: MCP_TOOLS })
  },
)

app.post(
  '/mcp/tools/call',
  agentRateLimit(),
  async (req: Request, res: Response) => {
    let validated: { name: string; arguments: Record<string, unknown> }
    try {
      const parsed = validateBody(
        McpToolCallRequestSchema,
        req.body,
        'MCP tool call',
      )
      validated = { name: parsed.name, arguments: parsed.arguments || {} }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      return res.status(400).json({ error: message })
    }

    const { name, arguments: args } = validated
    let result: object | null | undefined
    let isError = false

    try {
      switch (name) {
        // Intent Tools
        case 'create_intent': {
          const validatedArgs = expect(
            args,
            CreateIntentRequestSchema,
            'create_intent',
          )
          result = await intentService.createIntent({
            ...validatedArgs,
            sourceToken: validatedArgs.sourceToken as Address,
            destinationToken: validatedArgs.destinationToken as Address,
            recipient: validatedArgs.recipient as Address | undefined,
          })
          break
        }
        case 'get_quote': {
          const validatedArgs = expect(args, GetQuoteRequestSchema, 'get_quote')
          result = await intentService.getQuotes({
            ...validatedArgs,
            sourceToken: validatedArgs.sourceToken as Address,
            destinationToken: validatedArgs.destinationToken as Address,
          })
          break
        }
        case 'track_intent': {
          const intentId = expect(
            args.intentId,
            IntentIdSchema,
            'track_intent intentId',
          )
          result = await intentService.getIntent(intentId)
          break
        }
        case 'list_routes': {
          const validatedArgs =
            args && Object.keys(args).length > 0
              ? expect(args, ListRoutesQuerySchema, 'list_routes')
              : undefined
          result = await routeService.listRoutes(validatedArgs)
          break
        }
        case 'list_solvers': {
          const validatedArgs =
            args && Object.keys(args).length > 0
              ? expect(args, ListSolversQuerySchema, 'list_solvers')
              : undefined
          result = await solverService.listSolvers(validatedArgs)
          break
        }
        // XLP Pool Tools
        case 'list_v2_pools': {
          result = await poolService.listV2Pools()
          break
        }
        case 'get_pool_reserves': {
          const validatedArgs = expect(
            args,
            TokenPairSchema,
            'get_pool_reserves',
          )
          result = await poolService.listPoolsForPair(
            validatedArgs.token0 as Address,
            validatedArgs.token1 as Address,
          )
          break
        }
        case 'get_swap_quote': {
          const validatedArgs = expect(
            args,
            SwapQuoteRequestSchema,
            'get_swap_quote',
          )
          result = await poolService.getSwapQuote(
            validatedArgs.tokenIn as Address,
            validatedArgs.tokenOut as Address,
            validatedArgs.amountIn,
          )
          break
        }
        case 'get_all_swap_quotes': {
          const validatedArgs = expect(
            args,
            SwapQuoteRequestSchema,
            'get_all_swap_quotes',
          )
          result = await poolService.getAllSwapQuotes(
            validatedArgs.tokenIn as Address,
            validatedArgs.tokenOut as Address,
            validatedArgs.amountIn,
          )
          break
        }
        case 'get_pool_stats': {
          result = await poolService.getPoolStats()
          break
        }
        case 'list_pools_for_pair': {
          const validatedArgs = expect(
            args,
            TokenPairSchema,
            'list_pools_for_pair',
          )
          result = await poolService.listPoolsForPair(
            validatedArgs.token0 as Address,
            validatedArgs.token1 as Address,
          )
          break
        }
        // Moderation Tools
        case 'check_ban_status': {
          const validatedArgs = expect(
            args,
            CheckBanStatusRequestSchema,
            'check_ban_status',
          )
          result = await checkBanStatus(validatedArgs.address as Address)
          break
        }
        case 'get_moderator_profile': {
          const validatedArgs = expect(
            args,
            GetModeratorProfileRequestSchema,
            'get_moderator_profile',
          )
          result = await getModeratorProfile(validatedArgs.address as Address)
          break
        }
        case 'get_moderation_cases': {
          const validatedArgs =
            args && Object.keys(args).length > 0
              ? expect(
                  args,
                  GetModerationCasesQuerySchema,
                  'get_moderation_cases',
                )
              : {}
          result = await getModerationCases(validatedArgs)
          break
        }
        case 'get_moderation_case': {
          const caseId = expect(
            args.caseId,
            CaseIdSchema,
            'get_moderation_case caseId',
          )
          result = await getModerationCase(caseId)
          break
        }
        case 'get_reports': {
          const validatedArgs =
            args && Object.keys(args).length > 0
              ? expect(args, GetReportsQuerySchema, 'get_reports')
              : {}
          result = await getReports(validatedArgs)
          break
        }
        case 'get_agent_labels': {
          const agentId = expect(
            args.agentId,
            AgentIdSchema,
            'get_agent_labels agentId',
          )
          result = await getAgentLabels(agentId)
          break
        }
        case 'get_moderation_stats': {
          result = await getModerationStats()
          break
        }
        case 'prepare_stake': {
          const validatedArgs = expect(
            args,
            PrepareStakeRequestSchema,
            'prepare_stake',
          )
          result = {
            action: 'sign-and-send',
            transaction: prepareStakeTransaction(validatedArgs.amount),
          }
          break
        }
        case 'prepare_report': {
          const validatedArgs = expect(
            args,
            PrepareReportRequestSchema,
            'prepare_report',
          )
          result = {
            action: 'sign-and-send',
            transaction: prepareReportTransaction(
              validatedArgs.target as Address,
              validatedArgs.reason,
              validatedArgs.evidenceHash as `0x${string}`,
            ),
          }
          break
        }
        case 'prepare_vote': {
          const validatedArgs = expect(
            args,
            PrepareVoteRequestSchema,
            'prepare_vote',
          )
          result = {
            action: 'sign-and-send',
            transaction: prepareVoteTransaction(
              validatedArgs.caseId,
              validatedArgs.voteYes,
            ),
          }
          break
        }
        case 'prepare_challenge': {
          const validatedArgs = expect(
            args,
            PrepareChallengeRequestSchema,
            'prepare_challenge',
          )
          result = {
            action: 'sign-and-send',
            transaction: prepareChallengeTransaction(
              validatedArgs.caseId,
              validatedArgs.stakeAmount,
            ),
          }
          break
        }
        case 'prepare_appeal': {
          const validatedArgs = expect(
            args,
            PrepareAppealRequestSchema,
            'prepare_appeal',
          )
          result = {
            action: 'sign-and-send',
            transaction: prepareAppealTransaction(
              validatedArgs.caseId,
              validatedArgs.stakeAmount,
            ),
          }
          break
        }
        // Faucet Tools (testnet only)
        case 'faucet_status': {
          if (!IS_TESTNET) {
            result = { error: 'Faucet is only available on testnet' }
            isError = true
            break
          }
          const validatedArgs = expect(
            args,
            FaucetStatusRequestSchema,
            'faucet_status',
          )
          result = await faucetService.getFaucetStatus(
            validatedArgs.address as Address,
          )
          break
        }
        case 'faucet_claim': {
          if (!IS_TESTNET) {
            result = { error: 'Faucet is only available on testnet' }
            isError = true
            break
          }
          const validatedArgs = expect(
            args,
            FaucetClaimRequestSchema,
            'faucet_claim',
          )
          result = await faucetService.claimFromFaucet(
            validatedArgs.address as Address,
          )
          break
        }
        case 'faucet_info': {
          if (!IS_TESTNET) {
            result = { error: 'Faucet is only available on testnet' }
            isError = true
            break
          }
          result = faucetService.getFaucetInfo()
          break
        }
        // Risk Sleeve Tools
        case 'get_risk_tiers': {
          result = {
            tiers: [
              {
                id: 0,
                name: 'Conservative',
                description: 'Low risk, stable yields',
                expectedApyBps: 300,
                minDeposit: '0.01',
              },
              {
                id: 1,
                name: 'Balanced',
                description: 'Moderate risk with competitive returns',
                expectedApyBps: 1000,
                minDeposit: '0.01',
              },
              {
                id: 2,
                name: 'Aggressive',
                description: 'Higher risk, higher potential returns',
                expectedApyBps: 2000,
                minDeposit: '0.01',
              },
            ],
          }
          break
        }
        case 'get_sleeve_stats': {
          const tier = args.tier as number
          if (tier < 0 || tier > 2) {
            result = {
              error:
                'Invalid tier: must be 0 (Conservative), 1 (Balanced), or 2 (Aggressive)',
            }
            isError = true
            break
          }
          result = await getSleeveStats(tier as RiskTier)
          break
        }
        case 'get_sleeve_position': {
          const tier = args.tier as number
          const address = args.address as string
          if (tier < 0 || tier > 2) {
            result = { error: 'Invalid tier' }
            isError = true
            break
          }
          if (!address || !isAddress(address)) {
            result = { error: 'Invalid address' }
            isError = true
            break
          }
          result = await getSleevePosition(address as Address, tier as RiskTier)
          break
        }
        case 'prepare_sleeve_deposit': {
          const riskSleeveAddr = getRiskSleeveAddress()
          if (!riskSleeveAddr) {
            result = {
              error: 'RiskSleeve contract not yet deployed',
              suggestion:
                'Use the Gateway UI at /risk to deposit when contracts are live',
            }
            isError = true
            break
          }
          const amount = args.amount as string
          const tier = args.tier as number
          result = {
            action: 'sign-and-send',
            transaction: {
              to: riskSleeveAddr,
              value: amount,
              data: `0x${Buffer.from('deposit(uint8)').slice(0, 4).toString('hex')}${tier.toString(16).padStart(64, '0')}`,
            },
          }
          break
        }
        case 'prepare_sleeve_withdraw': {
          const riskSleeveAddr = getRiskSleeveAddress()
          if (!riskSleeveAddr) {
            result = {
              error: 'RiskSleeve contract not yet deployed',
              suggestion:
                'Use the Gateway UI at /risk to withdraw when contracts are live',
            }
            isError = true
            break
          }
          const amount = args.amount as string
          const tier = args.tier as number
          result = {
            action: 'sign-and-send',
            transaction: {
              to: riskSleeveAddr,
              data: `withdraw(${tier}, ${amount})`,
            },
          }
          break
        }
        case 'get_allocation_strategy': {
          result = await getDefaultStrategy()
          break
        }
        case 'prepare_router_deposit': {
          const routerAddr = getLiquidityRouterAddress()
          if (!routerAddr) {
            result = {
              error: 'LiquidityRouter contract not yet deployed',
              suggestion:
                'Use the Gateway UI to deposit when contracts are live',
            }
            isError = true
            break
          }
          const amount = args.amount as string
          result = {
            action: 'sign-and-send',
            transaction: {
              to: routerAddr,
              value: amount,
              data: '0x', // depositETH() selector
            },
          }
          break
        }
        case 'get_router_position': {
          const address = args.address as string
          if (!address || !isAddress(address)) {
            result = { error: 'Invalid address' }
            isError = true
            break
          }
          result = await getRouterPosition(address as Address)
          break
        }
        case 'estimate_yield': {
          const address = args.address as string
          if (!address || !isAddress(address)) {
            result = { error: 'Invalid address' }
            isError = true
            break
          }
          result = await estimateYield(address as Address)
          break
        }
        default: {
          result = { error: 'Tool not found' }
          isError = true
          break
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Tool execution failed'
      result = { error: message }
      isError = true
    }

    res.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    })
  },
)

app.get('/mcp', agentRateLimit(), (_req: Request, res: Response) => {
  res.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    capabilities: MCP_SERVER_INFO.capabilities,
  })
})

app.post(
  '/api/intents',
  strictRateLimit(),
  async (req: Request, res: Response) => {
    try {
      const validated = validateBody(
        CreateIntentRequestSchema,
        req.body,
        'create intent',
      )
      res.json(
        await intentService.createIntent({
          ...validated,
          sourceToken: validated.sourceToken as Address,
          destinationToken: validated.destinationToken as Address,
          recipient: validated.recipient as Address | undefined,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      res.status(400).json({ error: message })
    }
  },
)

app.get('/api/intents/:intentId', async (req: Request, res: Response) => {
  try {
    const intentId = expect(req.params.intentId, IntentIdSchema, 'intentId')
    const intent = await intentService.getIntent(intentId)
    if (!intent) {
      return res.status(404).json({ error: 'Intent not found' })
    }
    res.json(intent)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/intents', async (req: Request, res: Response) => {
  try {
    const validated =
      Object.keys(req.query).length > 0
        ? validateQuery(ListIntentsQuerySchema, req.query, 'list intents')
        : undefined
    res.json(await intentService.listIntents(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.post(
  '/api/intents/:intentId/cancel',
  strictRateLimit(),
  async (req: Request, res: Response) => {
    try {
      const intentId = expect(req.params.intentId, IntentIdSchema, 'intentId')
      const validated = validateBody(
        CancelIntentRequestSchema,
        req.body,
        'cancel intent',
      )
      res.json(await intentService.cancelIntent(intentId, validated.user))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      res.status(400).json({ error: message })
    }
  },
)

app.post('/api/intents/quote', async (req: Request, res: Response) => {
  try {
    const validated = validateBody(GetQuoteRequestSchema, req.body, 'get quote')
    res.json(
      await intentService.getQuotes({
        ...validated,
        sourceToken: validated.sourceToken as Address,
        destinationToken: validated.destinationToken as Address,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/routes', async (req: Request, res: Response) => {
  try {
    const validated =
      Object.keys(req.query).length > 0
        ? validateQuery(ListRoutesQuerySchema, req.query, 'list routes')
        : undefined
    res.json(await routeService.listRoutes(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/routes/:routeId', async (req: Request, res: Response) => {
  try {
    const routeId = expect(req.params.routeId, RouteIdSchema, 'routeId')
    const route = await routeService.getRoute(routeId)
    if (!route) {
      return res.status(404).json({ error: 'Route not found' })
    }
    res.json(route)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.post('/api/routes/best', async (req: Request, res: Response) => {
  try {
    const validated = validateBody(
      GetBestRouteRequestSchema,
      req.body,
      'get best route',
    )
    res.json(await routeService.getBestRoute(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/routes/:routeId/volume', async (req: Request, res: Response) => {
  try {
    const routeId = expect(req.params.routeId, RouteIdSchema, 'routeId')
    const validated = validateQuery(
      GetVolumeQuerySchema,
      { ...req.query, routeId },
      'get volume',
    )
    res.json(await routeService.getVolume(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/solvers/leaderboard', async (req: Request, res: Response) => {
  try {
    const validated =
      Object.keys(req.query).length > 0
        ? validateQuery(
            SolverLeaderboardQuerySchema,
            req.query,
            'solver leaderboard',
          )
        : undefined
    res.json(await solverService.getLeaderboard(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/solvers', async (req: Request, res: Response) => {
  try {
    const validated =
      Object.keys(req.query).length > 0
        ? validateQuery(ListSolversQuerySchema, req.query, 'list solvers')
        : undefined
    res.json(await solverService.listSolvers(validated))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get(
  '/api/solvers/:address/liquidity',
  async (req: Request, res: Response) => {
    try {
      const address = expectAddress(req.params.address, 'solver address')
      res.json(await solverService.getSolverLiquidity(address))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      res.status(400).json({ error: message })
    }
  },
)

app.get('/api/solvers/:address', async (req: Request, res: Response) => {
  try {
    const address = expectAddress(req.params.address, 'solver address')
    const solver = await solverService.getSolver(address)
    if (!solver) {
      return res.status(404).json({ error: 'Solver not found' })
    }
    res.json(solver)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/stats', async (_req: Request, res: Response) => {
  res.json(await intentService.getStats())
})

app.get('/api/stats/chain/:chainId', async (req: Request, res: Response) => {
  try {
    const chainId = expectChainId(Number(req.params.chainId), 'chainId')
    res.json(await intentService.getChainStats(chainId))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/config/chains', (_req: Request, res: Response) => {
  res.json(routeService.getChains())
})

app.get('/api/config/tokens', (req: Request, res: Response) => {
  const { chainId } = req.query
  if (chainId) {
    res.json(routeService.getTokens(Number(chainId)))
  } else {
    res.json(
      routeService.getChains().map((c) => ({
        chainId: c.chainId,
        chainName: c.name,
        tokens: routeService.getTokens(c.chainId),
      })),
    )
  }
})

app.get('/api/pools', async (req: Request, res: Response) => {
  try {
    const validated = validateQuery(
      ListPoolsQuerySchema,
      req.query,
      'list pools',
    )
    if (validated.token0 && validated.token1) {
      const pools = await poolService.listPoolsForPair(
        validated.token0 as Address,
        validated.token1 as Address,
      )
      return res.json({ pools, count: pools.length })
    }
    if (validated.type === 'v2') {
      const pools = await poolService.listV2Pools()
      return res.json({ pools, count: pools.length })
    }
    const stats = await poolService.getPoolStats()
    res.json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get('/api/pools/v2', async (_req: Request, res: Response) => {
  const pools = await poolService.listV2Pools()
  res.json({ pools, count: pools.length })
})

app.get('/api/pools/stats', async (_req: Request, res: Response) => {
  const stats = await poolService.getPoolStats()
  res.json(stats)
})

app.get('/api/pools/tokens', (_req: Request, res: Response) => {
  res.json(poolService.getTokens())
})

app.get('/api/pools/contracts', (_req: Request, res: Response) => {
  res.json(poolService.getContracts())
})

app.post('/api/pools/quote', async (req: Request, res: Response) => {
  try {
    const validated = validateBody(
      SwapQuoteRequestSchema,
      req.body,
      'swap quote',
    )
    const quote = await poolService.getSwapQuote(
      validated.tokenIn as Address,
      validated.tokenOut as Address,
      validated.amountIn,
    )
    if (!quote) {
      return res
        .status(404)
        .json({ error: 'No liquidity available for this swap' })
    }
    res.json(quote)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.post('/api/pools/quotes', async (req: Request, res: Response) => {
  try {
    const validated = validateBody(
      SwapQuoteRequestSchema,
      req.body,
      'swap quotes',
    )
    const quotes = await poolService.getAllSwapQuotes(
      validated.tokenIn as Address,
      validated.tokenOut as Address,
      validated.amountIn,
    )
    res.json({ quotes, bestQuote: quotes[0] || null, count: quotes.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.get(
  '/api/pools/pair/:token0/:token1',
  async (req: Request, res: Response) => {
    try {
      const validated = expect(
        { token0: req.params.token0, token1: req.params.token1 },
        TokenPairSchema,
        'token pair',
      )
      const pools = await poolService.listPoolsForPair(
        validated.token0 as Address,
        validated.token1 as Address,
      )
      res.json({ pools, count: pools.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      res.status(400).json({ error: message })
    }
  },
)

// Faucet REST API (testnet only)
app.get('/api/faucet/info', (_req: Request, res: Response) => {
  if (!IS_TESTNET)
    return res
      .status(403)
      .json({ error: 'Faucet is only available on testnet' })
  res.json(faucetService.getFaucetInfo())
})

app.get('/api/faucet/status/:address', async (req: Request, res: Response) => {
  if (!IS_TESTNET) {
    return res
      .status(403)
      .json({ error: 'Faucet is only available on testnet' })
  }
  try {
    const address = expectAddress(req.params.address, 'faucet status address')
    const status = await faucetService.getFaucetStatus(address)
    res.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    res.status(400).json({ error: message })
  }
})

app.post(
  '/api/faucet/claim',
  strictRateLimit(),
  async (req: Request, res: Response) => {
    if (!IS_TESTNET) {
      return res
        .status(403)
        .json({ error: 'Faucet is only available on testnet' })
    }
    try {
      const validated = validateBody(
        FaucetClaimRequestSchema,
        req.body,
        'faucet claim',
      )
      const result = await faucetService.claimFromFaucet(
        validated.address as Address,
      )
      if (!result.success) {
        return res.status(400).json(result)
      }
      res.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request'
      res.status(400).json({ error: message })
    }
  },
)

app.get('/health', (_req: Request, res: Response) => {
  const poolHealth = poolService.getHealthStatus()
  res.json({
    status: poolHealth.configured ? 'ok' : 'degraded',
    service: 'gateway-a2a',
    version: '1.0.0',
    wsClients: getWebSocketServer(Number(WS_PORT)).getClientCount(),
    poolService: poolHealth,
  })
})

getWebSocketServer(Number(WS_PORT))

app.listen(PORT, () => {
  console.log(`🌉 Gateway A2A Server running on http://localhost:${PORT}`)
  console.log(
    `   Network: ${getChainName(JEJU_CHAIN_ID)} (${IS_TESTNET ? 'testnet' : 'mainnet'})`,
  )
  console.log(
    `   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`,
  )
  console.log(`   A2A Endpoint: http://localhost:${PORT}/a2a`)
  console.log(`   MCP Endpoint: http://localhost:${PORT}/mcp`)
  console.log(`   REST API: http://localhost:${PORT}/api`)
  console.log(`   WebSocket: ws://localhost:${WS_PORT}`)
  if (IS_TESTNET) console.log(`   Faucet: enabled`)
})
