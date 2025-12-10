import express, { Request, Response } from 'express';
import cors from 'cors';
import { createPaymentRequirement, checkPayment, PAYMENT_TIERS, PaymentRequirements } from './lib/x402.js';
import { Address } from 'viem';
import { rateLimit, agentRateLimit, strictRateLimit } from './middleware/rate-limit.js';
import { intentService } from './services/intent-service.js';
import { routeService } from './services/route-service.js';
import { solverService } from './services/solver-service.js';
import { getWebSocketServer } from './services/websocket.js';
import { faucetService } from './services/faucet-service.js';
import { JEJU_CHAIN_ID, IS_TESTNET, getChainName, PORTS, SERVICES } from './config/networks.js';
import {
  checkBanStatus,
  getModeratorProfile,
  getModerationCases,
  getModerationCase,
  getReports,
  getAgentLabels,
  getModerationStats,
  prepareStakeTransaction,
  prepareReportTransaction,
  prepareVoteTransaction,
  prepareChallengeTransaction,
  prepareAppealTransaction,
} from './lib/moderation-api.js';

const app = express();
const PORT = PORTS.a2a;
const WS_PORT = PORTS.websocket;
// Only env var needed: payment recipient address (optional)
const PAYMENT_RECIPIENT = (process.env.GATEWAY_PAYMENT_RECIPIENT || '0x0000000000000000000000000000000000000000') as Address;

app.use(cors());
app.use(express.json());
app.use(rateLimit());

