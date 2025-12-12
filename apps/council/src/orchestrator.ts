/**
 * Council Orchestrator
 * 
 * Active process that monitors and drives the proposal lifecycle.
 * Uses local services by default - no external dependencies required.
 */

import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import type { CouncilConfig } from './types';
import { CouncilBlockchain } from './blockchain';
import { initLocalServices, store, inference } from './local-services';
import { makeTEEDecision, getTEEMode } from './tee';
import { councilAgentRuntime, type DeliberationRequest } from './agents';
import {
  COUNCIL_ABI,
  type ProposalFromContract,
  type CouncilVoteFromContract,
} from './shared';

// Extended ABI for write operations
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

// Status constants
const STATUS = {
  SUBMITTED: 0,
  COUNCIL_REVIEW: 1,
  RESEARCH_PENDING: 2,
  COUNCIL_FINAL: 3,
  CEO_QUEUE: 4,
  APPROVED: 5,
  EXECUTING: 6,
  COMPLETED: 7,
  REJECTED: 8,
};

interface OrchestratorStatus {
  running: boolean;
  cycleCount: number;
  lastCycle: number;
  operator: string | null;
  processedProposals: number;
}

export class CouncilOrchestrator {
  private readonly councilConfig: CouncilConfig;
  private readonly blockchain: CouncilBlockchain;
  private readonly provider: JsonRpcProvider;
  private wallet: Wallet | null = null;
  private council: Contract | null = null;
  private ceoAgent: Contract | null = null;
  private running = false;
  private cycleCount = 0;
  private lastCycle = 0;
  private processedProposals = 0;
  private pollInterval = 30_000; // 30 seconds

  constructor(councilConfig: CouncilConfig, blockchain: CouncilBlockchain) {
    this.councilConfig = councilConfig;
    this.blockchain = blockchain;
    this.provider = new JsonRpcProvider(councilConfig.rpcUrl);
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Initialize local services
    await initLocalServices();

    // Initialize ElizaOS agent runtimes
    await councilAgentRuntime.initialize();

    // Setup wallet if operator key available
    const operatorKey = process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY;
    if (operatorKey) {
      this.wallet = new Wallet(operatorKey, this.provider);
      this.council = new Contract(
        this.councilConfig.contracts.council,
        COUNCIL_WRITE_ABI,
        this.wallet
      );
      this.ceoAgent = new Contract(
        this.councilConfig.contracts.ceoAgent,
        CEO_WRITE_ABI,
        this.wallet
      );
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              COUNCIL ORCHESTRATOR - RUNNING                 ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Mode: ${this.wallet ? 'Active (can write to chain)' : 'Read-only (no operator key)'}         ║`);
    console.log(`║  Poll Interval: ${this.pollInterval / 1000}s                                       ║`);
    const teeMode = getTEEMode();
    console.log(`║  TEE Mode: ${teeMode === 'hardware' ? 'Hardware TEE (production)' : 'Simulated (local dev)'}${' '.repeat(18 - teeMode.length)}║`);
    console.log('║  Services: Local storage, inference                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    this.running = true;
    this.runLoop();
  }

  async stop(): Promise<void> {
    console.log('[Orchestrator] Stopping...');
    this.running = false;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      this.cycleCount++;
      this.lastCycle = Date.now();

      try {
        await this.processCycle();
      } catch (error) {
        console.error(`[Orchestrator] Cycle ${this.cycleCount} error:`, error);
      }

      await this.sleep(this.pollInterval);
    }
    console.log('[Orchestrator] Stopped.');
  }

  private async processCycle(): Promise<void> {
    if (!this.blockchain.councilDeployed) {
      // No contract deployed - nothing to do
      return;
    }

    // Get active proposals
    const activeIds = await this.blockchain.council.getActiveProposals() as string[];
    if (activeIds.length === 0) return;

    console.log(`[Orchestrator] Cycle ${this.cycleCount}: ${activeIds.length} active proposals`);

    for (const proposalId of activeIds.slice(0, 5)) {
      const proposal = await this.blockchain.council.getProposal(proposalId) as ProposalFromContract;
      await this.processProposal(proposalId, proposal);
    }
  }

  private async processProposal(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const status = proposal.status;
    const shortId = proposalId.slice(0, 10);

    switch (status) {
      case STATUS.SUBMITTED:
        console.log(`[${shortId}] New proposal - starting council review`);
        await this.startCouncilReview(proposalId, proposal);
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

  private async startCouncilReview(proposalId: string, _proposal: ProposalFromContract): Promise<void> {
    // In a real setup, the contract would transition status
    // For now, just log that review should start
    console.log(`[${proposalId.slice(0, 10)}] Ready for council agent votes`);
  }

  private async processCouncilReview(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const votes = await this.blockchain.council.getCouncilVotes(proposalId) as CouncilVoteFromContract[];
    const shortId = proposalId.slice(0, 10);

    // Check if all council agents have voted
    if (votes.length < 5) {
      // Use ElizaOS agents for deliberation
      const deliberationRequest: DeliberationRequest = {
        proposalId,
        title: `Proposal ${shortId}`,
        summary: `Type: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
        description: proposal.contentHash || 'No description available',
        proposalType: String(proposal.proposalType),
        submitter: proposal.proposer,
      };

      console.log(`[${shortId}] Starting ElizaOS agent deliberation...`);
      
      // Get votes from all council agents using ElizaOS runtimes
      const agentVotes = await councilAgentRuntime.deliberateAll(deliberationRequest);
      
      for (const agentVote of agentVotes) {
        console.log(`[${shortId}] ${agentVote.role}: ${agentVote.vote} (confidence: ${agentVote.confidence}%)`);
        
        // Store reasoning and record vote on-chain
        if (this.wallet && this.council) {
          const reasoningHash = await store({
            proposalId,
            agent: agentVote.agentId,
            role: agentVote.role,
            vote: agentVote.vote,
            reasoning: agentVote.reasoning,
            confidence: agentVote.confidence,
          });
          
          const voteValue = { APPROVE: 0, REJECT: 1, ABSTAIN: 2 }[agentVote.vote] ?? 2;
          
          try {
            const tx = await this.council.castCouncilVote(
              proposalId,
              voteValue,
              keccak256(toUtf8Bytes(reasoningHash))
            );
            await tx.wait();
            console.log(`[${shortId}] ${agentVote.role} vote recorded on-chain`);
          } catch {
            // Contract may not be deployed
          }
        }
      }
    }

