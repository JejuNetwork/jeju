/**
 * DAO Manifest Schema Tests
 *
 * Comprehensive tests for DAO manifest validation including:
 * - Valid manifest validation
 * - Boundary conditions (min/max values)
 * - Edge cases (empty arrays, special characters)
 * - Error handling for invalid inputs
 */

import { describe, expect, test } from 'bun:test'
import {
  DAOCouncilMemberSchema,
  DAODirectorConfigSchema,
  DAOFundingConfigSchema,
  DAOGovernanceParamsSchema,
  DAOManifestSchema,
  DAOSeededPackageSchema,
  DAOSeededRepoSchema,
  validateCouncilWeights,
  validateDAOManifest,
} from './dao-manifest'

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_Director = {
  name: 'Test Director',
  description: 'A test Director for the DAO',
  personality: 'Professional and decisive',
  traits: ['wise', 'fair'],
  voiceStyle: 'Formal',
  communicationTone: 'professional',
  specialties: ['governance'],
  pfpCid: 'QmTestCid',
}

const VALID_COUNCIL_MEMBER = {
  role: 'Treasury Guardian',
  description: 'Manages treasury',
  weight: 2500,
}

const VALID_GOVERNANCE_PARAMS = {
  minQualityScore: 60,
  councilVotingPeriod: 172800,
  gracePeriod: 86400,
  minProposalStake: '10000000000000000',
  quorumBps: 5000,
}

const VALID_FUNDING = {
  minStake: '1000000000000000',
  maxStake: '100000000000000000000',
  epochDuration: 2592000,
  cooldownPeriod: 604800,
  matchingMultiplier: 15000,
  quadraticEnabled: true,
  directorWeightCap: 5000,
}

const VALID_PACKAGE = {
  name: '@test/package',
  description: 'Test package',
  registry: 'npm' as const,
  fundingWeight: 1000,
}

const VALID_REPO = {
  name: 'test-repo',
  url: 'https://github.com/test/repo',
  description: 'Test repository',
  fundingWeight: 5000,
}

function createValidManifest() {
  return {
    name: 'test-dao',
    displayName: 'Test DAO',
    version: '1.0.0',
    description: 'A test DAO',
    type: 'dao' as const,
    governance: {
      director: VALID_Director,
      council: {
        members: [
          { ...VALID_COUNCIL_MEMBER, role: 'Treasury', weight: 2500 },
          { ...VALID_COUNCIL_MEMBER, role: 'Code', weight: 2500 },
          { ...VALID_COUNCIL_MEMBER, role: 'Community', weight: 2500 },
          { ...VALID_COUNCIL_MEMBER, role: 'Security', weight: 2500 },
        ],
      },
      parameters: VALID_GOVERNANCE_PARAMS,
    },
    funding: VALID_FUNDING,
  }
}

// ============================================================================
// Director Config Schema Tests
// ============================================================================

describe('DAODirectorConfigSchema', () => {
  test('validates minimal Director config', () => {
    const minimalDirector = {
      name: 'Director',
      description: 'Desc',
      personality: 'Pro',
      traits: ['wise'],
    }
    const result = DAODirectorConfigSchema.parse(minimalDirector)
    expect(result.name).toBe('Director')
    expect(result.voiceStyle).toBeUndefined()
  })

  test('validates full Director config', () => {
    const result = DAODirectorConfigSchema.parse(VALID_Director)
    expect(result.name).toBe('Test Director')
    expect(result.traits).toHaveLength(2)
    expect(result.specialties).toHaveLength(1)
  })

  test('rejects empty name', () => {
    expect(() =>
      DAODirectorConfigSchema.parse({ ...VALID_Director, name: '' }),
    ).toThrow()
  })

  test('rejects empty traits array', () => {
    expect(() =>
      DAODirectorConfigSchema.parse({ ...VALID_Director, traits: [] }),
    ).toThrow()
  })

  test('handles unicode in name and description', () => {
    const unicodeDirector = {
      ...VALID_Director,
      name: '孙悟空 🐵',
      description: 'القرد الملك',
    }
    const result = DAODirectorConfigSchema.parse(unicodeDirector)
    expect(result.name).toBe('孙悟空 🐵')
  })

  test('handles very long description', () => {
    const longDirector = {
      ...VALID_Director,
      description: 'x'.repeat(10000),
    }
    const result = DAODirectorConfigSchema.parse(longDirector)
    expect(result.description.length).toBe(10000)
  })
})

