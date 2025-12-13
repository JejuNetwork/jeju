/**
 * Blockchain client for Council
 */

import { Contract, JsonRpcProvider, formatEther, isAddress } from 'ethers';
import type { CouncilConfig } from './types';
import {
  COUNCIL_ABI, CEO_AGENT_ABI, ZERO_ADDRESS,
  getProposalStatus, getProposalType, getVoteType, getCouncilRole,
  type ProposalFromContract, type CouncilVoteFromContract,
  type ModelFromContract, type DecisionFromContract, type CEOStatsFromContract
} from './shared';

export class CouncilBlockchain {
  readonly provider: JsonRpcProvider;
  readonly council: Contract;
  readonly ceoAgent: Contract;
  readonly councilDeployed: boolean;
  readonly ceoDeployed: boolean;
  private readonly config: CouncilConfig;

  constructor(config: CouncilConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.council = new Contract(config.contracts.council, COUNCIL_ABI, this.provider);
    this.ceoAgent = new Contract(config.contracts.ceoAgent, CEO_AGENT_ABI, this.provider);
    this.councilDeployed = isAddress(config.contracts.council) && config.contracts.council !== ZERO_ADDRESS;
    this.ceoDeployed = isAddress(config.contracts.ceoAgent) && config.contracts.ceoAgent !== ZERO_ADDRESS;
  }

  async getProposal(proposalId: string): Promise<{ proposal: ProposalFromContract; votes: CouncilVoteFromContract[] } | null> {
    if (!this.councilDeployed) return null;
    const proposal = await this.council.getProposal(proposalId) as ProposalFromContract;
    const votes = await this.council.getCouncilVotes(proposalId) as CouncilVoteFromContract[];
    return { proposal, votes };
  }

  formatProposal(p: ProposalFromContract) {
    return {
      proposalId: p.proposalId,
      proposer: p.proposer,
      type: getProposalType(p.proposalType),
      status: getProposalStatus(p.status),
      qualityScore: p.qualityScore,
      createdAt: new Date(Number(p.createdAt) * 1000).toISOString(),
      councilVoteEnd: new Date(Number(p.councilVoteEnd) * 1000).toISOString(),
      gracePeriodEnd: p.gracePeriodEnd > 0n ? new Date(Number(p.gracePeriodEnd) * 1000).toISOString() : null,
      contentHash: p.contentHash,
      targetContract: p.targetContract,
      value: formatEther(p.value),
      totalStaked: formatEther(p.totalStaked),
      totalReputation: p.totalReputation.toString(),
      backerCount: p.backerCount.toString(),
      hasResearch: p.hasResearch,
      researchHash: p.researchHash,
      ceoApproved: p.ceoApproved
    };
  }

  formatVotes(votes: CouncilVoteFromContract[]) {
    return votes.map((v) => ({
      agent: v.councilAgent,
      role: getCouncilRole(v.role),
      vote: getVoteType(v.vote),
      weight: v.weight.toString(),
      votedAt: new Date(Number(v.votedAt) * 1000).toISOString(),
      reasoningHash: v.reasoningHash
    }));
  }

  async listProposals(activeOnly: boolean, limit = 20): Promise<{ total: number; proposals: Array<{ proposalId: string; proposer: string; type: string; status: string; qualityScore: number; createdAt: string }> }> {
    if (!this.councilDeployed) return { total: 0, proposals: [] };

    const proposalIds = activeOnly
      ? await this.council.getActiveProposals() as string[]
      : await this.council.getAllProposals() as string[];

    const proposals = [];
    for (const id of proposalIds.slice(-limit)) {
      const p = await this.council.getProposal(id) as ProposalFromContract;
      proposals.push({
        proposalId: id,
        proposer: p.proposer,
        type: getProposalType(p.proposalType),
        status: getProposalStatus(p.status),
        qualityScore: p.qualityScore,
        createdAt: new Date(Number(p.createdAt) * 1000).toISOString()
      });
    }

    return { total: proposalIds.length, proposals: proposals.reverse() };
  }

  async getCEOStatus(): Promise<{ currentModel: { modelId: string; name: string; provider: string; totalStaked?: string; benchmarkScore?: string }; stats: { totalDecisions: string; approvedDecisions: string; overriddenDecisions: string; approvalRate: string; overrideRate: string } }> {
    if (!this.ceoDeployed) {
      return {
        currentModel: { modelId: this.config.agents.ceo.model, name: this.config.agents.ceo.name, provider: 'local' },
        stats: { totalDecisions: '0', approvedDecisions: '0', overriddenDecisions: '0', approvalRate: '0%', overrideRate: '0%' }
      };
    }

    const stats = await this.ceoAgent.getCEOStats() as CEOStatsFromContract;
    const model = await this.ceoAgent.getCurrentModel() as ModelFromContract;

    return {
      currentModel: {
        modelId: model.modelId,
        name: model.modelName,
        provider: model.provider,
        totalStaked: formatEther(model.totalStaked),
        benchmarkScore: `${(Number(model.benchmarkScore) / 100).toFixed(2)}%`
      },
      stats: {
        totalDecisions: stats.totalDecisions.toString(),
        approvedDecisions: stats.approvedDecisions.toString(),
        overriddenDecisions: stats.overriddenDecisions.toString(),
        approvalRate: `${(Number(stats.approvalRate) / 100).toFixed(2)}%`,
        overrideRate: `${(Number(stats.overrideRate) / 100).toFixed(2)}%`
      }
    };
  }

