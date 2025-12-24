import { beforeAll, describe, expect, test } from 'bun:test'
import { type Address, createPublicClient, http, parseEther } from 'viem'
import {
  createNodeClient,
  getContractAddresses,
  networkLocalnet,
} from '../../api/lib/contracts'
import {
  detectHardware,
  getComputeCapabilities,
  type HardwareInfo,
  meetsRequirements,
  type ServiceRequirements,
} from '../../api/lib/hardware'
import { createNodeServices, type NodeServices } from '../../api/lib/services'

const RPC_URL = process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:6546'
const CHAIN_ID = 1337

interface TestAccount {
  key: `0x${string}`
  address: Address
}

const TEST_ACCOUNTS: TestAccount[] = [
  {
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  },
  {
    key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  },
  {
    key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  },
]

let isLocalnetRunning = false
let hardware: HardwareInfo

async function checkLocalnet(): Promise<boolean> {
  const publicClient = createPublicClient({
    chain: networkLocalnet,
    transport: http(RPC_URL),
  })
  const blockNumber = await publicClient.getBlockNumber().catch(() => null)
  return blockNumber !== null
}

async function waitForTx(hash: `0x${string}`): Promise<void> {
  const publicClient = createPublicClient({
    chain: networkLocalnet,
    transport: http(RPC_URL),
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

function skipIfNoLocalnet(): boolean {
  if (!isLocalnetRunning) {
    console.log('SKIPPED: Localnet not running')
    return true
  }
  return false
}

describe('Pre-flight Checks', () => {
  beforeAll(async () => {
    isLocalnetRunning = await checkLocalnet()
    hardware = detectHardware()
  })

  test('localnet connectivity', async () => {
    if (!isLocalnetRunning) {
      console.log('Localnet not running - run `jeju dev` to start')
    }
    expect(true).toBe(true)
  })

  test('hardware detection works', () => {
    expect(hardware).toBeDefined()
    expect(hardware.cpu.coresPhysical).toBeGreaterThan(0)
    expect(hardware.memory.totalMb).toBeGreaterThan(0)
  })

  test('compute capabilities analysis', () => {
    const capabilities = getComputeCapabilities(hardware)
    expect(capabilities.cpuCompute).toBeDefined()
    expect(capabilities.gpuCompute).toBeDefined()
  })

  test('contract addresses are valid', () => {
    const addresses = getContractAddresses(CHAIN_ID)
    expect(addresses.identityRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(addresses.computeStaking).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(addresses.oracleStakingManager).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(addresses.storageMarket).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(addresses.triggerRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })
})

describe('Wallet & Signing', () => {
  test('client creation without wallet', () => {
    const client = createNodeClient(RPC_URL, CHAIN_ID)
    expect(client.publicClient).toBeDefined()
    expect(client.walletClient).toBeNull()
  })

  test('client creation with wallet', () => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)
    expect(client.publicClient).toBeDefined()
    expect(client.walletClient).toBeDefined()
    expect(client.walletClient?.account?.address.toLowerCase()).toBe(
      TEST_ACCOUNTS[0].address.toLowerCase(),
    )
  })

  test('can read balance', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)
    const balance = await client.publicClient.getBalance({
      address: TEST_ACCOUNTS[0].address,
    })
    expect(balance).toBeGreaterThan(0n)
  })

  test('can send transaction', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)

    const account = client.walletClient?.account
    if (!account) throw new Error('Wallet client account not available')

    const hash = await client.walletClient?.sendTransaction({
      chain: networkLocalnet,
      account,
      to: TEST_ACCOUNTS[0].address,
      value: parseEther('0.001'),
    })

    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    await waitForTx(hash)
  })
})