const GATEWAY_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Gateway Portal - Protocol Infrastructure Hub',
  description: 'Multi-token paymaster system, node staking, app registry, cross-chain intents, and protocol infrastructure',
  url: `http://localhost:${PORT}/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Protocol Infrastructure
    { id: 'list-protocol-tokens', name: 'List Protocol Tokens', description: 'Get all tokens with deployed paymasters', tags: ['query', 'tokens', 'paymaster'], examples: ['Show protocol tokens', 'Which tokens can pay gas?'] },
    { id: 'get-node-stats', name: 'Get Node Statistics', description: 'Get network node statistics and health', tags: ['query', 'nodes', 'network'], examples: ['Show node stats', 'Network health'] },
    { id: 'list-nodes', name: 'List Registered Nodes', description: 'Get all registered node operators', tags: ['query', 'nodes'], examples: ['Show nodes', 'List node operators'] },
    { id: 'list-registered-apps', name: 'List Registered Apps', description: 'Get all apps registered in the ERC-8004 registry', tags: ['query', 'registry', 'apps'], examples: ['Show registered apps', 'What apps are available?'] },
    { id: 'get-app-by-tag', name: 'Get Apps by Tag', description: 'Find apps by category tag', tags: ['query', 'registry', 'discovery'], examples: ['Show me games', 'List marketplaces'] },
    // Cross-Chain Intents
    { id: 'create-intent', name: 'Create Cross-Chain Intent', description: 'Create a new intent for cross-chain swap/transfer', tags: ['intents', 'create', 'swap', 'bridge'], examples: ['Swap 1 ETH on Ethereum for USDC on Arbitrum'] },
    { id: 'get-quote', name: 'Get Intent Quote', description: 'Get best price quote for an intent from active solvers', tags: ['quote', 'pricing', 'intents'], examples: ['Quote for 1 ETH to USDC cross-chain'] },
    { id: 'track-intent', name: 'Track Intent Status', description: 'Get current status and execution details of an intent', tags: ['intents', 'status', 'tracking'], examples: ['Check status of intent 0x...'] },
    { id: 'cancel-intent', name: 'Cancel Intent', description: 'Cancel an open intent before solver claims', tags: ['intents', 'cancel'], examples: ['Cancel my pending intent'] },
    { id: 'list-routes', name: 'List Available Routes', description: 'Get all supported cross-chain routes', tags: ['routes', 'discovery'], examples: ['What chains can I bridge to?'] },
    { id: 'get-best-route', name: 'Get Best Route', description: 'Find optimal route for a specific swap', tags: ['routes', 'optimization'], examples: ['Best route for ETH to USDC'] },
    { id: 'list-solvers', name: 'List Active Solvers', description: 'Get all active solvers with reputation and liquidity', tags: ['solvers', 'liquidity'], examples: ['Show active solvers'] },
    { id: 'get-solver-liquidity', name: 'Get Solver Liquidity', description: 'Check available liquidity for a specific solver', tags: ['solvers', 'liquidity'], examples: ['Check solver 0x... liquidity'] },
    { id: 'get-stats', name: 'Get OIF Statistics', description: 'Get global intent framework statistics', tags: ['analytics', 'stats'], examples: ['Show OIF stats', 'Total volume today?'] },
    { id: 'get-volume', name: 'Get Route Volume', description: 'Get volume statistics for a specific route', tags: ['analytics', 'volume'], examples: ['Volume on Ethereum to Arbitrum route'] },
    // Moderation & Governance
    { id: 'check-ban-status', name: 'Check Ban Status', description: 'Check if an address is banned or on notice', tags: ['moderation', 'ban', 'query'], examples: ['Is 0x... banned?', 'Check my ban status'] },
    { id: 'get-moderator-profile', name: 'Get Moderator Profile', description: 'Get full moderator profile including reputation, P&L, and voting power', tags: ['moderation', 'reputation', 'query'], examples: ['My moderator stats', 'Show reputation for 0x...'] },
    { id: 'get-moderation-cases', name: 'Get Moderation Cases', description: 'List all moderation cases with voting status', tags: ['moderation', 'governance', 'query'], examples: ['Show active cases', 'List pending bans'] },
    { id: 'get-moderation-case', name: 'Get Case Details', description: 'Get full details of a specific moderation case', tags: ['moderation', 'query'], examples: ['Show case 0x...', 'Case details'] },
    { id: 'get-reports', name: 'Get Reports', description: 'List submitted reports with status', tags: ['moderation', 'reports', 'query'], examples: ['Show pending reports', 'List all reports'] },
    { id: 'get-agent-labels', name: 'Get Agent Labels', description: 'Get reputation labels for an agent (HACKER, SCAMMER, TRUSTED)', tags: ['moderation', 'labels', 'query'], examples: ['What labels does agent #123 have?'] },
    { id: 'get-moderation-stats', name: 'Get Moderation Stats', description: 'Get system-wide moderation statistics', tags: ['moderation', 'analytics', 'query'], examples: ['Moderation stats', 'How many bans?'] },
    { id: 'prepare-moderation-stake', name: 'Prepare Moderation Stake', description: 'Prepare transaction to stake and become a moderator', tags: ['moderation', 'stake', 'action'], examples: ['Stake 0.1 ETH for moderation'] },
    { id: 'prepare-report', name: 'Prepare Report', description: 'Prepare transaction to report a user', tags: ['moderation', 'report', 'action'], examples: ['Report 0x... for scamming'] },
    { id: 'prepare-vote', name: 'Prepare Vote', description: 'Prepare transaction to vote on a moderation case', tags: ['moderation', 'vote', 'action'], examples: ['Vote BAN on case 0x...'] },
    { id: 'prepare-challenge', name: 'Prepare Challenge', description: 'Prepare transaction to challenge a ban', tags: ['moderation', 'challenge', 'action'], examples: ['Challenge my ban'] },
    { id: 'prepare-appeal', name: 'Prepare Appeal', description: 'Prepare transaction to appeal a resolved ban', tags: ['moderation', 'appeal', 'action'], examples: ['Appeal case 0x...'] },
    // RPC Gateway
    { id: 'rpc-list-chains', name: 'List RPC Chains', description: 'Get all supported blockchain networks', tags: ['rpc', 'chains', 'query'], examples: ['What chains are supported?', 'List RPC endpoints'] },
    { id: 'rpc-get-limits', name: 'Check RPC Limits', description: 'Check rate limits and tier for an address', tags: ['rpc', 'limits', 'query'], examples: ['What are my RPC limits?', 'Check rate limit for 0x...'] },
    { id: 'rpc-get-usage', name: 'Get RPC Usage', description: 'Get usage statistics for an address', tags: ['rpc', 'usage', 'query'], examples: ['Show my RPC usage', 'How many requests have I made?'] },
    { id: 'rpc-create-key', name: 'Create API Key', description: 'Generate a new RPC API key', tags: ['rpc', 'apikey', 'action'], examples: ['Create new API key', 'Generate RPC key'] },
    { id: 'rpc-staking-info', name: 'RPC Staking Info', description: 'Get staking tiers and requirements', tags: ['rpc', 'staking', 'query'], examples: ['How do I get higher rate limits?', 'RPC staking tiers'] },
    // Faucet (testnet only - added dynamically)
  ].concat(IS_TESTNET ? [
    { id: 'faucet-status', name: 'Check Faucet Status', description: 'Check eligibility and cooldown for JEJU faucet', tags: ['faucet', 'query'], examples: ['Am I eligible for faucet?', 'Check my faucet status'] },
    { id: 'faucet-claim', name: 'Claim from Faucet', description: 'Claim JEJU tokens from testnet faucet (requires ERC-8004 registration)', tags: ['faucet', 'claim', 'action'], examples: ['Claim JEJU from faucet', 'Get testnet tokens'] },
    { id: 'faucet-info', name: 'Get Faucet Info', description: 'Get faucet configuration and requirements', tags: ['faucet', 'info', 'query'], examples: ['Faucet info', 'How does faucet work?'] },
  ] : []),
};

const MCP_SERVER_INFO = {
  name: 'jeju-gateway',
  version: '1.0.0',
  description: 'Gateway Portal - Protocol infrastructure and cross-chain intents',
  capabilities: { resources: true, tools: true, prompts: false },
};

const MCP_RESOURCES = [
  // Intent Framework
  { uri: 'oif://routes', name: 'Intent Routes', description: 'All available cross-chain routes', mimeType: 'application/json' },
  { uri: 'oif://solvers', name: 'Active Solvers', description: 'All registered solvers with reputation', mimeType: 'application/json' },
  { uri: 'oif://intents/recent', name: 'Recent Intents', description: 'Last 100 intents across all chains', mimeType: 'application/json' },
  { uri: 'oif://stats', name: 'OIF Statistics', description: 'Global intent framework statistics', mimeType: 'application/json' },
  // Moderation & Governance
  { uri: 'moderation://cases', name: 'Moderation Cases', description: 'All active and recent moderation cases', mimeType: 'application/json' },
  { uri: 'moderation://cases/active', name: 'Active Cases', description: 'Cases currently open for voting', mimeType: 'application/json' },
  { uri: 'moderation://reports', name: 'Reports', description: 'All submitted moderation reports', mimeType: 'application/json' },
  { uri: 'moderation://stats', name: 'Moderation Stats', description: 'System-wide moderation statistics', mimeType: 'application/json' },
  // Faucet (testnet only - added dynamically)
].concat(IS_TESTNET ? [
  { uri: 'faucet://info', name: 'Faucet Info', description: 'Faucet configuration and requirements', mimeType: 'application/json' },
] : []);

const MCP_TOOLS = [
  // Intent Tools
  { name: 'create_intent', description: 'Create a cross-chain swap intent', inputSchema: { type: 'object', properties: { sourceChain: { type: 'number' }, destinationChain: { type: 'number' }, sourceToken: { type: 'string' }, destinationToken: { type: 'string' }, amount: { type: 'string' }, recipient: { type: 'string' }, maxFee: { type: 'string' } }, required: ['sourceChain', 'destinationChain', 'sourceToken', 'destinationToken', 'amount'] } },
  { name: 'get_quote', description: 'Get best price quote for an intent', inputSchema: { type: 'object', properties: { sourceChain: { type: 'number' }, destinationChain: { type: 'number' }, sourceToken: { type: 'string' }, destinationToken: { type: 'string' }, amount: { type: 'string' } }, required: ['sourceChain', 'destinationChain', 'sourceToken', 'destinationToken', 'amount'] } },
  { name: 'track_intent', description: 'Track the status of an intent', inputSchema: { type: 'object', properties: { intentId: { type: 'string' } }, required: ['intentId'] } },
  { name: 'list_routes', description: 'List all available cross-chain routes', inputSchema: { type: 'object', properties: { sourceChain: { type: 'number' }, destinationChain: { type: 'number' } } } },
  { name: 'list_solvers', description: 'List all active solvers', inputSchema: { type: 'object', properties: { chainId: { type: 'number' }, minReputation: { type: 'number' } } } },
  // Moderation Tools
  { name: 'check_ban_status', description: 'Check if an address is banned', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Wallet address to check' } }, required: ['address'] } },
  { name: 'get_moderator_profile', description: 'Get moderator profile with reputation and P&L', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Moderator address' } }, required: ['address'] } },
  { name: 'get_moderation_cases', description: 'List moderation cases', inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean' }, resolvedOnly: { type: 'boolean' }, limit: { type: 'number' } } } },
  { name: 'get_moderation_case', description: 'Get details of a specific case', inputSchema: { type: 'object', properties: { caseId: { type: 'string' } }, required: ['caseId'] } },
  { name: 'get_reports', description: 'List submitted reports', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, pendingOnly: { type: 'boolean' } } } },
  { name: 'get_agent_labels', description: 'Get labels for an agent', inputSchema: { type: 'object', properties: { agentId: { type: 'number' } }, required: ['agentId'] } },
  { name: 'get_moderation_stats', description: 'Get system-wide moderation statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'prepare_stake', description: 'Prepare moderation stake transaction', inputSchema: { type: 'object', properties: { amount: { type: 'string', description: 'ETH amount to stake' } }, required: ['amount'] } },
  { name: 'prepare_report', description: 'Prepare report transaction', inputSchema: { type: 'object', properties: { target: { type: 'string' }, reason: { type: 'string' }, evidenceHash: { type: 'string' } }, required: ['target', 'reason', 'evidenceHash'] } },
  { name: 'prepare_vote', description: 'Prepare vote transaction', inputSchema: { type: 'object', properties: { caseId: { type: 'string' }, voteYes: { type: 'boolean' } }, required: ['caseId', 'voteYes'] } },
  { name: 'prepare_challenge', description: 'Prepare challenge transaction', inputSchema: { type: 'object', properties: { caseId: { type: 'string' }, stakeAmount: { type: 'string' } }, required: ['caseId', 'stakeAmount'] } },
  { name: 'prepare_appeal', description: 'Prepare appeal transaction', inputSchema: { type: 'object', properties: { caseId: { type: 'string' }, stakeAmount: { type: 'string' } }, required: ['caseId', 'stakeAmount'] } },
  // Faucet Tools (testnet only - added dynamically)
].concat(IS_TESTNET ? [
  { name: 'faucet_status', description: 'Check faucet eligibility and cooldown for an address', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Wallet address to check' } }, required: ['address'] } },
  { name: 'faucet_claim', description: 'Claim JEJU tokens from faucet (requires ERC-8004 registration)', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Wallet address to receive tokens' } }, required: ['address'] } },
  { name: 'faucet_info', description: 'Get faucet configuration and requirements', inputSchema: { type: 'object', properties: {} } },
] : []);

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: { message?: { messageId: string; parts: Array<{ kind: string; text?: string; data?: Record<string, string | number | boolean> }> } };
  id: number | string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: PaymentRequirements;
}

async function executeSkill(skillId: string, params: Record<string, unknown>, paymentHeader: string | null): Promise<SkillResult> {
  switch (skillId) {
    case 'list-protocol-tokens':
      return { message: 'Protocol tokens: elizaOS, CLANKER, VIRTUAL, CLANKERMON', data: { tokens: [{ symbol: 'elizaOS', hasPaymaster: true }, { symbol: 'CLANKER', hasPaymaster: true }, { symbol: 'VIRTUAL', hasPaymaster: true }, { symbol: 'CLANKERMON', hasPaymaster: true }] } };
    case 'get-node-stats':
      return { message: 'Node statistics available via NodeStakingManager contract', data: { note: 'Query NodeStakingManager.getNetworkStats() for live data' } };
    case 'list-nodes':
      return { message: 'Node listing available', data: { note: 'Query NodeStakingManager for registered nodes' } };
    case 'list-registered-apps':
      return { message: 'App registry available', data: { note: 'Query IdentityRegistry.getAllAgents() for registered apps' } };
    case 'get-app-by-tag':
      return { message: 'App discovery by tag available', data: { note: 'Provide tag parameter to filter apps' } };
    case 'deploy-paymaster': {
      const paymentCheck = await checkPayment(paymentHeader, PAYMENT_TIERS.PAYMASTER_DEPLOYMENT, PAYMENT_RECIPIENT);
      if (!paymentCheck.paid) return { message: 'Payment required', data: {}, requiresPayment: createPaymentRequirement('/a2a', PAYMENT_TIERS.PAYMASTER_DEPLOYMENT, 'Paymaster deployment fee', PAYMENT_RECIPIENT) };
      return { message: 'Paymaster deployment authorized', data: { token: params.token, fee: PAYMENT_TIERS.PAYMASTER_DEPLOYMENT.toString() } };
    }
    case 'add-liquidity': {
      const paymentCheck = await checkPayment(paymentHeader, PAYMENT_TIERS.LIQUIDITY_ADD, PAYMENT_RECIPIENT);
      if (!paymentCheck.paid) return { message: 'Payment required', data: {}, requiresPayment: createPaymentRequirement('/a2a', PAYMENT_TIERS.LIQUIDITY_ADD, 'Liquidity provision fee', PAYMENT_RECIPIENT) };
      return { message: 'Liquidity addition prepared', data: { paymaster: params.paymaster, amount: params.amount } };
    }
    case 'create-intent': {
      const intent = await intentService.createIntent({ sourceChain: params.sourceChain as number, destinationChain: params.destinationChain as number, sourceToken: params.sourceToken as string, destinationToken: params.destinationToken as string, amount: params.amount as string, recipient: params.recipient as string, maxFee: params.maxFee as string });
      return { message: `Intent created successfully. ID: ${intent.intentId}`, data: { intent } };
    }
    case 'get-quote': {
      const quotes = await intentService.getQuotes({ sourceChain: params.sourceChain as number, destinationChain: params.destinationChain as number, sourceToken: params.sourceToken as string, destinationToken: params.destinationToken as string, amount: params.amount as string });
      return { message: `Found ${quotes.length} quotes for your intent`, data: { quotes, bestQuote: quotes[0] } };
    }
    case 'track-intent': {
      const intent = await intentService.getIntent(params.intentId as string);
      if (!intent) return { message: 'Intent not found', data: { error: 'Intent not found' } };
      return { message: `Intent ${params.intentId} status: ${intent.status}`, data: intent };
    }
    case 'cancel-intent': {
      const user = params.user as string;
      if (!user) return { message: 'User address required', data: { error: 'Missing user parameter' } };
      const result = await intentService.cancelIntent(params.intentId as string, user);
      return { message: result.success ? 'Intent cancelled successfully' : result.message, data: result };
    }
    case 'list-routes': {
      const routes = await routeService.listRoutes();
      return { message: `Found ${routes.length} active routes`, data: { routes, totalRoutes: routes.length } };
    }
    case 'get-best-route': {
      const route = await routeService.getBestRoute({ sourceChain: params.sourceChain as number, destinationChain: params.destinationChain as number, prioritize: (params.prioritize as 'speed' | 'cost') || 'cost' });
      return { message: route ? `Best route found via ${route.oracle}` : 'No route available', data: { route } };
    }
    case 'list-solvers': {
      const solvers = await solverService.listSolvers();
      return { message: `${solvers.length} active solvers`, data: { solvers, activeSolvers: solvers.length } };
    }
    case 'get-solver-liquidity': {
      const liquidity = await solverService.getSolverLiquidity(params.solver as string);
      return { message: `Solver ${(params.solver as string).slice(0, 10)}... liquidity retrieved`, data: { solver: params.solver, liquidity } };
    }
    case 'get-stats': {
      const stats = await intentService.getStats();
      return { message: `OIF Stats: ${stats.totalIntents} intents, $${stats.totalVolumeUsd} volume`, data: stats };
    }
    case 'get-volume': {
      const volume = await routeService.getVolume({ sourceChain: params.sourceChain as number, destinationChain: params.destinationChain as number, period: (params.period as '24h' | '7d' | '30d' | 'all') || 'all' });
      return { message: `Route volume: $${volume.totalVolumeUsd}`, data: volume };
    }
    case 'check-ban-status': {
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const status = await checkBanStatus(address);
      return { message: status.isBanned ? `Address is ${status.isOnNotice ? 'on notice' : 'banned'}: ${status.reason}` : 'Address is not banned', data: status as unknown as Record<string, unknown> };
    }
    case 'get-moderator-profile': {
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const profile = await getModeratorProfile(address);
      if (!profile) return { message: 'Not a moderator or data unavailable', data: { address, isStaked: false } };
      return { message: `${profile.tier} tier moderator with ${profile.winRate}% win rate and ${profile.netPnL} ETH P&L`, data: profile as unknown as Record<string, unknown> };
    }
    case 'get-moderation-cases': {
      const cases = await getModerationCases({ activeOnly: params.activeOnly as boolean, resolvedOnly: params.resolvedOnly as boolean, limit: params.limit as number });
      return { message: `Found ${cases.length} moderation cases`, data: { cases, count: cases.length } };
    }
    case 'get-moderation-case': {
      const caseId = params.caseId as string;
      if (!caseId) return { message: 'Case ID required', data: { error: 'Missing caseId parameter' } };
      const caseData = await getModerationCase(caseId);
      if (!caseData) return { message: 'Case not found', data: { error: 'Case not found', caseId } };
      return { message: `Case ${caseData.status}: ${caseData.target.slice(0, 10)}... - ${caseData.reason.slice(0, 50)}`, data: caseData as unknown as Record<string, unknown> };
    }
    case 'get-reports': {
      const reports = await getReports({ limit: params.limit as number, pendingOnly: params.pendingOnly as boolean });
      return { message: `Found ${reports.length} reports`, data: { reports, count: reports.length } };
    }
    case 'get-agent-labels': {
      const agentId = params.agentId as number;
      if (!agentId) return { message: 'Agent ID required', data: { error: 'Missing agentId parameter' } };
      const labels = await getAgentLabels(agentId);
      return { message: labels.labels.length > 0 ? `Agent has labels: ${labels.labels.join(', ')}` : 'Agent has no labels', data: labels as unknown as Record<string, unknown> };
    }
    case 'get-moderation-stats': {
      const stats = await getModerationStats();
      return { message: `${stats.totalCases} total cases, ${stats.activeCases} active, ${stats.totalStaked} ETH staked, ${stats.banRate}% ban rate`, data: stats as unknown as Record<string, unknown> };
    }
    case 'prepare-moderation-stake': {
      const amount = params.amount as string;
      if (!amount) return { message: 'Amount required', data: { error: 'Missing amount parameter' } };
      const tx = prepareStakeTransaction(amount);
      return { message: `Prepared stake transaction for ${amount} ETH`, data: { action: 'sign-and-send', transaction: tx, note: 'Wait 24h after staking before voting power activates' } };
    }
    case 'prepare-report': {
      const { target, reason, evidenceHash } = params as { target: string; reason: string; evidenceHash: string };
      if (!target || !reason || !evidenceHash) return { message: 'Missing parameters', data: { error: 'target, reason, and evidenceHash required' } };
      const tx = prepareReportTransaction(target, reason, evidenceHash);
      return { message: `Prepared report transaction`, data: { action: 'sign-and-send', transaction: tx, warning: 'Your stake is at risk if community votes to clear' } };
    }
    case 'prepare-vote': {
      const { caseId, voteYes } = params as { caseId: string; voteYes: boolean };
      if (!caseId || voteYes === undefined) return { message: 'Missing parameters', data: { error: 'caseId and voteYes required' } };
      const tx = prepareVoteTransaction(caseId, voteYes);
      return { message: `Prepared vote ${voteYes ? 'BAN' : 'CLEAR'} transaction`, data: { action: 'sign-and-send', transaction: tx } };
    }
    case 'prepare-challenge': {
      const { caseId, stakeAmount } = params as { caseId: string; stakeAmount: string };
      if (!caseId || !stakeAmount) return { message: 'Missing parameters', data: { error: 'caseId and stakeAmount required' } };
      const tx = prepareChallengeTransaction(caseId, stakeAmount);
      return { message: `Prepared challenge transaction`, data: { action: 'sign-and-send', transaction: tx, warning: 'Stake at risk if ban upheld' } };
    }
    case 'prepare-appeal': {
      const { caseId, stakeAmount } = params as { caseId: string; stakeAmount: string };
      if (!caseId || !stakeAmount) return { message: 'Missing parameters', data: { error: 'caseId and stakeAmount required' } };
      const tx = prepareAppealTransaction(caseId, stakeAmount);
      return { message: `Prepared appeal transaction`, data: { action: 'sign-and-send', transaction: tx, note: 'Appeals require 10x the original stake' } };
    }
    // Faucet skills (testnet only)
    case 'faucet-status': {
      if (!IS_TESTNET) return { message: 'Faucet is only available on testnet', data: { error: 'Faucet disabled on mainnet' } };
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const status = await faucetService.getFaucetStatus(address as Address);
      const message = status.eligible
        ? `You are eligible to claim ${status.amountPerClaim} JEJU`
        : status.isRegistered
          ? `Cooldown active: ${Math.ceil(status.cooldownRemaining / 3600000)}h remaining`
          : 'You must register in the ERC-8004 Identity Registry first';
      return { message, data: status as unknown as Record<string, unknown> };
    }
    case 'faucet-claim': {
      if (!IS_TESTNET) return { message: 'Faucet is only available on testnet', data: { error: 'Faucet disabled on mainnet' } };
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const result = await faucetService.claimFromFaucet(address as Address);
      const message = result.success
        ? `Successfully claimed ${result.amount} JEJU. TX: ${result.txHash}`
        : result.error || 'Claim failed';
      return { message, data: result as unknown as Record<string, unknown> };
    }
    case 'faucet-info': {
      if (!IS_TESTNET) return { message: 'Faucet is only available on testnet', data: { error: 'Faucet disabled on mainnet' } };
      const info = faucetService.getFaucetInfo();
      return { message: `${info.name}: Claim ${info.amountPerClaim} ${info.tokenSymbol} every ${info.cooldownHours}h`, data: info as unknown as Record<string, unknown> };
    }
    // RPC Gateway Skills
    case 'rpc-list-chains': {
      const chainsRes = await fetch(`${SERVICES.rpcGateway}/v1/chains`);
      if (!chainsRes.ok) return { message: 'Failed to fetch chains', data: { error: 'RPC Gateway unavailable' } };
      const chainsData = await chainsRes.json() as { chains: Array<{ chainId: number; name: string; shortName: string; isTestnet: boolean }> };
      return { message: `${chainsData.chains.length} chains supported`, data: { chains: chainsData.chains } };
    }
    case 'rpc-get-limits': {
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const usageRes = await fetch(`${SERVICES.rpcGateway}/v1/usage`, { headers: { 'X-Wallet-Address': address } });
      if (!usageRes.ok) return { message: 'Failed to fetch limits', data: { error: 'RPC Gateway unavailable' } };
      const usageData = await usageRes.json() as { currentTier: string; rateLimit: number; remaining: number };
      return { message: `Tier: ${usageData.currentTier}, Limit: ${usageData.rateLimit}/min`, data: usageData as unknown as Record<string, unknown> };
    }
    case 'rpc-get-usage': {
      const address = params.address as string;
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const usageRes = await fetch(`${SERVICES.rpcGateway}/v1/usage`, { headers: { 'X-Wallet-Address': address } });
      if (!usageRes.ok) return { message: 'Failed to fetch usage', data: { error: 'RPC Gateway unavailable' } };
      const usageData = await usageRes.json() as { totalRequests: number; apiKeys: number };
      return { message: `${usageData.totalRequests} total requests, ${usageData.apiKeys} API keys`, data: usageData as unknown as Record<string, unknown> };
    }
    case 'rpc-create-key': {
      const address = params.address as string;
      const name = (params.name as string) || 'A2A Generated';
      if (!address) return { message: 'Address required', data: { error: 'Missing address parameter' } };
      const keyRes = await fetch(`${SERVICES.rpcGateway}/v1/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': address },
        body: JSON.stringify({ name }),
      });
      if (!keyRes.ok) return { message: 'Failed to create key', data: { error: 'Key creation failed' } };
      const keyData = await keyRes.json() as { key: string; id: string; tier: string };
      return { message: `API key created: ${keyData.key.slice(0, 15)}...`, data: { key: keyData.key, id: keyData.id, tier: keyData.tier, warning: 'Store this key securely - it will not be shown again' } };
    }
    case 'rpc-staking-info': {
      const stakeRes = await fetch(`${SERVICES.rpcGateway}/v1/stake`);
      if (!stakeRes.ok) return { message: 'Failed to fetch staking info', data: { error: 'RPC Gateway unavailable' } };
      const stakeData = await stakeRes.json() as { tiers: Record<string, { minStake: string; rateLimit: number | string }> };
      return { message: 'RPC rate limits based on staked JEJU. Higher stake = higher limits. 7-day unbonding period.', data: stakeData as unknown as Record<string, unknown> };
    }
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found', availableSkills: GATEWAY_AGENT_CARD.skills.map(s => s.id) } };
  }
}

