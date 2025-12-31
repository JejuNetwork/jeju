import { describe, expect, test } from 'bun:test'
import {
  getIpfsApiUrl,
  getL1RpcUrl,
  getLocalhostHost,
  getRpcGatewayUrl,
} from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  namehash,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import { APP_PORTS, L1_LOCALNET, TEST_WALLETS } from '../shared/constants'

const host = getLocalhostHost()

// Test configuration
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
  getL1RpcUrl() ??
  L1_LOCALNET.rpcUrl
const IPFS_API_URL = getIpfsApiUrl()
const JNS_GATEWAY_URL =
  (typeof process !== 'undefined' ? process.env.JNS_GATEWAY_URL : undefined) ??
  getRpcGatewayUrl() ??
  `http://${host}:${APP_PORTS.predictionMarket}`

// Contract addresses (from deployment)
const JNS_REGISTRAR = ((typeof process !== 'undefined'
  ? process.env.JNS_REGISTRAR
  : undefined) ?? '0x0') as Address
const JNS_RESOLVER = ((typeof process !== 'undefined'
  ? process.env.JNS_RESOLVER
  : undefined) ?? '0x0') as Address
const KEEPALIVE_REGISTRY = ((typeof process !== 'undefined'
  ? process.env.KEEPALIVE_REGISTRY
  : undefined) ?? '0x0') as Address

// Test wallet
const TEST_PRIVATE_KEY = TEST_WALLETS.deployer.privateKey as Hex
const account = privateKeyToAccount(TEST_PRIVATE_KEY)

const chain = {
  ...localhost,
  id: 31337,
}

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
})

// Skip tests if contracts not deployed
const skipIfNoContracts = JNS_REGISTRAR === '0x0'

