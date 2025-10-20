/**
 * Guardian Coordination Service
 * Tracks votes, coordinates decisions, and manages multi-sig governance
 */

import { Plugin, Service, Provider, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { ethers } from 'ethers';
import type { ContractService } from '../shared/contracts';

export interface AppealVote {
  appealId: string;
  guardianAddress: string;
  approve: boolean;
  timestamp: number;
  txHash?: string;
}

export interface AppealStatus {
  appealId: string;
  targetAgentId: number;
  votes: AppealVote[];
  approvalsNeeded: number;
  currentApprovals: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * Guardian Coordination Service
 * Manages guardian votes and multi-sig coordination
 */
export class GuardianCoordinationService extends Service {
  public static serviceType = 'guardian_coordination';
  
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private appeals: Map<string, AppealStatus> = new Map();
  private governanceContract!: ethers.Contract;
  
  async start(runtime: IAgentRuntime): Promise<GuardianCoordinationService> {
    const contractService = runtime.getService<ContractService>('contract_service');
    
    if (!contractService) {
      throw new Error('ContractService required for GuardianCoordinationService');
    }
    
    this.provider = contractService.getProvider();
    this.wallet = contractService.getWallet();
    
    const governanceAddr = runtime.getSetting('REGISTRY_GOVERNANCE');
    
    if (governanceAddr) {
      const governanceAbi = [
        'function appeals(bytes32) view returns (tuple(bytes32 proposalId, address appellant, uint256 submittedAt, uint8 approvalCount, uint8 rejectionCount, bool finalized))',
        'function getAppealVotes(bytes32 appealId) view returns (address[] guardians, bool[] approvals)',
        'event AppealVote(bytes32 indexed appealId, address indexed guardian, bool approve)'
      ];
      
      this.governanceContract = new ethers.Contract(governanceAddr, governanceAbi, this.wallet);
    }
    
    runtime.logger.info('Guardian coordination service started', {
      wallet: this.wallet.address,
      governance: governanceAddr || 'NOT_CONFIGURED'
    });
    
    return this;
  }
  
  /**
   * Record a guardian vote
   */
  async recordVote(
    appealId: string,
    guardianAddress: string,
    approve: boolean,
    txHash?: string
  ): Promise<void> {
    let appeal = this.appeals.get(appealId);
    
    if (!appeal) {
      // Create new appeal tracking
      appeal = {
        appealId,
        targetAgentId: 0, // Will be updated from contract
        votes: [],
        approvalsNeeded: 2, // 2/3 on localnet
        currentApprovals: 0,
        status: 'PENDING'
      };
      this.appeals.set(appealId, appeal);
    }
    
    // Check if guardian already voted
    const existingVote = appeal.votes.find(v => v.guardianAddress === guardianAddress);
    if (existingVote) {
      this.runtime.logger.warn('Guardian already voted on this appeal', {appealId, guardian: guardianAddress});
      return;
    }
    
    // Record vote
    appeal.votes.push({
      appealId,
      guardianAddress,
      approve,
      timestamp: Date.now(),
      txHash
    });
    
    // Update counts
    appeal.currentApprovals = appeal.votes.filter(v => v.approve).length;
    
    // Update status
    if (appeal.currentApprovals >= appeal.approvalsNeeded) {
      appeal.status = 'APPROVED';
      this.runtime.logger.info(`Appeal ${appealId} APPROVED (${appeal.currentApprovals}/${appeal.approvalsNeeded} votes)`);
    } else if (appeal.votes.length >= 3 && appeal.currentApprovals < appeal.approvalsNeeded) {
      appeal.status = 'REJECTED';
      this.runtime.logger.info(`Appeal ${appealId} REJECTED (${appeal.currentApprovals}/${appeal.approvalsNeeded} votes)`);
    }
  }
  
  /**
   * Get appeal status
   */
  getAppealStatus(appealId: string): AppealStatus | null {
    return this.appeals.get(appealId) || null;
  }
  
  /**
   * List all appeals
   */
  listAppeals(): AppealStatus[] {
    return Array.from(this.appeals.values());
  }
  
  /**
   * Sync appeal status from contract
   */
  async syncAppealFromContract(appealId: string): Promise<AppealStatus | null> {
    if (!this.governanceContract) {
      this.runtime.logger.warn('Governance contract not configured');
      return null;
    }
    
    try {
      const appeal = await this.governanceContract.appeals(appealId);
      const [guardians, approvals] = await this.governanceContract.getAppealVotes(appealId);
      
      const status: AppealStatus = {
        appealId,
        targetAgentId: 0, // Would parse from proposal
        votes: guardians.map((guardian: string, i: number) => ({
          appealId,
          guardianAddress: guardian,
          approve: approvals[i],
          timestamp: 0
        })),
        approvalsNeeded: 2,
        currentApprovals: approvals.filter((a: boolean) => a).length,
        status: appeal.finalized ? 
          (appeal.approvalCount >= 2 ? 'APPROVED' : 'REJECTED') : 
          'PENDING'
      };
      
      this.appeals.set(appealId, status);
      return status;
    } catch (error) {
      this.runtime.logger.error('Failed to sync appeal from contract:', error);
      return null;
    }
  }
  
  /**
   * Evaluate if agent should vote on appeal based on evidence quality
   */
  async shouldApproveAppeal(appealId: string, evidenceHash: string): Promise<boolean> {
    // Simple heuristic: check if evidence exists and is substantial
    const evidenceService = this.runtime.getService('evidence_service') as any;
    
    if (!evidenceService) {
      // Default to approve if can't check evidence (benefit of doubt)
      return true;
    }
    
    try {
      // Try to retrieve evidence
      const evidence = await evidenceService.getEvidence(evidenceHash);
      
      if (!evidence) {
        this.runtime.logger.warn('No evidence found for appeal, defaulting to REJECT');
        return false;
      }
      
      // Check if evidence is substantial (>100 bytes)
      if (evidence.size < 100) {
        this.runtime.logger.warn('Evidence is too small, likely low quality');
        return false;
      }
      
      // Could add more sophisticated analysis here
      // For now, substantial evidence = approve
      return true;
    } catch (error) {
      this.runtime.logger.error('Error evaluating evidence:', error);
      // On error, be conservative and reject
      return false;
    }
  }
  
  async stop(): Promise<void> {
    this.appeals.clear();
    this.runtime.logger.info('Guardian coordination service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Guardian coordination for multi-sig governance and appeal voting';
  }
}

/**
 * Pending Appeals Provider
 * Injects pending appeals into guardian context
 */
export const pendingAppealsProvider: Provider = {
  name: 'PENDING_APPEALS',
  description: 'List of appeals requiring guardian review',
  
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const coordinationService = runtime.getService<GuardianCoordinationService>('guardian_coordination');
    
    if (!coordinationService) {
      return {text: ''};
    }
    
    const appeals = coordinationService.listAppeals();
    const pending = appeals.filter(a => a.status === 'PENDING');
    
    if (pending.length === 0) {
      return {text: ''};
    }
    
    const appealsText = pending.map(a => 
      `- Appeal ${a.appealId.slice(0, 10)}...: ${a.currentApprovals}/${a.approvalsNeeded} votes`
    ).join('\n');
    
    return {
      text: `[PENDING APPEALS]\n${pending.length} appeals require review:\n${appealsText}\n[/PENDING APPEALS]`,
      data: {
        pendingAppeals: pending.map(a => ({
          appealId: a.appealId,
          votes: a.currentApprovals,
          needed: a.approvalsNeeded
        }))
      }
    };
  }
};

export const coordinationPlugin: Plugin = {
  name: '@crucible/plugin-coordination',
  description: 'Guardian coordination and multi-sig governance',
  services: [GuardianCoordinationService],
  providers: [pendingAppealsProvider]
};

