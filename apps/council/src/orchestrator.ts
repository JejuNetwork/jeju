/**
 * Council Orchestrator - drives proposal lifecycle
 */

import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import type { CouncilConfig } from './types';
import { CouncilBlockchain } from './blockchain';
import { initLocalServices, store, storeVote } from './local-services';
import { makeTEEDecision, getTEEMode } from './tee';
import { councilAgentRuntime, type DeliberationRequest } from './agents';
import { getResearchAgent, type ResearchRequest } from './research-agent';
import { COUNCIL_ABI, type ProposalFromContract, type CouncilVoteFromContract } from './shared';

const COUNCIL_WRITE_ABI = [
  ...COUNCIL_ABI,
  'function castCouncilVote(bytes32 proposalId, uint8 vote, bytes32 reasoningHash) external',
  'function finalizeCouncilVote(bytes32 proposalId) external',
  'function recordResearch(bytes32 proposalId, bytes32 researchHash) external',
  'function advanceToCEO(bytes32 proposalId) external',
  'function executeProposal(bytes32 proposalId) external',
] as const;

const CEO_WRITE_ABI = [
  'function recordDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, bytes32 encryptedHash, uint256 confidenceScore, uint256 alignmentScore) external',
] as const;

const STATUS = { SUBMITTED: 0, COUNCIL_REVIEW: 1, RESEARCH_PENDING: 2, COUNCIL_FINAL: 3, CEO_QUEUE: 4, APPROVED: 5, EXECUTING: 6, COMPLETED: 7, REJECTED: 8 } as const;

interface OrchestratorStatus { running: boolean; cycleCount: number; lastCycle: number; operator: string | null; processedProposals: number; errors: string[] }

export class CouncilOrchestrator {
  private readonly config: CouncilConfig;
  private readonly blockchain: CouncilBlockchain;
  private readonly provider: JsonRpcProvider;
  private wallet: Wallet | null = null;
  private council: Contract | null = null;
  private ceoAgent: Contract | null = null;
  private running = false;
  private cycleCount = 0;
  private lastCycle = 0;
  private processedProposals = 0;
  private errors: string[] = [];
  private pollInterval = 30_000;

  constructor(config: CouncilConfig, blockchain: CouncilBlockchain) {
    this.config = config;
    this.blockchain = blockchain;
    this.provider = new JsonRpcProvider(config.rpcUrl);
  }

  async start(): Promise<void> {
    if (this.running) return;

    await initLocalServices();
    await councilAgentRuntime.initialize();

    const operatorKey = process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY;
    if (operatorKey) {
      this.wallet = new Wallet(operatorKey, this.provider);
      this.council = new Contract(this.config.contracts.council, COUNCIL_WRITE_ABI, this.wallet);
      this.ceoAgent = new Contract(this.config.contracts.ceoAgent, CEO_WRITE_ABI, this.wallet);
    }

    console.log(`\n[Orchestrator] Started - Mode: ${this.wallet ? 'Active' : 'Read-only'}, TEE: ${getTEEMode()}`);
    this.running = true;
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      this.cycleCount++;
      this.lastCycle = Date.now();

      try { await this.processCycle(); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Orchestrator] Cycle ${this.cycleCount}:`, msg);
        this.errors.push(`${this.cycleCount}: ${msg}`);
        if (this.errors.length > 100) this.errors.shift();
      }

      await new Promise(r => setTimeout(r, this.pollInterval));
    }
  }

  private async processCycle(): Promise<void> {
    if (!this.blockchain.councilDeployed) return;

    const activeIds = await this.blockchain.council.getActiveProposals() as string[];
    if (activeIds.length === 0) return;

    console.log(`[Orchestrator] Cycle ${this.cycleCount}: ${activeIds.length} active proposals`);

    for (const proposalId of activeIds.slice(0, 5)) {
      const proposal = await this.blockchain.council.getProposal(proposalId) as ProposalFromContract;
      await this.processProposal(proposalId, proposal);
    }
  }

  private async processProposal(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);

    switch (proposal.status) {
      case STATUS.SUBMITTED:
        console.log(`[${shortId}] New proposal - starting council review`);
        break;

      case STATUS.COUNCIL_REVIEW:
        await this.processCouncilReview(proposalId, proposal);
        break;

      case STATUS.RESEARCH_PENDING:
        await this.processResearch(proposalId, proposal);
        break;

      case STATUS.COUNCIL_FINAL:
        await this.processFinalReview(proposalId, proposal);
        break;

      case STATUS.CEO_QUEUE:
        await this.processCEODecision(proposalId, proposal);
        break;

      case STATUS.APPROVED:
        await this.processApproved(proposalId, proposal);
        break;
    }

    this.processedProposals++;
  }

  private async processCouncilReview(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const votes = await this.blockchain.council.getCouncilVotes(proposalId) as CouncilVoteFromContract[];
    const shortId = proposalId.slice(0, 10);

    if (votes.length < 5) {
      const request: DeliberationRequest = {
        proposalId,
        title: `Proposal ${shortId}`,
        summary: `Type: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
        description: proposal.contentHash || 'No description',
        proposalType: String(proposal.proposalType),
        submitter: proposal.proposer,
      };

      console.log(`[${shortId}] Starting deliberation...`);
      const agentVotes = await councilAgentRuntime.deliberateAll(request);

