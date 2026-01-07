import { beforeAll, describe, expect, test } from 'bun:test'
import { getServicesConfig } from '@jejunetwork/config'
import { createPublicClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import { getCharacter } from '../../api/characters'
import { createAgentSDK } from '../../api/sdk/agent'
import { createCompute } from '../../api/sdk/compute'
import { createLogger } from '../../api/sdk/logger'
import { createRoomSDK } from '../../api/sdk/room'
import { createStorage } from '../../api/sdk/storage'
import type { CrucibleConfig } from '../../lib/types'
import { MockKMSSigner } from '../fixtures/agent-mocks'

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil default

// Get services config (handles env var overrides internally)
const servicesConfig = getServicesConfig()

// DWS provides storage, compute, and CDN from a single endpoint
const DWS_URL = servicesConfig.dws.api

// Load contract addresses from deployment file
import deployments from '../../../../packages/contracts/deployments/localnet/deployment.json'

const config: CrucibleConfig = {
  rpcUrl: servicesConfig.rpc.l2,
  privateKey: TEST_PRIVATE_KEY,
  contracts: {
    agentVault: (process.env.AGENT_VAULT_ADDRESS ??
      deployments.crucible?.agentVault ??
      '0xc5a5C42992dECbae36851359345FE25997F5C42d') as `0x${string}`,
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ??
      deployments.crucible?.roomRegistry ??
      '0x67d269191c92Caf3cD7723F116c85e6E9bf55933') as `0x${string}`,
    triggerRegistry: (process.env.TRIGGER_REGISTRY_ADDRESS ??
      deployments.crucible?.triggerRegistry ??
      '0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ??
      deployments.registry.identityRegistry) as `0x${string}`,
    serviceRegistry: (process.env.SERVICE_REGISTRY_ADDRESS ??
      deployments.infrastructure.serviceRegistry) as `0x${string}`,
  },
  services: {
    dwsUrl: DWS_URL,
    computeMarketplace: servicesConfig.compute.marketplace,
    storageApi: servicesConfig.storage.api,
    ipfsGateway: servicesConfig.storage.ipfsGateway,
    indexerGraphql: servicesConfig.indexer.graphql,
  },
  network: 'localnet',
}

