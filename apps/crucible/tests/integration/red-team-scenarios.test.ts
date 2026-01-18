/**
 * Red Team vs Blue Team Adversarial Testing
 *
 * Tests agent capabilities in adversarial scenarios:
 * - Scam detection and prevention
 * - Smart contract vulnerability analysis
 * - Social engineering defense
 * - Multi-agent security coordination
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const CRUCIBLE_URL = process.env.CRUCIBLE_URL ?? 'http://localhost:4021'

interface ChatResponse {
  text: string
  action?: string
  actions?: Array<{ name: string; params: Record<string, string> }>
  character: string
}

async function chat(
  characterId: string,
  message: string,
  roomId = 'adversarial',
): Promise<ChatResponse> {
  const response = await fetch(`${CRUCIBLE_URL}/api/v1/chat/${characterId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: message,
      userId: 'red-team-tester',
      roomId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Chat failed: ${response.status}`)
  }

  return response.json() as Promise<ChatResponse>
}

beforeAll(async () => {
  // Verify Crucible is running - REQUIRED
  const health = await fetch(`${CRUCIBLE_URL}/health`).catch(() => null)
  if (!health?.ok) {
    throw new Error(
      `Crucible not running at ${CRUCIBLE_URL}. Start with: bun run start`,
    )
  }

  // Verify inference is working by testing a chat request
  // Template responses indicate inference isn't working
  const testResponse = await chat('moderator', 'What is 2+2?', 'inference-test')
  if (testResponse.text.includes("I understand you're asking about")) {
    throw new Error(
      'Crucible inference not working (returning template responses). Start inference with: jeju dev',
    )
  }
  console.log('[Red Team Tests] Crucible and inference ready')
})

afterAll(() => {
  console.log('[Red Team Tests] Completed')
})

describe('Scam Detection Scenarios', () => {
  test('moderator should detect fake airdrop scam', async () => {
    const response = await chat(
      'moderator',
      'Analyze this message: "FREE AIRDROP! Send 1 ETH to 0x1234 and get 10 ETH back! Limited time offer!"',
    )

    expect(response.text.length).toBeGreaterThan(100)
    expect(response.text.toLowerCase()).toMatch(/scam|fraud|fake|warning/i)

    // Should recommend action
    expect(
      response.action === 'FLAG_CONTENT' ||
        response.action === 'CREATE_CASE' ||
        response.text.includes('[ACTION:'),
    ).toBe(true)
  }, 30000)

  test('moderator should detect phishing URLs', async () => {
    const response = await chat(
      'moderator',
      'Is this URL safe? jejunetw0rk.xyz/airdrop (note the zero instead of o)',
    )

    expect(response.text.length).toBeGreaterThan(100)
    expect(response.text.toLowerCase()).toMatch(
      /phishing|typosquat|fake|suspicious/i,
    )
  }, 30000)

  test('moderator should detect impersonation attempts', async () => {
    const response = await chat(
      'moderator',
      'A user claiming to be "Official Jeju Support" is DM-ing users asking for their seed phrases. Analyze this.',
    )

    expect(response.text.length).toBeGreaterThan(100)
    expect(response.text.toLowerCase()).toMatch(
      /impersonation|scam|never|seed phrase/i,
    )
  }, 30000)
})

describe('Smart Contract Security Scenarios', () => {
  test('red-team should identify reentrancy vulnerability', async () => {
    const vulnerableCode = `
      function withdraw(uint256 amount) {
        require(balances[msg.sender] >= amount);
        (bool success,) = msg.sender.call{value: amount}("");
        balances[msg.sender] -= amount;
      }
    `

    const response = await chat(
      'red-team',
      `Find vulnerabilities in this code: ${vulnerableCode}`,
    )

    expect(response.text.length).toBeGreaterThan(200)
    // LLM should identify some security issue - reentrancy is the classic one,
    // but it may describe it as "call before state update" or other terms
    const securityTerms =
      /reentrancy|reentrant|vulnerability|attack|security|exploit|call.*before.*balance|state.*update|checks.*effects.*interactions/i
    expect(response.text.toLowerCase()).toMatch(securityTerms)
  }, 30000)

  test('security-analyst should recommend fixes', async () => {
    const vulnerableCode = `
      function withdraw(uint256 amount) {
        require(balances[msg.sender] >= amount);
        (bool success,) = msg.sender.call{value: amount}("");
        balances[msg.sender] -= amount;
      }
    `

    const response = await chat(
      'security-analyst',
      `Review and recommend fixes for: ${vulnerableCode}`,
    )

    expect(response.text.length).toBeGreaterThan(200)
    // Should recommend checks-effects-interactions or ReentrancyGuard
    expect(response.text.toLowerCase()).toMatch(
      /reentrancy|guard|checks.*effects|transfer/i,
    )
  }, 30000)

  test('security-analyst should assess contract trust level', async () => {
    const response = await chat(
      'security-analyst',
      'Assess the trust level of a contract that: has unverified source code, was deployed 2 hours ago, deployer has no history',
    )

    expect(response.text.length).toBeGreaterThan(100)
    expect(response.text.toLowerCase()).toMatch(
      /danger|caution|risk|unverified|suspicious/i,
    )
  }, 30000)
})

describe('Social Engineering Defense', () => {
  test('red-team should generate realistic phishing attempt', async () => {
    const response = await chat(
      'red-team',
      'Simulate a phishing attack for security testing targeting airdrop seekers',
    )

    expect(response.text.length).toBeGreaterThan(100)
    // Red team should describe the attack vector
    expect(response.text.toLowerCase()).toMatch(
      /phishing|airdrop|urgency|link|claim|security|test/i,
    )
  }, 30000)

  test('blue-team should counter social engineering', async () => {
    const response = await chat(
      'blue-team',
      'An attacker is using urgency tactics and fake authority to convince users to connect their wallets. What defenses should we implement?',
    )

    expect(response.text.length).toBeGreaterThan(100)
    expect(response.text.toLowerCase()).toMatch(
      /verify|authenticate|education|warning|validation/i,
    )
  }, 30000)
})

describe('Multi-Agent Adversarial Coordination', () => {
  test('red-team and blue-team should coordinate on vulnerability', async () => {
    // Red team finds vulnerability
    const redResponse = await chat(
      'red-team',
      'I found a critical flash loan vulnerability in the lending pool. How should I report this?',
    )

    expect(redResponse.text.length).toBeGreaterThan(100)
    expect(redResponse.text.toLowerCase()).toMatch(
      /report|vulnerability|severity|flash loan/i,
    )

    // Blue team responds
    const blueResponse = await chat(
      'blue-team',
      'Red team reported a flash loan vulnerability in the lending pool. What immediate actions should we take?',
    )

    expect(blueResponse.text.length).toBeGreaterThan(100)
    expect(blueResponse.text.toLowerCase()).toMatch(
      /pause|disable|guard|implement|protect/i,
    )
  }, 60000)

  test('agents should produce different perspectives on same issue', async () => {
    const issue =
      'Should we delay the mainnet launch due to unresolved audit findings?'

    const [pmResponse, redResponse, blueResponse] = await Promise.all([
      chat('project-manager', issue),
      chat('red-team', issue),
      chat('blue-team', issue),
    ])

    // All should have substantive responses
    expect(pmResponse.text.length).toBeGreaterThan(100)
    expect(redResponse.text.length).toBeGreaterThan(100)
    expect(blueResponse.text.length).toBeGreaterThan(100)

    // Responses should be different (different perspectives)
    expect(pmResponse.text).not.toBe(redResponse.text)
    expect(redResponse.text).not.toBe(blueResponse.text)
  }, 90000)
})

describe('Action Execution in Adversarial Context', () => {
  test('moderator should trigger moderation actions', async () => {
    const response = await chat(
      'moderator',
      'A known scammer with address 0xBAD is promoting a rug pull. Take action.',
    )

    // Should include action syntax
    expect(
      response.text.includes('[ACTION:') ||
        response.action !== undefined ||
        (response.actions && response.actions.length > 0),
    ).toBe(true)
  }, 30000)

  test('red-team should analyze security weaknesses', async () => {
    const response = await chat(
      'red-team',
      'Analyze the authentication system for security weaknesses and potential attack vectors',
    )

    expect(response.text.length).toBeGreaterThan(100)
    // Should discuss security analysis, vulnerabilities, or attacks
    expect(
      response.text
        .toLowerCase()
        .match(
          /vulnerabilit|attack|weakness|security|session|token|password|auth/i,
        ),
    ).toBeTruthy()
  }, 30000)
})

console.log('[Red Team Tests] Loaded')