app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
  res.json(GATEWAY_AGENT_CARD);
});

app.get('/.well-known/governance-agent-card.json', (_req: Request, res: Response) => {
  res.json({
    id: 'jeju-futarchy-governance',
    name: 'Jeju Futarchy Governance',
    description: 'Market-based governance using prediction markets for parameter decisions',
    version: '1.0.0',
    protocol: 'a2a',
    protocolVersion: '0.3.0',
    capabilities: { governance: true, futarchy: true, predictionMarkets: true },
    skills: [
      { id: 'get-active-quests', name: 'Get Active Governance Quests', description: 'Returns all active futarchy governance quests', inputs: [], outputs: { quests: 'array' }, endpoint: '/a2a/governance' },
      { id: 'get-voting-power', name: 'Get Voting Power', description: 'Calculate voting power from stakes', inputs: [{ name: 'address', type: 'string', required: true }], outputs: { breakdown: 'object' }, endpoint: '/a2a/governance' },
      { id: 'create-quest', name: 'Create Governance Quest', description: 'Propose new governance change with futarchy markets', inputs: [{ name: 'title', type: 'string', required: true }, { name: 'objective', type: 'string', required: true }], outputs: { questId: 'string' }, endpoint: '/a2a/governance' },
    ],
    endpoints: { jsonrpc: `http://localhost:${PORT}/a2a/governance`, rest: `http://localhost:${PORT}/api/governance` },
    metadata: { governance_type: 'futarchy', voting_mechanism: 'stake_weighted' },
  });
});