// ============================================================================
// Council Member Schema Tests
// ============================================================================

describe('DAOCouncilMemberSchema', () => {
  test('validates council member with minimum weight', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: 1 }
    const result = DAOCouncilMemberSchema.parse(member)
    expect(result.weight).toBe(1)
  })

  test('validates council member with maximum weight', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: 10000 }
    const result = DAOCouncilMemberSchema.parse(member)
    expect(result.weight).toBe(10000)
  })

  test('rejects weight below minimum (0)', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: 0 }
    expect(() => DAOCouncilMemberSchema.parse(member)).toThrow()
  })

  test('rejects weight above maximum (10001)', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: 10001 }
    expect(() => DAOCouncilMemberSchema.parse(member)).toThrow()
  })

  test('rejects negative weight', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: -100 }
    expect(() => DAOCouncilMemberSchema.parse(member)).toThrow()
  })

  test('rejects non-integer weight', () => {
    const member = { ...VALID_COUNCIL_MEMBER, weight: 2500.5 }
    expect(() => DAOCouncilMemberSchema.parse(member)).toThrow()
  })

  test('accepts optional address field', () => {
    const member = {
      ...VALID_COUNCIL_MEMBER,
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    }
    const result = DAOCouncilMemberSchema.parse(member)
    expect(result.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  test('rejects invalid address format', () => {
    const member = { ...VALID_COUNCIL_MEMBER, address: 'not-an-address' }
    expect(() => DAOCouncilMemberSchema.parse(member)).toThrow()
  })

  test('accepts optional agentId', () => {
    const member = { ...VALID_COUNCIL_MEMBER, agentId: 42 }
    const result = DAOCouncilMemberSchema.parse(member)
    expect(result.agentId).toBe(42)
  })
})

// ============================================================================
// Governance Parameters Schema Tests
// ============================================================================

describe('DAOGovernanceParamsSchema', () => {
  test('validates governance params at boundaries', () => {
    const params = {
      minQualityScore: 0,
      councilVotingPeriod: 1,
      gracePeriod: 0,
      minProposalStake: '0',
      quorumBps: 0,
    }
    const result = DAOGovernanceParamsSchema.parse(params)
    expect(result.minQualityScore).toBe(0)
  })

  test('validates max quality score', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, minQualityScore: 100 }
    const result = DAOGovernanceParamsSchema.parse(params)
    expect(result.minQualityScore).toBe(100)
  })

  test('rejects quality score above 100', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, minQualityScore: 101 }
    expect(() => DAOGovernanceParamsSchema.parse(params)).toThrow()
  })

  test('rejects negative quality score', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, minQualityScore: -1 }
    expect(() => DAOGovernanceParamsSchema.parse(params)).toThrow()
  })

  test('rejects zero voting period', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, councilVotingPeriod: 0 }
    expect(() => DAOGovernanceParamsSchema.parse(params)).toThrow()
  })

  test('validates max quorum bps (10000)', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, quorumBps: 10000 }
    const result = DAOGovernanceParamsSchema.parse(params)
    expect(result.quorumBps).toBe(10000)
  })

  test('rejects quorum above 10000', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, quorumBps: 10001 }
    expect(() => DAOGovernanceParamsSchema.parse(params)).toThrow()
  })

  test('validates large minProposalStake (wei string)', () => {
    const params = {
      ...VALID_GOVERNANCE_PARAMS,
      minProposalStake: '999999999999999999999999999',
    }
    const result = DAOGovernanceParamsSchema.parse(params)
    expect(result.minProposalStake).toBe('999999999999999999999999999')
  })

  test('rejects non-numeric minProposalStake', () => {
    const params = { ...VALID_GOVERNANCE_PARAMS, minProposalStake: '10eth' }
    expect(() => DAOGovernanceParamsSchema.parse(params)).toThrow()
  })
})

