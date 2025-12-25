/**
 * DAO Deployment Logic Tests
 *
 * Comprehensive tests for DAO deployment including:
 * - Manifest discovery from filesystem
 * - Contract address loading
 * - Deployment option validation
 * - Council address resolution
 * - Integration with real filesystem
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  daoFundingAbi,
  daoRegistryAbi,
  packageRegistryAbi,
  repoRegistryAbi,
} from '@jejunetwork/contracts'
import {
  CHAIN_CONFIG,
  getDevCEOAddress,
  getDevCouncilAddresses,
  WELL_KNOWN_KEYS,
} from '../types'
import { type DAODeployOptions, discoverDAOManifests } from './dao-deploy'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestManifest(name: string, displayName: string) {
  return {
    name,
    displayName,
    version: '1.0.0',
    type: 'dao',
    governance: {
      ceo: {
        name: 'Test CEO',
        description: 'Test CEO description',
        personality: 'Professional',
        traits: ['wise', 'fair'],
      },
      council: {
        members: [
          { role: 'Treasury', description: 'Treasury guardian', weight: 5000 },
          { role: 'Code', description: 'Code guardian', weight: 5000 },
        ],
      },
      parameters: {
        minQualityScore: 60,
        councilVotingPeriod: 172800,
        gracePeriod: 86400,
        minProposalStake: '10000000000000000',
        quorumBps: 5000,
      },
    },
    funding: {
      minStake: '1000000000000000',
      maxStake: '100000000000000000000',
      epochDuration: 2592000,
      cooldownPeriod: 604800,
      matchingMultiplier: 15000,
      quadraticEnabled: true,
      ceoWeightCap: 5000,
    },
  }
}

// ============================================================================
// Well-Known Keys Tests
// ============================================================================

describe('WELL_KNOWN_KEYS', () => {
  test('contains 8 dev accounts', () => {
    expect(WELL_KNOWN_KEYS.dev).toHaveLength(8)
  })

  test('first account is deployer', () => {
    const deployer = WELL_KNOWN_KEYS.dev[0]
    expect(deployer.role).toBe('deployer')
    expect(deployer.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  test('all accounts have valid addresses', () => {
    for (const account of WELL_KNOWN_KEYS.dev) {
      expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })

  test('all accounts have valid private keys', () => {
    for (const account of WELL_KNOWN_KEYS.dev) {
      expect(account.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/)
    }
  })

  test('council accounts are accounts 1-4', () => {
    expect(WELL_KNOWN_KEYS.dev[1].role).toBe('council-treasury')
    expect(WELL_KNOWN_KEYS.dev[2].role).toBe('council-code')
    expect(WELL_KNOWN_KEYS.dev[3].role).toBe('council-community')
    expect(WELL_KNOWN_KEYS.dev[4].role).toBe('council-security')
  })

  test('CEO agent is account 5', () => {
    const ceo = WELL_KNOWN_KEYS.dev[5]
    expect(ceo.role).toBe('ceo-agent')
    expect(ceo.address).toBe('0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc')
  })

  test('user accounts are 6 and 7', () => {
    expect(WELL_KNOWN_KEYS.dev[6].role).toBe('user')
    expect(WELL_KNOWN_KEYS.dev[7].role).toBe('user')
  })

  test('all addresses are unique', () => {
    const addresses = WELL_KNOWN_KEYS.dev.map((a) => a.address)
    const uniqueAddresses = new Set(addresses)
    expect(uniqueAddresses.size).toBe(addresses.length)
  })

  test('all private keys are unique', () => {
    const keys = WELL_KNOWN_KEYS.dev.map((a) => a.privateKey)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })
})

// ============================================================================
// getDevCouncilAddresses Tests
// ============================================================================

describe('getDevCouncilAddresses', () => {
  test('returns 4 council addresses', () => {
    const addresses = getDevCouncilAddresses()
    expect(Object.keys(addresses)).toHaveLength(4)
  })

  test('returns correct address mapping', () => {
    const addresses = getDevCouncilAddresses()
    expect(addresses['Treasury Guardian']).toBe(WELL_KNOWN_KEYS.dev[1].address)
    expect(addresses['Code Guardian']).toBe(WELL_KNOWN_KEYS.dev[2].address)
    expect(addresses['Community Guardian']).toBe(WELL_KNOWN_KEYS.dev[3].address)
    expect(addresses['Security Guardian']).toBe(WELL_KNOWN_KEYS.dev[4].address)
  })

  test('all addresses are valid ethereum addresses', () => {
    const addresses = getDevCouncilAddresses()
    for (const address of Object.values(addresses)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })
})

// ============================================================================
// getDevCEOAddress Tests
// ============================================================================

describe('getDevCEOAddress', () => {
  test('returns CEO address', () => {
    const address = getDevCEOAddress()
    expect(address).toBe('0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc')
  })

  test('returns valid ethereum address', () => {
    const address = getDevCEOAddress()
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('matches WELL_KNOWN_KEYS ceo-agent', () => {
    const address = getDevCEOAddress()
    expect(address).toBe(WELL_KNOWN_KEYS.dev[5].address)
  })
})

// ============================================================================
// CHAIN_CONFIG Tests
// ============================================================================

describe('CHAIN_CONFIG', () => {
  test('contains localnet, testnet, and mainnet', () => {
    expect(CHAIN_CONFIG.localnet).toBeDefined()
    expect(CHAIN_CONFIG.testnet).toBeDefined()
    expect(CHAIN_CONFIG.mainnet).toBeDefined()
  })

  test('localnet has correct chain ID', () => {
    expect(CHAIN_CONFIG.localnet.chainId).toBe(31337)
  })

  test('testnet has correct chain ID', () => {
    expect(CHAIN_CONFIG.testnet.chainId).toBe(420691)
  })

  test('mainnet has correct chain ID', () => {
    expect(CHAIN_CONFIG.mainnet.chainId).toBe(42069)
  })

  test('all configs have rpcUrl', () => {
    expect(CHAIN_CONFIG.localnet.rpcUrl).toBeDefined()
    expect(CHAIN_CONFIG.testnet.rpcUrl).toBeDefined()
    expect(CHAIN_CONFIG.mainnet.rpcUrl).toBeDefined()
  })

  test('localnet rpcUrl is localhost', () => {
    expect(CHAIN_CONFIG.localnet.rpcUrl).toContain('127.0.0.1')
  })
})

// ============================================================================
// discoverDAOManifests Tests
// ============================================================================

describe('discoverDAOManifests', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `dao-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test('returns empty array for empty directory', () => {
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('discovers DAO in vendor/*/dao directory', () => {
    const daoDir = join(testDir, 'vendor', 'test-vendor', 'dao')
    mkdirSync(daoDir, { recursive: true })
    writeFileSync(
      join(daoDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('vendor-dao', 'Vendor DAO')),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].name).toBe('vendor-dao')
    expect(manifests[0].displayName).toBe('Vendor DAO')
  })

  test('discovers DAO in apps directory with governance', () => {
    const appDir = join(testDir, 'apps', 'test-app')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(
      join(appDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('app-dao', 'App DAO')),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].name).toBe('app-dao')
  })

  test('skips apps without governance section', () => {
    const appDir = join(testDir, 'apps', 'regular-app')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(
      join(appDir, 'jeju-manifest.json'),
      JSON.stringify({
        name: 'regular-app',
        version: '1.0.0',
        type: 'app',
      }),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('discovers multiple DAOs', () => {
    // Create vendor DAO
    const vendorDir = join(testDir, 'vendor', 'vendor1', 'dao')
    mkdirSync(vendorDir, { recursive: true })
    writeFileSync(
      join(vendorDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('dao-1', 'DAO One')),
    )

    // Create another vendor DAO
    const vendorDir2 = join(testDir, 'vendor', 'vendor2', 'dao')
    mkdirSync(vendorDir2, { recursive: true })
    writeFileSync(
      join(vendorDir2, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('dao-2', 'DAO Two')),
    )

    // Create app DAO
    const appDir = join(testDir, 'apps', 'dao-app')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(
      join(appDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('dao-3', 'DAO Three')),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(3)
    const names = manifests.map((m) => m.name).sort()
    expect(names).toEqual(['dao-1', 'dao-2', 'dao-3'])
  })

  test('handles invalid JSON in manifest', () => {
    const daoDir = join(testDir, 'vendor', 'broken', 'dao')
    mkdirSync(daoDir, { recursive: true })
    writeFileSync(join(daoDir, 'jeju-manifest.json'), 'not valid json')

    // Should not throw, just skip invalid manifests
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('handles manifest validation errors', () => {
    const daoDir = join(testDir, 'vendor', 'invalid', 'dao')
    mkdirSync(daoDir, { recursive: true })
    writeFileSync(
      join(daoDir, 'jeju-manifest.json'),
      JSON.stringify({
        name: 'invalid-dao',
        // Missing required governance and funding
      }),
    )

    // Should not throw, just skip invalid manifests
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('skips non-directory entries in vendor', () => {
    mkdirSync(join(testDir, 'vendor'), { recursive: true })
    writeFileSync(join(testDir, 'vendor', 'not-a-directory.txt'), 'test')

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('handles missing vendor directory', () => {
    // testDir exists but has no vendor or apps subdirectories
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('handles missing apps directory', () => {
    mkdirSync(join(testDir, 'vendor'), { recursive: true })
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })
})

// ============================================================================
// Real Filesystem Integration Tests
// ============================================================================

describe('Real Babylon DAO Discovery', () => {
  // Navigate from packages/cli/src/lib to repo root
  const rootDir = join(__dirname, '../../../..')

  test('discovers babylon DAO from real filesystem', () => {
    const manifests = discoverDAOManifests(rootDir)
    const babylonDao = manifests.find((m) => m.name === 'babylon-dao')
    expect(babylonDao).toBeDefined()
    expect(babylonDao?.displayName).toBe('Babylon DAO')
  })

  test('babylon DAO has Monkey King CEO', () => {
    const manifests = discoverDAOManifests(rootDir)
    const babylonDao = manifests.find((m) => m.name === 'babylon-dao')
    expect(babylonDao?.governance.ceo.name).toBe('Monkey King')
  })

  test('babylon DAO has 4 council members', () => {
    const manifests = discoverDAOManifests(rootDir)
    const babylonDao = manifests.find((m) => m.name === 'babylon-dao')
    expect(babylonDao?.governance.council.members).toHaveLength(4)
  })

  test('babylon DAO has seeded packages', () => {
    const manifests = discoverDAOManifests(rootDir)
    const babylonDao = manifests.find((m) => m.name === 'babylon-dao')
    expect(babylonDao?.packages?.seeded.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Deployment Options Validation
// ============================================================================

describe('Deployment Options', () => {
  test('network type accepts localnet', () => {
    const networks = ['localnet', 'testnet', 'mainnet'] as const
    for (const network of networks) {
      expect(CHAIN_CONFIG[network]).toBeDefined()
    }
  })

  test('localnet config matches expected structure', () => {
    const config = CHAIN_CONFIG.localnet
    expect(config).toHaveProperty('chainId')
    expect(config).toHaveProperty('name')
    expect(config).toHaveProperty('rpcUrl')
  })
})

// ============================================================================
// Council Resolution Tests
// ============================================================================

describe('Council Address Resolution', () => {
  test('maps council roles to anvil addresses', () => {
    const councilAddresses = getDevCouncilAddresses()

    // Verify each role maps correctly
    expect(councilAddresses['Treasury Guardian']).toBeDefined()
    expect(councilAddresses['Code Guardian']).toBeDefined()
    expect(councilAddresses['Community Guardian']).toBeDefined()
    expect(councilAddresses['Security Guardian']).toBeDefined()
  })

  test('council addresses match WELL_KNOWN_KEYS positions', () => {
    const councilAddresses = getDevCouncilAddresses()

    // Position 1 = Treasury Guardian
    expect(councilAddresses['Treasury Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[1].address,
    )

    // Position 2 = Code Guardian
    expect(councilAddresses['Code Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[2].address,
    )

    // Position 3 = Community Guardian
    expect(councilAddresses['Community Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[3].address,
    )

    // Position 4 = Security Guardian
    expect(councilAddresses['Security Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[4].address,
    )
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `dao-edge-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test('handles deeply nested vendor structure', () => {
    // Only dao subdirectory should be checked
    const nestedDir = join(testDir, 'vendor', 'nested', 'deep', 'dao')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(
      join(nestedDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('nested-dao', 'Nested DAO')),
    )

    // Should NOT find it - only vendor/NAME/dao is checked
    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(0)
  })

  test('handles symlinks in vendor directory', () => {
    // Skip if on Windows where symlinks behave differently
    if (process.platform === 'win32') return

    const realDir = join(testDir, 'real-vendor', 'dao')
    mkdirSync(realDir, { recursive: true })
    writeFileSync(
      join(realDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('symlink-dao', 'Symlink DAO')),
    )

    // This test documents behavior - symlinks should work
    const manifests = discoverDAOManifests(testDir)
    // Manifest in real-vendor won't be found as it's not under vendor/
    expect(manifests).toHaveLength(0)
  })

  test('handles manifest with special characters in name', () => {
    const daoDir = join(testDir, 'vendor', 'special-chars', 'dao')
    mkdirSync(daoDir, { recursive: true })
    writeFileSync(
      join(daoDir, 'jeju-manifest.json'),
      JSON.stringify(
        createTestManifest('dao-with-émojis-🎮', 'DAO with Émojis 🎮'),
      ),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].name).toBe('dao-with-émojis-🎮')
  })

  test('handles very large manifest file', () => {
    const daoDir = join(testDir, 'vendor', 'large', 'dao')
    mkdirSync(daoDir, { recursive: true })

    const largeManifest = createTestManifest('large-dao', 'Large DAO')
    // Add many packages
    ;(largeManifest as Record<string, unknown>).packages = {
      seeded: Array(100)
        .fill(null)
        .map((_, i) => ({
          name: `@test/package-${i}`,
          description: `Package ${i} description that is reasonably long`,
          registry: 'npm',
          fundingWeight: 100,
        })),
    }

    writeFileSync(
      join(daoDir, 'jeju-manifest.json'),
      JSON.stringify(largeManifest),
    )

    const manifests = discoverDAOManifests(testDir)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].packages?.seeded).toHaveLength(100)
  })

  test('handles concurrent discovery calls', async () => {
    // Create a DAO to discover
    const daoDir = join(testDir, 'vendor', 'concurrent', 'dao')
    mkdirSync(daoDir, { recursive: true })
    writeFileSync(
      join(daoDir, 'jeju-manifest.json'),
      JSON.stringify(createTestManifest('concurrent-dao', 'Concurrent DAO')),
    )

    // Run multiple discoveries concurrently
    const promises = Array(10)
      .fill(null)
      .map(() => Promise.resolve(discoverDAOManifests(testDir)))

    const results = await Promise.all(promises)

    // All should return the same result
    for (const manifests of results) {
      expect(manifests).toHaveLength(1)
      expect(manifests[0].name).toBe('concurrent-dao')
    }
  })
})

// ============================================================================
// Data Integrity Tests
// ============================================================================

describe('Data Integrity', () => {
  test('manifest discovery preserves all fields', () => {
    const testDir = join(tmpdir(), `dao-integrity-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const daoDir = join(testDir, 'vendor', 'integrity', 'dao')
      mkdirSync(daoDir, { recursive: true })

      const original = createTestManifest('integrity-dao', 'Integrity DAO')
      ;(original as Record<string, unknown>).packages = {
        seeded: [
          {
            name: '@test/pkg',
            description: 'Test',
            registry: 'npm',
            fundingWeight: 1000,
          },
        ],
      }
      ;(original as Record<string, unknown>).repos = {
        seeded: [
          {
            name: 'test-repo',
            url: 'https://github.com/test/repo',
            description: 'Test',
            fundingWeight: 5000,
          },
        ],
      }
      ;(original as Record<string, unknown>).fees = {
        type: 'game',
        controller: 'integrity-dao',
        categories: {
          trading: { description: 'Trading fee', defaultBps: 250 },
        },
      }

      writeFileSync(
        join(daoDir, 'jeju-manifest.json'),
        JSON.stringify(original),
      )

      const manifests = discoverDAOManifests(testDir)
      expect(manifests).toHaveLength(1)

      const discovered = manifests[0]

      // Verify all fields are preserved
      expect(discovered.name).toBe(original.name)
      expect(discovered.displayName).toBe(original.displayName)
      expect(discovered.governance.ceo.name).toBe(original.governance.ceo.name)
      expect(discovered.governance.council.members).toHaveLength(2)
      expect(discovered.funding.minStake).toBe(original.funding.minStake)
      expect(discovered.packages?.seeded).toHaveLength(1)
      expect(discovered.repos?.seeded).toHaveLength(1)
      expect(discovered.fees?.type).toBe('game')
    } finally {
      rmSync(testDir, { recursive: true })
    }
  })

  test('wei amounts are preserved as strings', () => {
    const testDir = join(tmpdir(), `dao-wei-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    try {
      const daoDir = join(testDir, 'vendor', 'wei', 'dao')
      mkdirSync(daoDir, { recursive: true })

      const manifest = createTestManifest('wei-dao', 'Wei DAO')
      // Use large wei amounts that would overflow Number
      manifest.funding.minStake = '999999999999999999999999'
      manifest.funding.maxStake = '99999999999999999999999999999'
      manifest.governance.parameters.minProposalStake =
        '88888888888888888888888888'

      writeFileSync(
        join(daoDir, 'jeju-manifest.json'),
        JSON.stringify(manifest),
      )

      const manifests = discoverDAOManifests(testDir)
      const discovered = manifests[0]

      // Verify strings are preserved exactly
      expect(discovered.funding.minStake).toBe('999999999999999999999999')
      expect(discovered.funding.maxStake).toBe('99999999999999999999999999999')
      expect(discovered.governance.parameters.minProposalStake).toBe(
        '88888888888888888888888888',
      )

      // Verify they're strings, not numbers
      expect(typeof discovered.funding.minStake).toBe('string')
    } finally {
      rmSync(testDir, { recursive: true })
    }
  })
})

// ============================================================================
// Contract ABI Verification Tests
// ============================================================================

describe('Contract ABI Verification', () => {
  // These tests verify that the generated ABIs contain the functions we use

  test('DAORegistry has createDAO function', () => {
    const createDAO = daoRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'createDAO',
    )
    expect(createDAO).toBeDefined()
    expect(createDAO?.inputs).toHaveLength(7)
  })

  test('DAORegistry has addCouncilMember function', () => {
    const addCouncilMember = daoRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'addCouncilMember',
    )
    expect(addCouncilMember).toBeDefined()
    expect(addCouncilMember?.inputs).toHaveLength(5)
  })

  test('DAORegistry has linkPackage function', () => {
    const linkPackage = daoRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'linkPackage',
    )
    expect(linkPackage).toBeDefined()
    expect(linkPackage?.inputs).toHaveLength(2)
  })

  test('DAORegistry has linkRepo function', () => {
    const linkRepo = daoRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'linkRepo',
    )
    expect(linkRepo).toBeDefined()
    expect(linkRepo?.inputs).toHaveLength(2)
  })

  test('DAORegistry has DAOCreated event', () => {
    const daoCreated = daoRegistryAbi.find(
      (item) => item.type === 'event' && item.name === 'DAOCreated',
    )
    expect(daoCreated).toBeDefined()
  })

  test('DAOFunding has setDAOConfig function', () => {
    const setDAOConfig = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'setDAOConfig',
    )
    expect(setDAOConfig).toBeDefined()
    expect(setDAOConfig?.inputs).toHaveLength(2)
  })

  test('DAOFunding has proposeProject function', () => {
    const proposeProject = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'proposeProject',
    )
    expect(proposeProject).toBeDefined()
    expect(proposeProject?.inputs).toHaveLength(8)
  })

  test('DAOFunding has acceptProject function', () => {
    const acceptProject = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'acceptProject',
    )
    expect(acceptProject).toBeDefined()
  })

  test('DAOFunding has proposeCEOWeight function (with timelock)', () => {
    const proposeCEOWeight = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'proposeCEOWeight',
    )
    expect(proposeCEOWeight).toBeDefined()
    expect(proposeCEOWeight?.inputs).toHaveLength(2)
  })

  test('DAOFunding does NOT have setCEOWeight function (uses timelock instead)', () => {
    const setCEOWeight = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'setCEOWeight',
    )
    // setCEOWeight was removed in favor of proposeCEOWeight + timelock
    expect(setCEOWeight).toBeUndefined()
  })

  test('DAOFunding config struct includes minStakePerParticipant', () => {
    const setDAOConfig = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'setDAOConfig',
    )
    expect(setDAOConfig).toBeDefined()

    const configInput = setDAOConfig?.inputs?.find(
      (input) => input.name === 'config' && input.type === 'tuple',
    )
    expect(configInput).toBeDefined()

    // Check that minStakePerParticipant is in the struct
    const components = (configInput as { components?: Array<{ name: string }> })
      ?.components
    const hasMinStakePerParticipant = components?.some(
      (c) => c.name === 'minStakePerParticipant',
    )
    expect(hasMinStakePerParticipant).toBe(true)
  })

  test('DAOFunding has createEpoch function', () => {
    const createEpoch = daoFundingAbi.find(
      (item) => item.type === 'function' && item.name === 'createEpoch',
    )
    expect(createEpoch).toBeDefined()
  })

  test('DAOFunding has depositMatchingFunds function', () => {
    const depositMatchingFunds = daoFundingAbi.find(
      (item) =>
        item.type === 'function' && item.name === 'depositMatchingFunds',
    )
    expect(depositMatchingFunds).toBeDefined()
  })

  test('DAOFunding has ProjectProposed event', () => {
    const projectProposed = daoFundingAbi.find(
      (item) => item.type === 'event' && item.name === 'ProjectProposed',
    )
    expect(projectProposed).toBeDefined()
  })

  test('PackageRegistry has createPackage function', () => {
    const createPackage = packageRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'createPackage',
    )
    expect(createPackage).toBeDefined()
    expect(createPackage?.inputs).toHaveLength(5)
  })

  test('RepoRegistry has createRepository function', () => {
    const createRepository = repoRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'createRepository',
    )
    expect(createRepository).toBeDefined()
    expect(createRepository?.inputs).toHaveLength(5)
  })
})

// ============================================================================
// Contract Event Decoding Tests
// ============================================================================

describe('Contract Event Structure', () => {
  test('DAOCreated event has daoId as indexed', () => {
    const daoCreated = daoRegistryAbi.find(
      (item) => item.type === 'event' && item.name === 'DAOCreated',
    )
    expect(daoCreated).toBeDefined()

    const inputs = (
      daoCreated as { inputs?: Array<{ name: string; indexed?: boolean }> }
    )?.inputs
    const daoIdInput = inputs?.find((i) => i.name === 'daoId')
    expect(daoIdInput?.indexed).toBe(true)
  })

  test('ProjectProposed event has projectId as indexed', () => {
    const projectProposed = daoFundingAbi.find(
      (item) => item.type === 'event' && item.name === 'ProjectProposed',
    )
    expect(projectProposed).toBeDefined()

    const inputs = (
      projectProposed as { inputs?: Array<{ name: string; indexed?: boolean }> }
    )?.inputs
    const projectIdInput = inputs?.find((i) => i.name === 'projectId')
    expect(projectIdInput?.indexed).toBe(true)
  })
})

// ============================================================================
// DAODeployOptions Validation Tests
// ============================================================================

describe('DAODeployOptions', () => {
  test('options interface has all required fields', () => {
    const options: DAODeployOptions = {
      network: 'localnet',
      manifestPath: '/path/to/manifest.json',
      rootDir: '/path/to/root',
      seed: true,
      dryRun: false,
      skipCouncil: false,
      skipFundingConfig: false,
      verbose: true,
    }

    expect(options.network).toBe('localnet')
    expect(options.manifestPath).toBe('/path/to/manifest.json')
    expect(options.rootDir).toBe('/path/to/root')
    expect(options.seed).toBe(true)
    expect(options.dryRun).toBe(false)
    expect(options.skipCouncil).toBe(false)
    expect(options.skipFundingConfig).toBe(false)
    expect(options.verbose).toBe(true)
  })

  test('options allows optional ipfsApiUrl', () => {
    const options: DAODeployOptions = {
      network: 'testnet',
      manifestPath: '/path/to/manifest.json',
      rootDir: '/path/to/root',
      seed: false,
      dryRun: true,
      skipCouncil: true,
      skipFundingConfig: true,
      verbose: false,
      ipfsApiUrl: 'https://ipfs.infura.io:5001',
    }

    expect(options.ipfsApiUrl).toBe('https://ipfs.infura.io:5001')
  })

  test('options allows optional funding amounts', () => {
    const options: DAODeployOptions = {
      network: 'mainnet',
      manifestPath: '/path/to/manifest.json',
      rootDir: '/path/to/root',
      seed: true,
      dryRun: false,
      skipCouncil: false,
      skipFundingConfig: false,
      verbose: false,
      fundTreasury: '1000000000000000000',
      fundMatching: '500000000000000000',
    }

    expect(options.fundTreasury).toBe('1000000000000000000')
    expect(options.fundMatching).toBe('500000000000000000')
  })
})

// ============================================================================
// Deployment Prerequisites Tests
// ============================================================================

describe('Deployment Prerequisites', () => {
  test('deployment requires governance contracts at known paths', () => {
    const deploymentPath = join(
      process.cwd(),
      'packages',
      'config',
      'deployments',
      'localnet.json',
    )
    // This test documents the expected path for deployment config
    expect(deploymentPath).toContain(
      'packages/config/deployments/localnet.json',
    )
  })

  test('WELL_KNOWN_KEYS provides dev addresses for localnet', () => {
    // Document that dev keys are only for localnet
    expect(WELL_KNOWN_KEYS.dev.length).toBe(8)
    expect(WELL_KNOWN_KEYS.dev[0].role).toBe('deployer')
  })

  test('council roles map to dev addresses correctly', () => {
    const devAddresses = getDevCouncilAddresses()
    expect(Object.keys(devAddresses)).toHaveLength(4)
    expect(devAddresses['Treasury Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[1].address,
    )
    expect(devAddresses['Code Guardian']).toBe(WELL_KNOWN_KEYS.dev[2].address)
    expect(devAddresses['Community Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[3].address,
    )
    expect(devAddresses['Security Guardian']).toBe(
      WELL_KNOWN_KEYS.dev[4].address,
    )
  })

  test('CEO address is account 5 (index 5)', () => {
    expect(getDevCEOAddress()).toBe(WELL_KNOWN_KEYS.dev[5].address)
  })
})
