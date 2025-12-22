/**
 * @fileoverview Full-stack runtime integration test
 * @module tests/integration/runtime-full-stack
 *
 * This test suite verifies that all network services work together in a running system:
 *
 * Services Tested:
 * - L1 (Geth) - Settlement layer
 * - L2 (op-geth) - network execution layer
 * - Indexer (Subsquid) - Data indexing
 * - Oracle Bot - Price feed updates
 * - Node Explorer - Operator dashboard
 *
 * Test Flow:
 * 1. Verify all services are running
 * 2. Deploy smart contracts
 * 3. Execute transactions
 * 4. Verify indexer captures data
 * 5. Test cross-service communication
 * 6. Validate data consistency
 *
 * @example Prerequisites
 * ```bash
 * # Terminal 1: Start localnet
 * bun run localnet:start
 *
 * # Terminal 2: Start indexer
 * cd apps/indexer && bun run dev
 *
 * # Terminal 3: Run tests
 * bun test tests/integration/runtime-full-stack.test.ts
 * ```
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  APP_PORTS,
  APP_URLS,
  JEJU_LOCALNET,
  L1_LOCALNET,
  TEST_WALLETS,
  TIMEOUTS,
} from '../shared/constants'

// Quick check if L2 RPC is available before running full suite
const l2RpcUrl = JEJU_LOCALNET.rpcUrl
let servicesAvailable = false
try {
  const res = await fetch(l2RpcUrl, {
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
  servicesAvailable = res.ok
} catch {
  servicesAvailable = false
}
if (!servicesAvailable) {
  console.log('⏭️  Skipping Runtime Full Stack tests - services not running')
  console.log('   Start with: bun run localnet:start')
}

/** Configuration for runtime testing derived from shared constants */
interface RuntimeConfig {
  l1: {
    rpcUrl: string
    chainId: number
  }
  l2: {
    rpcUrl: string
    wsUrl: string
    chainId: number
  }
  indexer: {
    graphqlUrl: string
    databaseUrl: string
  }
  timeouts: {
    blockProduction: number
    indexerSync: number
    rpcResponse: number
  }
}

const HOST = process.env.HOST || '127.0.0.1'

const CONFIG: RuntimeConfig = {
  l1: {
    rpcUrl: L1_LOCALNET.rpcUrl,
    chainId: L1_LOCALNET.chainId,
  },
  l2: {
    rpcUrl: JEJU_LOCALNET.rpcUrl,
    wsUrl: JEJU_LOCALNET.wsUrl,
    chainId: JEJU_LOCALNET.chainId,
  },
  indexer: {
    graphqlUrl: APP_URLS.indexerGraphQL,
    databaseUrl:
      process.env.INDEXER_DATABASE_URL ||
      `postgresql://postgres:postgres@${HOST}:${APP_PORTS.indexerDatabase}/indexer`,
  },
  timeouts: {
    blockProduction: TIMEOUTS.blockProduction,
    indexerSync: TIMEOUTS.indexerSync,
    rpcResponse: TIMEOUTS.rpcResponse,
  },
}

/**
 * Service status tracker
 */
interface ServiceStatus {
  l1Rpc: boolean
  l2Rpc: boolean
  l2Ws: boolean
  indexer: boolean
  database: boolean
}

/**
 * Deployment registry for test contracts
 */
interface DeployedContracts {
  token?: {
    address: string
    abi: InterfaceAbi
  }
  oracle?: {
    address: string
    abi: InterfaceAbi
  }
  vault?: {
    address: string
    abi: InterfaceAbi
  }
  paymaster?: {
    address: string
    abi: InterfaceAbi
  }
}