  async getDecision(proposalId: string): Promise<{ decided: boolean; decision?: { proposalId: string; modelId: string; approved: boolean; decisionHash: string; decidedAt: string; confidenceScore: string; alignmentScore: string; disputed: boolean; overridden: boolean } }> {
    if (!this.ceoDeployed) return { decided: false };

    const decision = await this.ceoAgent.getDecision(proposalId) as DecisionFromContract;
    if (!decision.decidedAt || decision.decidedAt === 0n) return { decided: false };

    return {
      decided: true,
      decision: {
        proposalId: decision.proposalId,
        modelId: decision.modelId,
        approved: decision.approved,
        decisionHash: decision.decisionHash,
        decidedAt: new Date(Number(decision.decidedAt) * 1000).toISOString(),
        confidenceScore: decision.confidenceScore.toString(),
        alignmentScore: decision.alignmentScore.toString(),
        disputed: decision.disputed,
        overridden: decision.overridden
      }
    };
  }

  async getModelCandidates(): Promise<Array<{ modelId: string; modelName: string; provider: string; totalStaked: string; totalReputation: string; benchmarkScore: number; decisionsCount: number; isActive: boolean }>> {
    if (!this.ceoDeployed) return [];

    const modelIds = await this.ceoAgent.getAllModels() as string[];
    const models = [];

    for (const modelId of modelIds) {
      const m = await this.ceoAgent.getModel(modelId) as ModelFromContract;
      models.push({
        modelId: m.modelId,
        modelName: m.modelName,
        provider: m.provider,
        totalStaked: formatEther(m.totalStaked),
        totalReputation: m.totalReputation.toString(),
        benchmarkScore: Number(m.benchmarkScore) / 100,
        decisionsCount: Number(m.decisionsCount),
        isActive: m.isActive,
      });
    }

    return models.sort((a, b) => parseFloat(b.totalStaked) - parseFloat(a.totalStaked));
  }

  async getRecentDecisions(limit = 10): Promise<Array<{ decisionId: string; proposalId: string; approved: boolean; confidenceScore: number; alignmentScore: number; decidedAt: number; disputed: boolean; overridden: boolean }>> {
    if (!this.ceoDeployed) return [];

    const decisionIds = await this.ceoAgent.getRecentDecisions(limit) as string[];
    const decisions = [];

    for (const id of decisionIds) {
      const d = await this.ceoAgent.getDecision(id) as DecisionFromContract;
      if (d.decidedAt && d.decidedAt > 0n) {
        decisions.push({
          decisionId: id,
          proposalId: d.proposalId,
          approved: d.approved,
          confidenceScore: Number(d.confidenceScore),
          alignmentScore: Number(d.alignmentScore),
          decidedAt: Number(d.decidedAt) * 1000,
          disputed: d.disputed,
          overridden: d.overridden,
        });
      }
    }

    return decisions;
  }

  async getGovernanceStats(): Promise<{ totalProposals: string; ceo: { model: string; decisions: string; approvalRate: string }; parameters: { minQualityScore: string; councilVotingPeriod: string; gracePeriod: string } }> {
    if (!this.councilDeployed || !this.ceoDeployed) {
      return {
        totalProposals: '0',
        ceo: { model: this.config.agents.ceo.model, decisions: '0', approvalRate: '0%' },
        parameters: {
          minQualityScore: this.config.parameters.minQualityScore.toString(),
          councilVotingPeriod: `${this.config.parameters.councilVotingPeriod} seconds`,
          gracePeriod: `${this.config.parameters.gracePeriod} seconds`
        }
      };
    }

    const proposalCount = await this.council.proposalCount() as bigint;
    const ceoStats = await this.ceoAgent.getCEOStats() as CEOStatsFromContract;
    const minQuality = await this.council.minQualityScore() as number;
    const votingPeriod = await this.council.councilVotingPeriod() as bigint;
    const grace = await this.council.gracePeriod() as bigint;

    return {
      totalProposals: proposalCount.toString(),
      ceo: {
        model: ceoStats.currentModelId,
        decisions: ceoStats.totalDecisions.toString(),
        approvalRate: `${(Number(ceoStats.approvalRate) / 100).toFixed(2)}%`
      },
      parameters: {
        minQualityScore: minQuality.toString(),
        councilVotingPeriod: `${votingPeriod.toString()} seconds`,
        gracePeriod: `${grace.toString()} seconds`
      }
    };
  }

  getCouncilStatus() {
    return {
      agents: ['Treasury', 'Code', 'Community', 'Security'].map((role, i) => ({
        role,
        index: i,
        description: ['Financial review', 'Technical review', 'Community impact', 'Security assessment'][i]
      })),
      votingPeriod: `${this.config.parameters.councilVotingPeriod} seconds`,
      gracePeriod: `${this.config.parameters.gracePeriod} seconds`
    };
  }
}

let instance: CouncilBlockchain | null = null;

export function getBlockchain(config: CouncilConfig): CouncilBlockchain {
  return instance ??= new CouncilBlockchain(config);
}
