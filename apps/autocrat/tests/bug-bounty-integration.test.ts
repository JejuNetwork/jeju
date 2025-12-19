/**
 * Bug Bounty Integration Tests
 * 
 * REAL tests against live APIs - requires environment variables:
 * - GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for AI inference
 * - DWS running for compute
 * 
 * Run with: bun test tests/bug-bounty-integration.test.ts
 */

import { describe, test, expect, beforeAll, setDefaultTimeout } from 'bun:test';

// Set longer timeout for API calls (60 seconds)
setDefaultTimeout(60000);
import { parseEther, formatEther } from 'viem';

// ============ Environment Check ============

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const hasInferenceKey = Boolean(GROQ_API_KEY || OPENAI_API_KEY || ANTHROPIC_API_KEY);
const DWS_URL = process.env.DWS_URL ?? 'http://localhost:8020';
const AUTOCRAT_URL = process.env.AUTOCRAT_URL ?? 'http://localhost:8010';

// ============ Helper Functions ============

async function checkDWSHealth(): Promise<{ available: boolean; provider: string }> {
  // Try multiple paths since DWS_URL might include /compute or not
  const paths = [
    `${DWS_URL}/health`,
    `${DWS_URL.replace('/compute', '')}/compute/health`,
    `${DWS_URL}/compute/health`,
  ];
  
  for (const path of paths) {
    try {
      const response = await fetch(path, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json() as { service: string };
        return { available: true, provider: data.service };
      }
    } catch {
      // Try next path
    }
  }
  return { available: false, provider: 'none' };
}

async function callDWSInference(messages: Array<{ role: string; content: string }>, maxTokens = 500): Promise<{
  content: string;
  provider: string;
  model: string;
}> {
  // Handle DWS_URL that might already include /compute
  const baseUrl = DWS_URL.endsWith('/compute') ? DWS_URL : `${DWS_URL}/compute`;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DWS inference failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    provider?: string;
    model?: string;
  };

  return {
    content: data.choices[0].message.content,
    provider: data.provider ?? 'unknown',
    model: data.model ?? 'unknown',
  };
}

async function callAnthropicDirect(prompt: string, systemPrompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0].text;
}

