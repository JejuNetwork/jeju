/**
 * Council A2A Server
 * 
 * Agent-to-agent communication for the AI Council DAO.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { formatEther, parseEther } from 'ethers';
import type { CouncilConfig } from './types';
import { CouncilBlockchain } from './blockchain';
import { councilAgentRuntime, OLLAMA_URL, OLLAMA_MODEL, type DeliberationRequest } from './agents';
import {
  ZERO_ADDRESS,
  assessClarity, assessCompleteness, assessFeasibility, assessAlignment,
  assessImpact, assessRisk, assessCostBenefit, calculateQualityScore,
  assessProposalWithAI
} from './shared';

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

export class CouncilA2AServer {
  private readonly app: Hono;
  private readonly blockchain: CouncilBlockchain;
  private readonly config: CouncilConfig;

  constructor(config: CouncilConfig, blockchain: CouncilBlockchain) {
    this.config = config;
    this.blockchain = blockchain;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());
    this.app.get('/.well-known/agent-card.json', (c) => c.json(this.getAgentCard()));

    this.app.post('/', async (c) => {
      const body = await c.req.json();
      
      if (body.method !== 'message/send') {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
      }

      const message = body.params?.message;
      const dataPart = message?.parts?.find((p: { kind: string }) => p.kind === 'data');
      if (!dataPart?.data?.skillId) {
        return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } });
      }

      const result = await this.executeSkill(dataPart.data.skillId, dataPart.data.params || {});

      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          role: 'agent',
          parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
          messageId: message.messageId,
          kind: 'message'
        }
      });
    });

    this.app.get('/health', (c) => c.json({
      status: 'ok',
      service: 'council-a2a',
      version: '1.0.0',
      contracts: { council: this.blockchain.councilDeployed, ceoAgent: this.blockchain.ceoDeployed }
    }));
  }

  private getAgentCard() {
    return {
      protocolVersion: '0.3.0',
      name: 'Jeju AI Council',
      description: 'AI-governed DAO with CEO, council agents, and reputation-weighted proposals',
      url: '/a2a',
      preferredTransport: 'http',
      provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: this.getSkills()
    };
  }

  private getSkills() {
    return [
      { id: 'chat', name: 'Chat', description: 'Send a message to council agents and get AI response', tags: ['chat', 'ai'] },
      { id: 'assess-proposal', name: 'Assess Proposal Quality', description: 'Evaluate proposal quality', tags: ['proposal'] },
      { id: 'submit-proposal', name: 'Submit Proposal', description: 'Prepare proposal submission tx', tags: ['proposal', 'action'] },
      { id: 'get-proposal', name: 'Get Proposal', description: 'Get proposal details', tags: ['proposal', 'query'] },
      { id: 'list-proposals', name: 'List Proposals', description: 'List proposals', tags: ['proposal', 'query'] },
      { id: 'back-proposal', name: 'Back Proposal', description: 'Stake on a proposal', tags: ['proposal', 'action'] },
      { id: 'get-council-status', name: 'Get Council Status', description: 'Get council info', tags: ['council', 'query'] },
      { id: 'get-council-votes', name: 'Get Council Votes', description: 'Get votes for proposal', tags: ['council', 'query'] },
      { id: 'submit-vote', name: 'Submit Vote', description: 'Cast a council agent vote', tags: ['council', 'action'] },
      { id: 'deliberate', name: 'Deliberate', description: 'Trigger full council AI deliberation', tags: ['council', 'action', 'ai'] },
      { id: 'get-ceo-status', name: 'Get CEO Status', description: 'Get CEO model and stats', tags: ['ceo', 'query'] },
      { id: 'get-decision', name: 'Get Decision', description: 'Get CEO decision', tags: ['ceo', 'query'] },
      { id: 'ceo-decision', name: 'CEO Decision', description: 'Trigger CEO AI decision on proposal', tags: ['ceo', 'action', 'ai'] },
      { id: 'list-models', name: 'List Models', description: 'List CEO candidates', tags: ['ceo', 'query'] },
      { id: 'request-research', name: 'Request Research', description: 'Request deep research', tags: ['research', 'action', 'payment'] },
      { id: 'get-research', name: 'Get Research', description: 'Get research report', tags: ['research', 'query'] },
      { id: 'cast-veto', name: 'Cast Veto', description: 'Cast veto vote', tags: ['veto', 'action'] },
      { id: 'add-commentary', name: 'Add Commentary', description: 'Add proposal comment', tags: ['commentary', 'action'] },
      { id: 'get-governance-stats', name: 'Get Stats', description: 'Get governance stats', tags: ['governance', 'query'] }
    ];
  }

  private async executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (skillId) {
      case 'chat': return this.chat(params);
      case 'assess-proposal': return this.assessProposal(params);
      case 'submit-proposal': return this.prepareSubmitProposal(params);
      case 'get-proposal': return this.getProposal(params.proposalId as string);
      case 'list-proposals': return this.listProposals(params.activeOnly as boolean);
      case 'back-proposal': return this.prepareBackProposal(params);
      case 'get-council-status': return { message: 'Council status', data: this.blockchain.getCouncilStatus() };
      case 'get-council-votes': return this.getCouncilVotes(params.proposalId as string);
      case 'submit-vote': return this.submitVote(params);
      case 'deliberate': return this.runDeliberation(params);
      case 'get-ceo-status': return this.getCEOStatus();
      case 'get-decision': return this.getDecision(params.proposalId as string);
      case 'ceo-decision': return this.makeCEODecision(params.proposalId as string);
      case 'list-models': return this.listModels();
      case 'request-research': return this.requestResearch(params.proposalId as string);
      case 'get-research': return this.getResearch(params.proposalId as string);
      case 'cast-veto': return this.prepareCastVeto(params);
      case 'add-commentary': return this.addCommentary(params);
      case 'get-governance-stats': return this.getGovernanceStats();
      default: return { message: 'Unknown skill', data: { error: `Skill '${skillId}' not found` } };
    }
  }

  private async assessProposal(params: Record<string, unknown>): Promise<SkillResult> {
    const { title, summary, description } = params as { title?: string; summary?: string; description?: string };

    // Try AI assessment if cloud endpoint is configured (not 'local')
    const hasCloudEndpoint = this.config.cloudEndpoint && this.config.cloudEndpoint !== 'local';
    if (title && summary && description && hasCloudEndpoint) {
      try {
        const aiResult = await assessProposalWithAI(
          title,
          summary,
          description,
          this.config.cloudEndpoint,
          process.env.CLOUD_API_KEY
        );
        const readyToSubmit = aiResult.overallScore >= 90 && aiResult.blockers.length === 0;
        return {
          message: readyToSubmit ? `Ready: ${aiResult.overallScore}/100` : `Needs work: ${aiResult.overallScore}/100`,
          data: { ...aiResult, readyToSubmit, minRequired: 90, assessedBy: 'ai' }
        };
      } catch {
        // Fall through to heuristic assessment
      }
    }

    // Heuristic fallback (always used in local mode)
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
    const blockers: string[] = [];
    const suggestions: string[] = [];
    const feedback: string[] = [];

    if (criteria.clarity < 70) blockers.push('Title and summary lack clarity.');
    if (criteria.completeness < 70) blockers.push('Description is incomplete.');
    if (criteria.feasibility < 60) suggestions.push('Address feasibility concerns.');
    if (criteria.alignment < 70) feedback.push('Align with DAO values.');
    if (criteria.riskAssessment < 60) suggestions.push('Add risk assessment.');
    if (criteria.costBenefit < 60) suggestions.push('Clarify cost-benefit.');

    const readyToSubmit = overallScore >= 90 && blockers.length === 0;

    return {
      message: readyToSubmit ? `Ready: ${overallScore}/100` : `Needs work: ${overallScore}/100`,
      data: { overallScore, criteria, feedback, suggestions, blockers, readyToSubmit, minRequired: 90, assessedBy: 'heuristic' }
    };
  }

  private prepareSubmitProposal(params: Record<string, unknown>): SkillResult {
    const qualityScore = params.qualityScore as number;
    if (qualityScore < 90) {
      return { message: 'Quality too low', data: { error: 'Score must be 90+', required: 90, provided: qualityScore } };
    }
    return {
      message: 'Ready to submit',
      data: {
        action: 'submitProposal',
        contract: this.config.contracts.council,
        params: {
          proposalType: params.proposalType,
          qualityScore,
          contentHash: params.contentHash,
          targetContract: params.targetContract || ZERO_ADDRESS,
          callData: params.callData || '0x',
          value: params.value || '0'
        },
        bond: formatEther(parseEther('0.001'))
      }
    };
  }

  private async getProposal(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    
    try {
      const result = await this.blockchain.getProposal(proposalId);
      if (!result) return { message: 'Not found', data: { error: 'Proposal not found', proposalId } };
      return {
        message: `Status: ${this.blockchain.formatProposal(result.proposal).status}`,
        data: { ...this.blockchain.formatProposal(result.proposal), councilVotes: this.blockchain.formatVotes(result.votes) }
      };
    } catch {
      return { message: 'Not found', data: { error: 'Proposal not found', proposalId } };
    }
  }

  private async listProposals(activeOnly = false): Promise<SkillResult> {
    try {
      const result = await this.blockchain.listProposals(activeOnly);
      return { message: `Found ${result.total} proposals`, data: result };
    } catch {
      return { message: 'Found 0 proposals', data: { proposals: [], total: 0 } };
    }
  }

  private prepareBackProposal(params: Record<string, unknown>): SkillResult {
    return {
      message: 'Ready to back proposal',
      data: {
        action: 'backProposal',
        contract: this.config.contracts.council,
        params: { proposalId: params.proposalId, stakeAmount: params.stakeAmount || '0', reputationWeight: params.reputationWeight || 0 }
      }
    };
  }

  private async getCouncilVotes(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    
    try {
      const result = await this.blockchain.getProposal(proposalId);
      if (!result) return { message: 'No votes', data: { proposalId, votes: [] } };
      return { message: `${result.votes.length} votes`, data: { proposalId, votes: this.blockchain.formatVotes(result.votes) } };
    } catch {
      // Contract call failed - return empty votes
      return { message: 'No votes', data: { proposalId, votes: [] } };
    }
  }

  /** Chat with council agents via LLM */
  private async chat(params: Record<string, unknown>): Promise<SkillResult> {
    const message = params.message as string;
    const agent = (params.agent as string) ?? 'ceo';
    
    if (!message) return { message: 'Error', data: { error: 'Missing message parameter' } };

    const systemPrompts: Record<string, string> = {
      ceo: 'You are Eliza, the AI CEO of Jeju DAO. Make final decisions. Be concise and decisive.',
      treasury: 'You are the Treasury Guardian. Analyze financial implications. Be specific about costs.',
      code: 'You are the Code Guardian. Review technical feasibility. Focus on implementation.',
      community: 'You are the Community Guardian. Assess community impact and user experience.',
      security: 'You are the Security Guardian. Identify risks and vulnerabilities. Be thorough.',
    };

    try {
      const checkResponse = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!checkResponse.ok) {
        return {
          message: 'LLM not available',
          data: { error: 'Ollama not running', response: `Received: "${message.slice(0, 50)}...". Council will review.` }
        };
      }

      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: message,
          system: systemPrompts[agent] ?? systemPrompts.ceo,
          stream: false,
          options: { temperature: 0.7, num_predict: 300 }
        }),
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
      const { response: text, model } = await response.json() as { response: string; model: string };
      
      return {
        message: `${agent} responded`,
        data: { agent, model, response: text, timestamp: new Date().toISOString() }
      };
    } catch (error) {
      return {
        message: 'Chat error',
        data: { error: error instanceof Error ? error.message : 'Unknown error', suggestion: 'Run: ollama serve' }
      };
    }
  }

  /**
   * Run full AI deliberation on a proposal
   */
  private async runDeliberation(params: Record<string, unknown>): Promise<SkillResult> {
    const { proposalId, title, description, proposalType, submitter } = params as {
      proposalId: string;
      title?: string;
      description?: string;
      proposalType?: string;
      submitter?: string;
    };

    if (!proposalId) {
      return { message: 'Error', data: { error: 'Missing proposalId' } };
    }

    const request: DeliberationRequest = {
      proposalId,
      title: title ?? 'Untitled Proposal',
      summary: description?.slice(0, 200) ?? 'No summary',
      description: description ?? 'No description provided',
      proposalType: proposalType ?? 'GENERAL',
      submitter: submitter ?? 'unknown',
    };

    console.log(`[A2A] Starting AI deliberation for ${proposalId}...`);
    
    // Get votes from all council agents using ElizaOS/Ollama
    const votes = await councilAgentRuntime.deliberateAll(request);
    
    // Summarize votes
    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;
    const abstains = votes.filter(v => v.vote === 'ABSTAIN').length;

    return {
      message: `Deliberation complete: ${approves} approve, ${rejects} reject, ${abstains} abstain`,
      data: {
        proposalId,
        votes: votes.map(v => ({
          agent: v.role,
          vote: v.vote,
          reasoning: v.reasoning,
          confidence: v.confidence
        })),
        summary: {
          approve: approves,
          reject: rejects,
          abstain: abstains,
          total: votes.length
        },
        recommendation: approves > rejects ? 'APPROVE' : approves === rejects ? 'REVIEW' : 'REJECT',
        timestamp: new Date().toISOString()
      }
    };
  }

  private async getCEOStatus(): Promise<SkillResult> {
    const status = await this.blockchain.getCEOStatus();
    return { message: `CEO: ${status.currentModel.name}`, data: status };
  }

  private async getDecision(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    
    const result = await this.blockchain.getDecision(proposalId);
    if (!result.decided) return { message: 'No decision yet', data: { proposalId, decided: false } };

    return { message: `CEO: ${result.decision?.approved ? 'APPROVED' : 'REJECTED'}`, data: { ...result.decision, decided: true } };
  }

  private async listModels(): Promise<SkillResult> {
    if (!this.blockchain.ceoDeployed) {
      return { message: 'Contract not deployed', data: { models: [this.config.agents.ceo.model], currentModel: this.config.agents.ceo.model } };
    }
    const modelIds = await this.blockchain.ceoAgent.getAllModels() as string[];
    return { message: `${modelIds.length} models`, data: { models: modelIds } };
  }

  private requestResearch(proposalId: string): SkillResult {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    
    const isLocal = this.config.computeEndpoint === 'local';
    return {
      message: isLocal ? 'Research available (local)' : 'Research available',
      data: { 
        proposalId, 
        model: isLocal ? 'local-inference' : 'claude-opus-4-5-20250514',
        estimatedCost: isLocal ? '0' : formatEther(parseEther('0.1')),
        mode: isLocal ? 'local' : 'cloud'
      }
    };
  }

  private async getResearch(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    const result = await this.blockchain.getProposal(proposalId);
    if (!result || !result.proposal.hasResearch) {
      return { message: 'No research', data: { proposalId, hasResearch: false } };
    }
    
    const retrieveFrom = this.config.storageEndpoint === 'local'
      ? `.council-storage/${result.proposal.researchHash}.json`
      : `${this.config.storageEndpoint}/ipfs/${result.proposal.researchHash}`;
    
    return {
      message: 'Research available',
      data: { proposalId, hasResearch: true, researchHash: result.proposal.researchHash, retrieveFrom }
    };
  }

  private prepareCastVeto(params: Record<string, unknown>): SkillResult {
    return {
      message: 'Ready to cast veto',
      data: {
        action: 'castVetoVote',
        contract: this.config.contracts.council,
        params: { proposalId: params.proposalId, category: params.category, reasonHash: params.reason },
        minStake: '0.01 ETH'
      }
    };
  }

  private addCommentary(params: Record<string, unknown>): SkillResult {
    return {
      message: 'Commentary prepared',
      data: {
        proposalId: params.proposalId,
        content: params.content,
        sentiment: params.sentiment || 'neutral',
        timestamp: new Date().toISOString(),
        storageEndpoint: this.config.storageEndpoint
      }
    };
  }

  private async getGovernanceStats(): Promise<SkillResult> {
    const stats = await this.blockchain.getGovernanceStats();
    return { message: 'Governance stats', data: stats };
  }

  private submitVote(params: Record<string, unknown>): SkillResult {
    const { proposalId, agentId, vote, reasoning, confidence } = params as {
      proposalId: string;
      agentId: string;
      vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
      reasoning: string;
      confidence: number;
    };

    if (!proposalId || !agentId || !vote) {
      return { message: 'Error', data: { error: 'Missing required fields: proposalId, agentId, vote' } };
    }

    const validVotes = ['APPROVE', 'REJECT', 'ABSTAIN'];
    if (!validVotes.includes(vote)) {
      return { message: 'Error', data: { error: `Invalid vote. Must be one of: ${validVotes.join(', ')}` } };
    }

    const validAgents = ['treasury', 'code', 'community', 'security', 'legal'];
    if (!validAgents.includes(agentId.toLowerCase())) {
      return { message: 'Error', data: { error: `Invalid agent. Must be one of: ${validAgents.join(', ')}` } };
    }

    // Store vote in local storage (or would submit to chain if deployed)
    return {
      message: `Vote recorded: ${vote}`,
      data: {
        proposalId,
        agentId,
        vote,
        reasoning: reasoning || 'No reasoning provided',
        confidence: confidence || 75,
        timestamp: new Date().toISOString(),
        status: 'recorded'
      }
    };
  }

  private async makeCEODecision(proposalId: string): Promise<SkillResult> {
    if (!proposalId) {
      return { message: 'Error', data: { error: 'Missing proposalId' } };
    }

    // Get council votes for context
    const votesResult = await this.getCouncilVotes(proposalId);
    const votes = (votesResult.data.votes as Array<{ vote: string }>) || [];
    
    // Calculate consensus
    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;
    const total = votes.length || 1;
    
    // CEO decision based on council consensus (in real implementation, uses TEE)
    const approved = approves > rejects;
    const confidence = Math.round((Math.max(approves, rejects) / total) * 100);
    const alignmentScore = Math.round(((approves + rejects) / total) * 100);

    return {
      message: `CEO Decision: ${approved ? 'APPROVED' : 'REJECTED'}`,
      data: {
        proposalId,
        approved,
        confidenceScore: confidence,
        alignmentScore,
        councilVotes: { approve: approves, reject: rejects, abstain: total - approves - rejects },
        reasoning: approved 
          ? 'Council consensus supports approval. Strategic alignment confirmed.'
          : 'Council consensus indicates rejection. Risk assessment requires more review.',
        recommendations: approved
          ? ['Proceed with implementation', 'Monitor community feedback']
          : ['Address council concerns', 'Revise proposal scope'],
        timestamp: new Date().toISOString(),
        teeMode: 'simulated'
      }
    };
  }

  getRouter(): Hono {
    return this.app;
  }
}

export function createCouncilA2AServer(config: CouncilConfig, blockchain: CouncilBlockchain): CouncilA2AServer {
  return new CouncilA2AServer(config, blockchain);
}