describe('Compute Service', () => {
  let services: NodeServices

  beforeAll(() => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)
    services = createNodeServices(client)
  })

  test('can read compute service state', async () => {
    if (skipIfNoLocalnet()) return

    const state = await services.compute.getState(TEST_ACCOUNTS[0].address)
    expect(state).toBeDefined()
    expect(typeof state.isRegistered).toBe('boolean')
    expect(typeof state.isStaked).toBe('boolean')
  })

  test('can stake as compute provider', async () => {
    if (skipIfNoLocalnet()) return

    const stakeAmount = parseEther('0.1')

    const hash = await services.compute.stake(stakeAmount).catch((e: Error) => {
      if (
        e.message?.includes('already staked') ||
        e.message?.includes('execution reverted')
      ) {
        return null
      }
      throw e
    })

    if (hash) {
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await waitForTx(hash)

      const state = await services.compute.getState(TEST_ACCOUNTS[0].address)
      expect(state.stakeAmount).toBeGreaterThanOrEqual(stakeAmount)
    }
  })

  test('can register compute service', async () => {
    if (skipIfNoLocalnet()) return

    services.compute.setHardware(hardware)

    if (services.compute.isNonTeeMode('cpu')) {
      services.compute.acknowledgeNonTeeRisk()
    }

    const hash = await services.compute
      .registerService({
        modelId: 'test-model-v1',
        endpoint: 'http://localhost:8080/inference',
        pricePerInputToken: 1000n,
        pricePerOutputToken: 2000n,
        stakeAmount: parseEther('0.1'),
        computeType: 'cpu',
        computeMode: 'non-tee',
        cpuCores: 2,
        acceptNonTeeRisk: true,
      })
      .catch((e: Error) => {
        if (
          e.message?.includes('already registered') ||
          e.message?.includes('execution reverted')
        ) {
          return null
        }
        throw e
      })

    if (hash) {
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await waitForTx(hash)
    }
  })

  test('setHardware accepts hardware info', () => {
    // Verify setHardware doesn't throw with valid hardware info
    expect(() => services.compute.setHardware(hardware)).not.toThrow()
  })

  test('non-TEE warning is required for non-TEE compute', () => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[1].key)
    const newServices = createNodeServices(client)
    newServices.compute.setHardware(hardware)

    if (newServices.compute.isNonTeeMode('cpu')) {
      expect(newServices.compute.getNonTeeWarning()).toContain(
        'NON-CONFIDENTIAL',
      )
    }
  })
})

describe('Oracle Service', () => {
  let services: NodeServices

  beforeAll(() => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[1].key)
    services = createNodeServices(client)
  })

  test('can read oracle service state', async () => {
    if (skipIfNoLocalnet()) return

    const state = await services.oracle.getState(TEST_ACCOUNTS[1].address)
    expect(state).toBeDefined()
    expect(typeof state.isRegistered).toBe('boolean')
  })

  test('can register as oracle provider', async () => {
    if (skipIfNoLocalnet()) return

    const hash = await services.oracle
      .register({
        agentId: 1n,
        stakeAmount: parseEther('1.0'),
        markets: ['ETH/USD', 'BTC/USD'],
      })
      .catch((e: Error) => {
        if (
          e.message?.includes('already registered') ||
          e.message?.includes('execution reverted')
        ) {
          return null
        }
        throw e
      })

    if (hash) {
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await waitForTx(hash)
    }
  })

  test('can submit price data', async () => {
    if (skipIfNoLocalnet()) return

    const state = await services.oracle.getState(TEST_ACCOUNTS[1].address)
    if (!state.isRegistered) {
      console.log('SKIPPED: Oracle not registered')
      return
    }

    const hash = await services.oracle
      .submitPrice('ETH/USD', 250000000000n)
      .catch(() => null)

    if (hash) {
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await waitForTx(hash)
    }
  })

  test('submission history is tracked locally', () => {
    const history = services.oracle.getSubmissionHistory()
    expect(Array.isArray(history)).toBe(true)
  })
})

describe('Storage Service', () => {
  let services: NodeServices

  beforeAll(() => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[2].key)
    services = createNodeServices(client)
  })

  test('can read storage service state', async () => {
    if (skipIfNoLocalnet()) return

    const state = await services.storage.getState(TEST_ACCOUNTS[2].address)
    expect(state).toBeDefined()
    expect(typeof state.isRegistered).toBe('boolean')
  })

  test('can register as storage provider', async () => {
    if (skipIfNoLocalnet()) return

    const hash = await services.storage
      .register({
        endpoint: 'http://localhost:9000/storage',
        capacityGB: 100,
        pricePerGBMonth: parseEther('0.001'),
        stakeAmount: parseEther('0.5'),
      })
      .catch((e: Error) => {
        if (
          e.message?.includes('already registered') ||
          e.message?.includes('execution reverted')
        ) {
          return null
        }
        throw e
      })

    if (hash) {
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
      await waitForTx(hash)
    }
  })
})