// ============================================================================
// Funding Config Schema Tests
// ============================================================================

describe('DAOFundingConfigSchema', () => {
  test('validates funding config', () => {
    const result = DAOFundingConfigSchema.parse(VALID_FUNDING)
    expect(result.quadraticEnabled).toBe(true)
    expect(result.matchingMultiplier).toBe(15000)
  })

  test('validates zero matching multiplier', () => {
    const funding = { ...VALID_FUNDING, matchingMultiplier: 0 }
    const result = DAOFundingConfigSchema.parse(funding)
    expect(result.matchingMultiplier).toBe(0)
  })

  test('validates max matching multiplier', () => {
    const funding = { ...VALID_FUNDING, matchingMultiplier: 100000 }
    const result = DAOFundingConfigSchema.parse(funding)
    expect(result.matchingMultiplier).toBe(100000)
  })

  test('rejects matching multiplier above max', () => {
    const funding = { ...VALID_FUNDING, matchingMultiplier: 100001 }
    expect(() => DAOFundingConfigSchema.parse(funding)).toThrow()
  })

  test('validates directorWeightCap at 0 (no cap)', () => {
    const funding = { ...VALID_FUNDING, directorWeightCap: 0 }
    const result = DAOFundingConfigSchema.parse(funding)
    expect(result.directorWeightCap).toBe(0)
  })

  test('validates directorWeightCap at 10000 (100%)', () => {
    const funding = { ...VALID_FUNDING, directorWeightCap: 10000 }
    const result = DAOFundingConfigSchema.parse(funding)
    expect(result.directorWeightCap).toBe(10000)
  })

  test('rejects zero epoch duration', () => {
    const funding = { ...VALID_FUNDING, epochDuration: 0 }
    expect(() => DAOFundingConfigSchema.parse(funding)).toThrow()
  })
})

// ============================================================================
// Seeded Package Schema Tests
// ============================================================================

describe('DAOSeededPackageSchema', () => {
  test('validates all registry types', () => {
    const registries = ['npm', 'foundry', 'cargo', 'pypi'] as const
    for (const registry of registries) {
      const pkg = { ...VALID_PACKAGE, registry }
      const result = DAOSeededPackageSchema.parse(pkg)
      expect(result.registry).toBe(registry)
    }
  })

  test('rejects invalid registry type', () => {
    const pkg = { ...VALID_PACKAGE, registry: 'maven' }
    expect(() => DAOSeededPackageSchema.parse(pkg)).toThrow()
  })

  test('validates funding weight at 0', () => {
    const pkg = { ...VALID_PACKAGE, fundingWeight: 0 }
    const result = DAOSeededPackageSchema.parse(pkg)
    expect(result.fundingWeight).toBe(0)
  })

  test('validates funding weight at max (10000)', () => {
    const pkg = { ...VALID_PACKAGE, fundingWeight: 10000 }
    const result = DAOSeededPackageSchema.parse(pkg)
    expect(result.fundingWeight).toBe(10000)
  })

  test('rejects funding weight above max', () => {
    const pkg = { ...VALID_PACKAGE, fundingWeight: 10001 }
    expect(() => DAOSeededPackageSchema.parse(pkg)).toThrow()
  })

  test('rejects empty package name', () => {
    const pkg = { ...VALID_PACKAGE, name: '' }
    expect(() => DAOSeededPackageSchema.parse(pkg)).toThrow()
  })
})

// ============================================================================
// Seeded Repo Schema Tests
// ============================================================================