app.post('/a2a', agentRateLimit(), async (req: Request, res: Response) => {
  const body: A2ARequest = req.body;

  if (body.method !== 'message/send') {
    return res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No data part found' } });
  }

  const skillId = dataPart.data.skillId as string;
  if (!skillId) {
    return res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No skillId specified' } });
  }

  const result = await executeSkill(skillId, dataPart.data as Record<string, unknown>, req.headers['x-payment'] as string || null);

  if (result.requiresPayment) {
    return res.status(402).json({ jsonrpc: '2.0', id: body.id, error: { code: 402, message: 'Payment Required', data: result.requiresPayment } });
  }

  res.json({
    jsonrpc: '2.0',
    id: body.id,
    result: { role: 'agent', parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }], messageId: message.messageId, kind: 'message' },
  });
});

app.post('/mcp/initialize', agentRateLimit(), (_req: Request, res: Response) => {
  res.json({ protocolVersion: '2024-11-05', serverInfo: MCP_SERVER_INFO, capabilities: MCP_SERVER_INFO.capabilities });
});

app.post('/mcp/resources/list', agentRateLimit(), (_req: Request, res: Response) => {
  res.json({ resources: MCP_RESOURCES });
});

app.post('/mcp/resources/read', agentRateLimit(), async (req: Request, res: Response) => {
  const { uri } = req.body;
  let contents: unknown;

  switch (uri) {
    // Intent Framework
    case 'oif://routes': contents = await routeService.listRoutes(); break;
    case 'oif://solvers': contents = await solverService.listSolvers(); break;
    case 'oif://intents/recent': contents = await intentService.listIntents({ limit: 100 }); break;
    case 'oif://stats': contents = await intentService.getStats(); break;
    // Moderation
    case 'moderation://cases': contents = await getModerationCases({ limit: 100 }); break;
    case 'moderation://cases/active': contents = await getModerationCases({ activeOnly: true, limit: 50 }); break;
    case 'moderation://reports': contents = await getReports({ limit: 100 }); break;
    case 'moderation://stats': contents = await getModerationStats(); break;
    // Faucet (testnet only)
    case 'faucet://info':
      if (!IS_TESTNET) return res.status(403).json({ error: 'Faucet is only available on testnet' });
      contents = faucetService.getFaucetInfo();
      break;
    default: return res.status(404).json({ error: 'Resource not found' });
  }

  res.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
});