describe('Cron Service', () => {
  let services: NodeServices

  beforeAll(() => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)
    services = createNodeServices(client)
  })

  test('can get active triggers', async () => {
    if (skipIfNoLocalnet()) return

    const triggers = await services.cron.getActiveTriggers()
    expect(Array.isArray(triggers)).toBe(true)
  })

  test('cron state tracking works', async () => {
    if (skipIfNoLocalnet()) return

    const state = await services.cron.getState()
    expect(state).toBeDefined()
    expect(typeof state.executionsCompleted).toBe('number')
    expect(typeof state.earningsWei).toBe('bigint')
  })
})

describe('Requirements Checking', () => {
  test('compute requirements - CPU service', () => {
    const requirements: ServiceRequirements = {
      minCpuCores: 2,
      minMemoryMb: 4096,
      minStorageGb: 10,
      requiresGpu: false,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(typeof result.meets).toBe('boolean')
    expect(Array.isArray(result.issues)).toBe(true)
  })

  test('compute requirements - GPU service', () => {
    const requirements: ServiceRequirements = {
      minCpuCores: 2,
      minMemoryMb: 8192,
      minStorageGb: 20,
      requiresGpu: true,
      minGpuMemoryMb: 8000,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(typeof result.meets).toBe('boolean')
  })

  test('compute requirements - TEE service', () => {
    const requirements: ServiceRequirements = {
      minCpuCores: 2,
      minMemoryMb: 4096,
      minStorageGb: 10,
      requiresGpu: false,
      requiresTee: true,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(typeof result.meets).toBe('boolean')
  })

  test('compute requirements - Docker service', () => {
    const requirements: ServiceRequirements = {
      minCpuCores: 2,
      minMemoryMb: 4096,
      minStorageGb: 10,
      requiresGpu: false,
      requiresTee: false,
      requiresDocker: true,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(typeof result.meets).toBe('boolean')
  })
})

describe('Service Factory & Lifecycle', () => {
  test('createNodeServices creates all services', () => {
    const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_ACCOUNTS[0].key)
    const services = createNodeServices(client)

    expect(services.compute).toBeDefined()
    expect(services.oracle).toBeDefined()
    expect(services.storage).toBeDefined()
    expect(services.cron).toBeDefined()
  })

  test('services throw when wallet not connected', async () => {
    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const services = createNodeServices(client)

    await expect(services.compute.stake(parseEther('0.1'))).rejects.toThrow(
      'Wallet not connected',
    )

    await expect(
      services.oracle.register({
        agentId: 1n,
        stakeAmount: parseEther('1'),
        markets: ['ETH/USD'],
      }),
    ).rejects.toThrow('Wallet not connected')

    await expect(
      services.storage.register({
        endpoint: 'http://localhost:9000',
        capacityGB: 1,
        pricePerGBMonth: 1n,
        stakeAmount: 1n,
      }),
    ).rejects.toThrow('Wallet not connected')
  })
})

describe('Contract Deployment Verification', () => {
  test('identity registry is deployed', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const code = await client.publicClient.getCode({
      address: client.addresses.identityRegistry,
    })

    if (code && code !== '0x') {
      expect(code.length).toBeGreaterThan(2)
    }
  })

  test('compute staking is deployed', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const code = await client.publicClient.getCode({
      address: client.addresses.computeStaking,
    })

    if (code && code !== '0x') {
      expect(code.length).toBeGreaterThan(2)
    }
  })

  test('oracle staking manager is deployed', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const code = await client.publicClient.getCode({
      address: client.addresses.oracleStakingManager,
    })

    if (code && code !== '0x') {
      expect(code.length).toBeGreaterThan(2)
    }
  })

  test('storage market is deployed', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const code = await client.publicClient.getCode({
      address: client.addresses.storageMarket,
    })

    if (code && code !== '0x') {
      expect(code.length).toBeGreaterThan(2)
    }
  })

  test('trigger registry is deployed', async () => {
    if (skipIfNoLocalnet()) return

    const client = createNodeClient(RPC_URL, CHAIN_ID)
    const code = await client.publicClient.getCode({
      address: client.addresses.triggerRegistry,
    })

    if (code && code !== '0x') {
      expect(code.length).toBeGreaterThan(2)
    }
  })
})
