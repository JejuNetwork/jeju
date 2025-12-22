/**
 * Bug Bounty System E2E Tests
 * 
 * Tests the complete bug bounty flow:
 * - Submission
 * - Assessment
 * - Validation
 * - Guardian review
 * - CEO decision
 * - Payout
 */

import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { parseEther, formatEther } from 'viem';
import {
  getBugBountyService,
  assessSubmission,
  resetBugBountyService,
} from '../src/bug-bounty-service';
import {
  validatePoCInSandbox,
  createSandboxConfig,
  getSandboxStats,
} from '../src/sandbox-executor';
import {
  BountySeverity,
  VulnerabilityType,
  BountySubmissionStatus,
  ValidationResult,
  SEVERITY_REWARDS,
  type BountySubmissionDraft,
} from '../src/types';

// Test constants
const RESEARCHER_ADDRESS = '0x1234567890123456789012345678901234567890' as const;
const GUARDIAN_1 = '0x2222222222222222222222222222222222222222' as const;
const GUARDIAN_2 = '0x3333333333333333333333333333333333333333' as const;
const GUARDIAN_3 = '0x4444444444444444444444444444444444444444' as const;
const GUARDIAN_4 = '0x5555555555555555555555555555555555555555' as const;
const GUARDIAN_5 = '0x6666666666666666666666666666666666666666' as const;

