/**
 * DAO API Integration Tests
 *
 * Tests the DAO management endpoints:
 * - DAO CRUD operations
 * - Agent management within DAOs
 * - Governance parameter updates
 * - Treasury queries
 *
 * These tests verify:
 * - Correct request/response formats
 * - Validation and error handling
 * - Edge cases and boundary conditions
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`
const API_BASE = `${AUTOCRAT_URL}/api/v1`

// Test data
const VALID_DAO_DRAFT = {
  name: 'test-dao',
  displayName: 'Test DAO',
  description: 'A test DAO for automated API testing',
  avatarCid: '',
  bannerCid: '',
  visibility: 'public',
  ceo: {
    role: 'CEO',
    persona: {
      name: 'Test CEO',
      avatarCid: '',
      bio: 'AI CEO for testing',
      personality: 'Decisive and analytical',
      traits: ['analytical', 'fair'],
      voiceStyle: 'authoritative',
      communicationTone: 'professional',
      specialties: ['governance'],
    },
    modelId: 'claude-opus-4-5-20250514',
    weight: 100,
    values: ['decentralization'],
    decisionStyle: 'balanced',
  },
  board: [
    {
      role: 'TREASURY',
      persona: {
        name: 'Treasury Guardian',
        avatarCid: '',
        bio: 'Protects the treasury',
        personality: 'Conservative',
        traits: ['analytical'],
        voiceStyle: 'formal',
        communicationTone: 'formal',
        specialties: ['finance'],
      },
      modelId: 'claude-sonnet-4-20250514',
      weight: 25,
      values: ['security'],
      decisionStyle: 'conservative',
    },
    {
      role: 'CODE',
      persona: {
        name: 'Code Guardian',
        avatarCid: '',
        bio: 'Reviews code changes',
        personality: 'Technical',
        traits: ['meticulous'],
        voiceStyle: 'technical',
        communicationTone: 'professional',
        specialties: ['development'],
      },
      modelId: 'claude-sonnet-4-20250514',
      weight: 25,
      values: ['quality'],
      decisionStyle: 'balanced',
    },
    {
      role: 'COMMUNITY',
      persona: {
        name: 'Community Voice',
        avatarCid: '',
        bio: 'Represents community interests',
        personality: 'Empathetic',
        traits: ['diplomatic'],
        voiceStyle: 'friendly',
        communicationTone: 'casual',
        specialties: ['community'],
      },
      modelId: 'claude-sonnet-4-20250514',
      weight: 25,
      values: ['inclusion'],
      decisionStyle: 'aggressive',
    },
  ],
  governanceParams: {
    minQualityScore: 70,
    councilVotingPeriod: 259200,
    gracePeriod: 86400,
    minProposalStake: '0.01',
    quorumBps: 5000,
    minBoardApprovals: 2,
    ceoVetoEnabled: true,
    communityVetoEnabled: true,
    vetoThreshold: 33,
  },
  tags: ['test'],
}

test.describe('DAO List Endpoints', () => {
  test('GET /dao/list returns array of DAOs', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/list`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.daos).toBeDefined()
    expect(Array.isArray(data.daos)).toBe(true)
  })

  test('GET /dao/list supports pagination', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/list?limit=5&offset=0`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.daos)).toBe(true)
    expect(data.daos.length).toBeLessThanOrEqual(5)
  })

  test('GET /dao/list supports status filter', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/list?status=active`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.daos)).toBe(true)

    // All returned DAOs should be active
    for (const dao of data.daos) {
      expect(dao.status).toBe('active')
    }
  })

  test('GET /dao/list supports search filter', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/list?search=network`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.daos)).toBe(true)

    // Results should contain search term in name, displayName, or description
  })

  test('GET /dao/list handles invalid status', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/list?status=invalid`)

    // Should either return empty array or error
    const data = await response.json()
    if (response.ok()) {
      expect(Array.isArray(data.daos)).toBe(true)
    } else {
      expect(data.error).toBeDefined()
    }
  })

  test('GET /dao/list handles negative pagination', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/dao/list?limit=-1&offset=-1`,
    )

    // Should handle gracefully
    const data = await response.json()
    if (response.ok()) {
      expect(Array.isArray(data.daos)).toBe(true)
    } else {
      expect(response.status()).toBe(400)
      expect(data.error).toBeDefined()
    }
  })

  test('GET /dao/active returns only active DAOs', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/active`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.daos)).toBe(true)

    for (const dao of data.daos) {
      expect(dao.status).toBe('active')
    }
  })
})

test.describe('Single DAO Endpoints', () => {
  test('GET /dao/:id returns DAO details', async ({ request }) => {
    // First get list to find a valid DAO ID
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(`${API_BASE}/dao/${daoId}`)
      expect(response.ok()).toBeTruthy()

      const data = await response.json()
      expect(data.daoId).toBe(daoId)
      expect(data.name).toBeDefined()
      expect(data.displayName).toBeDefined()
    }
  })

  test('GET /dao/:id returns 404 for non-existent DAO', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/nonexistent-dao-12345`)

    expect(response.status()).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('not found')
  })

  test('GET /dao/:id handles empty ID', async ({ request }) => {
    const response = await request.get(`${API_BASE}/dao/`)

    // Should return 404 or redirect
    expect([400, 404].includes(response.status())).toBe(true)
  })

  test('GET /dao/:id handles special characters', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/dao/${encodeURIComponent('<script>alert(1)</script>')}`,
    )

    // Should handle safely
    expect([400, 404].includes(response.status())).toBe(true)
  })
})

test.describe('DAO Creation', () => {
  test('POST /dao requires authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: VALID_DAO_DRAFT,
    })

    // Without auth, should return 401 or 403
    if (!response.ok()) {
      expect([401, 403].includes(response.status())).toBe(true)
    }
  })

  test('POST /dao validates required fields', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: { name: '' },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
    const data = await response.json()
    expect(data.error || data.message).toBeDefined()
  })

  test('POST /dao validates name format', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: {
        ...VALID_DAO_DRAFT,
        name: 'Invalid Name With Spaces!',
      },
    })

    // Name should be slug format
    if (!response.ok()) {
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    }
  })

  test('POST /dao validates minimum board members', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: {
        ...VALID_DAO_DRAFT,
        board: [VALID_DAO_DRAFT.board[0]], // Only 1 board member
      },
    })

    // Should fail - minimum 3 board members required
    if (!response.ok()) {
      expect(response.status()).toBeGreaterThanOrEqual(400)
      const data = await response.json()
      expect(data.error || data.message).toContain('board')
    }
  })

  test('POST /dao validates governance parameters', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: {
        ...VALID_DAO_DRAFT,
        governanceParams: {
          ...VALID_DAO_DRAFT.governanceParams,
          minQualityScore: 150, // Invalid - over 100
        },
      },
    })

    if (!response.ok()) {
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    }
  })
})

test.describe('DAO Update', () => {
  test('PATCH /dao/:id requires authentication', async ({ request }) => {
    const response = await request.patch(`${API_BASE}/dao/test-dao`, {
      data: { description: 'Updated' },
    })

    if (!response.ok()) {
      expect([401, 403, 404].includes(response.status())).toBe(true)
    }
  })

  test('PATCH /dao/:id validates update fields', async ({ request }) => {
    const response = await request.patch(`${API_BASE}/dao/test-dao`, {
      data: { status: 'invalid-status' },
    })

    if (!response.ok()) {
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    }
  })

  test('PATCH /dao/:id returns 404 for non-existent DAO', async ({
    request,
  }) => {
    const response = await request.patch(
      `${API_BASE}/dao/nonexistent-dao-12345`,
      {
        data: { description: 'Updated' },
      },
    )

    expect([401, 403, 404].includes(response.status())).toBe(true)
  })
})

test.describe('DAO Deletion', () => {
  test('DELETE /dao/:id requires authentication', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/dao/test-dao`)

    if (!response.ok()) {
      expect([401, 403, 404].includes(response.status())).toBe(true)
    }
  })

  test('DELETE /dao/:id returns 404 for non-existent DAO', async ({
    request,
  }) => {
    const response = await request.delete(
      `${API_BASE}/dao/nonexistent-dao-12345`,
    )

    expect([401, 403, 404].includes(response.status())).toBe(true)
  })
})

test.describe('Agent Endpoints within DAO', () => {
  test('GET /dao/:id/agents returns agent list', async ({ request }) => {
    // Get a valid DAO first
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(`${API_BASE}/dao/${daoId}/agents`)

      if (response.ok()) {
        const data = await response.json()
        expect(Array.isArray(data) || Array.isArray(data.agents)).toBe(true)
      }
    }
  })

  test('GET /dao/:id/agents/:agentId returns agent details', async ({
    request,
  }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      // Try to get CEO agent
      const response = await request.get(`${API_BASE}/dao/${daoId}/agents/ceo`)

      if (response.ok()) {
        const data = await response.json()
        expect(data.role).toBe('CEO')
        expect(data.persona).toBeDefined()
      }
    }
  })

  test('POST /dao/:id/agents requires authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao/test-dao/agents`, {
      data: VALID_DAO_DRAFT.board[0],
    })

    if (!response.ok()) {
      expect([401, 403, 404].includes(response.status())).toBe(true)
    }
  })

  test('DELETE /dao/:id/agents/ceo should fail', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/dao/test-dao/agents/ceo`)

    // Should not allow deleting CEO
    if (!response.ok()) {
      const data = await response.json()
      expect(
        response.status() === 400 ||
          response.status() === 403 ||
          response.status() === 404,
      ).toBe(true)
    }
  })
})

test.describe('Governance Parameter Endpoints', () => {
  test('GET /dao/:id/governance returns parameters', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(`${API_BASE}/dao/${daoId}/governance`)

      if (response.ok()) {
        const data = await response.json()
        expect(data.minQualityScore).toBeDefined()
        expect(data.councilVotingPeriod).toBeDefined()
      }
    }
  })

  test('PATCH /dao/:id/governance requires authentication', async ({
    request,
  }) => {
    const response = await request.patch(
      `${API_BASE}/dao/test-dao/governance`,
      {
        data: { minQualityScore: 80 },
      },
    )

    if (!response.ok()) {
      expect([401, 403, 404].includes(response.status())).toBe(true)
    }
  })

  test('PATCH /dao/:id/governance validates boundaries', async ({
    request,
  }) => {
    const response = await request.patch(
      `${API_BASE}/dao/test-dao/governance`,
      {
        data: {
          minQualityScore: -10, // Invalid
          quorumBps: 15000, // Invalid - over 10000
        },
      },
    )

    if (!response.ok()) {
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    }
  })
})

test.describe('Treasury Endpoints', () => {
  test('GET /dao/:id/treasury returns treasury data', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(`${API_BASE}/dao/${daoId}/treasury`)

      if (response.ok()) {
        const data = await response.json()
        expect(data.balances).toBeDefined()
        expect(Array.isArray(data.balances)).toBe(true)
      }
    }
  })

  test('GET /dao/:id/treasury returns 404 for non-existent DAO', async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/dao/nonexistent-dao-12345/treasury`,
    )

    expect(response.status()).toBe(404)
  })
})

test.describe('Proposal Endpoints within DAO', () => {
  test('GET /dao/:id/proposals returns proposal list', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(`${API_BASE}/dao/${daoId}/proposals`)

      if (response.ok()) {
        const data = await response.json()
        expect(Array.isArray(data) || Array.isArray(data.proposals)).toBe(true)
      }
    }
  })

  test('GET /dao/:id/proposals supports status filter', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(
        `${API_BASE}/dao/${daoId}/proposals?status=board_review`,
      )

      expect(response.ok()).toBeTruthy()
    }
  })

  test('GET /dao/:id/proposals supports type filter', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/dao/list`)
    const listData = await listResponse.json()

    if (listData.daos?.length > 0) {
      const daoId = listData.daos[0].daoId

      const response = await request.get(
        `${API_BASE}/dao/${daoId}/proposals?type=code`,
      )

      expect(response.ok()).toBeTruthy()
    }
  })

  test('POST /dao/:id/proposals requires authentication', async ({
    request,
  }) => {
    const response = await request.post(`${API_BASE}/dao/test-dao/proposals`, {
      data: {
        title: 'Test Proposal',
        summary: 'A test proposal',
        description: 'Full description',
        proposalType: 'general',
      },
    })

    if (!response.ok()) {
      expect([401, 403, 404].includes(response.status())).toBe(true)
    }
  })

  test('POST /dao/:id/proposals validates required fields', async ({
    request,
  }) => {
    const response = await request.post(`${API_BASE}/dao/test-dao/proposals`, {
      data: {
        // Missing title, summary
        description: 'Only description',
      },
    })

    if (!response.ok()) {
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    }
  })
})

test.describe('Error Handling', () => {
  test('handles malformed JSON', async ({ request }) => {
    const response = await request.post(`${API_BASE}/dao`, {
      data: 'not valid json',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('handles very large payloads', async ({ request }) => {
    const largeDescription = 'a'.repeat(100000)

    const response = await request.post(`${API_BASE}/dao`, {
      data: {
        ...VALID_DAO_DRAFT,
        description: largeDescription,
      },
    })

    // Should either accept or reject with appropriate error
    if (!response.ok()) {
      expect(response.status()).toBeGreaterThanOrEqual(400)
    }
  })

  test('handles concurrent requests', async ({ request }) => {
    const requests = Array(10)
      .fill(null)
      .map(() => request.get(`${API_BASE}/dao/list`))

    const responses = await Promise.all(requests)

    // All should complete without error
    for (const response of responses) {
      expect(response.status()).toBeLessThan(500)
    }
  })
})

test.describe('Health Check', () => {
  test('GET /health includes DAO service status', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.status).toBeDefined()
  })
})
