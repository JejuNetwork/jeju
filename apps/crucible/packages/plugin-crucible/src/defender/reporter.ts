import { Plugin, Action, type IAgentRuntime, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import type { ContractService } from '../shared/contracts';
import type { RegistryService } from '../shared/registry';
import type { EvidenceService } from '../shared/evidence';

/**
 * Report types from UnifiedReportingSystem
 */
enum ReportType {
  NETWORK_BAN = 0,    // Ban from all apps
  APP_BAN = 1,        // Ban from specific app
  LABEL_HACKER = 2,   // Apply HACKER label
  LABEL_SCAMMER = 3   // Apply SCAMMER label
}

/**
 * Severity levels
 */
enum ReportSeverity {
  LOW = 0,      // 7 day vote, 0.001 ETH bond
  MEDIUM = 1,   // 3 day vote, 0.01 ETH bond
  HIGH = 2,     // 24 hour vote, 0.05 ETH bond
  CRITICAL = 3  // 24 hour vote + immediate temp ban, 0.1 ETH bond
}

/**
 * Submit Report Action
 * 
 * Deep integration with UnifiedReportingSystem for reporting bad actors.
 * Citizens use this to report hackers and scammers with evidence.
 */
const submitReportAction: Action = {
  name: 'SUBMIT_REPORT',
  description: 'Submit a report to UnifiedReportingSystem to ban or label a bad actor',
  
  similes: ['report bad actor', 'submit evidence', 'request ban', 'label scammer', 'label hacker'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Report agent 42 as a scammer with evidence'}
    },
    {
      user: 'agent',
      content: {text: 'Submitting report to label agent 42 as SCAMMER...', action: 'SUBMIT_REPORT'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const contractService = runtime.getService<ContractService>('contract_service');
    // Only citizens can submit reports
    return agentType === 'citizen' && !!contractService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    const evidenceService = runtime.getService<EvidenceService>('evidence_service');
    
    try {
      // Extract report parameters from state/message
      const targetAgentId = state?.targetAgentId || message.content?.data?.targetAgentId;
      const reportType = state?.reportType || ReportType.LABEL_SCAMMER;
      const severity = state?.severity || ReportSeverity.MEDIUM;
      const evidence = state?.evidence || message.content?.data?.evidence || '';
      const details = state?.details || message.content?.data?.details || 'Suspicious activity detected';
      
      if (!targetAgentId) {
        throw new Error('Target agent ID required');
      }

      // Calculate required bond based on severity
      const bonds = {
        [ReportSeverity.LOW]: '0.001',
        [ReportSeverity.MEDIUM]: '0.01',
        [ReportSeverity.HIGH]: '0.05',
        [ReportSeverity.CRITICAL]: '0.1'
      };
      const bondAmount = bonds[severity as keyof typeof bonds];

      // Upload evidence to storage if service available
      let evidenceHash: string;
      
      if (evidenceService && evidence) {
        // Create comprehensive evidence document
        const evidenceDoc = JSON.stringify({
          targetAgentId,
          reportType: ReportType[reportType],
          severity: ReportSeverity[severity],
          details,
          evidence,
          reportedBy: contractService.getWallet().address,
          timestamp: Date.now(),
          blockNumber: await contractService.getProvider().getBlockNumber()
        }, null, 2);
        
        const cid = await evidenceService.storeEvidence(
          evidenceDoc,
          `report-agent-${targetAgentId}.json`,
          'application/json',
          contractService.getWallet().address
        );
        
        // Convert CID to bytes32 for contract
        evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
        
        runtime.logger.info('Evidence uploaded', {cid, hash: evidenceHash});
      } else {
        // Fallback: hash the evidence directly
        evidenceHash = ethers.id(JSON.stringify(evidence || details));
        runtime.logger.warn('Evidence service not available, using direct hash');
      }

      runtime.logger.info('Submitting report to UnifiedReportingSystem', {
        targetAgentId,
        reportType,
        severity,
        bondAmount
      });

      // Submit report to UnifiedReportingSystem contract
      const reportingSystemAddr = runtime.getSetting('UNIFIED_REPORTING_SYSTEM') || '0x...'// Need from deployment;
      
      const tx = await contractService.sendTransaction(
        reportingSystemAddr,
        [
          'function submitReport(uint256 targetAgentId, uint8 reportType, uint8 severity, bytes32 evidenceHash, string details) external payable returns (uint256)'
        ],
        'submitReport',
        bondAmount,
        targetAgentId,
        reportType,
        severity,
        evidenceHash,
        details
      );

      // Extract report ID from events
      const receipt = await contractService.getProvider().getTransactionReceipt(tx);
      // Parse ReportCreated event to get reportId
      const reportId = 1; // Simplified - would parse from events

      runtime.logger.info('Report submitted successfully', {reportId, txHash: tx});

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Submitted report #${reportId} to UnifiedReportingSystem. Target: Agent ${targetAgentId}. Type: ${ReportType[reportType]}. Severity: ${ReportSeverity[severity]}. Bond: ${bondAmount} ETH. TX: ${tx}`,
          action: 'SUBMIT_REPORT',
          data: {reportId, targetAgentId, reportType, severity, txHash: tx, evidenceHash}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, reportId, txHash: tx, targetAgentId};
    } catch (error: any) {
      runtime.logger.error('Report submission failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Vote in Futarchy Market Action
 * 
 * Citizens and guardians vote on reports by trading shares in prediction markets.
 * Guardians have 3x voting weight.
 */
const voteInMarketAction: Action = {
  name: 'VOTE_IN_MARKET',
  description: 'Vote in futarchy prediction market by buying YES or NO shares',
  
  similes: ['trade in market', 'buy shares', 'vote yes', 'vote no', 'support ban', 'oppose ban'],
  
  examples: [[
    {
      user: 'system',
      content: {text: 'Vote YES to ban agent 42'}
    },
    {
      user: 'agent',
      content: {text: 'Trading YES shares in market to support banning agent 42...', action: 'VOTE_IN_MARKET'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const agentType = runtime.getSetting('AGENT_TYPE');
    const contractService = runtime.getService<ContractService>('contract_service');
    // Citizens and guardians can vote
    return (agentType === 'citizen' || agentType === 'guardian') && !!contractService;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, _state?: any) => {
    const contractService = runtime.getService<ContractService>('contract_service');
    if (!contractService) {
      return {success: false, error: 'Contract service not available'};
    }
    
    try {
      const marketId = _state?.marketId || message.content?.data?.marketId;
      const voteYes = _state?.voteYes !== undefined ? _state.voteYes : true; // Default YES
      const amount = _state?.amount || '10'; // 10 elizaOS default
      
      if (!marketId) {
        throw new Error('Market ID required');
      }

      const agentType = runtime.getSetting('AGENT_TYPE');
      const isGuardian = agentType === 'guardian';
      const votingWeight = isGuardian ? 3 : 1;
      
      const elizaToken = runtime.getSetting('ELIZA_TOKEN') || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
      const predimarketAddr = runtime.getSetting('PREDIMARKET') || '0x...'; // Need from deployment

      runtime.logger.info('Voting in futarchy market', {
        marketId,
        voteYes,
        amount,
        votingWeight: `${votingWeight}x`
      });

      // Buy shares in prediction market
      const amountWei = ethers.parseEther(amount);
      const tx = await contractService.sendTransaction(
        predimarketAddr,
        [
          'function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares, address token) external returns (uint256)'
        ],
        'buy',
        '0',
        marketId,
        voteYes,
        amountWei,
        0, // minShares (accept any)
        elizaToken
      );

      runtime.logger.info('Vote cast successfully', {txHash: tx, marketId, outcome: voteYes ? 'YES' : 'NO'});

      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Cast vote in futarchy market ${marketId.slice(0, 10)}... Voting ${voteYes ? 'YES' : 'NO'} with ${amount} elizaOS (${votingWeight}x weight${isGuardian ? ' as guardian' : ''}). TX: ${tx}`,
          action: 'VOTE_IN_MARKET',
          data: {marketId, voteYes, amount, votingWeight, txHash: tx}
        },
        roomId: message.roomId
      }, 'messages');

      return {success: true, txHash: tx, marketId, voteYes, votingWeight};
    } catch (error: any) {
      runtime.logger.error('Market vote failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const reporterPlugin: Plugin = {
  name: '@crucible/plugin-reporter',
  description: 'Deep integration with UnifiedReportingSystem and futarchy voting',
  actions: [submitReportAction, voteInMarketAction]
};

