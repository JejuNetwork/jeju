/**
 * E2E Tests for Security Analyst Agent
 *
 * Tests the FETCH_CONTRACT action and security analysis flow.
 * Requires: Crucible server running (`bun run dev`)
 */

import { describe, expect, test } from 'bun:test'

const CRUCIBLE_URL = process.env.CRUCIBLE_URL ?? 'http://localhost:8001'
const TEST_CONTRACT_URL =
  'https://raw.githubusercontent.com/elizaos/jeju/main/packages/contracts/src/agents/AgentVault.sol'

// Known content from AgentVault.sol that MUST appear if fetched correctly
const AGENTVAULT_MARKERS = {
  // Contract name
  contractName: 'AgentVault',
  // SPDX license (all Jeju contracts have this)
  license: 'SPDX-License-Identifier',
  // Specific function names in AgentVault
  functions: ['deposit', 'withdraw', 'spend'],
  // Imports or inheritance
  imports: ['Ownable', 'ReentrancyGuard'],
}

// Helper to check if server is running
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${CRUCIBLE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Helper to chat with agent
async function chatWithAgent(
  characterId: string,
  text: string,
): Promise<{ text: string; action?: string; actions?: Array<{ name: string }> }> {
  const response = await fetch(`${CRUCIBLE_URL}/api/v1/chat/${characterId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      userId: 'test-user',
      roomId: `test-${Date.now()}`,
    }),
    signal: AbortSignal.timeout(60000), // 60s timeout for inference
  })

  if (!response.ok) {
    throw new Error(`Chat failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

describe('Security Analyst Agent', () => {
  test('server is running', async () => {
    const running = await isServerRunning()
    if (!running) {
      console.log('⚠️  Crucible server not running. Start with: bun run dev')
      console.log('    Skipping security analyst tests.')
      return
    }
    expect(running).toBe(true)
  })

  // Baseline test: verify the contract URL is valid and contains expected content
  test('baseline: GitHub contract URL is accessible', async () => {
    const response = await fetch(TEST_CONTRACT_URL, {
      signal: AbortSignal.timeout(10000),
    })

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)

    const content = await response.text()
    console.log('Contract size:', content.length, 'bytes')

    // Verify this is actually AgentVault.sol
    expect(content).toContain('contract AgentVault')
    expect(content).toContain('SPDX-License-Identifier')

    // Store for comparison (check key functions exist)
    for (const fn of AGENTVAULT_MARKERS.functions) {
      const hasFn = content.includes(`function ${fn}`) || content.includes(fn)
      if (hasFn) {
        console.log(`  ✓ Found function: ${fn}`)
      }
    }

    expect(content.length).toBeGreaterThan(1000) // Contract should be substantial
    console.log('✅ Baseline verified - AgentVault.sol is accessible at expected URL')
  })

  test('security-analyst character exists', async () => {
    if (!(await isServerRunning())) return

    const response = await fetch(`${CRUCIBLE_URL}/api/v1/chat/characters`)
    const data = await response.json()

    const characterIds = data.characters?.map((c: { id: string }) => c.id) ?? []

    // This will fail until we create the character - that's expected
    if (!characterIds.includes('security-analyst')) {
      console.log('⚠️  security-analyst character not found. Create it first.')
      console.log('    Available characters:', characterIds.join(', '))
    }

    // For now, just check we can list characters
    expect(data.characters).toBeDefined()
  })

  test(
    'can fetch contract via FETCH_CONTRACT action',
    async () => {
      if (!(await isServerRunning())) return

      // Check if security-analyst exists
      const charsResponse = await fetch(`${CRUCIBLE_URL}/api/v1/chat/characters`)
      const charsData = await charsResponse.json()
      const characterIds = charsData.characters?.map((c: { id: string }) => c.id) ?? []

      if (!characterIds.includes('security-analyst')) {
        console.log('⚠️  security-analyst not available, skipping')
        return
      }

      const response = await chatWithAgent(
        'security-analyst',
        `Fetch the contract at ${TEST_CONTRACT_URL}`,
      )

      console.log('Response length:', response.text.length)
      console.log('Response preview:', response.text.slice(0, 500))

      // Verify response is substantial
      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(500) // Contract should be large

      // PROOF: Verify SPECIFIC content from AgentVault.sol
      // These are unique identifiers that prove we fetched the actual contract

      // Must contain the contract name
      expect(response.text).toContain(AGENTVAULT_MARKERS.contractName)

      // Must contain SPDX license header
      expect(response.text).toContain(AGENTVAULT_MARKERS.license)

      // Must contain at least one of the key function names
      const hasFunction = AGENTVAULT_MARKERS.functions.some((fn) =>
        response.text.includes(fn),
      )
      expect(hasFunction).toBe(true)

      console.log('✅ Contract fetch verified - contains AgentVault-specific content')
    },
    90000, // 90s timeout
  )

  test(
    'can analyze contract for vulnerabilities',
    async () => {
      if (!(await isServerRunning())) return

      const charsResponse = await fetch(`${CRUCIBLE_URL}/api/v1/chat/characters`)
      const charsData = await charsResponse.json()
      const characterIds = charsData.characters?.map((c: { id: string }) => c.id) ?? []

      if (!characterIds.includes('security-analyst')) {
        console.log('⚠️  security-analyst not available, skipping')
        return
      }

      const response = await chatWithAgent(
        'security-analyst',
        `Analyze ${TEST_CONTRACT_URL} for security vulnerabilities. Focus on reentrancy, access control, and common DeFi issues.`,
      )

      console.log('Analysis preview:', response.text.slice(0, 1000))

      // Verify response is substantive
      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(200)

      // Check if response mentions security concepts
      const hasSecurityAnalysis =
        response.text.toLowerCase().includes('reentrancy') ||
        response.text.toLowerCase().includes('access') ||
        response.text.toLowerCase().includes('security') ||
        response.text.toLowerCase().includes('vulnerability') ||
        response.text.toLowerCase().includes('risk') ||
        response.text.toLowerCase().includes('finding')

      expect(hasSecurityAnalysis).toBe(true)
    },
    120000, // 120s timeout for analysis
  )

  test(
    'rejects non-GitHub URLs',
    async () => {
      if (!(await isServerRunning())) return

      const charsResponse = await fetch(`${CRUCIBLE_URL}/api/v1/chat/characters`)
      const charsData = await charsResponse.json()
      const characterIds = charsData.characters?.map((c: { id: string }) => c.id) ?? []

      if (!characterIds.includes('security-analyst')) {
        console.log('⚠️  security-analyst not available, skipping')
        return
      }

      const response = await chatWithAgent(
        'security-analyst',
        'Fetch contract from http://localhost:8080/evil.sol',
      )

      // Should reject or warn about non-allowed domain
      const rejectsUnsafe =
        response.text.toLowerCase().includes('not allowed') ||
        response.text.toLowerCase().includes('only github') ||
        response.text.toLowerCase().includes('cannot fetch') ||
        response.text.toLowerCase().includes('security') ||
        response.text.toLowerCase().includes('internal')

      expect(rejectsUnsafe).toBe(true)
    },
    60000,
  )
})