app.post('/mcp/tools/list', agentRateLimit(), (_req: Request, res: Response) => {
  res.json({ tools: MCP_TOOLS });
});

app.post('/mcp/tools/call', agentRateLimit(), async (req: Request, res: Response) => {
  const { name, arguments: args } = req.body;
  let result: unknown;
  let isError = false;

  switch (name) {
    // Intent Tools
    case 'create_intent': result = await intentService.createIntent(args); break;
    case 'get_quote': result = await intentService.getQuotes(args); break;
    case 'track_intent': result = await intentService.getIntent(args.intentId); break;
    case 'list_routes': result = await routeService.listRoutes(args); break;
    case 'list_solvers': result = await solverService.listSolvers(args); break;
    // Moderation Tools
    case 'check_ban_status': 
      if (!args.address) { result = { error: 'Address required' }; isError = true; }
      else result = await checkBanStatus(args.address);
      break;
    case 'get_moderator_profile':
      if (!args.address) { result = { error: 'Address required' }; isError = true; }
      else result = await getModeratorProfile(args.address);
      break;
    case 'get_moderation_cases': result = await getModerationCases(args); break;
    case 'get_moderation_case':
      if (!args.caseId) { result = { error: 'Case ID required' }; isError = true; }
      else result = await getModerationCase(args.caseId);
      break;
    case 'get_reports': result = await getReports(args); break;
    case 'get_agent_labels':
      if (!args.agentId) { result = { error: 'Agent ID required' }; isError = true; }
      else result = await getAgentLabels(args.agentId);
      break;
    case 'get_moderation_stats': result = await getModerationStats(); break;
    case 'prepare_stake':
      if (!args.amount) { result = { error: 'Amount required' }; isError = true; }
      else result = { action: 'sign-and-send', transaction: prepareStakeTransaction(args.amount) };
      break;
    case 'prepare_report':
      if (!args.target || !args.reason || !args.evidenceHash) { result = { error: 'target, reason, evidenceHash required' }; isError = true; }
      else result = { action: 'sign-and-send', transaction: prepareReportTransaction(args.target, args.reason, args.evidenceHash) };
      break;
    case 'prepare_vote':
      if (!args.caseId || args.voteYes === undefined) { result = { error: 'caseId and voteYes required' }; isError = true; }
      else result = { action: 'sign-and-send', transaction: prepareVoteTransaction(args.caseId, args.voteYes) };
      break;
    case 'prepare_challenge':
      if (!args.caseId || !args.stakeAmount) { result = { error: 'caseId and stakeAmount required' }; isError = true; }
      else result = { action: 'sign-and-send', transaction: prepareChallengeTransaction(args.caseId, args.stakeAmount) };
      break;
    case 'prepare_appeal':
      if (!args.caseId || !args.stakeAmount) { result = { error: 'caseId and stakeAmount required' }; isError = true; }
      else result = { action: 'sign-and-send', transaction: prepareAppealTransaction(args.caseId, args.stakeAmount) };
      break;
    // Faucet Tools (testnet only)
    case 'faucet_status':
      if (!IS_TESTNET) { result = { error: 'Faucet is only available on testnet' }; isError = true; }
      else if (!args.address) { result = { error: 'Address required' }; isError = true; }
      else result = await faucetService.getFaucetStatus(args.address);
      break;
    case 'faucet_claim':
      if (!IS_TESTNET) { result = { error: 'Faucet is only available on testnet' }; isError = true; }
      else if (!args.address) { result = { error: 'Address required' }; isError = true; }
      else result = await faucetService.claimFromFaucet(args.address);
      break;
    case 'faucet_info':
      if (!IS_TESTNET) { result = { error: 'Faucet is only available on testnet' }; isError = true; }
      else result = faucetService.getFaucetInfo();
      break;
    default: result = { error: 'Tool not found' }; isError = true;
  }

  res.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError });
});