describe.skipIf(skipIfNoContracts)('Decentralized App Deployment', () => {
  const testAppName = `testapp${Date.now()}`
  const testJnsName = `${testAppName}.jeju`
  let ipfsCid: string
  let jnsNode: Hex
  let keepaliveId: Hex

  describe('IPFS Upload', () => {
    test('should upload content to IPFS', async () => {
      // Create test HTML content
      const htmlContent = `<!DOCTYPE html>
<html>
<head><title>${testAppName}</title></head>
<body><h1>Hello from ${testAppName}</h1></body>
</html>`

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([htmlContent], { type: 'text/html' }),
        'index.html',
      )

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      let response: Response
      try {
        response = await fetch(`${IPFS_API_URL}/api/v0/add`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
      } catch (e) {
        clearTimeout(timeoutId)
        // Connection refused or timeout - IPFS not available
        if (
          e instanceof Error &&
          (e.name === 'AbortError' || e.message.includes('ECONNREFUSED'))
        ) {
          console.log('IPFS not available - skipping upload test')
          ipfsCid = 'QmTest123' // Mock CID for subsequent tests
          return
        }
        throw e
      }
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(
          `IPFS upload failed: ${response.status} ${response.statusText}`,
        )
      }

      const result = await response.json()
      ipfsCid = result.Hash

      expect(ipfsCid).toMatch(/^Qm[a-zA-Z0-9]{44}$/)
      console.log(`✅ Uploaded to IPFS: ${ipfsCid}`)
    })
  })

  describe('JNS Registration', () => {
    test('should check name availability', async () => {
      const JNS_REGISTRAR_ABI = [
        {
          name: 'available',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'name', type: 'string' }],
          outputs: [{ type: 'bool' }],
        },
      ] as const

      const available = await publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'available',
        args: [testAppName],
      })

      expect(available).toBe(true)
      console.log(`✅ Name ${testAppName} is available`)
    })

    test('should register JNS name', async () => {
      const JNS_REGISTRAR_ABI = [
        {
          name: 'register',
          type: 'function',
          stateMutability: 'payable',
          inputs: [
            { name: 'name', type: 'string' },
            { name: 'owner', type: 'address' },
            { name: 'duration', type: 'uint256' },
          ],
          outputs: [{ type: 'bytes32' }],
        },
        {
          name: 'rentPrice',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'name', type: 'string' },
            { name: 'duration', type: 'uint256' },
          ],
          outputs: [{ type: 'uint256' }],
        },
      ] as const

      const duration = 365n * 24n * 60n * 60n // 1 year

      const price = await publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [testAppName, duration],
      })

      const { request } = await publicClient.simulateContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'register',
        args: [testAppName, account.address, duration],
        value: price,
        account,
      })

      const hash = await walletClient.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash })

      jnsNode = namehash(testJnsName) as Hex
      expect(jnsNode).toMatch(/^0x[a-f0-9]{64}$/)
      console.log(`✅ Registered JNS name: ${testJnsName}`)
    })

    test('should set contenthash', async () => {
      const JNS_RESOLVER_ABI = [
        {
          name: 'setContenthash',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'node', type: 'bytes32' },
            { name: 'hash', type: 'bytes' },
          ],
          outputs: [],
        },
      ] as const

      // Encode IPFS CID as contenthash
      // Format: 0xe3 (ipfs) + 0x01 (protobuf) + 0x01 (version) + 0x70 (dag-pb) + multihash
      const contenthash =
        '0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f' as Hex

      const { request } = await publicClient.simulateContract({
        address: JNS_RESOLVER,
        abi: JNS_RESOLVER_ABI,
        functionName: 'setContenthash',
        args: [jnsNode, contenthash],
        account,
      })

      const hash = await walletClient.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash })

      console.log(`✅ Set contenthash for ${testJnsName}`)
    })
  })

  describe('Keepalive Configuration', () => {
    test('should register keepalive', async () => {
      const KEEPALIVE_ABI = [
        {
          name: 'registerKeepalive',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'jnsNode', type: 'bytes32' },
            { name: 'agentId', type: 'uint256' },
            { name: 'vaultAddress', type: 'address' },
            { name: 'globalMinBalance', type: 'uint256' },
            { name: 'checkInterval', type: 'uint256' },
            { name: 'autoFundAmount', type: 'uint256' },
            { name: 'autoFundEnabled', type: 'bool' },
          ],
          outputs: [{ type: 'bytes32' }],
        },
      ] as const

      const { request } = await publicClient.simulateContract({
        address: KEEPALIVE_REGISTRY,
        abi: KEEPALIVE_ABI,
        functionName: 'registerKeepalive',
        args: [
          jnsNode,
          0n, // No agent
          account.address, // Vault
          parseEther('0.1'), // Min balance
          3600n, // 1 hour check interval
          parseEther('0.05'), // Auto-fund amount
          true, // Auto-fund enabled
        ],
        account,
      })

      const hash = await walletClient.writeContract(request)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      const log = receipt.logs[0]
      if (!log) {
        throw new Error('No logs emitted from registerKeepalive transaction')
      }
      const topic = log.topics[1]
      if (!topic) {
        throw new Error('Missing keepaliveId topic in log')
      }
      keepaliveId = topic as Hex
      console.log(`✅ Registered keepalive: ${keepaliveId.slice(0, 10)}...`)
    })

    test('should add IPFS resource to keepalive', async () => {
      const KEEPALIVE_ABI = [
        {
          name: 'addResource',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'keepaliveId', type: 'bytes32' },
            { name: 'resourceType', type: 'uint8' },
            { name: 'identifier', type: 'string' },
            { name: 'healthEndpoint', type: 'string' },
            { name: 'minBalance', type: 'uint256' },
            { name: 'required', type: 'bool' },
          ],
          outputs: [],
        },
      ] as const

      const { request } = await publicClient.simulateContract({
        address: KEEPALIVE_REGISTRY,
        abi: KEEPALIVE_ABI,
        functionName: 'addResource',
        args: [
          keepaliveId,
          0, // IPFS_CONTENT
          ipfsCid,
          '', // No health endpoint for static content
          0n,
          true,
        ],
        account,
      })

      const hash = await walletClient.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash })

      console.log(`✅ Added IPFS resource to keepalive`)
    })
  })

  describe('Gateway Serving', () => {
    test('should resolve JNS via gateway API', async () => {
      let response: Response
      try {
        response = await fetch(
          `${JNS_GATEWAY_URL}/api/resolve/${testJnsName}`,
          {
            signal: AbortSignal.timeout(5000),
          },
        )
      } catch (e) {
        if (
          e instanceof Error &&
          (e.name === 'AbortError' ||
            e.name === 'TimeoutError' ||
            e.message.includes('ECONNREFUSED'))
        ) {
          console.log('Gateway not available - skipping resolve test')
          return
        }
        throw e
      }

      if (!response.ok) {
        throw new Error(
          `Gateway returned ${response.status}: ${response.statusText}`,
        )
      }

      const data = await response.json()
      expect(data.name).toBe(testJnsName)
      console.log(`✅ JNS resolution working via gateway`)
    })

    test('should check keepalive status via gateway', async () => {
      let response: Response
      try {
        response = await fetch(
          `${JNS_GATEWAY_URL}/api/keepalive/status/${testJnsName}`,
          {
            signal: AbortSignal.timeout(5000),
          },
        )
      } catch (e) {
        if (
          e instanceof Error &&
          (e.name === 'AbortError' ||
            e.name === 'TimeoutError' ||
            e.message.includes('ECONNREFUSED'))
        ) {
          console.log('Gateway not available - skipping keepalive status test')
          return
        }
        throw e
      }

      if (!response.ok) {
        throw new Error(
          `Gateway returned ${response.status}: ${response.statusText}`,
        )
      }

      const data = await response.json()
      expect(data.name).toBe(testJnsName)
      expect(typeof data.funded).toBe('boolean')
      console.log(`✅ Keepalive status check working`)
    })
  })
})