      for (const vote of agentVotes) {
        console.log(`[${shortId}] ${vote.role}: ${vote.vote} (${vote.confidence}%)`);
        
        // Actually store the vote
        storeVote(proposalId, { role: vote.role, vote: vote.vote, reasoning: vote.reasoning, confidence: vote.confidence });

        if (this.wallet && this.council) {
          const reasoningHash = await store({ proposalId, agent: vote.agentId, role: vote.role, vote: vote.vote, reasoning: vote.reasoning, confidence: vote.confidence });
          const voteValue = { APPROVE: 0, REJECT: 1, ABSTAIN: 2 }[vote.vote] ?? 2;
          
          const tx = await this.council.castCouncilVote(proposalId, voteValue, keccak256(toUtf8Bytes(reasoningHash)));
          await tx.wait();
          console.log(`[${shortId}] ${vote.role} vote on-chain`);
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= Number(proposal.councilVoteEnd) && this.wallet && this.council) {
      const tx = await this.council.finalizeCouncilVote(proposalId);
      await tx.wait();
      console.log(`[${shortId}] Council vote finalized`);
    }
  }

  private async processResearch(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    if (proposal.hasResearch) return;

    console.log(`[${shortId}] Generating deep research...`);
    
    // Use the new research agent for comprehensive analysis
    const researchAgent = getResearchAgent();
    const researchRequest: ResearchRequest = {
      proposalId,
      title: `Proposal ${shortId}`,
      description: `${proposal.contentHash || 'No description'}\n\nType: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
      proposalType: String(proposal.proposalType),
      depth: 'standard',
    };

    const report = await researchAgent.conductResearch(researchRequest);
    
    console.log(`[${shortId}] Research complete: ${report.recommendation} (risk: ${report.riskLevel}, confidence: ${report.confidenceLevel}%)`);
    console.log(`[${shortId}] Key findings: ${report.keyFindings.slice(0, 2).join('; ')}`);

    if (this.wallet && this.council) {
      const tx = await this.council.recordResearch(proposalId, keccak256(toUtf8Bytes(report.requestHash)));
      await tx.wait();
      console.log(`[${shortId}] Research on-chain: ${report.requestHash.slice(0, 12)}...`);
    }
  }

  private async processFinalReview(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);

    if (now < Number(proposal.councilVoteEnd)) return;

    if (this.wallet && this.council) {
      const tx = await this.council.advanceToCEO(proposalId);
      await tx.wait();
      console.log(`[${shortId}] Advanced to CEO queue`);
    }
  }

  private async processCEODecision(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    console.log(`[${shortId}] Processing CEO decision...`);

    const votes = await this.blockchain.council.getCouncilVotes(proposalId) as CouncilVoteFromContract[];
    const formattedVotes = votes.map(v => ({
      role: ['Treasury', 'Code', 'Community', 'Security', 'Legal'][v.role] ?? 'Unknown',
      vote: (['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'][v.vote] ?? 'ABSTAIN') as 'APPROVE' | 'REJECT' | 'ABSTAIN',
      reasoning: v.reasoningHash,
    }));

    const ceoDecision = await councilAgentRuntime.ceoDecision({
      proposalId,
      councilVotes: formattedVotes.map(v => ({ ...v, agentId: v.role.toLowerCase(), confidence: 75, timestamp: Date.now() })),
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    const teeDecision = await makeTEEDecision({
      proposalId,
      councilVotes: formattedVotes,
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    const decisionHash = await store({
      proposalId,
      ceoAnalysis: ceoDecision,
      teeDecision: {
        approved: teeDecision.approved,
        publicReasoning: teeDecision.publicReasoning,
        confidenceScore: teeDecision.confidenceScore,
        alignmentScore: teeDecision.alignmentScore,
        recommendations: teeDecision.recommendations,
        encryptedHash: teeDecision.encryptedHash,
        attestation: teeDecision.attestation,
      },
      decidedAt: Date.now(),
    });

    console.log(`[${shortId}] CEO: ${teeDecision.approved ? 'APPROVED' : 'REJECTED'} (${teeDecision.confidenceScore}%)`);

    if (this.wallet && this.ceoAgent) {
      const tx = await this.ceoAgent.recordDecision(
        proposalId,
        teeDecision.approved,
        keccak256(toUtf8Bytes(decisionHash)),
        teeDecision.encryptedHash,
        teeDecision.confidenceScore,
        teeDecision.alignmentScore
      );
      await tx.wait();
      console.log(`[${shortId}] Decision on-chain`);
    }
  }

  private async processApproved(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);
    const gracePeriodEnd = Number(proposal.gracePeriodEnd);

    if (now < gracePeriodEnd) {
      console.log(`[${shortId}] Grace period (${gracePeriodEnd - now}s remaining)`);
      return;
    }

    if (this.wallet && this.council) {
      const tx = await this.council.executeProposal(proposalId);
      await tx.wait();
      console.log(`[${shortId}] Executed`);
    }
  }

  getStatus(): OrchestratorStatus {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastCycle: this.lastCycle,
      operator: this.wallet?.address ?? null,
      processedProposals: this.processedProposals,
      errors: this.errors.slice(-10),
    };
  }
}

export function createOrchestrator(config: CouncilConfig, blockchain: CouncilBlockchain): CouncilOrchestrator {
  return new CouncilOrchestrator(config, blockchain);
}