describe('DAOSeededRepoSchema', () => {
  test('validates repo with valid URL', () => {
    const result = DAOSeededRepoSchema.parse(VALID_REPO)
    expect(result.url).toBe('https://github.com/test/repo')
  })

  test('validates various URL formats', () => {
    const urls = [
      'https://github.com/org/repo',
      'https://gitlab.com/org/repo',
      'http://localhost:3000/repo',
      'https://bitbucket.org/org/repo.git',
    ]
    for (const url of urls) {
      const repo = { ...VALID_REPO, url }
      const result = DAOSeededRepoSchema.parse(repo)
      expect(result.url).toBe(url)
    }
  })

  test('rejects invalid URL format', () => {
    const repo = { ...VALID_REPO, url: 'not-a-url' }
    expect(() => DAOSeededRepoSchema.parse(repo)).toThrow()
  })

  test('rejects empty repo name', () => {
    const repo = { ...VALID_REPO, name: '' }
    expect(() => DAOSeededRepoSchema.parse(repo)).toThrow()
  })
})

// ============================================================================
// Full Manifest Schema Tests
// ============================================================================

describe('DAOManifestSchema', () => {
  test('validates complete manifest', () => {
    const manifest = createValidManifest()
    const result = DAOManifestSchema.parse(manifest)
    expect(result.name).toBe('test-dao')
    expect(result.governance.director.name).toBe('Test Director')
  })

  test('validates minimal manifest without optional fields', () => {
    const manifest = {
      name: 'minimal-dao',
      governance: {
        director: {
          name: 'Director',
          description: 'Desc',
          personality: 'Pro',
          traits: ['wise'],
        },
        council: {
          members: [{ role: 'Guardian', description: 'Desc', weight: 10000 }],
        },
        parameters: VALID_GOVERNANCE_PARAMS,
      },
      funding: VALID_FUNDING,
    }
    const result = DAOManifestSchema.parse(manifest)
    expect(result.displayName).toBeUndefined()
    expect(result.packages).toBeUndefined()
  })

  test('validates manifest with packages and repos', () => {
    const manifest = {
      ...createValidManifest(),
      packages: { seeded: [VALID_PACKAGE] },
      repos: { seeded: [VALID_REPO] },
    }
    const result = DAOManifestSchema.parse(manifest)
    expect(result.packages?.seeded).toHaveLength(1)
    expect(result.repos?.seeded).toHaveLength(1)
  })

  test('validates manifest with deployment config', () => {
    const manifest = {
      ...createValidManifest(),
      deployment: {
        localnet: { autoSeed: true, fundTreasury: '1000000000000000000' },
        testnet: { autoSeed: false },
        mainnet: { autoSeed: false, requiresMultisig: true },
      },
    }
    const result = DAOManifestSchema.parse(manifest)
    expect(result.deployment?.localnet?.autoSeed).toBe(true)
    expect(result.deployment?.mainnet?.requiresMultisig).toBe(true)
  })

  test('validates manifest with fee config', () => {
    const manifest = {
      ...createValidManifest(),
      fees: {
        type: 'game' as const,
        controller: 'test-dao',
        categories: {
          trading: { description: 'Trading fee', defaultBps: 250 },
        },
      },
    }
    const result = DAOManifestSchema.parse(manifest)
    expect(result.fees?.type).toBe('game')
    expect(result.fees?.categories.trading.defaultBps).toBe(250)
  })

  test('rejects manifest without name', () => {
    const manifest = { ...createValidManifest() }
    delete (manifest as Record<string, unknown>).name
    expect(() => DAOManifestSchema.parse(manifest)).toThrow()
  })

  test('rejects manifest with empty council', () => {
    const manifest = createValidManifest()
    manifest.governance.council.members = []
    expect(() => DAOManifestSchema.parse(manifest)).toThrow()
  })
})

// ============================================================================
// validateDAOManifest Function Tests
// ============================================================================