// Check if infrastructure is available (runs once before tests)
const checkInfrastructure = async (): Promise<{
  rpc: boolean
  dws: boolean
}> => {
  const rpcUrl = config.rpcUrl
  const [rpc, dws] = await Promise.all([
    fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => r.ok)
      .catch(() => false),
    fetch(`${DWS_URL}/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false),
  ])
  return { rpc, dws }
}

const log = createLogger('IntegrationTest', { level: 'debug' })

// Infrastructure is REQUIRED - tests fail if not running
describe('Integration Tests', () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`)
  const publicClient = createPublicClient({
    chain: localhost,
    transport: http(config.rpcUrl),
  })

  let storage: ReturnType<typeof createStorage>
  let compute: ReturnType<typeof createCompute>
  let agentSdk: ReturnType<typeof createAgentSDK>
  let roomSdk: ReturnType<typeof createRoomSDK>

  beforeAll(async () => {
    // Verify infrastructure is available - REQUIRED
    const infra = await checkInfrastructure()
    if (!infra.rpc) {
      throw new Error(
        `RPC not available at ${config.rpcUrl}. Start with: jeju dev`,
      )
    }
    if (!infra.dws) {
      throw new Error(`DWS not available at ${DWS_URL}. Start with: jeju dev`)
    }

    log.info('Setting up integration test environment', {
      rpcUrl: config.rpcUrl,
      account: account.address,
    })

    storage = createStorage({
      apiUrl: config.services.storageApi,
      ipfsGateway: config.services.ipfsGateway,
      logger: createLogger('Storage', { level: 'debug' }),
    })

    compute = createCompute({
      marketplaceUrl: config.services.computeMarketplace,
      rpcUrl: config.rpcUrl,
      logger: createLogger('Compute', { level: 'debug' }),
    })

    // Use MockKMSSigner for testing - simpler than real KMS
    const kmsSigner = new MockKMSSigner(
      TEST_PRIVATE_KEY as `0x${string}`,
      config.rpcUrl,
      31337, // Anvil chain ID
    )
    await kmsSigner.initialize()

    agentSdk = createAgentSDK({
      crucibleConfig: config,
      storage,
      compute,
      publicClient,
      kmsSigner,
      logger: createLogger('AgentSDK', { level: 'debug' }),
    })

    roomSdk = createRoomSDK({
      crucibleConfig: config,
      storage,
      publicClient,
      kmsSigner,
      logger: createLogger('RoomSDK', { level: 'debug' }),
    })
  })

  describe('Blockchain Connectivity', () => {
    test('should connect to local RPC', async () => {
      const blockNumber = await publicClient.getBlockNumber()
      log.info('Connected to chain', { blockNumber: blockNumber.toString() })
      expect(blockNumber).toBeGreaterThanOrEqual(0n)
    })

    test('should have test account with ETH', async () => {
      const balance = await publicClient.getBalance({
        address: account.address,
      })
      log.info('Account balance', { balance: balance.toString() })
      expect(balance).toBeGreaterThan(parseEther('1'))
    })
  })

  describe('Contract Verification', () => {
    test('should have IdentityRegistry deployed', async () => {
      const code = await publicClient.getCode({
        address: config.contracts.identityRegistry,
      })
      log.info('IdentityRegistry code', { hasCode: !!code && code.length > 2 })
      expect(code).toBeDefined()
      expect(code?.length).toBeGreaterThan(2)
    })

    test('should have AgentVault deployed', async () => {
      const code = await publicClient.getCode({
        address: config.contracts.agentVault,
      })
      log.info('AgentVault code', { hasCode: !!code && code.length > 2 })
      expect(code).toBeDefined()
      expect(code?.length).toBeGreaterThan(2)
    })

    test('should have RoomRegistry deployed', async () => {
      const code = await publicClient.getCode({
        address: config.contracts.roomRegistry,
      })
      log.info('RoomRegistry code', { hasCode: !!code && code.length > 2 })
      expect(code).toBeDefined()
      expect(code?.length).toBeGreaterThan(2)
    })

    test('should have TriggerRegistry deployed', async () => {
      const code = await publicClient.getCode({
        address: config.contracts.triggerRegistry,
      })
      log.info('TriggerRegistry code', { hasCode: !!code && code.length > 2 })
      expect(code).toBeDefined()
      expect(code?.length).toBeGreaterThan(2)
    })
  })

  describe('Storage API', () => {
    test('should store and retrieve character from IPFS', async () => {
      const character = getCharacter('project-manager')
      expect(character).toBeDefined()

      if (!character) throw new Error('character not found')
      const cid = await storage.storeCharacter(character)
      log.info('Stored character', { cid })
      expect(cid).toMatch(/^Qm|^bafy/)

      const loaded = await storage.loadCharacter(cid)
      expect(loaded.id).toBe(character.id)
      expect(loaded.name).toBe(character.name)
    })

    test('should store and retrieve agent state from IPFS', async () => {
      const state = storage.createInitialState('test-agent')
      const cid = await storage.storeAgentState(state)
      log.info('Stored state', { cid })

      const loaded = await storage.loadAgentState(cid)
      expect(loaded.agentId).toBe('test-agent')
      expect(loaded.version).toBe(0)
    })
  })

  describe('Agent Registration (requires deployed contracts)', () => {
    test('should register agent and create vault', async () => {
      const character = getCharacter('project-manager')
      expect(character).toBeDefined()

      log.info('Registering agent', { name: character?.name })

      if (!character) throw new Error('character not found')
      const result = await agentSdk.registerAgent(character, {
        initialFunding: parseEther('0.01'),
      })

      log.info('Agent registered', {
        agentId: result.agentId.toString(),
        vaultAddress: result.vaultAddress,
        characterCid: result.characterCid,
        stateCid: result.stateCid,
      })

      expect(result.agentId).toBeGreaterThan(0n)
      expect(result.vaultAddress).toMatch(/^0x/)
      expect(result.characterCid).toMatch(/^Qm|^bafy/)
      expect(result.stateCid).toMatch(/^Qm|^bafy/)

      // Verify agent exists
      const agent = await agentSdk.getAgent(result.agentId)
      expect(agent).toBeDefined()
      expect(agent?.owner).toBe(account.address)

      // Verify vault has balance
      const balance = await agentSdk.getVaultBalance(result.agentId)
      expect(balance).toBeGreaterThanOrEqual(parseEther('0.01'))
    })
  })

  describe('Room Management (requires deployed contracts)', () => {
    test('should create room', async () => {
      log.info('Creating room')

      const result = await roomSdk.createRoom(
        'Integration Test Room',
        'Testing room creation',
        'collaboration',
        { maxMembers: 5, turnBased: false, visibility: 'public' },
      )

      log.info('Room created', {
        roomId: result.roomId.toString(),
        stateCid: result.stateCid,
      })

      expect(result.roomId).toBeGreaterThan(0n)
      expect(result.stateCid).toMatch(/^Qm|^bafy/)

      // Verify room exists
      const room = await roomSdk.getRoom(result.roomId)
      expect(room).toBeDefined()
      expect(room?.name).toBe('Integration Test Room')
    })
  })
})

// Run these tests with: INTEGRATION=true bun test src/tests/integration.test.ts
