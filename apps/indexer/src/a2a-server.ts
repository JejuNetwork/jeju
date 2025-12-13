/**
 * Indexer A2A Server
 * 
 * Agent-to-agent interface for blockchain data queries.
 * Provides indexed blockchain data via A2A protocol.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Types
// ============================================================================

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>;
    };
  };
  id: number | string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

// ============================================================================
// Agent Card
// ============================================================================

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Indexer',
  description: 'Blockchain data indexing service providing fast queries for on-chain events, transactions, and state',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Block/Transaction Skills
    { id: 'get-block', name: 'Get Block', description: 'Get block by number or hash', tags: ['query', 'block'] },
    { id: 'get-transaction', name: 'Get Transaction', description: 'Get transaction by hash', tags: ['query', 'transaction'] },
    { id: 'get-transactions', name: 'Get Transactions', description: 'Query transactions with filters', tags: ['query', 'transactions'] },
    { id: 'get-logs', name: 'Get Event Logs', description: 'Query decoded event logs', tags: ['query', 'events'] },
    
    // Account Skills
    { id: 'get-account', name: 'Get Account', description: 'Get account info including balance and nonce', tags: ['query', 'account'] },
    { id: 'get-account-transactions', name: 'Get Account Transactions', description: 'Get transactions for an account', tags: ['query', 'account'] },
    { id: 'get-token-balances', name: 'Get Token Balances', description: 'Get ERC20 token balances for an account', tags: ['query', 'tokens'] },
    { id: 'get-nft-holdings', name: 'Get NFT Holdings', description: 'Get NFTs owned by an account', tags: ['query', 'nft'] },
    
    // Contract Skills
    { id: 'get-contract', name: 'Get Contract', description: 'Get contract info including ABI if verified', tags: ['query', 'contract'] },
    { id: 'get-contract-events', name: 'Get Contract Events', description: 'Get events emitted by a contract', tags: ['query', 'events'] },
    { id: 'get-verified-contracts', name: 'Get Verified Contracts', description: 'List verified contracts', tags: ['query', 'verified'] },
    
    // ERC-8004 Agent Skills
    { id: 'get-agent', name: 'Get Agent', description: 'Get registered agent by ID', tags: ['query', 'agent'] },
    { id: 'get-agents', name: 'Get Agents', description: 'Query registered agents with filters', tags: ['query', 'agents'] },
    { id: 'get-agent-reputation', name: 'Get Agent Reputation', description: 'Get reputation metrics for an agent', tags: ['query', 'reputation'] },
    { id: 'get-agent-activity', name: 'Get Agent Activity', description: 'Get on-chain activity for an agent', tags: ['query', 'activity'] },
    
    // OIF/EIL Skills
    { id: 'get-intent', name: 'Get Intent', description: 'Get cross-chain intent by ID', tags: ['query', 'oif'] },
    { id: 'get-intents', name: 'Get Intents', description: 'Query intents with filters', tags: ['query', 'oif'] },
    { id: 'get-solver', name: 'Get Solver', description: 'Get solver info and statistics', tags: ['query', 'solver'] },
    { id: 'get-xlp', name: 'Get XLP', description: 'Get cross-chain liquidity provider info', tags: ['query', 'xlp'] },
    
    // Governance Skills
    { id: 'get-proposal', name: 'Get Proposal', description: 'Get governance proposal by ID', tags: ['query', 'governance'] },
    { id: 'get-proposals', name: 'Get Proposals', description: 'Query governance proposals', tags: ['query', 'governance'] },
    { id: 'get-votes', name: 'Get Votes', description: 'Get votes for a proposal', tags: ['query', 'votes'] },
    
    // Statistics Skills
    { id: 'get-network-stats', name: 'Get Network Stats', description: 'Get overall network statistics', tags: ['query', 'stats'] },
    { id: 'get-token-stats', name: 'Get Token Stats', description: 'Get token transfer statistics', tags: ['query', 'stats'] },
    { id: 'get-defi-stats', name: 'Get DeFi Stats', description: 'Get DeFi protocol statistics', tags: ['query', 'stats'] },
  ],
};

// ============================================================================
// Skill Execution
// ============================================================================

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
  switch (skillId) {
    // Block/Transaction Skills
    case 'get-block': {
      const blockNumber = params.blockNumber as number | undefined;
      const blockHash = params.blockHash as string | undefined;
      return {
        message: `Block data for ${blockNumber ?? blockHash}`,
        data: {
          endpoint: '/graphql',
          query: `query GetBlock($number: Int, $hash: String) {
            blocks(where: { number_eq: $number, hash_eq: $hash }, limit: 1) {
              number
              hash
              timestamp
              transactionCount
              gasUsed
              gasLimit
            }
          }`,
          variables: { number: blockNumber, hash: blockHash },
        },
      };
    }

    case 'get-transaction': {
      const hash = params.hash as string;
      if (!hash) {
        return { message: 'Transaction hash required', data: { error: 'Missing hash' } };
      }
      return {
        message: `Transaction ${hash}`,
        data: {
          endpoint: '/graphql',
          query: `query GetTx($hash: String!) {
            transactions(where: { hash_eq: $hash }, limit: 1) {
              hash
              from
              to
              value
              gasUsed
              status
              blockNumber
              timestamp
            }
          }`,
          variables: { hash },
        },
      };
    }

    case 'get-logs': {
      const { address, topics, fromBlock, toBlock, limit } = params as {
        address?: string;
        topics?: string[];
        fromBlock?: number;
        toBlock?: number;
        limit?: number;
      };
      return {
        message: 'Event logs query',
        data: {
          endpoint: '/graphql',
          query: `query GetLogs($address: String, $topic0: String, $fromBlock: Int, $toBlock: Int, $limit: Int) {
            logs(where: {
              address_eq: $address
              topic0_eq: $topic0
              block: { number_gte: $fromBlock, number_lte: $toBlock }
            }, limit: $limit, orderBy: block_number_DESC) {
              address
              topics
              data
              blockNumber
              transactionHash
            }
          }`,
          variables: { address, topic0: topics?.[0], fromBlock, toBlock, limit: limit ?? 100 },
        },
      };
    }

    // Account Skills
    case 'get-account': {
      const address = params.address as string;
      if (!address) {
        return { message: 'Address required', data: { error: 'Missing address' } };
      }
      return {
        message: `Account ${address}`,
        data: {
          endpoint: '/graphql',
          query: `query GetAccount($address: String!) {
            accounts(where: { id_eq: $address }, limit: 1) {
              id
              balance
              transactionCount
              contractCode
            }
          }`,
          variables: { address: address.toLowerCase() },
        },
      };
    }

    case 'get-token-balances': {
      const address = params.address as string;
      return {
        message: `Token balances for ${address}`,
        data: {
          endpoint: '/graphql',
          query: `query GetTokenBalances($address: String!) {
            tokenBalances(where: { account_eq: $address, balance_gt: "0" }) {
              token { address symbol decimals name }
              balance
            }
          }`,
          variables: { address: address.toLowerCase() },
        },
      };
    }

    // ERC-8004 Agent Skills
    case 'get-agent': {
      const agentId = params.agentId as string | number;
      return {
        message: `Agent ${agentId}`,
        data: {
          endpoint: '/graphql',
          query: `query GetAgent($agentId: BigInt!) {
            registeredAgents(where: { agentId_eq: $agentId }, limit: 1) {
              agentId
              owner
              name
              role
              a2aEndpoint
              mcpEndpoint
              isActive
              registeredAt
              metadata { key value }
            }
          }`,
          variables: { agentId },
        },
      };
    }

    case 'get-agents': {
      const { role, active, limit, offset } = params as {
        role?: string;
        active?: boolean;
        limit?: number;
        offset?: number;
      };
      return {
        message: 'Query agents',
        data: {
          endpoint: '/graphql',
          query: `query GetAgents($role: String, $active: Boolean, $limit: Int, $offset: Int) {
            registeredAgents(
              where: { role_eq: $role, isActive_eq: $active }
              limit: $limit
              offset: $offset
              orderBy: registeredAt_DESC
            ) {
              agentId
              owner
              name
              role
              isActive
            }
          }`,
          variables: { role, active, limit: limit ?? 50, offset: offset ?? 0 },
        },
      };
    }

    case 'get-agent-reputation': {
      const agentId = params.agentId as string | number;
      return {
        message: `Reputation for agent ${agentId}`,
        data: {
          endpoint: '/graphql',
          query: `query GetReputation($agentId: BigInt!) {
            agentFeedback(where: { agentId_eq: $agentId }) {
              score
              tag
              details
              feedbackBy
              timestamp
            }
            agentValidations(where: { agentId_eq: $agentId }) {
              validated
              validator
              timestamp
            }
          }`,
          variables: { agentId },
        },
      };
    }

    // OIF/EIL Skills
    case 'get-intent': {
      const intentId = params.intentId as string;
      return {
        message: `Intent ${intentId}`,
        data: {
          endpoint: '/graphql',
          query: `query GetIntent($intentId: String!) {
            oifIntents(where: { intentId_eq: $intentId }, limit: 1) {
              intentId
              sender
              sourceChain
              destinationChain
              sourceToken
              destinationToken
              amount
              status
              solver
              createdAt
              settledAt
            }
          }`,
          variables: { intentId },
        },
      };
    }

    case 'get-solver': {
      const solverAddress = params.address as string;
      return {
        message: `Solver ${solverAddress}`,
        data: {
          endpoint: '/graphql',
          query: `query GetSolver($address: String!) {
            oifSolvers(where: { address_eq: $address }, limit: 1) {
              address
              agentId
              stake
              isActive
              settledCount
              totalVolume
              reputation
            }
          }`,
          variables: { address: solverAddress.toLowerCase() },
        },
      };
    }

    // Governance Skills
    case 'get-proposal': {
      const proposalId = params.proposalId as string;
      return {
        message: `Proposal ${proposalId}`,
        data: {
          endpoint: '/graphql',
          query: `query GetProposal($proposalId: String!) {
            councilProposals(where: { proposalId_eq: $proposalId }, limit: 1) {
              proposalId
              title
              description
              proposer
              status
              votesFor
              votesAgainst
              createdAt
              executedAt
            }
          }`,
          variables: { proposalId },
        },
      };
    }

    case 'get-proposals': {
      const { status, limit } = params as { status?: string; limit?: number };
      return {
        message: 'Query proposals',
        data: {
          endpoint: '/graphql',
          query: `query GetProposals($status: String, $limit: Int) {
            councilProposals(
              where: { status_eq: $status }
              limit: $limit
              orderBy: createdAt_DESC
            ) {
              proposalId
              title
              status
              votesFor
              votesAgainst
              createdAt
            }
          }`,
          variables: { status, limit: limit ?? 20 },
        },
      };
    }

    // Statistics Skills
    case 'get-network-stats': {
      return {
        message: 'Network statistics',
        data: {
          endpoint: '/graphql',
          query: `query GetNetworkStats {
            networkSnapshots(limit: 1, orderBy: timestamp_DESC) {
              totalTransactions
              totalAccounts
              totalContracts
              totalTokens
              blockNumber
              timestamp
            }
          }`,
        },
      };
    }

    case 'get-token-stats': {
      return {
        message: 'Token statistics',
        data: {
          endpoint: '/graphql',
          query: `query GetTokenStats {
            tokenDistributions(limit: 10, orderBy: totalSupply_DESC) {
              token { address symbol name }
              holders
              totalSupply
              transfers24h
            }
          }`,
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found', availableSkills: AGENT_CARD.skills.map(s => s.id) },
      };
  }
}

// ============================================================================
// A2A Server
// ============================================================================

export function createIndexerA2AServer(): Hono {
  const app = new Hono();

  app.use('/*', cors());

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  app.post('/', async (c) => {
    const body = await c.req.json() as A2ARequest;

    if (body.method !== 'message/send') {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }

    const message = body.params?.message;
    if (!message?.parts) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'Invalid params' },
      });
    }

    const dataPart = message.parts.find((p) => p.kind === 'data');
    if (!dataPart?.data) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No data part found' },
      });
    }

    const skillId = dataPart.data.skillId as string;
    const result = await executeSkill(skillId, dataPart.data);

    return c.json({
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

  app.get('/', (c) => c.json({
    service: 'indexer-a2a',
    version: '1.0.0',
    agentCard: '/.well-known/agent-card.json',
  }));

  return app;
}

const A2A_PORT = parseInt(process.env.A2A_PORT || '4353');

export async function startA2AServer(): Promise<void> {
  const app = createIndexerA2AServer();
  
  const server = Bun.serve({
    port: A2A_PORT,
    fetch: app.fetch,
  });

  console.log(`📡 A2A Server running on http://localhost:${A2A_PORT}`);
}

export { AGENT_CARD as INDEXER_AGENT_CARD };