async function callGroqDirect(prompt: string, systemPrompt: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

async function callOpenAIDirect(prompt: string, systemPrompt: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API failed: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

// ============ Tests ============

describe('Environment Verification', () => {
  test('should have at least one inference API key', () => {
    console.log('\n=== Inference Provider Configuration ===');
    console.log(`GROQ_API_KEY: ${GROQ_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`OPENAI_API_KEY: ${OPENAI_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`DWS_URL: ${DWS_URL}`);
    console.log(`AUTOCRAT_URL: ${AUTOCRAT_URL}`);
    
    expect(hasInferenceKey).toBe(true);
  });
});

describe('Direct API Provider Tests', () => {
  test('should successfully call Groq API directly', async () => {
    if (!GROQ_API_KEY) {
      console.log('Skipping Groq test - no API key');
      return;
    }

    console.log('\n=== Testing Groq API Direct ===');
    
    const response = await callGroqDirect(
      'What is 2 + 2? Reply with just the number.',
      'You are a helpful assistant. Be concise.'
    );

    console.log(`Groq response: "${response}"`);
    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(0);
    expect(response).toContain('4');
  });

  test('should successfully call OpenAI API directly', async () => {
    if (!OPENAI_API_KEY) {
      console.log('Skipping OpenAI test - no API key');
      return;
    }

    console.log('\n=== Testing OpenAI API Direct ===');
    
    const response = await callOpenAIDirect(
      'What is 2 + 2? Reply with just the number.',
      'You are a helpful assistant. Be concise.'
    );

    console.log(`OpenAI response: "${response}"`);
    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(0);
    expect(response).toContain('4');
  });

  test('should successfully call Anthropic API directly', async () => {
    if (!ANTHROPIC_API_KEY) {
      console.log('Skipping Anthropic test - no API key');
      return;
    }

    console.log('\n=== Testing Anthropic API Direct ===');
    
    const response = await callAnthropicDirect(
      'What is 2 + 2? Reply with just the number.',
      'You are a helpful assistant. Be concise.'
    );

    console.log(`Anthropic response: "${response}"`);
    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(0);
    expect(response).toContain('4');
  });
});

describe('DWS Inference Integration', () => {
  let dwsAvailable = false;

  beforeAll(async () => {
    const health = await checkDWSHealth();
    dwsAvailable = health.available;
    console.log(`\n=== DWS Status: ${dwsAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'} ===`);
    if (health.available) {
      console.log(`Provider: ${health.provider}`);
    }
  });

  test('should call DWS inference endpoint', async () => {
    if (!dwsAvailable) {
      console.log('Skipping - DWS not available. Start with: cd apps/dws && bun run dev');
      return;
    }

    console.log('\n=== Testing DWS Inference ===');

    const result = await callDWSInference([
      { role: 'system', content: 'You are a helpful assistant. Be concise.' },
      { role: 'user', content: 'What is 2 + 2? Reply with just the number.' },
    ]);

    console.log(`DWS response: "${result.content}"`);
    console.log(`Provider: ${result.provider}, Model: ${result.model}`);

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).toContain('4');
  });
});

describe('Security Validation Agent - Real AI Analysis', () => {
  test('should analyze a vulnerability report with real AI', async () => {
    // Use direct API call since DWS might not be running
    const inferenceFunc = ANTHROPIC_API_KEY 
      ? callAnthropicDirect 
      : GROQ_API_KEY 
        ? callGroqDirect 
        : OPENAI_API_KEY 
          ? callOpenAIDirect 
          : null;

    if (!inferenceFunc) {
      console.log('Skipping - no inference provider available');
      return;
    }

    console.log('\n=== Testing Security Validation Agent ===');

    const vulnerabilityReport = `
VULNERABILITY REPORT:
Title: SQL Injection in User Search API
Severity: HIGH
Type: SQL Injection

Description:
The /api/users/search endpoint does not properly sanitize the 'query' parameter.
An attacker can inject SQL commands to extract sensitive data from the database.

Affected Components:
- Backend API (/api/users/search)
- PostgreSQL database

Steps to Reproduce:
1. Navigate to the search endpoint
2. Enter payload: ' OR '1'='1' --
3. Observe all users are returned instead of matching results

Proof of Concept:
curl "https://target.com/api/users/search?query=' OR '1'='1' --"

Suggested Fix:
Use parameterized queries or prepared statements instead of string concatenation.
`;

    const systemPrompt = `You are a security expert analyzing vulnerability reports.
Evaluate the following submission for validity, severity accuracy, and potential impact.
Be skeptical but fair. Respond in JSON format:
{
  "isValid": boolean,
  "severityAssessment": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "impact": "brief description",
  "recommendations": ["list of recommendations"],
  "confidence": 0-100
}`;

    const response = await inferenceFunc(vulnerabilityReport, systemPrompt);
    
    console.log('AI Security Analysis Response:');
    console.log(response);

    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(50);
    
    // Check the response contains expected security analysis elements
    const lowerResponse = response.toLowerCase();
    expect(
      lowerResponse.includes('sql') || 
      lowerResponse.includes('injection') || 
      lowerResponse.includes('vulnerability') ||
      lowerResponse.includes('valid')
    ).toBe(true);
  });

  test('should assess a critical wallet drain vulnerability', async () => {
    const inferenceFunc = ANTHROPIC_API_KEY 
      ? callAnthropicDirect 
      : GROQ_API_KEY 
        ? callGroqDirect 
        : OPENAI_API_KEY 
          ? callOpenAIDirect 
          : null;

    if (!inferenceFunc) {
      console.log('Skipping - no inference provider available');
      return;
    }

    console.log('\n=== Testing Critical Vulnerability Assessment ===');

    const criticalReport = `
CRITICAL SECURITY VULNERABILITY:
Title: Reentrancy Attack in Staking Contract

Description:
The StakingPool.sol contract has a reentrancy vulnerability in the withdrawStake() function.
The function sends ETH before updating the user's balance, allowing recursive withdrawals.

Impact Assessment:
- Total value at risk: ~$10M in staked assets
- Attack can drain entire staking pool
- Requires only a single malicious contract deployment

Proof of Concept:
\`\`\`solidity
contract Attacker {
    IStakingPool target;
    
    function attack() external payable {
        target.stake{value: msg.value}();
        target.withdrawStake(msg.value);
    }
    
    receive() external payable {
        if (address(target).balance > 0) {
            target.withdrawStake(1 ether);
        }
    }
}
\`\`\`

This is an IMMEDIATE threat requiring emergency action.
`;

    const systemPrompt = `You are a blockchain security auditor. Analyze this smart contract vulnerability.
Determine if this is a valid, exploitable vulnerability.
Respond with JSON:
{
  "isImmediateThreat": boolean,
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "exploitability": "Easy" | "Medium" | "Hard",
  "recommendedAction": "string",
  "estimatedImpact": "string",
  "suggestedBounty": "string in USD range"
}`;

    const response = await inferenceFunc(criticalReport, systemPrompt);
    
    console.log('Critical Vulnerability Assessment:');
    console.log(response);

    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(50);
    
    const lowerResponse = response.toLowerCase();
    expect(
      lowerResponse.includes('reentrancy') || 
      lowerResponse.includes('critical') || 
      lowerResponse.includes('vulnerability') ||
      lowerResponse.includes('threat')
    ).toBe(true);
  });
});

describe('Guardian Agent Response Test', () => {
  test('should simulate guardian voting on a vulnerability', async () => {
    const inferenceFunc = ANTHROPIC_API_KEY 
      ? callAnthropicDirect 
      : GROQ_API_KEY 
        ? callGroqDirect 
        : OPENAI_API_KEY 
          ? callOpenAIDirect 
          : null;

    if (!inferenceFunc) {
      console.log('Skipping - no inference provider available');
      return;
    }

    console.log('\n=== Testing Guardian Agent Voting ===');

    const submissionSummary = `
Bug Bounty Submission #0x1234:
- Severity: HIGH
- Type: Privilege Escalation
- Title: API Token Reuse Across Sessions
- Automated Validation: LIKELY_VALID (confidence: 75%)
- Impact: Users can access other accounts
- PoC Provided: Yes
- Suggested Reward: $12,000 - $18,000
`;

    const guardianPrompt = `You are a Guardian Agent for Jeju Network's bug bounty program.
You are reviewing a security vulnerability submission that has passed automated validation.

Review this submission and decide:
1. APPROVE - Valid vulnerability, suggest reward amount
2. REJECT - Invalid or out of scope
3. REQUEST_CHANGES - Need more information

Respond in JSON:
{
  "decision": "APPROVE" | "REJECT" | "REQUEST_CHANGES",
  "suggestedReward": "amount in ETH",
  "reasoning": "brief explanation",
  "confidence": 0-100
}`;

    const response = await inferenceFunc(submissionSummary, guardianPrompt);
    
    console.log('Guardian Vote Response:');
    console.log(response);

    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(20);
    
    const lowerResponse = response.toLowerCase();
    expect(
      lowerResponse.includes('approve') || 
      lowerResponse.includes('reject') || 
      lowerResponse.includes('request')
    ).toBe(true);
  });
});

describe('CEO Decision Agent Test', () => {
  test('should simulate CEO final decision on critical vulnerability', async () => {
    const inferenceFunc = ANTHROPIC_API_KEY 
      ? callAnthropicDirect 
      : GROQ_API_KEY 
        ? callGroqDirect 
        : OPENAI_API_KEY 
          ? callOpenAIDirect 
          : null;

    if (!inferenceFunc) {
      console.log('Skipping - no inference provider available');
      return;
    }

    console.log('\n=== Testing CEO Decision Agent ===');

    const decisionContext = `
CEO REVIEW REQUIRED:
Submission: Critical reentrancy vulnerability in staking contract
Severity: CRITICAL
Estimated Impact: $10M at risk

Guardian Votes:
- Guardian 1: APPROVE, $30k suggested, "Valid reentrancy, critical fix needed"
- Guardian 2: APPROVE, $25k suggested, "Confirmed on testnet fork"
- Guardian 3: APPROVE, $28k suggested, "Well documented, clear PoC"
- Guardian 4: APPROVE, $35k suggested, "Immediate threat, max bounty"
- Guardian 5: APPROVE, $30k suggested, "Critical priority"

Average Suggested Reward: $29,600

Automated Validation: VERIFIED (exploit confirmed in sandbox)
`;

    const ceoPrompt = `You are Eliza, AI CEO of Jeju Network.
You must make the final decision on this critical security bounty.

Consider:
1. Guardian consensus and suggested rewards
2. Severity and impact assessment
3. DAO treasury capacity
4. Precedent for future bounties

Respond with your executive decision in JSON:
{
  "approved": boolean,
  "finalReward": "amount in ETH",
  "reasoning": "executive summary",
  "urgency": "IMMEDIATE" | "HIGH" | "STANDARD",
  "additionalNotes": "any special instructions"
}`;

    const response = await inferenceFunc(decisionContext, ceoPrompt);
    
    console.log('CEO Decision:');
    console.log(response);

    expect(response).toBeDefined();
    expect(response.length).toBeGreaterThan(50);
    
    const lowerResponse = response.toLowerCase();
    expect(
      lowerResponse.includes('approved') || 
      lowerResponse.includes('reward') ||
      lowerResponse.includes('eth')
    ).toBe(true);
  });
});

describe('Full Bug Bounty Flow Integration', () => {
  test('should complete end-to-end bug bounty flow with real AI', async () => {
    const inferenceFunc = ANTHROPIC_API_KEY 
      ? callAnthropicDirect 
      : GROQ_API_KEY 
        ? callGroqDirect 
        : OPENAI_API_KEY 
          ? callOpenAIDirect 
          : null;

    if (!inferenceFunc) {
      console.log('Skipping - no inference provider available');
      return;
    }

    console.log('\n=== Full E2E Bug Bounty Flow ===');

    // Step 1: Submission Assessment
    console.log('\nStep 1: Assessing submission...');
    const submissionAssessment = await inferenceFunc(
      `Analyze this vulnerability for the bug bounty program:
Title: Cross-site scripting in dashboard
Description: User input in profile name is not sanitized, allowing XSS attacks
Severity claimed: MEDIUM
Steps: 1. Edit profile 2. Enter <script>alert(1)</script> 3. View profile

Is this valid? What severity should it be?`,
      'You are a security validator. Respond with: VALID/INVALID, actual severity, and brief note.'
    );
    console.log(`Assessment: ${submissionAssessment.slice(0, 200)}`);
    expect(submissionAssessment).toBeDefined();

    // Step 2: Guardian Vote
    console.log('\nStep 2: Guardian voting...');
    const guardianVote = await inferenceFunc(
      `As a guardian, vote on this XSS vulnerability:
- Validation result: LIKELY_VALID
- Claimed severity: MEDIUM
- Actual severity: MEDIUM (confirmed)
- Has PoC: Yes

Should this be APPROVED, REJECTED, or REQUEST_CHANGES?`,
      'You are a security guardian. Vote with brief reasoning.'
    );
    console.log(`Guardian vote: ${guardianVote.slice(0, 200)}`);
    expect(guardianVote).toBeDefined();

    // Step 3: (For HIGH/CRITICAL, CEO would review - skip for MEDIUM)
    console.log('\nStep 3: For MEDIUM severity, no CEO review needed');

    // Step 4: Payout calculation
    console.log('\nStep 4: Calculating payout...');
    const payoutCalc = await inferenceFunc(
      `Calculate bounty payout for:
- Severity: MEDIUM
- Impact: XSS affecting dashboard users
- PoC quality: Good
- Fix suggestion: Yes
- Range for MEDIUM: $2,500 - $10,000

What's the appropriate payout amount?`,
      'You are a bounty calculator. Provide amount in ETH (assume $2500/ETH) and brief justification.'
    );
    console.log(`Payout: ${payoutCalc.slice(0, 200)}`);
    expect(payoutCalc).toBeDefined();

    console.log('\n=== E2E Flow Complete ===');
  });
});

// ============ Print Summary ============

describe('Test Summary', () => {
  test('should print configuration summary', () => {
    console.log('\n' + '='.repeat(60));
    console.log('BUG BOUNTY INTEGRATION TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nInference Providers:`);
    console.log(`  - Groq: ${GROQ_API_KEY ? 'CONFIGURED' : 'not set'}`);
    console.log(`  - OpenAI: ${OPENAI_API_KEY ? 'CONFIGURED' : 'not set'}`);
    console.log(`  - Anthropic: ${ANTHROPIC_API_KEY ? 'CONFIGURED' : 'not set'}`);
    console.log(`\nPrimary Provider: ${ANTHROPIC_API_KEY ? 'Anthropic' : GROQ_API_KEY ? 'Groq' : OPENAI_API_KEY ? 'OpenAI' : 'NONE'}`);
    console.log(`\nTo run with all features:`);
    console.log(`  1. Set API keys in .env`);
    console.log(`  2. Start DWS: cd apps/dws && bun run dev`);
    console.log(`  3. Start Autocrat: cd apps/autocrat && bun run dev`);
    console.log('='.repeat(60) + '\n');
    
    expect(true).toBe(true);
  });
});