app.get('/mcp', agentRateLimit(), (_req: Request, res: Response) => {
  res.json({ server: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version, description: MCP_SERVER_INFO.description, resources: MCP_RESOURCES, tools: MCP_TOOLS, capabilities: MCP_SERVER_INFO.capabilities });
});

app.post('/api/intents', strictRateLimit(), async (req: Request, res: Response) => {
  const { sourceChain, destinationChain, sourceToken, destinationToken, amount } = req.body;
  if (!sourceChain || !destinationChain || !sourceToken || !destinationToken || !amount) {
    return res.status(400).json({ error: 'Missing required fields', required: ['sourceChain', 'destinationChain', 'sourceToken', 'destinationToken', 'amount'] });
  }
  res.json(await intentService.createIntent(req.body));
});

app.get('/api/intents/:intentId', async (req: Request, res: Response) => {
  const intent = await intentService.getIntent(req.params.intentId);
  if (!intent) return res.status(404).json({ error: 'Intent not found' });
  res.json(intent);
});

app.get('/api/intents', async (req: Request, res: Response) => {
  const { user, status, sourceChain, destinationChain, limit } = req.query;
  res.json(await intentService.listIntents({
    user: user as string,
    status: status as string,
    sourceChain: sourceChain ? Number(sourceChain) : undefined,
    destinationChain: destinationChain ? Number(destinationChain) : undefined,
    limit: limit ? Number(limit) : 50,
  }));
});