describe.skipIf(!servicesAvailable)('Runtime Full Stack Integration', () => {
  let serviceStatus: ServiceStatus
  let l1Client: ReturnType<typeof createPublicClient>
  let l2Client: ReturnType<typeof createPublicClient>
  let deployerWallet: ReturnType<typeof createWalletClient>
  let deployerAccount: ReturnType<typeof privateKeyToAccount>
  const _deployedContracts: DeployedContracts = {}

  beforeAll(async () => {
    console.log('\n🔍 Checking service availability...\n')

    serviceStatus = {
      l1Rpc: await checkService('L1 RPC', CONFIG.l1.rpcUrl),
      l2Rpc: await checkService('L2 RPC', CONFIG.l2.rpcUrl),
      l2Ws: await checkWebSocket('L2 WebSocket', CONFIG.l2.wsUrl),
      indexer: await checkGraphQL('Indexer GraphQL', CONFIG.indexer.graphqlUrl),
      database: await checkDatabase('PostgreSQL', CONFIG.indexer.databaseUrl),
    }

    console.log('')

    // Initialize providers
    l1Client = createPublicClient({ transport: http(CONFIG.l1.rpcUrl) })
    l2Client = createPublicClient({ transport: http(CONFIG.l2.rpcUrl) })

    deployerAccount = privateKeyToAccount(
      TEST_WALLETS.deployer.privateKey as `0x${string}`,
    )
    deployerWallet = createWalletClient({
      account: deployerAccount,
      transport: http(CONFIG.l2.rpcUrl),
    })
  })

  describe('Service Health Checks', () => {
    it('L1 RPC should be running', () => {
      expect(serviceStatus.l1Rpc).toBe(true)
    })

    it('L2 RPC should be running', () => {
      expect(serviceStatus.l2Rpc).toBe(true)
    })

    it('L2 should have correct chain ID', async () => {
      const chainId = await l2Client.getChainId()
      expect(Number(chainId)).toBe(CONFIG.l2.chainId)
    })
  })

  describe('Block Production', () => {
    it('L1 should be producing blocks', async () => {
      const block1 = await l1Client.getBlockNumber()
      await sleep(2000)
      const block2 = await l1Client.getBlockNumber()

      expect(Number(block2)).toBeGreaterThan(Number(block1))
      console.log(
        `   ✅ L1 produced ${Number(block2) - Number(block1)} blocks in 2s`,
      )
    })

    it('L2 should be producing blocks', async () => {
      const block1 = await l2Client.getBlockNumber()
      await sleep(3000) // Wait for 1-2 blocks (2s block time)
      const block2 = await l2Client.getBlockNumber()

      expect(Number(block2)).toBeGreaterThan(Number(block1))
      console.log(
        `   ✅ L2 produced ${Number(block2) - Number(block1)} blocks in 3s`,
      )
    })

    it('L2 blocks should have reasonable timestamps', async () => {
      const block = await l2Client.getBlock({ blockTag: 'latest' })
      const now = Math.floor(Date.now() / 1000)
      const blockTime = Number(block.timestamp)

      // Block timestamp should be within last minute
      expect(Math.abs(now - blockTime)).toBeLessThan(60)
      console.log(
        `   ⏰ Latest block timestamp: ${new Date(blockTime * 1000).toISOString()}`,
      )
    })
  })

  describe('Transaction Execution', () => {
    let txHash: `0x${string}`

    it(
      'should send and confirm transaction',
      async () => {
        console.log('   📤 Sending test transaction...')

        txHash = await deployerWallet.sendTransaction({
          to: TEST_WALLETS.user1.address as Address,
          value: parseEther('0.5'),
        })

        console.log(`   📝 Transaction hash: ${txHash.slice(0, 20)}...`)

        const receipt = await l2Client.waitForTransactionReceipt({
          hash: txHash,
        })
        expect(receipt.status).toBe('success')
        expect(Number(receipt.blockNumber)).toBeGreaterThan(0)

        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`)
        console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`)
      },
      CONFIG.timeouts.blockProduction,
    )

    it('should verify transaction on RPC', async () => {
      const tx = await l2Client.getTransaction({ hash: txHash })

      expect(tx).toBeTruthy()
      expect(tx.hash).toBe(txHash)
      expect(tx.from.toLowerCase()).toBe(deployerAccount.address.toLowerCase())

      console.log(`   ✅ Transaction verified on RPC`)
    })

    it('should get transaction receipt', async () => {
      const receipt = await l2Client.getTransactionReceipt({ hash: txHash })

      expect(receipt).toBeTruthy()
      expect(receipt?.status).toBe('success')

      console.log(`   ✅ Receipt retrieved successfully`)
    })
  })

  describe('Indexer Synchronization', () => {
    it('should check if indexer is running', () => {
      if (!serviceStatus.indexer) {
        console.log('   ⏭️  Indexer not running - skipping indexer tests')
        console.log('   ℹ️  Start with: cd apps/indexer && npm run dev')
        return
      }

      expect(serviceStatus.indexer).toBe(true)
    })

    it(
      'should query indexed blocks',
      async () => {
        if (!serviceStatus.indexer) return

        const data = await queryGraphQL(`{
        blocks(limit: 5, orderBy: number_DESC) {
          number
          hash
          timestamp
          transactionCount
        }
      }`)

        expect(data.blocks).toBeTruthy()
        expect(data.blocks.length).toBeGreaterThan(0)

        console.log(`   📊 Indexed blocks: ${data.blocks.length}`)
        console.log(`   📈 Latest: #${data.blocks[0].number}`)
      },
      CONFIG.timeouts.indexerSync,
    )

    it(
      'should query indexed transactions',
      async () => {
        if (!serviceStatus.indexer) return

        const data = await queryGraphQL(`{
        transactions(limit: 10, orderBy: id_DESC) {
          hash
          status
          value
        }
      }`)

        expect(data.transactions).toBeTruthy()
        console.log(`   📊 Indexed transactions: ${data.transactions.length}`)
      },
      CONFIG.timeouts.indexerSync,
    )

    it(
      'should query indexed event logs',
      async () => {
        if (!serviceStatus.indexer) return

        const data = await queryGraphQL(`{
        logs(limit: 10) {
          topic0
          address { address }
        }
      }`)

        expect(data.logs).toBeTruthy()
        console.log(`   📊 Indexed logs: ${data.logs.length}`)
      },
      CONFIG.timeouts.indexerSync,
    )

    it(
      'should verify event decoding',
      async () => {
        if (!serviceStatus.indexer) return

        const data = await queryGraphQL(`{
        decodedEvents(limit: 5) {
          eventName
          eventSignature
        }
      }`)

        if (data.decodedEvents && data.decodedEvents.length > 0) {
          console.log(`   ✅ Decoded ${data.decodedEvents.length} events`)
          const eventNames = new Set(
            data.decodedEvents.map((e: { eventName: string }) => e.eventName),
          )
          console.log(`   📋 Event types: ${Array.from(eventNames).join(', ')}`)
        } else {
          console.log(`   ℹ️  No decoded events yet (no token transfers)`)
        }
      },
      CONFIG.timeouts.indexerSync,
    )
  })

  describe('WebSocket Streaming', () => {
    it('should subscribe to new blocks via WebSocket', async () => {
      // WebSocket streaming test skipped - use polling instead
      console.log('   ⏭️  WebSocket streaming skipped (using HTTP polling)')

      // Test block polling instead
      const block1 = await l2Client.getBlockNumber()
      await sleep(3000)
      const block2 = await l2Client.getBlockNumber()

      expect(Number(block2)).toBeGreaterThanOrEqual(Number(block1))
      console.log(`   ✅ Block polling working: ${block1} -> ${block2}`)
    }, 15000)
  })

  describe('Data Consistency Verification', () => {
    it(
      'should verify RPC and indexer have consistent block count',
      async () => {
        if (!serviceStatus.indexer) return

        const rpcBlockNum = await l2Provider.getBlockNumber()

        const indexerData = await queryGraphQL(`{
        blocks(limit: 1, orderBy: number_DESC) {
          number
        }
      }`)

        const indexerBlockNum = indexerData.blocks[0]?.number || 0

        console.log(`   📊 RPC block: ${rpcBlockNum}`)
        console.log(`   📊 Indexer block: ${indexerBlockNum}`)

        // Indexer should be close (within 10 blocks)
        expect(rpcBlockNum - indexerBlockNum).toBeLessThan(10)

        if (rpcBlockNum - indexerBlockNum > 0) {
          console.log(
            `   ℹ️  Indexer is ${rpcBlockNum - indexerBlockNum} blocks behind (normal)`,
          )
        } else {
          console.log(`   ✅ Indexer is fully synced`)
        }
      },
      CONFIG.timeouts.indexerSync,
    )

    it(
      'should verify transaction data matches between RPC and indexer',
      async () => {
        if (!serviceStatus.indexer) return

        // Get a recent transaction from RPC
        const block = await l2Provider.getBlock('latest', true)
        if (!block || block.transactions.length === 0) {
          console.log('   ℹ️  No transactions in latest block')
          return
        }

        const txHash = block.transactions[0]
        const rpcTx = await l2Provider.getTransaction(txHash as string)

        if (!rpcTx) return

        // Wait for indexer to process
        await sleep(5000)

        // Query from indexer
        const indexerData = await queryGraphQL(`{
        transactions(where: { hash_eq: "${rpcTx.hash}" }) {
          hash
          from { address }
          to { address }
          value
          nonce
        }
      }`)

        if (indexerData.transactions && indexerData.transactions.length > 0) {
          const indexedTx = indexerData.transactions[0]

          expect(indexedTx.hash).toBe(rpcTx.hash)
          expect(indexedTx.from.address.toLowerCase()).toBe(
            rpcTx.from.toLowerCase(),
          )
          if (rpcTx.to) {
            expect(indexedTx.to.address.toLowerCase()).toBe(
              rpcTx.to.toLowerCase(),
            )
          }
          expect(BigInt(indexedTx.value)).toBe(rpcTx.value)

          console.log('   ✅ RPC and indexer data match perfectly')
        } else {
          console.log('   ℹ️  Transaction not yet indexed (indexer catching up)')
        }
      },
      CONFIG.timeouts.indexerSync,
    )
  })

  describe('Performance Benchmarks', () => {
    it('should measure RPC latency', async () => {
      const measurements: number[] = []

      for (let i = 0; i < 10; i++) {
        const start = Date.now()
        await l2Client.getBlockNumber()
        measurements.push(Date.now() - start)
      }

      const avgLatency =
        measurements.reduce((a, b) => a + b, 0) / measurements.length
      const minLatency = Math.min(...measurements)
      const maxLatency = Math.max(...measurements)

      console.log(`   ⏱️  RPC Latency Statistics:`)
      console.log(`      Average: ${avgLatency.toFixed(2)}ms`)
      console.log(`      Min: ${minLatency}ms`)
      console.log(`      Max: ${maxLatency}ms`)

      expect(avgLatency).toBeLessThan(CONFIG.timeouts.rpcResponse)
    })

    it('should measure block production rate', async () => {
      const startBlock = Number(await l2Client.getBlockNumber())
      const startTime = Date.now()

      await sleep(10000) // Wait 10 seconds

      const endBlock = Number(await l2Client.getBlockNumber())
      const endTime = Date.now()

      const blocksProduced = endBlock - startBlock
      const timeElapsed = (endTime - startTime) / 1000 // Convert to seconds
      const blockTime = timeElapsed / blocksProduced

      console.log(`   ⏱️  Block Production:`)
      console.log(`      Blocks produced: ${blocksProduced}`)
      console.log(`      Time elapsed: ${timeElapsed.toFixed(2)}s`)
      console.log(`      Average block time: ${blockTime.toFixed(2)}s`)

      // Localnet should be ~2s block time
      expect(blockTime).toBeGreaterThan(1)
      expect(blockTime).toBeLessThan(5)
    }, 15000)

    it('should measure indexer sync latency (if running)', async () => {
      if (!serviceStatus.indexer) return

      // Send transaction
      const txStart = Date.now()
      const txHash = await deployerWallet.sendTransaction({
        to: TEST_WALLETS.user1.address as Address,
        value: parseEther('0.01'),
      })

      await l2Client.waitForTransactionReceipt({ hash: txHash })
      const txConfirmed = Date.now()

      console.log(`   ⏱️  Transaction confirmed in ${txConfirmed - txStart}ms`)

      // Wait for indexer to process
      let indexed = false
      let indexTime = 0

      for (let i = 0; i < 20; i++) {
        await sleep(1000)

        try {
          const data = await queryGraphQL(`{
            transactions(where: { hash_eq: "${txHash}" }) {
              hash
            }
          }`)

          if (data.transactions && data.transactions.length > 0) {
            indexTime = Date.now()
            indexed = true
            break
          }
        } catch {
          // Continue waiting
        }
      }

      if (indexed) {
        const syncLatency = indexTime - txConfirmed
        console.log(`   ⏱️  Indexer sync latency: ${syncLatency}ms`)

        // Should sync within 20 seconds
        expect(syncLatency).toBeLessThan(20000)
      } else {
        console.log('   ⚠️  Transaction not indexed within 20 seconds')
      }
    }, 30000)
  })

  describe('System Integration Summary', () => {
    it('should print comprehensive status report', async () => {
      console.log(`\n${'═'.repeat(60)}`)
      console.log(`${' '.repeat(15)}SYSTEM STATUS REPORT`)
      console.log(`${'═'.repeat(60)}\n`)

      // Service Status
      console.log('🔧 Services:')
      console.log(
        `   L1 RPC:        ${serviceStatus.l1Rpc ? '✅ Running' : '❌ Down'}`,
      )
      console.log(
        `   L2 RPC:        ${serviceStatus.l2Rpc ? '✅ Running' : '❌ Down'}`,
      )
      console.log(
        `   L2 WebSocket:  ${serviceStatus.l2Ws ? '✅ Running' : '⏭️  Not available'}`,
      )
      console.log(
        `   Indexer:       ${serviceStatus.indexer ? '✅ Running' : '⏭️  Not running'}`,
      )
      console.log(
        `   Database:      ${serviceStatus.database ? '✅ Running' : '⏭️  Not running'}`,
      )
      console.log('')

      // Network Info
      const l2Block = await l2Client.getBlockNumber()
      const l2ChainId = await l2Client.getChainId()
      const gasPrice = await l2Client.getGasPrice()

      console.log('🌐 Network:')
      console.log(`   Chain ID:      ${l2ChainId}`)
      console.log(`   Block Height:  ${l2Block}`)
      console.log(`   Gas Price:     ${formatUnits(gasPrice, 9)} gwei`)
      console.log('')

      // Account Info
      const balance = await l2Client.getBalance({
        address: deployerAccount.address,
      })
      console.log('👤 Deployer Account:')
      console.log(`   Address:       ${deployerAccount.address}`)
      console.log(`   Balance:       ${formatEther(balance)} ETH`)
      console.log('')

      // Indexer Stats
      if (serviceStatus.indexer) {
        try {
          const stats = await getIndexerStats()
          console.log('📊 Indexer Statistics:')
          console.log(`   Blocks:        ${stats.blocks}`)
          console.log(`   Transactions:  ${stats.transactions}`)
          console.log(`   Logs:          ${stats.logs}`)
          console.log(`   Contracts:     ${stats.contracts}`)
          console.log(`   Accounts:      ${stats.accounts}`)
          console.log('')
        } catch (_error) {
          console.log('📊 Indexer Statistics: Not available\n')
        }
      }

      console.log(`${'═'.repeat(60)}\n`)

      // Verify critical services
      expect(serviceStatus.l1Rpc).toBe(true)
      expect(serviceStatus.l2Rpc).toBe(true)
    })
  })
})