describe('Bug Bounty Service', () => {
  let service: ReturnType<typeof getBugBountyService>;

  beforeAll(() => {
    resetBugBountyService();
    service = getBugBountyService();
  });

  describe('Assessment', () => {
    test('should assess a low severity submission', () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.LOW,
        vulnType: VulnerabilityType.INFORMATION_DISCLOSURE,
        title: 'Minor information disclosure in API',
        summary: 'API endpoint leaks debug information in error responses which could be used for reconnaissance by attackers.',
        description: 'The /api/v1/debug endpoint returns stack traces and internal server information when errors occur. This could help attackers understand the system architecture and identify potential attack vectors. While not directly exploitable, this information disclosure makes other attacks easier to plan and execute.',
        affectedComponents: ['Backend API'],
        stepsToReproduce: [
          'Make a request to /api/v1/debug with invalid parameters',
          'Observe the error response contains stack trace',
        ],
        proofOfConcept: '',
        suggestedFix: 'Remove debug information from production error responses',
        stake: '0.01',
      };

      const assessment = assessSubmission(draft);

      expect(assessment.readyToSubmit).toBe(true);
      expect(assessment.validationPriority).toBe('low');
      expect(assessment.severityScore).toBe(25); // LOW = 1 * 25
      expect(assessment.isImmediateThreat).toBe(false);
    });

    test('should flag critical wallet drain as immediate threat', () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.CRITICAL,
        vulnType: VulnerabilityType.WALLET_DRAIN,
        title: 'Critical: Unauthorized token transfer in bridge contract',
        summary: 'Bridge contract allows arbitrary token transfers when validation is bypassed through reentrancy.',
        description: `
The bridge contract has a critical reentrancy vulnerability that allows an attacker to drain all tokens.
The vulnerability exists in the claimTokens function which does not follow checks-effects-interactions pattern.
An attacker can exploit this by deploying a malicious token contract that calls back into the bridge during transfer.
This affects all bridged tokens worth approximately $10M.
        `.trim(),
        affectedComponents: ['Smart Contracts', 'Bridge'],
        stepsToReproduce: [
          'Deploy malicious token contract with callback in transfer function',
          'Initiate bridge claim with malicious token as recipient',
          'Callback triggers additional claims before state update',
          'Repeat until all tokens are drained',
        ],
        proofOfConcept: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Exploit {
    address bridge;
    uint256 count;
    
    constructor(address _bridge) {
        bridge = _bridge;
    }
    
    receive() external payable {
        if (count < 10) {
            count++;
            IBridge(bridge).claimTokens();
        }
    }
}
        `.trim(),
        suggestedFix: 'Add reentrancy guard and follow CEI pattern',
        stake: '0.5',
      };

      const assessment = assessSubmission(draft);

      expect(assessment.readyToSubmit).toBe(true);
      expect(assessment.isImmediateThreat).toBe(true);
      expect(assessment.validationPriority).toBe('critical');
      expect(assessment.severityScore).toBe(100); // CRITICAL = 4 * 25
      expect(assessment.exploitabilityScore).toBe(90); // Has PoC
    });

    test('should reject incomplete submission', () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.HIGH,
        vulnType: VulnerabilityType.REMOTE_CODE_EXECUTION,
        title: 'RCE',
        summary: 'RCE in server',
        description: 'Found RCE',
        affectedComponents: [],
        stepsToReproduce: ['Run exploit'],
        proofOfConcept: '',
        suggestedFix: '',
        stake: '0.01',
      };

      const assessment = assessSubmission(draft);

      expect(assessment.readyToSubmit).toBe(false);
      expect(assessment.feedback.length).toBeGreaterThan(0);
      expect(assessment.feedback.some(f => f.includes('Description'))).toBe(true);
      expect(assessment.feedback.some(f => f.includes('component'))).toBe(true);
    });
  });

  describe('Submission Flow', () => {
    test('should submit and retrieve a bounty', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.MEDIUM,
        vulnType: VulnerabilityType.DENIAL_OF_SERVICE,
        title: 'DoS vulnerability in indexer websocket handler',
        summary: 'Websocket handler does not limit message size, allowing memory exhaustion attacks.',
        description: `
The indexer websocket endpoint at /ws does not implement message size limits.
An attacker can send extremely large messages that cause the server to run out of memory.
This affects all users connected to the indexer and can cause service disruption.
The fix is straightforward - add message size limits to the websocket handler.
        `.trim(),
        affectedComponents: ['Backend API', 'DWS Compute'],
        stepsToReproduce: [
          'Connect to websocket at /ws',
          'Send a message larger than 100MB',
          'Observe server memory usage spike',
          'Repeat until server crashes',
        ],
        proofOfConcept: `
const ws = new WebSocket('ws://target/ws');
ws.onopen = () => {
  const bigMessage = 'x'.repeat(100 * 1024 * 1024);
  ws.send(bigMessage);
};
        `.trim(),
        suggestedFix: 'Add message size limit: ws.setMaxPayload(1024 * 1024)',
        stake: '0.1',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 1n);

      expect(submission.submissionId).toBeDefined();
      expect(submission.researcher).toBe(RESEARCHER_ADDRESS);
      expect(submission.severity).toBe(BountySeverity.MEDIUM);
      // When DWS is unavailable, status skips to GUARDIAN_REVIEW, otherwise VALIDATING
      expect([BountySubmissionStatus.VALIDATING, BountySubmissionStatus.GUARDIAN_REVIEW]).toContain(submission.status);

      // Retrieve
      const retrieved = service.get(submission.submissionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe(draft.title);
    });

    test('should prioritize by severity and stake', async () => {
      // Reset state to ensure clean test
      resetBugBountyService();
      
      // Submit medium severity 
      const mediumSeverity: BountySubmissionDraft = {
        severity: BountySeverity.MEDIUM,
        vulnType: VulnerabilityType.OTHER,
        title: 'Medium severity submission test',
        summary: 'Test submission with medium severity for priority testing purposes and verification.',
        description: 'This is a test submission to verify that severity-based prioritization works correctly in the bug bounty queue. The bug bounty system should prioritize submissions with higher severity to ensure critical issues are addressed first by the security team.',
        affectedComponents: ['Other'],
        stepsToReproduce: ['Step 1 - Submit medium severity', 'Step 2 - Verify priority'],
        proofOfConcept: '',
        suggestedFix: '',
      };

      // Submit high severity (should be prioritized)
      const highSeverity: BountySubmissionDraft = {
        ...mediumSeverity,
        severity: BountySeverity.HIGH,
        title: 'High severity submission test',
      };

      await service.submit(mediumSeverity, RESEARCHER_ADDRESS, 2n);
      await service.submit(highSeverity, RESEARCHER_ADDRESS, 3n);

      // List all - high severity should come first due to priority calculation
      const list = service.list();
      
      // Higher severity * stake should be first (HIGH=2 > MEDIUM=1)
      expect(list[0].title).toBe('High severity submission test');
    });
  });

  describe('Validation Flow', () => {
    test('should complete validation and move to guardian review', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.HIGH,
        vulnType: VulnerabilityType.PRIVILEGE_ESCALATION,
        title: 'Privilege escalation via API token reuse',
        summary: 'API tokens can be reused across different user sessions leading to privilege escalation.',
        description: `
The authentication system does not properly invalidate API tokens when session context changes.
An attacker with a valid API token can reuse it to access other user accounts by manipulating the session.
This affects all authenticated users and could lead to data theft or unauthorized actions.
        `.trim(),
        affectedComponents: ['Backend API', 'Governance'],
        stepsToReproduce: [
          'Obtain valid API token as user A',
          'Modify session cookie to user B session ID',
          'Make API request with user A token',
          'Observe request succeeds with user B context',
        ],
        proofOfConcept: 'curl -H "Authorization: Bearer TOKEN_A" -H "Cookie: session=SESSION_B" /api/user/profile',
        suggestedFix: 'Bind tokens to session ID and validate on each request',
        stake: '0.2',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 4n);
      
      // Complete validation
      const updated = service.completeValidation(
        submission.submissionId,
        ValidationResult.LIKELY_VALID,
        'Static analysis confirms vulnerability pattern. Manual review recommended.'
      );

      expect(updated.status).toBe(BountySubmissionStatus.GUARDIAN_REVIEW);
      expect(updated.validationResult).toBe(ValidationResult.LIKELY_VALID);
    });

    test('should reject invalid submission', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.CRITICAL,
        vulnType: VulnerabilityType.FUNDS_AT_RISK,
        title: 'Fake critical vulnerability',
        summary: 'This is a fake submission to test rejection flow and validation handling in the system.',
        description: 'This submission contains no actual vulnerability and should be rejected by the validation process. The submission is intentionally incomplete and lacks proper technical details to test that the guardian review process correctly identifies and rejects invalid or low-quality submissions that waste reviewer time.',
        affectedComponents: ['Smart Contracts'],
        stepsToReproduce: ['There are no steps to reproduce', 'This is fake submission'],
        proofOfConcept: '',
        suggestedFix: '',
        stake: '0.01',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 5n);
      
      const updated = service.completeValidation(
        submission.submissionId,
        ValidationResult.INVALID,
        'No valid vulnerability demonstrated. PoC not provided.'
      );

      expect(updated.status).toBe(BountySubmissionStatus.REJECTED);
    });
  });

  describe('Guardian Review', () => {
    test('should approve with quorum for HIGH severity', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.HIGH,
        vulnType: VulnerabilityType.MPC_KEY_EXPOSURE,
        title: 'MPC key share exposure through timing side-channel',
        summary: 'MPC signing operation leaks key share bits through timing analysis of network responses.',
        description: `
The MPC signing protocol does not use constant-time operations for key share manipulation.
An attacker with network visibility can analyze timing differences to extract key share bits.
Over time, enough bits can be collected to reconstruct the full key share.
This affects the entire MPC infrastructure and could lead to key compromise.
        `.trim(),
        affectedComponents: ['MPC KMS'],
        stepsToReproduce: [
          'Position attacker on same network segment',
          'Request multiple MPC signatures',
          'Measure response times for each operation',
          'Apply statistical analysis to extract key bits',
        ],
        proofOfConcept: 'import timing_attack; timing_attack.extract_key_bits(target)',
        suggestedFix: 'Use constant-time comparison and operations for all key material',
        stake: '0.5',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 6n);
      service.completeValidation(submission.submissionId, ValidationResult.VERIFIED, 'Timing analysis confirmed');

      // HIGH severity requires 4 guardian approvals
      const reward = parseEther('6'); // 6 ETH suggested

      service.guardianVote(submission.submissionId, GUARDIAN_1, 1n, true, reward, 'Valid timing attack confirmed');
      service.guardianVote(submission.submissionId, GUARDIAN_2, 2n, true, reward, 'Confirmed valid attack vector');
      service.guardianVote(submission.submissionId, GUARDIAN_3, 3n, true, reward, 'Verified timing analysis');
      
      let status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.GUARDIAN_REVIEW); // Still in review

      service.guardianVote(submission.submissionId, GUARDIAN_4, 4n, true, reward, 'Approve this submission');
      
      status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.CEO_REVIEW); // HIGH goes to CEO
      expect(status!.guardianApprovals).toBe(4);
    });

    test('should reject with too many negative votes', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.MEDIUM,
        vulnType: VulnerabilityType.OTHER,
        title: 'Dubious vulnerability claim',
        summary: 'Questionable vulnerability that guardians will reject during review process testing.',
        description: 'This submission is intentionally weak to test the guardian rejection flow. The vulnerability claim lacks sufficient technical evidence and clear reproduction steps. Guardians should identify this as a low-quality submission and vote to reject it through the normal review process.',
        affectedComponents: ['Other'],
        stepsToReproduce: ['Unclear step that lacks detail', 'Another unclear step'],
        proofOfConcept: '',
        suggestedFix: '',
        stake: '0.01',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 7n);
      service.completeValidation(submission.submissionId, ValidationResult.LIKELY_VALID, 'Needs guardian review');

      // 6 rejections should reject
      for (let i = 0; i < 6; i++) {
        const guardianAddr = `0x${(7 + i).toString(16).padStart(40, '0')}` as `0x${string}`;
        service.guardianVote(submission.submissionId, guardianAddr, BigInt(10 + i), false, 0n, 'Not valid - insufficient evidence provided');
      }

      const status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.REJECTED);
    });
  });

  describe('CEO Decision', () => {
    test('should complete payout flow for approved critical', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.CRITICAL,
        vulnType: VulnerabilityType.FUNDS_AT_RISK,
        title: 'Critical: Arithmetic overflow in staking contract',
        summary: 'Staking contract has integer overflow allowing unlimited token minting.',
        description: `
The staking reward calculation in StakingPool.sol has an integer overflow vulnerability.
When stake amount multiplied by reward rate exceeds uint256 max, it wraps to a small number.
However, the unchecked block allows the opposite - wrapping from small to very large.
An attacker can mint effectively unlimited tokens by exploiting this overflow.
This directly threatens all staked funds worth approximately $50M.
        `.trim(),
        affectedComponents: ['Smart Contracts', 'Governance'],
        stepsToReproduce: [
          'Deploy exploit contract that inherits from staking pool',
          'Call stake with amount near uint256 max / reward rate',
          'Wait for reward calculation to trigger overflow',
          'Claim rewards which will be astronomically large',
        ],
        proofOfConcept: `
contract Exploit {
    IStaking staking;
    function attack() external {
        uint256 overflowAmount = type(uint256).max / staking.rewardRate() + 1;
        staking.stake(overflowAmount);
        staking.claimRewards(); // Claims overflow amount
    }
}
        `.trim(),
        suggestedFix: 'Use SafeMath or Solidity 0.8+ checked arithmetic',
        stake: '1.0',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 8n);
      service.completeValidation(submission.submissionId, ValidationResult.VERIFIED, 'Overflow confirmed on testnet fork');

      // CRITICAL requires 5 guardian approvals
      const reward = parseEther('20');
      const guardians = [GUARDIAN_1, GUARDIAN_2, GUARDIAN_3, GUARDIAN_4, GUARDIAN_5];
      
      for (let i = 0; i < 5; i++) {
        service.guardianVote(submission.submissionId, guardians[i], BigInt(20 + i), true, reward, 'Critical vulnerability - approve this submission');
      }

      let status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.CEO_REVIEW);

      // CEO approves with final reward
      const finalReward = parseEther('25');
      service.ceoDecision(submission.submissionId, true, finalReward, 'Critical vulnerability confirmed. Maximum reward approved.');

      status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.APPROVED);
      expect(status!.rewardAmount).toBe(finalReward);

      // Pay reward
      const payout = await service.payReward(submission.submissionId);
      expect(payout.amount).toBe(finalReward);

      status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.PAID);

      // Check researcher stats
      const stats = service.getResearcherStats(RESEARCHER_ADDRESS);
      expect(stats.approvedSubmissions).toBeGreaterThan(0);
      expect(stats.totalEarned).toBeGreaterThanOrEqual(finalReward);
    });

    test('CEO can reject high severity submission', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.HIGH,
        vulnType: VulnerabilityType.CONSENSUS_ATTACK,
        title: 'Theoretical 51% attack vector',
        summary: 'Theoretical attack on consensus that requires impractical resources beyond any known entity.',
        description: 'Theoretical consensus attack that would require controlling 60% of the network which is economically infeasible. This submission describes an attack vector that while technically possible would require resources exceeding those of any known actor. The economic cost of acquiring sufficient stake would exceed any potential gain from the attack.',
        affectedComponents: ['Governance'],
        stepsToReproduce: ['Control 60% of network hashrate or stake', 'Execute the theoretical attack vector'],
        proofOfConcept: '',
        suggestedFix: '',
        stake: '0.1',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 9n);
      service.completeValidation(submission.submissionId, ValidationResult.LIKELY_VALID, 'Theoretical');

      // 4 guardians approve but CEO rejects
      const reward = parseEther('5');
      service.guardianVote(submission.submissionId, GUARDIAN_1, 30n, true, reward, 'Theoretical but valid vulnerability');
      service.guardianVote(submission.submissionId, GUARDIAN_2, 31n, true, reward, 'Approve this theoretical vulnerability');
      service.guardianVote(submission.submissionId, GUARDIAN_3, 32n, true, reward, 'Approve this submission for CEO review');
      service.guardianVote(submission.submissionId, GUARDIAN_4, 33n, true, reward, 'Approve - should go to CEO');

      let status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.CEO_REVIEW);

      // CEO rejects
      service.ceoDecision(
        submission.submissionId,
        false,
        0n,
        'Attack is economically infeasible. Requires resources beyond any known entity.'
      );

      status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.REJECTED);
    });
  });

  describe('Fix & Disclosure', () => {
    test('should record fix and schedule disclosure', async () => {
      const draft: BountySubmissionDraft = {
        severity: BountySeverity.MEDIUM,
        vulnType: VulnerabilityType.INFORMATION_DISCLOSURE,
        title: 'API key exposure in frontend bundle',
        summary: 'Internal API keys are exposed in the production JavaScript bundle and can be seen by anyone.',
        description: 'The frontend build process includes internal API keys in the JavaScript bundle which are visible to anyone who views the page source. These keys could be used to access internal APIs or services. The keys should be moved to server-side environment variables and accessed through a backend proxy.',
        affectedComponents: ['Frontend'],
        stepsToReproduce: ['Open browser dev tools on the page', 'Search for API_KEY in sources tab', 'Find exposed keys in the bundle'],
        proofOfConcept: 'grep -r "API_KEY" dist/main.js',
        suggestedFix: 'Move keys to backend proxy',
        stake: '0.05',
      };

      const submission = await service.submit(draft, RESEARCHER_ADDRESS, 10n);
      service.completeValidation(submission.submissionId, ValidationResult.VERIFIED, 'Keys found in bundle');

      // Guardian approval (3 for MEDIUM)
      const reward = parseEther('2');
      service.guardianVote(submission.submissionId, GUARDIAN_1, 40n, true, reward, 'Valid API key exposure confirmed');
      service.guardianVote(submission.submissionId, GUARDIAN_2, 41n, true, reward, 'Valid - found keys in bundle');
      service.guardianVote(submission.submissionId, GUARDIAN_3, 42n, true, reward, 'Valid submission - approve');

      // MEDIUM doesn't go to CEO
      let status = service.get(submission.submissionId);
      expect(status!.status).toBe(BountySubmissionStatus.APPROVED);

      // Record fix - must be a valid 40-char hex git commit hash
      const fixed = service.recordFix(submission.submissionId, 'abc123def456abc123def456abc123def456abc1');
      expect(fixed.fixCommitHash).toBe('abc123def456abc123def456abc123def456abc1');
      expect(fixed.disclosureDate).toBeGreaterThan(Date.now() / 1000);

      // Researcher can disclose
      const disclosed = service.researcherDisclose(submission.submissionId, RESEARCHER_ADDRESS);
      expect(disclosed.researcherDisclosed).toBe(true);
    });
  });

  describe('Sandbox Executor', () => {
    test('should create appropriate sandbox config for EVM exploit', () => {
      const config = createSandboxConfig(
        VulnerabilityType.FUNDS_AT_RISK,
        'contract Exploit { function drain() external {} }',
        { FORK_BLOCK: '12345678' }
      );

      expect(config.imageRef).toContain('evm');
      expect(config.resources.memoryMb).toBe(8192);
      expect(config.resources.networkBandwidthMbps).toBe(10); // Needs RPC
      expect(config.securityOptions.noNetwork).toBe(false);
      expect(config.env.FORK_BLOCK).toBe('12345678');
    });

    test('should create isolated config for RCE', () => {
      const config = createSandboxConfig(
        VulnerabilityType.REMOTE_CODE_EXECUTION,
        'os.system("whoami")',
      );

      expect(config.imageRef).toContain('isolated');
      expect(config.resources.memoryMb).toBe(1024);
      expect(config.resources.cpuCores).toBe(1);
      expect(config.timeout).toBe(60);
      expect(config.securityOptions.noNetwork).toBe(true);
      expect(config.securityOptions.seccompProfile).toBe('paranoid');
    });

    test('should track sandbox stats', () => {
      const stats = getSandboxStats();
      
      expect(stats).toHaveProperty('activeJobs');
      expect(stats).toHaveProperty('completedJobs');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('avgExecutionTimeMs');
    });
  });

  describe('Pool Stats', () => {
    test('should return accurate pool stats', () => {
      const stats = service.getPoolStats();

      expect(stats.totalPool).toBeGreaterThanOrEqual(0n);
      expect(stats.totalPaidOut).toBeGreaterThanOrEqual(0n);
      expect(stats.activeSubmissions).toBeGreaterThanOrEqual(0);
      expect(stats.guardianCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Severity Rewards', () => {
    test('should have correct reward ranges', () => {
      expect(SEVERITY_REWARDS[BountySeverity.LOW].min).toBe('$500');
      expect(SEVERITY_REWARDS[BountySeverity.LOW].max).toBe('$2,500');
      
      expect(SEVERITY_REWARDS[BountySeverity.MEDIUM].min).toBe('$2,500');
      expect(SEVERITY_REWARDS[BountySeverity.MEDIUM].max).toBe('$10,000');
      
      expect(SEVERITY_REWARDS[BountySeverity.HIGH].min).toBe('$10,000');
      expect(SEVERITY_REWARDS[BountySeverity.HIGH].max).toBe('$25,000');
      
      expect(SEVERITY_REWARDS[BountySeverity.CRITICAL].min).toBe('$25,000');
      expect(SEVERITY_REWARDS[BountySeverity.CRITICAL].max).toBe('$50,000');
    });
  });
});

describe('Bug Bounty API', () => {
  // These tests would normally run against the actual API
  // For unit tests, we test the service directly
  
  test('API routes are defined', async () => {
    const { bugBountyRouter } = await import('../src/bug-bounty-routes');
    expect(bugBountyRouter).toBeDefined();
  });
});

