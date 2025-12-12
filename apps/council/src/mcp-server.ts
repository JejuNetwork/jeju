/**
 * Council MCP Server
 * 
 * Model Context Protocol server for AI agent tool access.
 */

import { Hono } from 'hono';
import type { CouncilConfig } from './types';
import { CouncilBlockchain } from './blockchain';
import {
  PROPOSAL_STATUS, PROPOSAL_TYPES, ZERO_ADDRESS,
  assessClarity, assessCompleteness, assessFeasibility, assessAlignment,
  assessImpact, assessRisk, assessCostBenefit, calculateQualityScore
} from './shared';

interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: readonly string[] }>;
    required?: string[];
  };
}

export class CouncilMCPServer {
  private readonly app: Hono;
  private readonly blockchain: CouncilBlockchain;
  private readonly config: CouncilConfig;

  constructor(config: CouncilConfig, blockchain: CouncilBlockchain) {
    this.config = config;
    this.blockchain = blockchain;
    this.app = new Hono();
    this.setupRoutes();
  }

  private getResources(): MCPResource[] {
    return [
      { uri: 'council://proposals/active', name: 'Active Proposals', description: 'Current proposals', mimeType: 'application/json' },
      { uri: 'council://proposals/all', name: 'All Proposals', description: 'Proposal history', mimeType: 'application/json' },
      { uri: 'council://ceo/status', name: 'CEO Status', description: 'CEO model and stats', mimeType: 'application/json' },
      { uri: 'council://governance/stats', name: 'Governance Stats', description: 'DAO statistics', mimeType: 'application/json' },
      { uri: 'council://council/agents', name: 'Council Agents', description: 'Council roles', mimeType: 'application/json' }
    ];
  }