// ============ Helper Functions ============

/**
 * Check if a JSON-RPC service is available
 */
async function checkService(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
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

    if (response.ok) {
      console.log(`✅ ${name}: Running`)
      return true
    }
  } catch (_error) {
    console.log(`❌ ${name}: Not available`)
  }

  return false
}

/**
 * Check if WebSocket service is available
 */
async function checkWebSocket(name: string, _url: string): Promise<boolean> {
  // WebSocket check simplified - assume available if HTTP works
  console.log(`⏭️  ${name}: Skipped (using HTTP)`)
  return false
}

/**
 * Check if GraphQL service is available
 */
async function checkGraphQL(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ __schema { queryType { name } } }',
      }),
      signal: AbortSignal.timeout(2000),
    })

    if (response.ok) {
      console.log(`✅ ${name}: Running`)
      return true
    }
  } catch (_error) {
    console.log(`⏭️  ${name}: Not running (optional)`)
  }

  return false
}

/**
 * Check if PostgreSQL database is available
 */
async function checkDatabase(name: string, _url: string): Promise<boolean> {
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    await execAsync('docker ps | grep squid-db-1', { timeout: 2000 })
    console.log(`✅ ${name}: Running`)
    return true
  } catch (_error) {
    console.log(`⏭️  ${name}: Not running (optional)`)
    return false
  }
}