describe('validateDAOManifest', () => {
  test('returns validated manifest on success', () => {
    const manifest = createValidManifest()
    const result = validateDAOManifest(manifest)
    expect(result.name).toBe('test-dao')
  })

  test('throws ZodError on invalid input', () => {
    expect(() => validateDAOManifest({})).toThrow()
  })

  test('throws on null input', () => {
    expect(() => validateDAOManifest(null)).toThrow()
  })

  test('throws on undefined input', () => {
    expect(() => validateDAOManifest(undefined)).toThrow()
  })

  test('throws descriptive error for missing fields', () => {
    try {
      validateDAOManifest({ name: 'test' })
      expect(true).toBe(false) // Should not reach
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('governance')
    }
  })
})

// ============================================================================
// validateCouncilWeights Function Tests
// ============================================================================

describe('validateCouncilWeights', () => {
  test('validates weights summing to 10000', () => {
    const members = [
      { weight: 2500 },
      { weight: 2500 },
      { weight: 2500 },
      { weight: 2500 },
    ]
    const result = validateCouncilWeights(members)
    expect(result.valid).toBe(true)
    expect(result.total).toBe(10000)
  })

  test('validates single member with full weight', () => {
    const members = [{ weight: 10000 }]
    const result = validateCouncilWeights(members)
    expect(result.valid).toBe(true)
  })

  test('detects weights under 10000', () => {
    const members = [{ weight: 5000 }, { weight: 4000 }]
    const result = validateCouncilWeights(members)
    expect(result.valid).toBe(false)
    expect(result.total).toBe(9000)
    expect(result.message).toContain('9000')
    expect(result.message).toContain('expected 10000')
  })

  test('detects weights over 10000', () => {
    const members = [{ weight: 6000 }, { weight: 6000 }]
    const result = validateCouncilWeights(members)
    expect(result.valid).toBe(false)
    expect(result.total).toBe(12000)
  })

  test('validates custom expected total', () => {
    const members = [{ weight: 500 }, { weight: 500 }]
    const result = validateCouncilWeights(members, 1000)
    expect(result.valid).toBe(true)
    expect(result.total).toBe(1000)
  })

  test('handles empty members array', () => {
    const result = validateCouncilWeights([])
    expect(result.valid).toBe(false)
    expect(result.total).toBe(0)
  })

  test('handles many small weights', () => {
    const members = Array(100).fill({ weight: 100 })
    const result = validateCouncilWeights(members)
    expect(result.valid).toBe(true)
    expect(result.total).toBe(10000)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  test('handles whitespace-only name', () => {
    const manifest = createValidManifest()
    manifest.name = '   '
    // Should fail validation - whitespace is not a valid name
    const result = DAOManifestSchema.safeParse(manifest)
    // Note: Zod string() doesn't reject whitespace by default
    // This test documents current behavior
    expect(result.success).toBe(true)
  })

  test('handles special characters in names', () => {
    const manifest = createValidManifest()
    manifest.name = 'dao-with-special-chars_123'
    const result = validateDAOManifest(manifest)
    expect(result.name).toBe('dao-with-special-chars_123')
  })

  test('handles very large wei amounts', () => {
    const manifest = createValidManifest()
    manifest.funding.maxStake = '999999999999999999999999999999'
    const result = validateDAOManifest(manifest)
    expect(result.funding.maxStake).toBe('999999999999999999999999999999')
  })

  test('handles JSON with extra fields', () => {
    const manifest = {
      ...createValidManifest(),
      unknownField: 'should be ignored',
      nested: { also: 'ignored' },
    }
    const result = validateDAOManifest(manifest)
    expect(result.name).toBe('test-dao')
  })

  test('handles array types correctly', () => {
    const manifest = createValidManifest()
    // Try to pass non-array as members
    const invalidManifest = {
      ...manifest,
      governance: {
        ...manifest.governance,
        council: { members: 'not an array' },
      },
    }
    expect(() => validateDAOManifest(invalidManifest)).toThrow()
  })
})
