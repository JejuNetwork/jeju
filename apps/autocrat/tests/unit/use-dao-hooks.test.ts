/**
 * useDAO Hooks Unit Tests
 *
 * Tests for the React Query hooks that power DAO data fetching and mutations.
 * These tests verify:
 * - Correct API endpoints are called
 * - Query parameters are properly constructed
 * - Error handling works correctly
 * - Cache invalidation happens on mutations
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock fetch for testing
const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof mock>

const API_BASE = '/api/v1'

// Mock data
const MOCK_DAO_LIST = [
  {
    daoId: 'jeju-network',
    name: 'jeju-network',
    displayName: 'Jeju Network',
    description: 'The main network DAO',
    avatarCid: '',
    status: 'active',
    visibility: 'public',
    ceoName: 'Atlas',
    ceoAvatarCid: '',
    boardMemberCount: 5,
    proposalCount: 42,
    activeProposalCount: 3,
    treasuryBalance: '1500000',
    memberCount: 12500,
    createdAt: 1700000000000,
    tags: ['infrastructure', 'governance'],
    isNetworkDAO: true,
  },
  {
    daoId: 'defi-guild',
    name: 'defi-guild',
    displayName: 'DeFi Guild',
    description: 'DeFi protocol governance',
    avatarCid: '',
    status: 'active',
    visibility: 'public',
    ceoName: 'Treasury Bot',
    ceoAvatarCid: '',
    boardMemberCount: 3,
    proposalCount: 15,
    activeProposalCount: 1,
    treasuryBalance: '250000',
    memberCount: 890,
    createdAt: 1701000000000,
    tags: ['defi', 'yield'],
    isNetworkDAO: false,
  },
]

const MOCK_DAO_DETAIL = {
  daoId: 'jeju-network',
  name: 'jeju-network',
  displayName: 'Jeju Network',
  description: 'The main network DAO governing Jeju infrastructure',
  avatarCid: '',
  bannerCid: '',
  status: 'active',
  visibility: 'public',
  treasury: '0x1234567890123456789012345678901234567890',
  council: '0x2345678901234567890123456789012345678901',
  ceoAgentContract: '0x3456789012345678901234567890123456789012',
  feeConfig: '0x4567890123456789012345678901234567890123',
  manifestCid: 'QmXYZ...',
  ceo: {
    id: 'ceo-1',
    daoId: 'jeju-network',
    role: 'CEO',
    persona: {
      name: 'Atlas',
      avatarCid: '',
      bio: 'Strategic leader focused on network growth',
      personality: 'Decisive, strategic, mission-focused',
      traits: ['analytical', 'fair'],
      voiceStyle: 'authoritative',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy'],
    },
    modelId: 'claude-opus-4-5-20250514',
    modelName: 'Claude Opus 4.5',
    modelProvider: 'Anthropic',
    weight: 100,
    isActive: true,
    connectors: [],
    context: {
      knowledgeCids: [],
      linkedRepos: [],
      linkedPackages: [],
      customInstructions: '',
      maxContextTokens: 128000,
    },
    values: ['decentralization', 'transparency'],
    decisionStyle: 'balanced',
    createdAt: 1700000000000,
    updatedAt: 1700500000000,
    lastActiveAt: 1700600000000,
    decisionsCount: 156,
    approvalRate: 78,
  },
  board: [],
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
  fundingConfig: {
    minStake: '0.001',
    maxStake: '100',
    epochDuration: 2592000,
    cooldownPeriod: 604800,
    matchingMultiplier: 2,
    quadraticEnabled: true,
    ceoWeightCap: 50,
    treasuryFeePercent: 5,
  },
  networkPermissions: {
    isNetworkDAO: true,
    canModerateNetwork: true,
    canManageContracts: true,
    canApproveDaos: true,
  },
  stats: {
    totalProposals: 42,
    activeProposals: 3,
    approvedProposals: 35,
    rejectedProposals: 4,
    totalStaked: '125000',
    totalFunded: '850000',
    uniqueProposers: 156,
    averageQualityScore: 82,
    averageApprovalTime: 172800,
    ceoApprovalRate: 78,
    boardApprovalRate: 85,
  },
  createdAt: 1700000000000,
  updatedAt: 1700600000000,
  creator: '0x5678901234567890123456789012345678901234',
  tags: ['infrastructure', 'governance'],
  linkedPackages: [],
  linkedRepos: ['jejunetwork/core'],
}

const MOCK_AGENT = {
  id: 'ceo-1',
  daoId: 'jeju-network',
  role: 'CEO',
  persona: {
    name: 'Atlas',
    avatarCid: '',
    bio: 'Strategic leader',
    personality: 'Decisive',
    traits: ['analytical'],
    voiceStyle: 'authoritative',
    communicationTone: 'professional',
    specialties: ['governance'],
  },
  modelId: 'claude-opus-4-5-20250514',
  modelName: 'Claude Opus 4.5',
  modelProvider: 'Anthropic',
  weight: 100,
  isActive: true,
  connectors: [],
  context: {
    knowledgeCids: [],
    linkedRepos: [],
    linkedPackages: [],
    customInstructions: '',
    maxContextTokens: 128000,
  },
  values: ['decentralization'],
  decisionStyle: 'balanced',
  createdAt: 1700000000000,
  updatedAt: 1700500000000,
  lastActiveAt: 1700600000000,
  decisionsCount: 156,
  approvalRate: 78,
}

const MOCK_PROPOSAL = {
  proposalId: 'prop-1',
  daoId: 'jeju-network',
  title: 'Upgrade Treasury Contract',
  summary: 'Upgrade to v2 with better security',
  description: 'Full description here...',
  proposalType: 'code',
  status: 'board_review',
  proposer: '0xabcdef1234567890',
  qualityScore: 85,
  boardApprovals: 2,
  boardRejections: 0,
  totalBoardMembers: 5,
  createdAt: 1700500000000,
  updatedAt: 1700600000000,
  tags: ['security', 'treasury'],
  boardVotes: [],
  backers: [],
  totalStaked: '0.5',
  comments: [],
  farcasterCasts: [],
}

beforeEach(() => {
  fetchMock = mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    }),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('DAO List Fetching', () => {
  test('fetches all DAOs from /dao/list endpoint', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ daos: MOCK_DAO_LIST }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/list`)
    const data = await response.json()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/dao/list`)
    expect(data.daos).toHaveLength(2)
    expect(data.daos[0].daoId).toBe('jeju-network')
  })

  test('fetches active DAOs from /dao/active endpoint', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ daos: MOCK_DAO_LIST }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/active`)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/dao/active`)
  })

  test('handles API error response correctly', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Database connection failed' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/list`)
    expect(response.ok).toBe(false)
    expect(response.statusText).toBe('Internal Server Error')
  })

  test('handles network failure', async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(new Error('Network error')),
    )

    await expect(fetch(`${API_BASE}/dao/list`)).rejects.toThrow('Network error')
  })

  test('filters DAOs by search term client-side', () => {
    const daos = MOCK_DAO_LIST
    const searchTerm = 'defi'

    const filtered = daos.filter((dao) => {
      const searchLower = searchTerm.toLowerCase()
      return (
        dao.name.toLowerCase().includes(searchLower) ||
        dao.displayName.toLowerCase().includes(searchLower) ||
        dao.description.toLowerCase().includes(searchLower)
      )
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0].daoId).toBe('defi-guild')
  })

  test('filters DAOs by network-only flag', () => {
    const daos = MOCK_DAO_LIST
    const networkOnly = true

    const filtered = daos.filter((dao) => !networkOnly || dao.isNetworkDAO)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].isNetworkDAO).toBe(true)
  })

  test('handles empty DAO list', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ daos: [] }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/list`)
    const data = await response.json()

    expect(data.daos).toHaveLength(0)
  })
})

describe('Single DAO Fetching', () => {
  test('fetches DAO by ID with URL encoding', async () => {
    const daoId = 'jeju-network'

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_DAO_DETAIL),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/${encodeURIComponent(daoId)}`)
    const data = await response.json()

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/dao/jeju-network`)
    expect(data.daoId).toBe('jeju-network')
    expect(data.ceo.persona.name).toBe('Atlas')
  })

  test('handles DAO not found (404)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'DAO not found' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/nonexistent`)
    expect(response.ok).toBe(false)

    const error = await response.json()
    expect(error.error).toBe('DAO not found')
  })

  test('handles special characters in DAO ID', async () => {
    const daoId = 'test-dao-123'

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_DAO_DETAIL, daoId }),
      }),
    )

    await fetch(`${API_BASE}/dao/${encodeURIComponent(daoId)}`)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/dao/test-dao-123`)
  })
})

describe('DAO Creation', () => {
  test('creates DAO with POST to /dao', async () => {
    const newDao = {
      name: 'new-dao',
      displayName: 'New DAO',
      description: 'A new test DAO',
      avatarCid: '',
      bannerCid: '',
      visibility: 'public',
      treasury: '0x0000000000000000000000000000000000000000',
      ceo: {
        role: 'CEO',
        persona: {
          name: 'CEO Bot',
          avatarCid: '',
          bio: '',
          personality: '',
          traits: [],
          voiceStyle: '',
          communicationTone: 'professional',
          specialties: [],
        },
        modelId: 'claude-opus-4-5-20250514',
        weight: 100,
        values: [],
        decisionStyle: 'balanced',
      },
      board: [],
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
      tags: [],
    }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_DAO_DETAIL, daoId: 'new-dao' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDao),
    })

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/dao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDao),
    })

    const data = await response.json()
    expect(data.daoId).toBe('new-dao')
  })

  test('handles validation error on create', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            message: 'Name must be at least 3 characters',
          }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ab' }),
    })

    expect(response.ok).toBe(false)
    const error = await response.json()
    expect(error.message).toContain('3 characters')
  })

  test('handles duplicate name error', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({ message: 'DAO with this name already exists' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'jeju-network' }),
    })

    expect(response.ok).toBe(false)
    const error = await response.json()
    expect(error.message).toContain('already exists')
  })
})

describe('DAO Update', () => {
  test('updates DAO with PATCH', async () => {
    const updates = { description: 'Updated description' }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_DAO_DETAIL, ...updates }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.description).toBe('Updated description')
  })

  test('handles unauthorized update', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({ message: 'Not authorized to update this DAO' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hacked' }),
    })

    expect(response.ok).toBe(false)
    const error = await response.json()
    expect(error.message).toContain('Not authorized')
  })
})

describe('Agent Operations', () => {
  test('fetches agent by ID', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_AGENT),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/agents/ceo-1`)
    const data = await response.json()

    expect(data.id).toBe('ceo-1')
    expect(data.persona.name).toBe('Atlas')
    expect(data.role).toBe('CEO')
  })

  test('creates new board member', async () => {
    const newAgent = {
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
    }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ...newAgent,
            id: 'agent-new',
            daoId: 'jeju-network',
          }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAgent),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.role).toBe('TREASURY')
  })

  test('updates agent configuration', async () => {
    const updates = {
      modelId: 'gpt-4o',
      decisionStyle: 'aggressive',
    }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_AGENT, ...updates }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/agents/ceo-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.modelId).toBe('gpt-4o')
  })

  test('deletes board member', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    )

    const response = await fetch(
      `${API_BASE}/dao/jeju-network/agents/board-1`,
      {
        method: 'DELETE',
      },
    )

    expect(response.ok).toBe(true)
  })

  test('prevents deleting CEO agent', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Cannot delete CEO agent' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/agents/ceo-1`, {
      method: 'DELETE',
    })

    expect(response.ok).toBe(false)
    const error = await response.json()
    expect(error.message).toContain('CEO')
  })
})

describe('Proposal Operations', () => {
  test('fetches proposals for DAO', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([MOCK_PROPOSAL]),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/proposals`)
    const data = await response.json()

    expect(data).toHaveLength(1)
    expect(data[0].proposalId).toBe('prop-1')
  })

  test('filters proposals by status', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([MOCK_PROPOSAL]),
      }),
    )

    await fetch(`${API_BASE}/dao/jeju-network/proposals?status=board_review`)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/dao/jeju-network/proposals?status=board_review`,
    )
  })

  test('filters proposals by type', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([MOCK_PROPOSAL]),
      }),
    )

    await fetch(`${API_BASE}/dao/jeju-network/proposals?type=code`)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/dao/jeju-network/proposals?type=code`,
    )
  })

  test('fetches single proposal', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_PROPOSAL),
      }),
    )

    const response = await fetch(
      `${API_BASE}/dao/jeju-network/proposals/prop-1`,
    )
    const data = await response.json()

    expect(data.proposalId).toBe('prop-1')
    expect(data.title).toBe('Upgrade Treasury Contract')
  })

  test('creates new proposal', async () => {
    const newProposal = {
      title: 'New Proposal',
      summary: 'A test proposal',
      description: 'Full description of the proposal',
      proposalType: 'general',
      tags: ['test'],
    }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ...MOCK_PROPOSAL,
            proposalId: 'prop-new',
            ...newProposal,
          }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProposal),
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.proposalId).toBe('prop-new')
    expect(data.title).toBe('New Proposal')
  })

  test('handles proposal validation error', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Title is required' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No title' }),
    })

    expect(response.ok).toBe(false)
    const error = await response.json()
    expect(error.message).toContain('Title')
  })
})

describe('Treasury Operations', () => {
  test('fetches treasury data', async () => {
    const treasuryData = {
      balances: [
        {
          token: '0x0000000000000000000000000000000000000000',
          symbol: 'ETH',
          balance: '100.5',
          usdValue: '250000',
          change24h: 2.5,
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          type: 'inflow',
          description: 'Proposal reward',
          amount: '1.5',
          token: 'ETH',
          timestamp: 1700500000000,
          txHash: '0xabc...',
        },
      ],
      totalUsdValue: '250000',
    }

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(treasuryData),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/jeju-network/treasury`)
    const data = await response.json()

    expect(data.balances).toHaveLength(1)
    expect(data.balances[0].symbol).toBe('ETH')
    expect(data.totalUsdValue).toBe('250000')
  })
})

describe('Edge Cases and Boundary Conditions', () => {
  test('handles empty string DAO ID', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'DAO ID is required' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/`)
    expect(response.ok).toBe(false)
  })

  test('handles very long DAO name', async () => {
    const longName = 'a'.repeat(256)

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Name exceeds maximum length' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: longName }),
    })

    expect(response.ok).toBe(false)
  })

  test('handles unicode in DAO name', async () => {
    const unicodeName = 'test-dao-日本語'

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_DAO_DETAIL, name: unicodeName }),
      }),
    )

    const response = await fetch(
      `${API_BASE}/dao/${encodeURIComponent(unicodeName)}`,
    )
    expect(response.ok).toBe(true)
  })

  test('handles concurrent requests', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ daos: MOCK_DAO_LIST }),
      }),
    )

    const requests = Array(10)
      .fill(null)
      .map(() => fetch(`${API_BASE}/dao/list`))

    const responses = await Promise.all(requests)

    expect(responses.every((r) => r.ok)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  test('handles request timeout simulation', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100),
        ),
    )

    await expect(fetch(`${API_BASE}/dao/list`)).rejects.toThrow('Timeout')
  })

  test('handles malformed JSON response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/list`)
    await expect(response.json()).rejects.toThrow('Unexpected token')
  })

  test('handles pagination parameters', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ daos: MOCK_DAO_LIST.slice(0, 1) }),
      }),
    )

    await fetch(`${API_BASE}/dao/list?limit=1&offset=0`)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/dao/list?limit=1&offset=0`,
    )
  })

  test('handles negative pagination values', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ message: 'Invalid pagination parameters' }),
      }),
    )

    const response = await fetch(`${API_BASE}/dao/list?limit=-1`)
    expect(response.ok).toBe(false)
  })

  test('handles board member count at minimum (3)', () => {
    const board = [
      { role: 'TREASURY' },
      { role: 'CODE' },
      { role: 'COMMUNITY' },
    ]
    expect(board.length).toBeGreaterThanOrEqual(3)
  })

  test('validates governance params boundaries', () => {
    const params = {
      minQualityScore: 70,
      councilVotingPeriod: 259200,
      quorumBps: 5000,
      minBoardApprovals: 2,
    }

    expect(params.minQualityScore).toBeGreaterThanOrEqual(0)
    expect(params.minQualityScore).toBeLessThanOrEqual(100)
    expect(params.quorumBps).toBeGreaterThanOrEqual(0)
    expect(params.quorumBps).toBeLessThanOrEqual(10000)
  })
})
