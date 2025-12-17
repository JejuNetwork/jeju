/**
 * Autocrat Orchestrator - Multi-tenant DAO proposal lifecycle management
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { readContract, waitForTransactionReceipt } from 'viem/actions';
import { parseAbi } from 'viem';
import { base, baseSepolia, localhost } from 'viem/chains';
import type { CEOPersona, GovernanceParams } from './types';
import { AutocratBlockchain } from './blockchain';
import { DAOService, createDAOService, type DAOFull, type FundingProject } from './dao-service';

// Config type for orchestrator
interface AutocratConfig {
  rpcUrl: string;
  chainId: number;
  daoRegistry: Address;
  daoFunding: Address;
}

function inferChain(rpcUrl: string) {
  if (rpcUrl.includes('mainnet') || rpcUrl.includes('base.org')) return base;
  if (rpcUrl.includes('sepolia')) return baseSepolia;
  return localhost;
}
import { initLocalServices, store, storeVote } from './local-services';
import { makeTEEDecision, getTEEMode } from './tee';
import { autocratAgentRuntime, type DeliberationRequest } from './agents';
import { getResearchAgent, type ResearchRequest } from './research-agent';
import { COUNCIL_ABI, type ProposalFromContract, type AutocratVoteFromContract } from './shared';

// ============ ABIs ============

const COUNCIL_WRITE_ABI = parseAbi([
  ...COUNCIL_ABI.map((item) => {
    if (typeof item === 'string') return item;
    return JSON.stringify(item);
  }) as string[],
  'function castAutocratVote(bytes32 proposalId, uint8 vote, bytes32 reasoningHash) external',
  'function finalizeAutocratVote(bytes32 proposalId) external',
  'function recordResearch(bytes32 proposalId, bytes32 researchHash) external',
  'function advanceToCEO(bytes32 proposalId) external',
  'function executeProposal(bytes32 proposalId) external',
]);

const CEO_WRITE_ABI = parseAbi([
  'function recordDecision(bytes32 proposalId, bool approved, bytes32 decisionHash, bytes32 encryptedHash, uint256 confidenceScore, uint256 alignmentScore) external',
]);

// ============ Constants ============

const STATUS = {
  SUBMITTED: 0,
  AUTOCRAT_REVIEW: 1,
  RESEARCH_PENDING: 2,
  AUTOCRAT_FINAL: 3,
  CEO_QUEUE: 4,
  APPROVED: 5,
  EXECUTING: 6,
  COMPLETED: 7,
  REJECTED: 8,
} as const;

// ============ Types ============

interface DAOState {
  daoId: string;
  daoFull: DAOFull;
  councilAddress: Address;
  ceoAgentAddress: Address;
  lastProcessed: number;
  processedCount: number;
  errors: string[];
  isActive: boolean;
}

interface OrchestratorStatus {
  running: boolean;
  cycleCount: number;
  lastCycle: number;
  operator: string | null;
  daoCount: number;
  totalProcessed: number;
  daoStates: Record<string, DAOStateStatus>;
  errors: string[];
}

interface DAOStateStatus {
  daoId: string;
  name: string;
  displayName: string;
  isActive: boolean;
  lastProcessed: number;
  processedCount: number;
  ceoName: string;
  errors: string[];
}

interface CEODecisionContext {
  proposalId: string;
  daoId: string;
  persona: CEOPersona;
  autocratVotes: Array<{
    role: string;
    vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
    reasoning: string;
    agentId: string;
    confidence: number;
    timestamp: number;
  }>;
  researchReport?: string;
}

// ============ Orchestrator Class ============

export class AutocratOrchestrator {
  private readonly config: AutocratConfig;
  private readonly blockchain: AutocratBlockchain;
  private readonly client: PublicClient;
  private readonly walletClient: WalletClient;
  private daoService: DAOService | null = null;
  private account: PrivateKeyAccount | null = null;
  private daoStates: Map<string, DAOState> = new Map();
  private running = false;
  private cycleCount = 0;
  private lastCycle = 0;
  private totalProcessed = 0;
  private errors: string[] = [];
  private pollInterval = 30_000;
  private fundingCheckInterval = 3600_000; // 1 hour
  private lastFundingCheck = 0;

  constructor(config: AutocratConfig, blockchain: AutocratBlockchain) {
    this.config = config;
    this.blockchain = blockchain;
    const chain = inferChain(config.rpcUrl);
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
    });
  }

  // ============ Lifecycle Methods ============

  async start(): Promise<void> {
    if (this.running) return;

    await initLocalServices();
    await autocratAgentRuntime.initialize();

    const operatorKey = process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY;
    if (operatorKey) {
      this.account = privateKeyToAccount(operatorKey as `0x${string}`);
    }

    // Initialize DAO service
    this.daoService = createDAOService({
      rpcUrl: this.config.rpcUrl,
      chainId: this.config.chainId,
      daoRegistryAddress: this.config.daoRegistry,
      daoFundingAddress: this.config.daoFunding,
      privateKey: operatorKey,
    });

    // Load all active DAOs
    await this.loadDAOs();

    console.log(`\n[Orchestrator] Started - Mode: ${this.account ? 'Active' : 'Read-only'}, TEE: ${getTEEMode()}`);
    console.log(`[Orchestrator] Loaded ${this.daoStates.size} DAOs`);

    this.running = true;
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log('[Orchestrator] Stopping...');
  }

  // ============ Main Loop ============

  private async runLoop(): Promise<void> {
    while (this.running) {
      this.cycleCount++;
      this.lastCycle = Date.now();

      try {
        await this.processCycle();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Orchestrator] Cycle ${this.cycleCount}:`, msg);
        this.errors.push(`${this.cycleCount}: ${msg}`);
        if (this.errors.length > 100) this.errors.shift();
      }

      await new Promise((r) => setTimeout(r, this.pollInterval));
    }
  }

  private async processCycle(): Promise<void> {
    // Refresh DAO list periodically
    if (this.cycleCount % 10 === 0) {
      await this.loadDAOs();
    }

    // Process each active DAO
    const daoPromises = Array.from(this.daoStates.values())
      .filter((state) => state.isActive)
      .map((state) => this.processDAO(state));

    await Promise.all(daoPromises);

    // Check funding epochs
    if (Date.now() - this.lastFundingCheck > this.fundingCheckInterval) {
      await this.processFundingEpochs();
      this.lastFundingCheck = Date.now();
    }
  }

  // ============ DAO Management ============

  private async loadDAOs(): Promise<void> {
    if (!this.daoService) return;

    const daoIds = await this.daoService.getActiveDAOs();

    for (const daoId of daoIds) {
      if (this.daoStates.has(daoId)) continue;

      const daoFull = await this.daoService.getDAOFull(daoId);
      if (!daoFull.dao.council || daoFull.dao.council === '0x0000000000000000000000000000000000000000') {
        console.log(`[Orchestrator] DAO ${daoFull.dao.name} has no council contract, skipping`);
        continue;
      }

      this.daoStates.set(daoId, {
        daoId,
        daoFull,
        councilAddress: daoFull.dao.council as Address,
        ceoAgentAddress: daoFull.dao.ceoAgent as Address,
        lastProcessed: 0,
        processedCount: 0,
        errors: [],
        isActive: true,
      });

      console.log(`[Orchestrator] Loaded DAO: ${daoFull.dao.displayName} (CEO: ${daoFull.ceoPersona.name})`);
    }

    // Deactivate removed DAOs
    for (const [daoId, state] of this.daoStates) {
      if (!daoIds.includes(daoId)) {
        state.isActive = false;
      }
    }
  }

  private async processDAO(state: DAOState): Promise<void> {
    const { daoId, daoFull, councilAddress } = state;
    const daoName = daoFull.dao.name;

    try {
      const activeIds = (await readContract(this.client, {
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'getActiveProposals',
      })) as string[];

      if (activeIds.length === 0) return;

      console.log(`[${daoName}] Cycle ${this.cycleCount}: ${activeIds.length} active proposals`);

      for (const proposalId of activeIds.slice(0, 5)) {
        const proposal = (await readContract(this.client, {
          address: councilAddress,
          abi: COUNCIL_WRITE_ABI,
          functionName: 'getProposal',
          args: [proposalId],
        })) as ProposalFromContract;

        await this.processProposal(state, proposalId, proposal);
        state.processedCount++;
        this.totalProcessed++;
      }

      state.lastProcessed = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state.errors.push(`${this.cycleCount}: ${msg}`);
      if (state.errors.length > 20) state.errors.shift();
    }
  }

  // ============ Proposal Processing ============

  private async processProposal(state: DAOState, proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const shortId = proposalId.slice(0, 10);
    const daoName = state.daoFull.dao.name;

    switch (proposal.status) {
      case STATUS.SUBMITTED:
        console.log(`[${daoName}:${shortId}] New proposal - starting autocrat review`);
        break;

      case STATUS.AUTOCRAT_REVIEW:
        await this.processCouncilReview(state, proposalId, proposal);
        break;

      case STATUS.RESEARCH_PENDING:
        await this.processResearch(state, proposalId, proposal);
        break;

      case STATUS.AUTOCRAT_FINAL:
        await this.processFinalReview(state, proposalId, proposal);
        break;

      case STATUS.CEO_QUEUE:
        await this.processCEODecision(state, proposalId, proposal);
        break;

      case STATUS.APPROVED:
        await this.processApproved(state, proposalId, proposal);
        break;
    }
  }

  private async processCouncilReview(
    state: DAOState,
    proposalId: string,
    proposal: ProposalFromContract
  ): Promise<void> {
    const { councilAddress, daoFull } = state;
    const daoName = daoFull.dao.name;

    const votes = (await readContract(this.client, {
      address: councilAddress,
      abi: COUNCIL_WRITE_ABI,
      functionName: 'getAutocratVotes',
      args: [proposalId],
    })) as AutocratVoteFromContract[];

    const shortId = proposalId.slice(0, 10);

    if (votes.length < 5) {
      const request: DeliberationRequest = {
        proposalId,
        title: `Proposal ${shortId}`,
        summary: `Type: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
        description: proposal.contentHash || 'No description',
        proposalType: String(proposal.proposalType),
        submitter: proposal.proposer,
        daoId: state.daoId,
        daoName: daoFull.dao.displayName,
        governanceParams: daoFull.params,
      };

      console.log(`[${daoName}:${shortId}] Starting deliberation...`);
      const agentVotes = await autocratAgentRuntime.deliberateAll(request);

      for (const vote of agentVotes) {
        console.log(`[${daoName}:${shortId}] ${vote.role}: ${vote.vote} (${vote.confidence}%)`);

        await storeVote(proposalId, {
          role: vote.role,
          vote: vote.vote,
          reasoning: vote.reasoning,
          confidence: vote.confidence,
          daoId: state.daoId,
        });

        if (this.account) {
          const reasoningHash = await store({
            proposalId,
            daoId: state.daoId,
            agent: vote.agentId,
            role: vote.role,
            vote: vote.vote,
            reasoning: vote.reasoning,
            confidence: vote.confidence,
          });

          const voteValue = { APPROVE: 0, REJECT: 1, ABSTAIN: 2 }[vote.vote] ?? 2;

          const hash = await this.walletClient.writeContract({
            address: councilAddress,
            abi: COUNCIL_WRITE_ABI,
            functionName: 'castAutocratVote',
            args: [proposalId as `0x${string}`, voteValue, keccak256(stringToHex(reasoningHash))],
            account: this.account,
          });
          await waitForTransactionReceipt(this.client, { hash });
          console.log(`[${daoName}:${shortId}] ${vote.role} vote on-chain`);
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= Number(proposal.autocratVoteEnd) && this.account) {
      const hash = await this.walletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'finalizeAutocratVote',
        args: [proposalId as `0x${string}`],
        account: this.account,
      });
      await waitForTransactionReceipt(this.client, { hash });
      console.log(`[${daoName}:${shortId}] Autocrat vote finalized`);
    }
  }

  private async processResearch(state: DAOState, proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const { councilAddress, daoFull } = state;
    const daoName = daoFull.dao.name;
    const shortId = proposalId.slice(0, 10);

    if (proposal.hasResearch) return;

    console.log(`[${daoName}:${shortId}] Generating deep research...`);

    const researchAgent = getResearchAgent();
    const researchRequest: ResearchRequest = {
      proposalId,
      title: `Proposal ${shortId}`,
      description: `${proposal.contentHash || 'No description'}\n\nType: ${proposal.proposalType}, Quality: ${proposal.qualityScore}`,
      proposalType: String(proposal.proposalType),
      depth: 'standard',
      daoId: state.daoId,
      daoName: daoFull.dao.displayName,
    };

    const report = await researchAgent.conductResearch(researchRequest);

    console.log(
      `[${daoName}:${shortId}] Research complete: ${report.recommendation} (risk: ${report.riskLevel}, confidence: ${report.confidenceLevel}%)`
    );
    console.log(`[${daoName}:${shortId}] Key findings: ${report.keyFindings.slice(0, 2).join('; ')}`);

    if (this.account) {
      const hash = await this.walletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'recordResearch',
        args: [proposalId as `0x${string}`, keccak256(stringToHex(report.requestHash))],
        account: this.account,
      });
      await waitForTransactionReceipt(this.client, { hash });
      console.log(`[${daoName}:${shortId}] Research on-chain: ${report.requestHash.slice(0, 12)}...`);
    }
  }

  private async processFinalReview(state: DAOState, proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const { councilAddress, daoFull } = state;
    const daoName = daoFull.dao.name;
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);

    if (now < Number(proposal.autocratVoteEnd)) return;

    if (this.account) {
      const hash = await this.walletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'advanceToCEO',
        args: [proposalId as `0x${string}`],
        account: this.account,
      });
      await waitForTransactionReceipt(this.client, { hash });
      console.log(`[${daoName}:${shortId}] Advanced to CEO queue`);
    }
  }

  private async processCEODecision(state: DAOState, proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const { councilAddress, ceoAgentAddress, daoFull } = state;
    const daoName = daoFull.dao.name;
    const persona = daoFull.ceoPersona;
    const shortId = proposalId.slice(0, 10);

    console.log(`[${daoName}:${shortId}] CEO ${persona.name} processing decision...`);

    const votes = (await readContract(this.client, {
      address: councilAddress,
      abi: COUNCIL_WRITE_ABI,
      functionName: 'getAutocratVotes',
      args: [proposalId],
    })) as AutocratVoteFromContract[];

    const formattedVotes = votes.map((v) => ({
      role: ['Treasury', 'Code', 'Community', 'Security', 'Legal'][v.role] ?? 'Unknown',
      vote: (['APPROVE', 'REJECT', 'ABSTAIN', 'REQUEST_CHANGES'][v.vote] ?? 'ABSTAIN') as 'APPROVE' | 'REJECT' | 'ABSTAIN',
      reasoning: v.reasoningHash,
      agentId: ['Treasury', 'Code', 'Community', 'Security', 'Legal'][v.role]?.toLowerCase() ?? 'unknown',
      confidence: 75,
      timestamp: Date.now(),
    }));

    // Build CEO decision context with persona
    const ceoContext: CEODecisionContext = {
      proposalId,
      daoId: state.daoId,
      persona,
      autocratVotes: formattedVotes,
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    };

    // Get CEO analysis with persona context
    const ceoDecision = await autocratAgentRuntime.ceoDecision({
      proposalId,
      daoId: state.daoId,
      persona,
      autocratVotes: formattedVotes,
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    // Make TEE-secured decision
    const teeDecision = await makeTEEDecision({
      proposalId,
      daoId: state.daoId,
      persona,
      autocratVotes: formattedVotes.map((v) => ({ role: v.role, vote: v.vote, reasoning: v.reasoning })),
      researchReport: proposal.hasResearch ? proposal.researchHash : undefined,
    });

    // Generate persona-styled response
    const personaResponse = this.generatePersonaResponse(persona, teeDecision.approved, teeDecision.publicReasoning);

    const decisionHash = await store({
      proposalId,
      daoId: state.daoId,
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
      personaResponse,
      decidedAt: Date.now(),
    });

    console.log(`[${daoName}:${shortId}] ${persona.name}: ${teeDecision.approved ? 'APPROVED' : 'REJECTED'} (${teeDecision.confidenceScore}%)`);
    console.log(`[${daoName}:${shortId}] "${personaResponse.slice(0, 100)}..."`);

    if (this.account && ceoAgentAddress && ceoAgentAddress !== '0x0000000000000000000000000000000000000000') {
      const hash = await this.walletClient.writeContract({
        address: ceoAgentAddress,
        abi: CEO_WRITE_ABI,
        functionName: 'recordDecision',
        args: [
          proposalId as `0x${string}`,
          teeDecision.approved,
          keccak256(stringToHex(decisionHash)),
          teeDecision.encryptedHash as `0x${string}`,
          BigInt(teeDecision.confidenceScore),
          BigInt(teeDecision.alignmentScore),
        ],
        account: this.account,
      });
      await waitForTransactionReceipt(this.client, { hash });
      console.log(`[${daoName}:${shortId}] Decision on-chain`);
    }
  }

  private async processApproved(state: DAOState, proposalId: string, proposal: ProposalFromContract): Promise<void> {
    const { councilAddress, daoFull } = state;
    const daoName = daoFull.dao.name;
    const shortId = proposalId.slice(0, 10);
    const now = Math.floor(Date.now() / 1000);
    const gracePeriodEnd = Number(proposal.gracePeriodEnd);

    if (now < gracePeriodEnd) {
      console.log(`[${daoName}:${shortId}] Grace period (${gracePeriodEnd - now}s remaining)`);
      return;
    }

    if (this.account) {
      const hash = await this.walletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_WRITE_ABI,
        functionName: 'executeProposal',
        args: [proposalId as `0x${string}`],
        account: this.account,
      });
      await waitForTransactionReceipt(this.client, { hash });
      console.log(`[${daoName}:${shortId}] Executed`);
    }
  }

  // ============ Funding Management ============

  private async processFundingEpochs(): Promise<void> {
    if (!this.daoService || !this.account) return;

    for (const [daoId, state] of this.daoStates) {
      if (!state.isActive) continue;

      const daoName = state.daoFull.dao.name;

      try {
        const epoch = await this.daoService.getCurrentEpoch(daoId);

        // Check if epoch needs finalization
        if (epoch.epochId > 0 && !epoch.finalized && Date.now() / 1000 > epoch.endTime) {
          console.log(`[${daoName}] Finalizing funding epoch ${epoch.epochId}...`);

          // Get allocations before finalizing
          const allocations = await this.daoService.getFundingAllocations(daoId);
          console.log(`[${daoName}] Epoch ${epoch.epochId} allocations:`);
          for (const alloc of allocations.slice(0, 5)) {
            console.log(`  - ${alloc.projectName}: ${alloc.allocationPercentage.toFixed(1)}%`);
          }

          await this.daoService.finalizeEpoch(daoId);
          console.log(`[${daoName}] Epoch ${epoch.epochId} finalized`);
        }

        // Auto-set CEO weights for new projects
        const projects = await this.daoService.getActiveProjects(daoId);
        for (const project of projects) {
          if (project.ceoWeight === 0 && project.createdAt < Date.now() / 1000 - 86400) {
            // Calculate weight based on project quality and community stake
            const weight = this.calculateProjectWeight(project, state.daoFull);
            if (weight > 0) {
              await this.daoService.setCEOWeight(project.projectId, weight);
              console.log(`[${daoName}] Set CEO weight for ${project.name}: ${weight / 100}%`);
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[${daoName}] Funding error:`, msg);
      }
    }
  }

  private calculateProjectWeight(project: FundingProject, daoFull: DAOFull): number {
    // Base weight from community stake
    const stakeWeight = Math.min(Number(project.communityStake) / 1e18, 100) * 10;

    // Bonus for linked packages/repos
    const isLinked =
      daoFull.linkedPackages.includes(project.registryId) || daoFull.linkedRepos.includes(project.registryId);

    const linkedBonus = isLinked ? 1000 : 0;

    // Total weight (capped at CEO weight cap from config)
    const totalWeight = Math.min(stakeWeight + linkedBonus, daoFull.params.quorumBps / 2);

    return Math.floor(totalWeight);
  }

  // ============ Persona Response Generation ============

  private generatePersonaResponse(persona: CEOPersona, approved: boolean, reasoning: string): string {
    const templates = this.getPersonaTemplates(persona);
    const decision = approved ? 'approval' : 'rejection';

    // Select template based on personality
    let response: string;
    switch (persona.communicationTone) {
      case 'playful':
        response = templates.playful[decision];
        break;
      case 'authoritative':
        response = templates.authoritative[decision];
        break;
      case 'friendly':
        response = templates.friendly[decision];
        break;
      case 'formal':
        response = templates.formal[decision];
        break;
      default:
        response = templates.professional[decision];
    }

    // Add reasoning
    response = response.replace('{reasoning}', reasoning);
    response = response.replace('{name}', persona.name);

    return response;
  }

  private getPersonaTemplates(persona: CEOPersona): Record<string, Record<string, string>> {
    // Check for specific personas with custom templates
    if (persona.name.toLowerCase().includes('monkey king')) {
      return {
        playful: {
          approval:
            'The Monkey King approves. {reasoning}. Let this journey begin - together we shall reach the Western Paradise.',
          rejection:
            'Even the Monkey King must decline this path. {reasoning}. Return with a stronger proposal, and we shall consider again.',
        },
        authoritative: {
          approval: 'By my golden cudgel, it is decided. {reasoning}. The Great Sage Equal to Heaven grants passage.',
          rejection:
            'The Heavenly Court would not approve. {reasoning}. Refine your offering and return when worthy.',
        },
        friendly: {
          approval:
            'My friends, we move forward together. {reasoning}. The Monkey King stands with you on this adventure.',
          rejection:
            'Dear companions, not this time. {reasoning}. But do not despair - every setback is a lesson for the journey ahead.',
        },
        formal: {
          approval: 'After due consideration, approval is granted. {reasoning}. Proceed with the blessing of Babylon.',
          rejection: 'After careful review, this proposal cannot proceed. {reasoning}. Please revise and resubmit.',
        },
        professional: {
          approval:
            'Decision: Approved. {reasoning}. The Babylon DAO moves forward with this initiative under the guidance of the Monkey King.',
          rejection:
            'Decision: Declined. {reasoning}. The Monkey King invites refinement of this proposal for future consideration.',
        },
      };
    }

    // Default templates
    return {
      playful: {
        approval: 'Great news everyone. {reasoning}. Let\'s make it happen.',
        rejection: 'Not quite there yet. {reasoning}. Keep iterating.',
      },
      authoritative: {
        approval: 'This proposal is approved. {reasoning}. Execute immediately.',
        rejection: 'This proposal is rejected. {reasoning}. Do better.',
      },
      friendly: {
        approval: 'I\'m happy to approve this. {reasoning}. Looking forward to seeing the results.',
        rejection: 'I appreciate the effort, but I can\'t approve this. {reasoning}. Let\'s work together on improvements.',
      },
      formal: {
        approval: 'After thorough review, this proposal is approved. {reasoning}. Please proceed with implementation.',
        rejection:
          'After careful consideration, this proposal is not approved. {reasoning}. Please address the concerns and resubmit.',
      },
      professional: {
        approval: 'Decision: Approved. {reasoning}. Implementation may proceed.',
        rejection: 'Decision: Not Approved. {reasoning}. Revision required before resubmission.',
      },
    };
  }

  // ============ Status Methods ============

  getStatus(): OrchestratorStatus {
    const daoStates: Record<string, DAOStateStatus> = {};

    for (const [daoId, state] of this.daoStates) {
      daoStates[daoId] = {
        daoId,
        name: state.daoFull.dao.name,
        displayName: state.daoFull.dao.displayName,
        isActive: state.isActive,
        lastProcessed: state.lastProcessed,
        processedCount: state.processedCount,
        ceoName: state.daoFull.ceoPersona.name,
        errors: state.errors.slice(-5),
      };
    }

    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastCycle: this.lastCycle,
      operator: this.account?.address ?? null,
      daoCount: this.daoStates.size,
      totalProcessed: this.totalProcessed,
      daoStates,
      errors: this.errors.slice(-10),
    };
  }

  getDAOStatus(daoId: string): DAOStateStatus | null {
    const state = this.daoStates.get(daoId);
    if (!state) return null;

    return {
      daoId,
      name: state.daoFull.dao.name,
      displayName: state.daoFull.dao.displayName,
      isActive: state.isActive,
      lastProcessed: state.lastProcessed,
      processedCount: state.processedCount,
      ceoName: state.daoFull.ceoPersona.name,
      errors: state.errors.slice(-5),
    };
  }

  async refreshDAO(daoId: string): Promise<void> {
    if (!this.daoService) return;

    const daoFull = await this.daoService.getDAOFull(daoId);
    const existing = this.daoStates.get(daoId);

    if (existing) {
      existing.daoFull = daoFull;
      existing.councilAddress = daoFull.dao.council as Address;
      existing.ceoAgentAddress = daoFull.dao.ceoAgent as Address;
    } else {
      this.daoStates.set(daoId, {
        daoId,
        daoFull,
        councilAddress: daoFull.dao.council as Address,
        ceoAgentAddress: daoFull.dao.ceoAgent as Address,
        lastProcessed: 0,
        processedCount: 0,
        errors: [],
        isActive: true,
      });
    }
  }

  setDAOActive(daoId: string, active: boolean): void {
    const state = this.daoStates.get(daoId);
    if (state) {
      state.isActive = active;
    }
  }

  setPollInterval(interval: number): void {
    this.pollInterval = Math.max(5000, interval);
  }
}

// ============ Factory Function ============

export function createOrchestrator(config: AutocratConfig, blockchain: AutocratBlockchain): AutocratOrchestrator {
  return new AutocratOrchestrator(config, blockchain);
}