    // Check if voting period ended
    const now = Math.floor(Date.now() / 1000);
    if (now >= Number(proposal.councilVoteEnd) && this.wallet && this.council) {
      try {
        const tx = await this.council.finalizeCouncilVote(proposalId);
        await tx.wait();
        console.log(`[${shortId}] Council vote finalized`);
      } catch {
        console.log(`[${shortId}] Council vote ready to finalize (no contract)`);
      }
    }
  }

  private async processResearch(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);

    if (proposal.hasResearch) {
      console.log(`[${shortId}] Research already complete`);
      return;
    }

    console.log(`[${shortId}] Conducting research...`);
    
    // Generate research using local inference
    const researchPrompt = `Conduct research on proposal ${proposalId}`;
    const researchResult = await inference({ messages: [{ role: 'user', content: researchPrompt }] });
    
    // Store research
    const researchHash = await store({
      proposalId,
      research: JSON.parse(researchResult),
      completedAt: Date.now(),
    });

    console.log(`[${shortId}] Research stored: ${researchHash.slice(0, 12)}...`);

    // Record on-chain if possible
    if (this.wallet && this.council) {
      try {
        const tx = await this.council.recordResearch(
          proposalId,
          keccak256(toUtf8Bytes(researchHash))
        );
        await tx.wait();
        console.log(`[${shortId}] Research recorded on-chain`);
      } catch {
        // Contract may not have this function
      }
    }
  }

  private async processFinalReview(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);

    if (now < Number(proposal.councilVoteEnd)) {
      return; // Still in review
    }

    // Advance to CEO queue
    if (this.wallet && this.council) {
      try {
        const tx = await this.council.advanceToCEO(proposalId);
        await tx.wait();
        console.log(`[${shortId}] Advanced to CEO queue`);
      } catch {
        console.log(`[${shortId}] Ready for CEO (no contract)`);
      }
    }
  }

  private async processCEODecision(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);

    console.log(`[${shortId}] Processing CEO decision via ElizaOS agent...`);

    // Get council votes for context
    const votes = await this.blockchain.council.getCouncilVotes(proposalId) as CouncilVoteFromContract[];
    
    // Format votes for the CEO agent
    const formattedVotes = votes.map(v => ({
      role: ['Treasury', 'Code', 'Community', 'Security', 'Legal'][v.role] ?? 'Unknown',
      vote: (['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'][v.vote] ?? 'ABSTAIN') as 'APPROVE' | 'REJECT' | 'ABSTAIN',
      reasoning: v.reasoningHash,
    }));

    // Use ElizaOS CEO agent for decision (provides AI-powered analysis)
    const ceoDecision = await councilAgentRuntime.ceoDecision({
      proposalId,
      councilVotes: formattedVotes.map(v => ({
        ...v,
        agentId: v.role.toLowerCase(),
        confidence: 75,
        timestamp: Date.now(),
      })),
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    // Wrap in TEE for secure attestation (hardware if configured, otherwise simulated)
    const teeDecision = await makeTEEDecision({
      proposalId,
      councilVotes: formattedVotes,
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    // Store decision (use TEE result for cryptographic properties)
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

    console.log(`[${shortId}] CEO: ${teeDecision.approved ? 'APPROVED' : 'REJECTED'} (confidence: ${teeDecision.confidenceScore}%)`);
    console.log(`[${shortId}] Reasoning: ${ceoDecision.reasoning}`);

    // Record on-chain if possible
    if (this.wallet && this.ceoAgent) {
      try {
        const tx = await this.ceoAgent.recordDecision(
          proposalId,
          teeDecision.approved,
          keccak256(toUtf8Bytes(decisionHash)),
          teeDecision.encryptedHash,
          teeDecision.confidenceScore,
          teeDecision.alignmentScore
        );
        await tx.wait();
        console.log(`[${shortId}] Decision recorded on-chain`);
      } catch {
        // Contract may not be deployed
      }
    }
  }

  private async processApproved(proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);
    const gracePeriodEnd = Number(proposal.gracePeriodEnd);

    if (now < gracePeriodEnd) {
      const remaining = gracePeriodEnd - now;
      console.log(`[${shortId}] In grace period (${remaining}s remaining)`);
      return;
    }

    // Execute proposal
    if (this.wallet && this.council) {
      try {
        const tx = await this.council.executeProposal(proposalId);
        await tx.wait();
        console.log(`[${shortId}] Executed!`);
      } catch {
        console.log(`[${shortId}] Ready for execution (no contract)`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus(): OrchestratorStatus {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastCycle: this.lastCycle,
      operator: this.wallet?.address ?? null,
      processedProposals: this.processedProposals,
    };
  }
}

export function createOrchestrator(
  councilConfig: CouncilConfig,
  blockchain: CouncilBlockchain
): CouncilOrchestrator {
  return new CouncilOrchestrator(councilConfig, blockchain);
}