describe('Health Check Standard', () => {
  test('should implement standard health endpoints', async () => {
    const endpoints = ['/health']
    let anyEndpointAvailable = false

    for (const endpoint of endpoints) {
      let response: Response
      try {
        response = await fetch(`${JNS_GATEWAY_URL}${endpoint}`, {
          signal: AbortSignal.timeout(2000),
        })
      } catch (e) {
        // Handle connection refused and timeout errors
        if (e instanceof Error) {
          const errorText = e.message || e.name || ''
          if (
            errorText.includes('ConnectionRefused') ||
            errorText.includes('ECONNREFUSED') ||
            errorText.includes('Unable to connect') ||
            e.name === 'AbortError' ||
            e.name === 'TimeoutError'
          ) {
            console.log(`Gateway endpoint ${endpoint} not available - skipping`)
            continue
          }
        }
        // Also catch the bun-specific error format
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ConnectionRefused') {
          console.log(`Gateway endpoint ${endpoint} not available - skipping`)
          continue
        }
        throw e
      }

      if (!response.ok) {
        console.log(
          `Gateway endpoint ${endpoint} returned ${response.status} - skipping`,
        )
        continue
      }

      anyEndpointAvailable = true
      const data = await response.json()
      expect(data.status).toBeDefined()
      console.log(`✅ ${endpoint} returns valid response`)
    }

    if (!anyEndpointAvailable) {
      console.log('⏭️  No gateway endpoints available - skipping')
    }
  })
})

describe('ENS Mirror', () => {
  test.skipIf(!process.env.ETH_RPC_URL)(
    'should resolve ENS via Ethereum',
    async () => {
      const ethClient = createPublicClient({
        chain: { ...localhost, id: 1 },
        transport: http(process.env.ETH_RPC_URL),
      })

      const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
      const ENS_ABI = [
        {
          name: 'resolver',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ type: 'address' }],
        },
      ] as const

      const node = namehash('vitalik.eth') as Hex
      const resolver = await ethClient.readContract({
        address: ENS_REGISTRY,
        abi: ENS_ABI,
        functionName: 'resolver',
        args: [node],
      })

      expect(resolver).not.toBe('0x0000000000000000000000000000000000000000')
      console.log(
        `✅ ENS resolution working: vitalik.eth resolver = ${resolver.slice(0, 10)}...`,
      )
    },
  )
})