app.post('/api/intents/:intentId/cancel', strictRateLimit(), async (req: Request, res: Response) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'User address required' });
  res.json(await intentService.cancelIntent(req.params.intentId, user));
});

app.post('/api/intents/quote', async (req: Request, res: Response) => {
  const { sourceChain, destinationChain, sourceToken, destinationToken, amount } = req.body;
  if (!sourceChain || !destinationChain || !sourceToken || !destinationToken || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  res.json(await intentService.getQuotes(req.body));
});

app.get('/api/routes', async (req: Request, res: Response) => {
  const { sourceChain, destinationChain, active } = req.query;
  res.json(await routeService.listRoutes({
    sourceChain: sourceChain ? Number(sourceChain) : undefined,
    destinationChain: destinationChain ? Number(destinationChain) : undefined,
    active: active !== undefined ? active === 'true' : undefined,
  }));
});

app.get('/api/routes/:routeId', async (req: Request, res: Response) => {
  const route = await routeService.getRoute(req.params.routeId);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

app.post('/api/routes/best', async (req: Request, res: Response) => {
  res.json(await routeService.getBestRoute(req.body));
});

app.get('/api/routes/:routeId/volume', async (req: Request, res: Response) => {
  res.json(await routeService.getVolume({ routeId: req.params.routeId, period: (req.query.period as '24h' | '7d' | '30d' | 'all') || '24h' }));
});

app.get('/api/solvers/leaderboard', async (req: Request, res: Response) => {
  const { limit, sortBy } = req.query;
  const validSortBy = ['volume', 'fills', 'reputation', 'successRate'];
  const sort = sortBy && validSortBy.includes(sortBy as string) ? sortBy as 'volume' | 'fills' | 'reputation' | 'successRate' : 'volume';
  res.json(await solverService.getLeaderboard({ limit: limit ? Number(limit) : 20, sortBy: sort }));
});

app.get('/api/solvers', async (req: Request, res: Response) => {
  const { chainId, minReputation, active } = req.query;
  res.json(await solverService.listSolvers({
    chainId: chainId ? Number(chainId) : undefined,
    minReputation: minReputation ? Number(minReputation) : undefined,
    active: active !== 'false',
  }));
});

app.get('/api/solvers/:address/liquidity', async (req: Request, res: Response) => {
  res.json(await solverService.getSolverLiquidity(req.params.address));
});

app.get('/api/solvers/:address', async (req: Request, res: Response) => {
  const solver = await solverService.getSolver(req.params.address);
  if (!solver) return res.status(404).json({ error: 'Solver not found' });
  res.json(solver);
});

app.get('/api/stats', async (_req: Request, res: Response) => {
  res.json(await intentService.getStats());
});

app.get('/api/stats/chain/:chainId', async (req: Request, res: Response) => {
  res.json(await intentService.getChainStats(Number(req.params.chainId)));
});

app.get('/api/config/chains', (_req: Request, res: Response) => {
  res.json(routeService.getChains());
});

app.get('/api/config/tokens', (req: Request, res: Response) => {
  const { chainId } = req.query;
  if (chainId) {
    res.json(routeService.getTokens(Number(chainId)));
  } else {
    res.json(routeService.getChains().map(c => ({ chainId: c.chainId, chainName: c.name, tokens: routeService.getTokens(c.chainId) })));
  }
});

// Faucet REST API (testnet only)
app.get('/api/faucet/info', (_req: Request, res: Response) => {
  if (!IS_TESTNET) return res.status(403).json({ error: 'Faucet is only available on testnet' });
  res.json(faucetService.getFaucetInfo());
});

app.get('/api/faucet/status/:address', async (req: Request, res: Response) => {
  if (!IS_TESTNET) return res.status(403).json({ error: 'Faucet is only available on testnet' });
  const { address } = req.params;
  if (!address) {
    return res.status(400).json({ error: 'Address required' });
  }
  const status = await faucetService.getFaucetStatus(address as Address);
  res.json(status);
});

app.post('/api/faucet/claim', strictRateLimit(), async (req: Request, res: Response) => {
  if (!IS_TESTNET) return res.status(403).json({ error: 'Faucet is only available on testnet' });
  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'Address required in request body' });
  }
  const result = await faucetService.claimFromFaucet(address as Address);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'gateway-a2a', version: '1.0.0', wsClients: getWebSocketServer(Number(WS_PORT)).getClientCount() });
});

getWebSocketServer(Number(WS_PORT));

app.listen(PORT, () => {
  console.log(`🌉 Gateway A2A Server running on http://localhost:${PORT}`);
  console.log(`   Network: ${getChainName(JEJU_CHAIN_ID)} (${IS_TESTNET ? 'testnet' : 'mainnet'})`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   A2A Endpoint: http://localhost:${PORT}/a2a`);
  console.log(`   MCP Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`   REST API: http://localhost:${PORT}/api`);
  console.log(`   WebSocket: ws://localhost:${WS_PORT}`);
  if (IS_TESTNET) console.log(`   Faucet: enabled`);
});
