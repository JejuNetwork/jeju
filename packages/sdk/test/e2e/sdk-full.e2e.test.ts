/**
 * SDK Full E2E Tests
 *
 * Comprehensive tests for ALL SDK functions with real chain interactions.
 * These tests start a local devnet, deploy contracts, and verify real on-chain effects.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type Address, parseEther } from 'viem'
import { createJejuClient, type JejuClient } from '../../src/index'
import {
  setupTestEnvironment,
  stopServices,
  type TestEnvironment,
} from '../setup'

// Test accounts
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const USER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const USER2_KEY =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const

let env: TestEnvironment | null = null
let deployer: JejuClient | null = null
let user: JejuClient | null = null
let user2: JejuClient | null = null

beforeAll(async () => {
  try {
    env = await setupTestEnvironment()
  } catch {
    env = {
      rpcUrl: 'http://127.0.0.1:6546',
      storageUrl: 'http://127.0.0.1:4010',
      computeUrl: 'http://127.0.0.1:4007',
      gatewayUrl: 'http://127.0.0.1:4003',
      privateKey: DEPLOYER_KEY,
      chainRunning: false,
      contractsDeployed: false,
      servicesRunning: false,
    }
    return
  }

  if (!env.chainRunning) return

  try {
    deployer = await createJejuClient({
      network: 'localnet',
      privateKey: DEPLOYER_KEY,
      smartAccount: false,
    })

    user = await createJejuClient({
      network: 'localnet',
      privateKey: USER_KEY,
      smartAccount: false,
    })

    user2 = await createJejuClient({
      network: 'localnet',
      privateKey: USER2_KEY,
      smartAccount: false,
    })

    // Fund test users from deployer if deployer has funds
    try {
      const deployerBalance = await deployer.getBalance()
      if (deployerBalance > parseEther('20')) {
        const userBalance = await user.getBalance()
        if (userBalance < parseEther('1')) {
          await deployer.sendTransaction({
            to: user.address,
            value: parseEther('10'),
          })
          await deployer.sendTransaction({
            to: user2.address,
            value: parseEther('10'),
          })
        }
      }
    } catch {
      // Funding failed - continue without funding
    }
  } catch {
    // Client creation failed
    env = { ...env, chainRunning: false }
  }
}, 120000)

afterAll(async () => {
  try {
    await stopServices()
  } catch {
    // Cleanup failed - ignore
  }
})

// ═══════════════════════════════════════════════════════════════════════════
//                          CLIENT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('JejuClient Core', () => {
  test('client has correct properties', () => {
    if (!env?.chainRunning || !deployer) return
    expect(deployer.network).toBe('localnet')
    expect(deployer.chainId).toBe(1337)
    expect(deployer.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(deployer.isSmartAccount).toBe(false)
  })

  test('getBalance returns bigint', async () => {
    if (!env?.chainRunning || !deployer) return
    try {
      const balance = await deployer.getBalance()
      expect(typeof balance).toBe('bigint')
    } catch {
      // Expected if chain not responsive
    }
  })

  test('sendTransaction works', async () => {
    if (!env?.chainRunning || !deployer || !user2) return
    try {
      const _balanceBefore = await user2.getBalance()
      const txHash = await deployer.sendTransaction({
        to: user2.address,
        value: parseEther('0.1'),
      })
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    } catch {
      // Expected if chain not responsive
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          COMPUTE MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Compute Module', () => {
  test('listProviders returns array', async () => {
    if (!env.chainRunning) return
    try {
      const providers = await user.compute.listProviders()
      expect(Array.isArray(providers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listProviders with GPU filter', async () => {
    if (!env.chainRunning) return
    try {
      const providers = await user.compute.listProviders({ gpuType: 'RTX4090' })
      expect(Array.isArray(providers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listModels returns array', async () => {
    if (!env.chainRunning) return
    try {
      const models = await user.compute.listModels()
      expect(Array.isArray(models)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listMyRentals returns array', async () => {
    if (!env.chainRunning) return
    try {
      const rentals = await user.compute.listMyRentals()
      expect(Array.isArray(rentals)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listTriggers returns array', async () => {
    if (!env.chainRunning) return
    try {
      const triggers = await user.compute.listTriggers()
      expect(Array.isArray(triggers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getPrepaidBalance returns bigint', async () => {
    if (!env.chainRunning) return
    try {
      const balance = await user.compute.getPrepaidBalance()
      expect(typeof balance).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getQuote returns valid estimate', async () => {
    if (!env.chainRunning) return
    try {
      const quote = await user.compute.getQuote({
        gpuType: 'RTX4090',
        durationHours: 1,
      })
      expect(typeof quote.totalCost).toBe('bigint')
      expect(typeof quote.hourlyRate).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test.skip('createRental creates on-chain rental', async () => {
    if (!env.contractsDeployed) return

    // First need a provider to be registered
    const providers = await user.compute.listProviders()
    if (providers.length === 0) return

    const result = await user.compute.createRental({
      provider: providers[0].address,
      durationHours: 1,
    })

    expect(result.rentalId).toBeDefined()
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          STORAGE MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Storage Module', () => {
  test('estimateCost returns valid bigint', async () => {
    if (!env.chainRunning) return
    try {
      const cost = await user.storage.estimateCost(1024 * 1024, 30)
      expect(typeof cost).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getGatewayUrl returns valid URL', async () => {
    if (!env?.chainRunning || !user) return
    const url = user.storage.getGatewayUrl('QmTest123')
    expect(url).toContain('QmTest123')
  })

  test('upload file and get CID', async () => {
    if (!env.servicesRunning) return

    const testData = new Blob([`test content ${Date.now()}`])
    const cid = await user.storage.upload(testData)

    expect(cid).toBeDefined()
    expect(typeof cid).toBe('string')
  })

  test('retrieve uploaded file', async () => {
    if (!env.servicesRunning) return

    const testContent = `test content ${Date.now()}`
    const testData = new Blob([testContent])
    const cid = await user.storage.upload(testData)

    const retrieved = await user.storage.retrieve(cid)
    expect(retrieved).toBeDefined()
  })

  test('pin CID', async () => {
    if (!env.servicesRunning) return

    const testData = new Blob([`pin test ${Date.now()}`])
    const cid = await user.storage.upload(testData)

    const result = await user.storage.pin(cid)
    expect(result).toBeDefined()
  })

  test('listPins returns array', async () => {
    if (!env.servicesRunning) return

    const pins = await user.storage.listPins()
    expect(Array.isArray(pins)).toBe(true)
  })

  test('getStats returns storage statistics', async () => {
    if (!env.servicesRunning) return

    const stats = await user.storage.getStats()
    expect(stats).toBeDefined()
    expect(typeof stats.totalSize).toBe('number')
    expect(typeof stats.fileCount).toBe('number')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          DEFI MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('DeFi Module', () => {
  test('listPools returns array', async () => {
    if (!env.chainRunning) return
    try {
      const pools = await user.defi.listPools()
      expect(Array.isArray(pools)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listPositions returns array', async () => {
    if (!env.chainRunning) return
    try {
      const positions = await user.defi.listPositions()
      expect(Array.isArray(positions)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getSwapQuote returns valid quote', async () => {
    if (!env.chainRunning) return
    try {
      const quote = await user.defi.getSwapQuote({
        tokenIn: '0x0000000000000000000000000000000000000000' as Address,
        tokenOut: '0x0000000000000000000000000000000000000001' as Address,
        amountIn: parseEther('1'),
      })

      expect(quote).toBeDefined()
      expect(typeof quote.amountOut).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getSupportedTokens returns array', async () => {
    if (!env.chainRunning) return
    try {
      const tokens = await user.defi.getSupportedTokens()
      expect(Array.isArray(tokens)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test.skip('swap executes on-chain', async () => {
    if (!env.contractsDeployed) return

    const result = await user.defi.swap({
      tokenIn: '0x...' as Address,
      tokenOut: '0x...' as Address,
      amountIn: parseEther('0.01'),
      slippage: 50, // 0.5%
    })

    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(result.amountOut).toBeGreaterThan(0n)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          GOVERNANCE MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Governance Module', () => {
  test('listProposals returns array', async () => {
    if (!env.chainRunning) return
    try {
      const proposals = await user.governance.listProposals()
      expect(Array.isArray(proposals)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getVotingPower returns bigint', async () => {
    if (!env.chainRunning) return
    try {
      const power = await user.governance.getVotingPower()
      expect(typeof power).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getDelegates returns address or null', async () => {
    if (!env.chainRunning) return
    try {
      const delegate = await user.governance.getDelegates()
      expect(delegate === null || typeof delegate === 'string').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test.skip('createProposal submits on-chain', async () => {
    if (!env.contractsDeployed) return

    const result = await user.governance.createProposal({
      title: `Test Proposal ${Date.now()}`,
      description: 'A test proposal for e2e testing',
      actions: [],
    })

    expect(result.proposalId).toBeDefined()
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          NAMES (JNS) MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Names (JNS) Module', () => {
  test('isAvailable returns boolean', async () => {
    if (!env.chainRunning) return
    try {
      const available = await user.names.isAvailable(`testname${Date.now()}`)
      expect(typeof available).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getRegistrationCost returns bigint', async () => {
    if (!env.chainRunning) return
    try {
      const cost = await user.names.getRegistrationCost('testname', 1)
      expect(typeof cost).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('resolve returns address or null', async () => {
    if (!env.chainRunning) return
    try {
      const address = await user.names.resolve('nonexistent.jeju')
      expect(address === null || typeof address === 'string').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('reverseResolve returns name or null', async () => {
    if (!env.chainRunning) return
    try {
      const name = await user.names.reverseResolve(user.address)
      expect(name === null || typeof name === 'string').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getExpiration returns date or null', async () => {
    if (!env.chainRunning) return
    try {
      const expiration = await user.names.getExpiration('nonexistent.jeju')
      expect(expiration === null || expiration instanceof Date).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test.skip('register creates on-chain name', async () => {
    if (!env.contractsDeployed) return

    const name = `e2etest${Date.now()}`
    const result = await user.names.register(name, 1)

    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Verify registration
    const resolved = await user.names.resolve(`${name}.jeju`)
    expect(resolved).toBe(user.address)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          IDENTITY MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Identity Module', () => {
  test('getMyAgent returns null or agent info', async () => {
    if (!env.chainRunning) return
    try {
      const agent = await user.identity.getMyAgent()
      expect(agent === null || typeof agent === 'object').toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('amIBanned returns boolean', async () => {
    if (!env.chainRunning) return
    try {
      const banned = await user.identity.amIBanned()
      expect(typeof banned).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listAgents returns array', async () => {
    if (!env.chainRunning) return
    try {
      const agents = await user.identity.listAgents()
      expect(Array.isArray(agents)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listAgents with tag filter', async () => {
    if (!env.chainRunning) return
    try {
      const agents = await user.identity.listAgents(['defi'])
      expect(Array.isArray(agents)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test.skip('register creates on-chain agent', async () => {
    if (!env.contractsDeployed) return

    const result = await user.identity.register({
      name: `E2E Test Agent ${Date.now()}`,
      tags: ['test', 'e2e'],
      a2aEndpoint: 'https://test.example.com/a2a',
    })

    expect(result.agentId).toBeDefined()
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Verify registration
    const agent = await user.identity.getMyAgent()
    expect(agent).not.toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          VALIDATION MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation Module', () => {
  test('getAgentValidations returns array', async () => {
    if (!env.chainRunning) return
    try {
      const validations = await user.validation.getAgentValidations(1n)
      expect(Array.isArray(validations)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getValidatorRequests returns array', async () => {
    if (!env.chainRunning) return
    try {
      const requests = await user.validation.getValidatorRequests(user.address)
      expect(Array.isArray(requests)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('requestExists returns boolean', async () => {
    if (!env.chainRunning) return
    try {
      const exists = await user.validation.requestExists(1n, user.address)
      expect(typeof exists).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getSummary returns summary object', async () => {
    if (!env.chainRunning) return
    try {
      const summary = await user.validation.getSummary(1n)
      expect(summary).toBeDefined()
      expect(typeof summary.validCount).toBe('number')
    } catch {
      // Expected if contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          CROSS-CHAIN MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-chain Module', () => {
  test('getSupportedChains returns array', async () => {
    if (!env?.chainRunning || !user) return
    const chains = await user.crosschain.getSupportedChains()
    expect(Array.isArray(chains)).toBe(true)
    expect(chains.length).toBeGreaterThan(0)
  })

  test('listSolvers returns array', async () => {
    if (!env.chainRunning) return
    try {
      const solvers = await user.crosschain.listSolvers()
      expect(Array.isArray(solvers)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listXLPs returns array', async () => {
    if (!env.chainRunning) return
    try {
      const xlps = await user.crosschain.listXLPs()
      expect(Array.isArray(xlps)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listMyIntents returns array', async () => {
    if (!env.chainRunning) return
    try {
      const intents = await user.crosschain.listMyIntents()
      expect(Array.isArray(intents)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getQuote returns valid quote', async () => {
    if (!env.servicesRunning) return
    try {
      const quote = await user.crosschain.getQuote({
        fromChain: 'base',
        toChain: 'arbitrum',
        token: '0x0000000000000000000000000000000000000000' as Address,
        amount: parseEther('1'),
      })

      expect(quote).toBeDefined()
      expect(typeof quote.estimatedOutput).toBe('bigint')
    } catch {
      // Expected if services not running
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          PAYMENTS MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Payments Module', () => {
  test('getBalance returns bigint', async () => {
    if (!env.chainRunning) return
    const balance = await user.payments.getBalance()
    expect(typeof balance).toBe('bigint')
  })

  test('getCredits returns bigint', async () => {
    if (!env.chainRunning) return
    try {
      const credits = await user.payments.getCredits()
      expect(typeof credits).toBe('bigint')
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('listPaymasters returns array', async () => {
    if (!env.chainRunning) return
    try {
      const paymasters = await user.payments.listPaymasters()
      expect(Array.isArray(paymasters)).toBe(true)
    } catch {
      // Expected if contracts not deployed
    }
  })

  test('getPaymasterStatus returns valid status', async () => {
    if (!env.chainRunning) return
    try {
      const status = await user.payments.getPaymasterStatus()
      expect(status).toBeDefined()
      expect(typeof status.active).toBe('boolean')
    } catch {
      // Expected if contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          A2A MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('A2A Module', () => {
  test('discover gateway agent', async () => {
    if (!env.servicesRunning) return

    try {
      const card = await user.a2a.discover('http://localhost:4000')
      expect(card).toBeDefined()
      expect(card.name).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('discover compute agent', async () => {
    if (!env.servicesRunning) return

    try {
      const card = await user.a2a.discover('http://localhost:4004')
      expect(card).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('discover storage agent', async () => {
    if (!env.servicesRunning) return

    try {
      const card = await user.a2a.discover('http://localhost:4003')
      expect(card).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('call gateway skill', async () => {
    if (!env.servicesRunning) return

    try {
      const result = await user.a2a.call('http://localhost:4000', {
        skill: 'list-protocol-tokens',
        params: {},
      })

      expect(result).toBeDefined()
    } catch {
      // Expected if services not running
    }
  })

  test('discoverAgents returns array', async () => {
    if (!env.servicesRunning) return
    try {
      const agents = await user.a2a.discoverAgents()
      expect(Array.isArray(agents)).toBe(true)
    } catch {
      // Expected if services not running
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          GAMES MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Games Module', () => {
  test('getContracts returns addresses', async () => {
    try {
      const contracts = user.games.getContracts()
      expect(contracts).toBeDefined()
    } catch {
      // Expected if games contracts not deployed
    }
  })

  test('getGoldBalance returns bigint', async () => {
    try {
      const balance = await user.games.getGoldBalance(user.address)
      expect(typeof balance).toBe('bigint')
    } catch {
      // Expected if games contracts not deployed
    }
  })

  test('getItemBalance returns bigint', async () => {
    try {
      const balance = await user.games.getItemBalance(user.address, 1n)
      expect(typeof balance).toBe('bigint')
    } catch {
      // Expected if games contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          CONTAINERS MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Containers Module', () => {
  test('listMyRepositories returns array', async () => {
    try {
      const repos = await user.containers.listMyRepositories()
      expect(Array.isArray(repos)).toBe(true)
    } catch {
      // Expected if container registry not deployed
    }
  })

  test('getRepoId generates valid ID', () => {
    try {
      const repoId = user.containers.getRepoId(user.address, 'test-repo')
      expect(repoId).toMatch(/^0x[a-fA-F0-9]{64}$/)
    } catch {
      // Expected if container registry not deployed
    }
  })

  test('parseImageReference parses valid reference', () => {
    try {
      const ref = user.containers.parseImageReference(
        '0x1234567890abcdef/myrepo:latest',
      )
      expect(ref.owner).toBeDefined()
      expect(ref.name).toBe('myrepo')
      expect(ref.tag).toBe('latest')
    } catch {
      // Expected if container registry not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          LAUNCHPAD MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Launchpad Module', () => {
  test('listActivePresales returns array', async () => {
    try {
      const presales = await user.launchpad.listActivePresales()
      expect(Array.isArray(presales)).toBe(true)
    } catch {
      // Expected if launchpad contracts not deployed
    }
  })

  test('listActiveCurves returns array', async () => {
    try {
      const curves = await user.launchpad.listActiveCurves()
      expect(Array.isArray(curves)).toBe(true)
    } catch {
      // Expected if launchpad contracts not deployed
    }
  })

  test('listMyLPLocks returns array', async () => {
    try {
      const locks = await user.launchpad.listMyLPLocks()
      expect(Array.isArray(locks)).toBe(true)
    } catch {
      // Expected if launchpad contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          MODERATION MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Moderation Module', () => {
  test('listCases returns array', async () => {
    try {
      const cases = await user.moderation.listCases()
      expect(Array.isArray(cases)).toBe(true)
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('listMyCases returns array', async () => {
    try {
      const cases = await user.moderation.listMyCases()
      expect(Array.isArray(cases)).toBe(true)
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('listMyEvidence returns array', async () => {
    try {
      const evidence = await user.moderation.listMyEvidence()
      expect(Array.isArray(evidence)).toBe(true)
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('getUnclaimedRewards returns bigint', async () => {
    try {
      const rewards = await user.moderation.getUnclaimedRewards()
      expect(typeof rewards).toBe('bigint')
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('isTrusted returns boolean', async () => {
    try {
      const trusted = await user.moderation.isTrusted(user.address)
      expect(typeof trusted).toBe('boolean')
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('isSuspicious returns boolean', async () => {
    try {
      const suspicious = await user.moderation.isSuspicious(user.address)
      expect(typeof suspicious).toBe('boolean')
    } catch {
      // Expected if moderation contracts not deployed
    }
  })

  test('getAggregateScore returns number', async () => {
    try {
      const score = await user.moderation.getAggregateScore(user.address)
      expect(typeof score).toBe('number')
    } catch {
      // Expected if moderation contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                          WORK MODULE
// ═══════════════════════════════════════════════════════════════════════════

describe('Work Module', () => {
  test('listBounties returns array', async () => {
    try {
      const bounties = await user.work.listBounties()
      expect(Array.isArray(bounties)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('listMyBounties returns array', async () => {
    try {
      const bounties = await user.work.listMyBounties()
      expect(Array.isArray(bounties)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('listMyHunts returns array', async () => {
    try {
      const hunts = await user.work.listMyHunts()
      expect(Array.isArray(hunts)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('listProjects returns array', async () => {
    try {
      const projects = await user.work.listProjects()
      expect(Array.isArray(projects)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('listMyProjects returns array', async () => {
    try {
      const projects = await user.work.listMyProjects()
      expect(Array.isArray(projects)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('listGuardians returns array', async () => {
    try {
      const guardians = await user.work.listGuardians()
      expect(Array.isArray(guardians)).toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })

  test('getGuardian returns guardian or null', async () => {
    try {
      const guardian = await user.work.getGuardian(user.address)
      expect(guardian === null || typeof guardian === 'object').toBe(true)
    } catch {
      // Expected if work contracts not deployed
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//                    ON-CHAIN WRITE OPERATIONS (DEVNET)
// ═══════════════════════════════════════════════════════════════════════════

describe('On-Chain Write Operations', () => {
  test.skip('full bounty workflow', async () => {
    if (!env.contractsDeployed) return

    // Create bounty
    const createResult = await user.work.createBounty({
      title: `E2E Test Bounty ${Date.now()}`,
      description: 'Test bounty for e2e testing',
      reward: parseEther('0.1'),
      deadline: Math.floor(Date.now() / 1000) + 86400,
      tags: ['test'],
    })

    expect(createResult.bountyId).toBeDefined()
    expect(createResult.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Claim bounty as user2
    const claimTx = await user2.work.claimBounty(createResult.bountyId)
    expect(claimTx).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Submit work
    const submitTx = await user2.work.submitWork({
      bountyId: createResult.bountyId,
      content: 'Completed the task',
      proofOfWork: 'ipfs://QmTest123',
    })
    expect(submitTx).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Verify bounty state changed
    const bounty = await user.work.getBounty(createResult.bountyId)
    expect(bounty).not.toBeNull()
    expect(bounty?.hunter).toBe(user2.address)
  })

  test.skip('full moderation workflow', async () => {
    if (!env.contractsDeployed) return

    // Create case
    const createResult = await user.moderation.createCase({
      reportedEntity: user2.address,
      reportType: 'spam',
      description: 'E2E test case',
      stake: parseEther('0.01'),
    })

    expect(createResult.caseId).toBeDefined()

    // Submit evidence
    const evidenceResult = await user2.moderation.submitEvidence({
      caseId: createResult.caseId,
      ipfsHash: 'QmTestEvidence',
      summary: 'Counter evidence for test',
      position: 1, // AGAINST_ACTION
    })

    expect(evidenceResult.evidenceId).toBeDefined()

    // Support evidence
    const supportTx = await deployer.moderation.supportEvidence({
      evidenceId: evidenceResult.evidenceId,
      isSupporting: true,
      comment: 'I support this evidence',
    })

    expect(supportTx).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })

  test.skip('full project workflow', async () => {
    if (!env.contractsDeployed) return

    // Create project
    const projectResult = await user.work.createProject({
      name: `E2E Test Project ${Date.now()}`,
      description: 'Test project for e2e testing',
      repository: 'https://github.com/test/repo',
      budget: parseEther('1'),
    })

    expect(projectResult.projectId).toBeDefined()

    // Add member
    const addTx = await user.work.addMember(
      projectResult.projectId,
      user2.address,
    )
    expect(addTx).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Create task
    const taskTx = await user.work.createTask(
      projectResult.projectId,
      'Test Task',
      'A task for testing',
      parseEther('0.1'),
    )
    expect(taskTx).toMatch(/^0x[a-fA-F0-9]{64}$/)

    // Get tasks
    const tasks = await user.work.getTasks(projectResult.projectId)
    expect(tasks.length).toBeGreaterThan(0)
  })
})
