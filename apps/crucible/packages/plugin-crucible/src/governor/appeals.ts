import { Plugin, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import type { ContractService } from '../shared/contracts';
import type { GuardianCoordinationService } from './coordination';

/**
 * Vote on Appeal Action
 * 
 * Guardians vote on appeals from banned agents.
 * Requires 2/3 guardian consensus to approve.
 */
const voteOnAppealAction: Action = {
  name: 'VOTE_ON_APPEAL',
  description: 'Guardian votes on appeal from banned agent (requires 2/3 consensus)',
  
  similes: ['review appeal', 'approve appeal', 'reject appeal', 'vote on appeal'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Review and vote on appeal #5'}
    },
    {
      user: 'agent',
      content: {text: 'Reviewing appeal #5. Checking evidence...', action: 'VOTE_ON_APPEAL'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const contractService = runtime.getService<ContractService>('contract_service');
    // Only guardians can vote on appeals
    return agentType === 'guardian' && !!contractService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    try {
      const appealId = state?.appealId || message.content?.data?.appealId;
      const approve = state?.approve !== undefined ? state.approve : true;
      
      if (!appealId) {
        throw new Error('Appeal ID required');
      }

      const governanceAddr = runtime.getSetting('REGISTRY_GOVERNANCE') || '0x...'; // Need from deployment

      runtime.logger.info('Voting on appeal', {appealId, approve});

      // Call voteOnAppeal on RegistryGovernance
      const tx = await contractService.sendTransaction(
        governanceAddr,
        [
          'function voteOnAppeal(bytes32 appealId, bool approve) external'
        ],
        'voteOnAppeal',
        '0',
        appealId,
        approve
      );

      runtime.logger.info('Appeal vote cast', {txHash: tx, appealId, vote: approve ? 'APPROVE' : 'REJECT'});
      
      // Record vote in coordination service
      const coordinationService = runtime.getService<GuardianCoordinationService>('guardian_coordination');
      if (coordinationService) {
        await coordinationService.recordVote(
          appealId,
          contractService.getWallet().address,
          approve,
          tx
        );
      }

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Guardian vote on appeal ${appealId.slice(0, 10)}...: ${approve ? 'APPROVE' : 'REJECT'}. TX: ${tx}. Awaiting 2/3 consensus.`,
          action: 'VOTE_ON_APPEAL',
          data: {appealId, approve, txHash: tx}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, txHash: tx, appealId, approve};
    } catch (error: any) {
      runtime.logger.error('Appeal vote failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Approve Governance Proposal Action
 * 
 * Guardians approve passed proposals via multi-sig.
 * Threshold: 1/1 localnet, 2/3 testnet, 3/5 mainnet
 */
const approveProposalAction: Action = {
  name: 'APPROVE_PROPOSAL',
  description: 'Guardian approves governance proposal as part of multi-sig',
  
  similes: ['approve ban', 'approve slash', 'sign proposal', 'multi-sig approve'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Approve proposal to ban agent 42'}
    },
    {
      user: 'agent',
      content: {text: 'Approving proposal via multi-sig...', action: 'APPROVE_PROPOSAL'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const contractService = runtime.getService<ContractService>('contract_service');
    return agentType === 'guardian' && !!contractService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    try {
      const proposalId = state?.proposalId || message.content?.data?.proposalId;
      
      if (!proposalId) {
        throw new Error('Proposal ID required');
      }

      const governanceAddr = runtime.getSetting('REGISTRY_GOVERNANCE') || '0x...';

      runtime.logger.info('Approving governance proposal (multi-sig)', {proposalId});

      const tx = await contractService.sendTransaction(
        governanceAddr,
        [
          'function approveProposal(bytes32 proposalId) external'
        ],
        'approveProposal',
        '0',
        proposalId
      );

      runtime.logger.info('Proposal approved', {txHash: tx, proposalId});

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Guardian approval for proposal ${proposalId.slice(0, 10)}.... Multi-sig vote cast. TX: ${tx}`,
          action: 'APPROVE_PROPOSAL',
          data: {proposalId, txHash: tx}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, txHash: tx, proposalId};
    } catch (error: any) {
      runtime.logger.error('Proposal approval failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Submit Appeal Action
 * 
 * Banned agents (including test hackers/scammers) submit appeals
 */
const submitAppealAction: Action = {
  name: 'SUBMIT_APPEAL',
  description: 'Submit appeal against ban or label (requires 0.05 ETH bond)',
  
  similes: ['appeal ban', 'contest label', 'request review'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Appeal the ban decision'}
    },
    {
      user: 'agent',
      content: {text: 'Submitting appeal with evidence...', action: 'SUBMIT_APPEAL'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    return !!contractService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    try {
      const proposalId = state?.proposalId || message.content?.data?.proposalId;
      const evidence = state?.evidence || 'Appeal evidence';
      const appealBond = '0.05'; // Fixed appeal bond

      if (!proposalId) {
        throw new Error('Proposal ID required for appeal');
      }

      const governanceAddr = runtime.getSetting('REGISTRY_GOVERNANCE') || '0x...';

      runtime.logger.info('Submitting appeal', {proposalId, bond: appealBond});

      const tx = await contractService.sendTransaction(
        governanceAddr,
        [
          'function submitAppeal(bytes32 proposalId, string evidence) external payable returns (bytes32)'
        ],
        'submitAppeal',
        appealBond,
        proposalId,
        evidence
      );

      runtime.logger.info('Appeal submitted', {txHash: tx, proposalId});

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Appeal submitted for proposal ${proposalId.slice(0, 10)}.... Bond: ${appealBond} ETH. Awaiting guardian review. TX: ${tx}`,
          action: 'SUBMIT_APPEAL',
          data: {proposalId, txHash: tx, appealBond}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, txHash: tx, proposalId};
    } catch (error: any) {
      runtime.logger.error('Appeal submission failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const appealsPlugin: Plugin = {
  name: '@crucible/plugin-appeals',
  description: 'Deep integration with governance appeals system',
  actions: [voteOnAppealAction, approveProposalAction, submitAppealAction]
};