  private getTools(): MCPTool[] {
    return [
      {
        name: 'assess_proposal_quality',
        description: 'Assess proposal quality',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Proposal title' },
            summary: { type: 'string', description: 'Summary (50-500 chars)' },
            description: { type: 'string', description: 'Full description' },
            proposalType: { type: 'string', description: 'Type', enum: PROPOSAL_TYPES }
          },
          required: ['title', 'summary', 'description', 'proposalType']
        }
      },
      {
        name: 'get_proposal',
        description: 'Get proposal details',
        inputSchema: { type: 'object', properties: { proposalId: { type: 'string', description: 'Proposal ID' } }, required: ['proposalId'] }
      },
      {
        name: 'list_proposals',
        description: 'List proposals',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by status', enum: PROPOSAL_STATUS },
            type: { type: 'string', description: 'Filter by type', enum: PROPOSAL_TYPES },
            limit: { type: 'string', description: 'Max results' }
          }
        }
      },
      {
        name: 'get_council_votes',
        description: 'Get council votes',
        inputSchema: { type: 'object', properties: { proposalId: { type: 'string', description: 'Proposal ID' } }, required: ['proposalId'] }
      },
      {
        name: 'get_ceo_decision',
        description: 'Get CEO decision',
        inputSchema: { type: 'object', properties: { proposalId: { type: 'string', description: 'Proposal ID' } }, required: ['proposalId'] }
      },
      {
        name: 'prepare_proposal_submission',
        description: 'Prepare submission tx',
        inputSchema: {
          type: 'object',
          properties: {
            proposalType: { type: 'string', description: 'Type', enum: PROPOSAL_TYPES },
            qualityScore: { type: 'string', description: 'Score (0-100)' },
            contentHash: { type: 'string', description: 'IPFS hash' },
            targetContract: { type: 'string', description: 'Target contract' },
            callData: { type: 'string', description: 'Calldata' },
            value: { type: 'string', description: 'Value in wei' }
          },
          required: ['proposalType', 'qualityScore', 'contentHash']
        }
      },
      {
        name: 'request_deep_research',
        description: 'Request deep research',
        inputSchema: { type: 'object', properties: { proposalId: { type: 'string', description: 'Proposal ID' } }, required: ['proposalId'] }
      },
      {
        name: 'check_veto_status',
        description: 'Check veto status',
        inputSchema: { type: 'object', properties: { proposalId: { type: 'string', description: 'Proposal ID' } }, required: ['proposalId'] }
      }
    ];
  }

  private setupRoutes(): void {
    this.app.get('/', (c) => c.json({
      server: 'jeju-council',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      resources: this.getResources(),
      tools: this.getTools()
    }));

    this.app.post('/initialize', (c) => c.json({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'jeju-council', version: '1.0.0' },
      capabilities: { resources: true, tools: true, prompts: false }
    }));

    this.app.post('/resources/list', (c) => c.json({ resources: this.getResources() }));

    this.app.post('/resources/read', async (c) => {
      const { uri } = await c.req.json();
      const contents = await this.readResource(uri);
      if (!contents) return c.json({ error: 'Resource not found' }, 404);
      return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
    });

    this.app.post('/tools/list', (c) => c.json({ tools: this.getTools() }));

    this.app.post('/tools/call', async (c) => {
      const { name, arguments: args } = await c.req.json();
      const { result, isError } = await this.callTool(name, args);
      return c.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError });
    });

    this.app.get('/health', (c) => c.json({
      status: 'ok',
      server: 'council-mcp',
      version: '1.0.0',
      contracts: { council: this.blockchain.councilDeployed, ceoAgent: this.blockchain.ceoDeployed }
    }));
  }

  private async readResource(uri: string): Promise<Record<string, unknown> | null> {
    switch (uri) {
      case 'council://proposals/active':
        return this.blockchain.listProposals(true, 50);
      case 'council://proposals/all':
        return this.blockchain.listProposals(false, 100);
      case 'council://ceo/status':
        return this.blockchain.getCEOStatus();
      case 'council://governance/stats':
        return this.blockchain.getGovernanceStats();
      case 'council://council/agents':
        return this.blockchain.getCouncilStatus();
      default:
        return null;
    }
  }

  private async callTool(name: string, args: Record<string, string>): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    switch (name) {
      case 'assess_proposal_quality':
        return { result: this.assessProposalQuality(args), isError: false };
      case 'get_proposal':
        return this.getProposal(args.proposalId);
      case 'list_proposals':
        return this.listProposals(args);
      case 'get_council_votes':
        return this.getCouncilVotes(args.proposalId);
      case 'get_ceo_decision':
        return this.getCEODecision(args.proposalId);
      case 'prepare_proposal_submission':
        return { result: this.prepareProposalSubmission(args), isError: false };
      case 'request_deep_research':
        return { result: this.requestDeepResearch(args.proposalId), isError: false };
      case 'check_veto_status':
        return this.checkVetoStatus(args.proposalId);
      default:
        return { result: { error: 'Tool not found' }, isError: true };
    }
  }

  private assessProposalQuality(args: Record<string, string>): Record<string, unknown> {
    const { title, summary, description } = args;
    const criteria = {
      clarity: assessClarity(title, summary, description),
      completeness: assessCompleteness(description),
      feasibility: assessFeasibility(description),
      alignment: assessAlignment(description),
      impact: assessImpact(description),
      riskAssessment: assessRisk(description),
      costBenefit: assessCostBenefit(description)
    };
    const overallScore = calculateQualityScore(criteria);

    const feedback: string[] = [];
    if (criteria.clarity < 70) feedback.push('Improve clarity');
    if (criteria.completeness < 70) feedback.push('Add details');
    if (criteria.alignment < 70) feedback.push('Align with values');
    if (criteria.riskAssessment < 60) feedback.push('Add risks');

    return { overallScore, criteria, feedback, readyToSubmit: overallScore >= 90, minRequired: 90 };
  }

  private async getProposal(proposalId: string): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const result = await this.blockchain.getProposal(proposalId);
    if (!result) return { result: { error: 'Contract not deployed' }, isError: true };
    if (result.proposal.createdAt === 0n) return { result: { error: 'Proposal not found' }, isError: true };
    return { result: this.blockchain.formatProposal(result.proposal), isError: false };
  }

  private async listProposals(args: Record<string, string>): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const limit = parseInt(args.limit || '20', 10);
    const result = await this.blockchain.listProposals(true, limit);
    
    let proposals = result.proposals;
    if (args.status) proposals = proposals.filter(p => p.status === args.status);
    if (args.type) proposals = proposals.filter(p => p.type === args.type);
    
    return { result: { proposals }, isError: false };
  }

  private async getCouncilVotes(proposalId: string): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const result = await this.blockchain.getProposal(proposalId);
    if (!result) return { result: { error: 'Contract not deployed', votes: [] }, isError: false };
    return { result: { proposalId, votes: this.blockchain.formatVotes(result.votes) }, isError: false };
  }

  private async getCEODecision(proposalId: string): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const result = await this.blockchain.getDecision(proposalId);
    if (!result.decided) return { result: { decided: false, proposalId }, isError: false };
    return { result: { decided: true, ...result.decision }, isError: false };
  }

  private prepareProposalSubmission(args: Record<string, string>): Record<string, unknown> {
    const typeIndex = PROPOSAL_TYPES.indexOf(args.proposalType as typeof PROPOSAL_TYPES[number]);
    if (typeIndex === -1) return { error: 'Invalid type' };
    return {
      transaction: {
        to: this.config.contracts.council,
        method: 'submitProposal',
        params: {
          proposalType: typeIndex,
          qualityScore: parseInt(args.qualityScore, 10),
          contentHash: args.contentHash,
          targetContract: args.targetContract || ZERO_ADDRESS,
          callData: args.callData || '0x',
          value: args.value || '0'
        },
        bond: '0.001 ETH'
      }
    };
  }

  private requestDeepResearch(proposalId: string): Record<string, unknown> {
    if (this.config.computeEndpoint === 'local') {
      return {
        proposalId,
        service: 'deep-research',
        model: 'local-inference',
        mode: 'local',
        estimatedCost: '0 ETH (local mode)'
      };
    }
    return {
      proposalId,
      service: 'deep-research',
      model: 'claude-opus-4-5-20250514',
      endpoint: `${this.config.computeEndpoint}/a2a`,
      estimatedCost: '0.1 ETH'
    };
  }

  private async checkVetoStatus(proposalId: string): Promise<{ result: Record<string, unknown>; isError: boolean }> {
    const result = await this.blockchain.getProposal(proposalId);
    if (!result) return { result: { error: 'Contract not deployed' }, isError: true };
    if (result.proposal.status !== 5) return { result: { error: 'Not in APPROVED status' }, isError: true };

    const gracePeriodEnd = Number(result.proposal.gracePeriodEnd);
    const now = Math.floor(Date.now() / 1000);
    
    return {
      result: {
        proposalId,
        inGracePeriod: now < gracePeriodEnd,
        gracePeriodEnds: new Date(gracePeriodEnd * 1000).toISOString(),
        timeRemaining: `${Math.max(0, gracePeriodEnd - now)} seconds`
      },
      isError: false
    };
  }

  getRouter(): Hono {
    return this.app;
  }
}

export function createCouncilMCPServer(config: CouncilConfig, blockchain: CouncilBlockchain): CouncilMCPServer {
  return new CouncilMCPServer(config, blockchain);
}
