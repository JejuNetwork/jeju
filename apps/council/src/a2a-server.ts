/**
 * Council A2A Server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { formatEther, parseEther } from 'ethers';
import type { CouncilConfig } from './types';
import { CouncilBlockchain } from './blockchain';
import { councilAgentRuntime, type DeliberationRequest } from './agents';
import { storeVote, getVotes, generateResearch, getResearch, store, checkOllama, ollamaGenerate, OLLAMA_MODEL } from './local-services';
import { ZERO_ADDRESS, assessClarity, assessCompleteness, assessFeasibility, assessAlignment, assessImpact, assessRisk, assessCostBenefit, calculateQualityScore, assessProposalWithAI } from './shared';
import { getTEEMode } from './tee';

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
      skills: [
        { id: 'chat', name: 'Chat', description: 'Chat with council agents (requires Ollama)', tags: ['chat', 'ai'] },
        { id: 'assess-proposal', name: 'Assess Proposal', description: 'Evaluate proposal quality', tags: ['proposal'] },
        { id: 'submit-proposal', name: 'Submit Proposal', description: 'Prepare proposal submission', tags: ['proposal', 'action'] },
        { id: 'get-proposal', name: 'Get Proposal', description: 'Get proposal details', tags: ['proposal', 'query'] },
        { id: 'list-proposals', name: 'List Proposals', description: 'List proposals', tags: ['proposal', 'query'] },
        { id: 'back-proposal', name: 'Back Proposal', description: 'Stake on proposal', tags: ['proposal', 'action'] },
        { id: 'get-council-status', name: 'Council Status', description: 'Get council info', tags: ['council', 'query'] },
        { id: 'get-council-votes', name: 'Council Votes', description: 'Get votes for proposal', tags: ['council', 'query'] },
        { id: 'submit-vote', name: 'Submit Vote', description: 'Cast council vote', tags: ['council', 'action'] },
        { id: 'deliberate', name: 'Deliberate', description: 'Run council deliberation (requires Ollama)', tags: ['council', 'action', 'ai'] },
        { id: 'get-ceo-status', name: 'CEO Status', description: 'Get CEO model and stats', tags: ['ceo', 'query'] },
        { id: 'get-decision', name: 'Get Decision', description: 'Get CEO decision', tags: ['ceo', 'query'] },
        { id: 'ceo-decision', name: 'CEO Decision', description: 'Trigger CEO decision', tags: ['ceo', 'action', 'ai'] },
        { id: 'list-models', name: 'List Models', description: 'List CEO candidates', tags: ['ceo', 'query'] },
        { id: 'request-research', name: 'Request Research', description: 'Request research (requires Ollama)', tags: ['research', 'action'] },
        { id: 'get-research', name: 'Get Research', description: 'Get research report', tags: ['research', 'query'] },
        { id: 'cast-veto', name: 'Cast Veto', description: 'Cast veto vote', tags: ['veto', 'action'] },
        { id: 'add-commentary', name: 'Add Commentary', description: 'Add comment', tags: ['commentary', 'action'] },
        { id: 'get-governance-stats', name: 'Stats', description: 'Governance stats', tags: ['governance', 'query'] }
      ]
    };
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
      case 'request-research': return this.requestResearch(params);
      case 'get-research': return this.getResearchResult(params.proposalId as string);
      case 'cast-veto': return this.prepareCastVeto(params);
      case 'add-commentary': return this.addCommentary(params);
      case 'get-governance-stats': return this.getGovernanceStats();
      default: return { message: 'Unknown skill', data: { error: `Skill '${skillId}' not found` } };
    }
  }

  private async chat(params: Record<string, unknown>): Promise<SkillResult> {
    const message = params.message as string;
    const agent = (params.agent as string) ?? 'ceo';
    if (!message) return { message: 'Error', data: { error: 'Missing message parameter' } };

    const ollamaUp = await checkOllama();
    if (!ollamaUp) {
      return { message: 'LLM unavailable', data: { error: 'Ollama not running. Start with: ollama serve' } };
    }

    const systemPrompts: Record<string, string> = {
      ceo: 'You are Eliza, AI CEO of Jeju DAO. Make decisive governance decisions.',
      treasury: 'You are the Treasury Guardian. Analyze financial implications.',
      code: 'You are the Code Guardian. Review technical feasibility.',
      community: 'You are the Community Guardian. Assess community impact.',
      security: 'You are the Security Guardian. Identify risks and vulnerabilities.',
    };

    const response = await ollamaGenerate(message, systemPrompts[agent] ?? systemPrompts.ceo);
    return { message: `${agent} responded`, data: { agent, model: OLLAMA_MODEL, response, timestamp: new Date().toISOString() } };
  }

  private async assessProposal(params: Record<string, unknown>): Promise<SkillResult> {
    const { title, summary, description } = params as { title?: string; summary?: string; description?: string };

    // Try AI assessment first
    const ollamaUp = await checkOllama();
    if (ollamaUp && title && summary && description) {
      const prompt = `Assess this DAO proposal and return JSON scores 0-100:

Title: ${title}
Summary: ${summary}
Description: ${description}

Return ONLY JSON:
{"clarity":N,"completeness":N,"feasibility":N,"alignment":N,"impact":N,"riskAssessment":N,"costBenefit":N,"feedback":[],"blockers":[],"suggestions":[]}`;

      try {
        const response = await ollamaGenerate(prompt, 'You are a DAO proposal evaluator. Return only valid JSON.');
        const parsed = JSON.parse(response) as { clarity: number; completeness: number; feasibility: number; alignment: number; impact: number; riskAssessment: number; costBenefit: number; feedback: string[]; blockers: string[]; suggestions: string[] };
        const overallScore = calculateQualityScore(parsed);
        return {
          message: overallScore >= 90 ? `Ready: ${overallScore}/100` : `Needs work: ${overallScore}/100`,
          data: { overallScore, criteria: parsed, feedback: parsed.feedback, blockers: parsed.blockers, suggestions: parsed.suggestions, readyToSubmit: overallScore >= 90, assessedBy: 'ollama' }
        };
      } catch {
        // Fall through to heuristic
      }
    }

    // Try cloud AI if configured
    const hasCloud = this.config.cloudEndpoint && this.config.cloudEndpoint !== 'local';
    if (hasCloud && title && summary && description) {
      try {
        const result = await assessProposalWithAI(title, summary, description, this.config.cloudEndpoint, process.env.CLOUD_API_KEY);
        return {
          message: result.overallScore >= 90 ? `Ready: ${result.overallScore}/100` : `Needs work: ${result.overallScore}/100`,
          data: { ...result, readyToSubmit: result.overallScore >= 90, assessedBy: 'cloud' }
        };
      } catch {
        // Fall through to heuristic
      }
    }

    // Heuristic fallback (clearly labeled)
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

    return {
      message: `Heuristic assessment: ${overallScore}/100 (no LLM available)`,
      data: { overallScore, criteria, readyToSubmit: overallScore >= 90, assessedBy: 'heuristic', warning: 'LLM unavailable - using basic heuristics' }
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
        params: { proposalType: params.proposalType, qualityScore, contentHash: params.contentHash, targetContract: params.targetContract || ZERO_ADDRESS, callData: params.callData || '0x', value: params.value || '0' },
        bond: formatEther(parseEther('0.001'))
      }
    };
  }

  private async getProposal(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    const result = await this.blockchain.getProposal(proposalId);
    if (!result) return { message: 'Not found', data: { error: 'Proposal not found or contract not deployed', proposalId } };
    return { message: `Status: ${this.blockchain.formatProposal(result.proposal).status}`, data: { ...this.blockchain.formatProposal(result.proposal), councilVotes: this.blockchain.formatVotes(result.votes) } };
  }

  private async listProposals(activeOnly = false): Promise<SkillResult> {
    const result = await this.blockchain.listProposals(activeOnly);
    return { message: `Found ${result.total} proposals`, data: result };
  }

  private prepareBackProposal(params: Record<string, unknown>): SkillResult {
    return {
      message: 'Ready to back',
      data: { action: 'backProposal', contract: this.config.contracts.council, params: { proposalId: params.proposalId, stakeAmount: params.stakeAmount || '0', reputationWeight: params.reputationWeight || 0 } }
    };
  }

  private async getCouncilVotes(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    
    // Get from local storage first
    const localVotes = getVotes(proposalId);
    if (localVotes.length > 0) {
      return { message: `${localVotes.length} votes`, data: { proposalId, votes: localVotes, source: 'local' } };
    }

    // Try blockchain
    const result = await this.blockchain.getProposal(proposalId);
    if (!result) return { message: 'No votes', data: { proposalId, votes: [] } };
    return { message: `${result.votes.length} votes`, data: { proposalId, votes: this.blockchain.formatVotes(result.votes), source: 'chain' } };
  }

  private submitVote(params: Record<string, unknown>): SkillResult {
    const { proposalId, agentId, vote, reasoning, confidence } = params as { proposalId: string; agentId: string; vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'; reasoning: string; confidence: number };

    if (!proposalId || !agentId || !vote) {
      return { message: 'Error', data: { error: 'Missing: proposalId, agentId, vote' } };
    }

    if (!['APPROVE', 'REJECT', 'ABSTAIN'].includes(vote)) {
      return { message: 'Error', data: { error: 'Invalid vote. Must be: APPROVE, REJECT, or ABSTAIN' } };
    }

    const validAgents = ['treasury', 'code', 'community', 'security', 'legal'];
    if (!validAgents.includes(agentId.toLowerCase())) {
      return { message: 'Error', data: { error: `Invalid agent. Must be: ${validAgents.join(', ')}` } };
    }

    // Actually store the vote
    storeVote(proposalId, { role: agentId.toUpperCase(), vote, reasoning: reasoning || 'No reasoning', confidence: confidence || 75 });

    return {
      message: `Vote stored: ${vote}`,
      data: { proposalId, agentId, vote, reasoning: reasoning || 'No reasoning', confidence: confidence || 75, timestamp: new Date().toISOString(), status: 'stored' }
    };
  }

  private async runDeliberation(params: Record<string, unknown>): Promise<SkillResult> {
    const { proposalId, title, description, proposalType, submitter } = params as { proposalId: string; title?: string; description?: string; proposalType?: string; submitter?: string };
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };

    const ollamaUp = await checkOllama();
    if (!ollamaUp) {
      return { message: 'LLM unavailable', data: { error: 'Deliberation requires Ollama. Start with: ollama serve' } };
    }

    const request: DeliberationRequest = {
      proposalId,
      title: title ?? 'Untitled',
      summary: description?.slice(0, 200) ?? 'No summary',
      description: description ?? 'No description',
      proposalType: proposalType ?? 'GENERAL',
      submitter: submitter ?? 'unknown',
    };

    const votes = await councilAgentRuntime.deliberateAll(request);
    
    // Store all votes
    for (const v of votes) {
      storeVote(proposalId, { role: v.role, vote: v.vote, reasoning: v.reasoning, confidence: v.confidence });
    }

    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;

    return {
      message: `Deliberation: ${approves} approve, ${rejects} reject`,
      data: {
        proposalId,
        votes: votes.map(v => ({ agent: v.role, vote: v.vote, reasoning: v.reasoning, confidence: v.confidence })),
        summary: { approve: approves, reject: rejects, abstain: votes.length - approves - rejects, total: votes.length },
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
    if (!result.decided) return { message: 'No decision', data: { proposalId, decided: false } };
    return { message: `CEO: ${result.decision?.approved ? 'APPROVED' : 'REJECTED'}`, data: { ...result.decision, decided: true } };
  }

  private async listModels(): Promise<SkillResult> {
    if (!this.blockchain.ceoDeployed) {
      return { message: 'Contract not deployed', data: { models: [this.config.agents.ceo.model], currentModel: this.config.agents.ceo.model } };
    }
    const modelIds = await this.blockchain.ceoAgent.getAllModels() as string[];
    return { message: `${modelIds.length} models`, data: { models: modelIds } };
  }

  private async requestResearch(params: Record<string, unknown>): Promise<SkillResult> {
    const proposalId = params.proposalId as string;
    const description = (params.description as string) ?? 'Proposal for DAO governance';
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };

    const ollamaUp = await checkOllama();
    if (!ollamaUp) {
      return { message: 'LLM unavailable', data: { error: 'Research requires Ollama. Start with: ollama serve' } };
    }

    const research = await generateResearch(proposalId, description);
    return {
      message: 'Research complete',
      data: { proposalId, model: research.model, reportLength: research.report.length, preview: research.report.slice(0, 500) }
    };
  }

  private getResearchResult(proposalId: string): SkillResult {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };
    const research = getResearch(proposalId);
    if (!research) return { message: 'No research', data: { proposalId, hasResearch: false } };
    return { message: 'Research available', data: { proposalId, hasResearch: true, ...research } };
  }

  private prepareCastVeto(params: Record<string, unknown>): SkillResult {
    return {
      message: 'Ready to veto',
      data: { action: 'castVetoVote', contract: this.config.contracts.council, params: { proposalId: params.proposalId, category: params.category, reasonHash: params.reason }, minStake: '0.01 ETH' }
    };
  }

  private async addCommentary(params: Record<string, unknown>): Promise<SkillResult> {
    const { proposalId, content, sentiment } = params as { proposalId: string; content: string; sentiment?: string };
    if (!proposalId || !content) return { message: 'Error', data: { error: 'Missing proposalId or content' } };

    // Store the comment
    const hash = await store({ type: 'commentary', proposalId, content, sentiment: sentiment || 'neutral', timestamp: Date.now() });

    return {
      message: 'Commentary stored',
      data: { proposalId, content, sentiment: sentiment || 'neutral', timestamp: new Date().toISOString(), hash }
    };
  }

  private async getGovernanceStats(): Promise<SkillResult> {
    const stats = await this.blockchain.getGovernanceStats();
    return { message: 'Governance stats', data: stats };
  }

  private async makeCEODecision(proposalId: string): Promise<SkillResult> {
    if (!proposalId) return { message: 'Error', data: { error: 'Missing proposalId' } };

    const ollamaUp = await checkOllama();
    if (!ollamaUp) {
      return { message: 'LLM unavailable', data: { error: 'CEO decision requires Ollama. Start with: ollama serve' } };
    }

    const votes = getVotes(proposalId);
    const approves = votes.filter(v => v.vote === 'APPROVE').length;
    const rejects = votes.filter(v => v.vote === 'REJECT').length;
    const total = votes.length || 1;

    // Use real LLM for decision reasoning
    const prompt = `As AI CEO, make a decision on this proposal.

Council votes: ${approves} approve, ${rejects} reject, ${total - approves - rejects} abstain

Vote details:
${votes.map(v => `- ${v.role}: ${v.vote} (${v.confidence}%) - ${v.reasoning}`).join('\n')}

Provide your decision as: APPROVED or REJECTED, with reasoning.`;

    const response = await ollamaGenerate(prompt, 'You are Eliza, AI CEO of Jeju DAO. Make decisive, well-reasoned governance decisions.');
    const approved = response.toLowerCase().includes('approved') && !response.toLowerCase().includes('rejected');

    const decision = {
      proposalId,
      approved,
      confidenceScore: Math.round((Math.max(approves, rejects) / total) * 100),
      alignmentScore: Math.round(((approves + rejects) / total) * 100),
      councilVotes: { approve: approves, reject: rejects, abstain: total - approves - rejects },
      reasoning: response.slice(0, 500),
      recommendations: approved ? ['Proceed with implementation'] : ['Address council concerns'],
      timestamp: new Date().toISOString(),
      model: OLLAMA_MODEL,
      teeMode: getTEEMode()
    };

    await store({ type: 'ceo_decision', ...decision });

    return { message: `CEO: ${approved ? 'APPROVED' : 'REJECTED'}`, data: decision };
  }

  getRouter(): Hono {
    return this.app;
  }
}

export function createCouncilA2AServer(config: CouncilConfig, blockchain: CouncilBlockchain): CouncilA2AServer {
  return new CouncilA2AServer(config, blockchain);
}