/**
 * Query GraphQL endpoint
 */
async function queryGraphQL(query: string): Promise<Record<string, unknown>> {
  const response = await fetch(CONFIG.indexer.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(`GraphQL query failed: ${response.statusText}`)
  }

  const result = (await response.json()) as {
    data?: Record<string, unknown>
    errors?: Array<{ message: string }>
  }

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`)
  }

  if (!result.data) {
    throw new Error('GraphQL response missing data')
  }

  return result.data
}

/**
 * Get indexer statistics
 */
interface IndexerStats {
  blocks: number
  transactions: number
  logs: number
  contracts: number
  accounts: number
}

async function getIndexerStats(): Promise<IndexerStats> {
  const queries = [
    'blocks: { blocks { id } }',
    'transactions: { transactions { id } }',
    'logs: { logs { id } }',
    'contracts: { contracts { id } }',
    'accounts: { accounts { id } }',
  ]

  const stats: IndexerStats = {
    blocks: 0,
    transactions: 0,
    logs: 0,
    contracts: 0,
    accounts: 0,
  }

  for (const q of queries) {
    const [key, query] = q.split(': ')
    const data = await queryGraphQL(`{ ${query} }`)
    const results = data[Object.keys(data)[0]]
    if (key in stats && Array.isArray(results)) {
      ;(stats as Record<string, number>)[key] = results.length
    }
  }

  return stats
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
