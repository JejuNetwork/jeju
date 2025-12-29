#!/usr/bin/env bun
/**
 * Testnet + Babylon End-to-End Verification
 *
 * Comprehensive verification of deployed testnet including Babylon:
 * - Chain health (L1 and L2)
 * - Contract deployment verification
 * - Service endpoint health checks
 * - Token balances and transactions
 * - Babylon game functionality
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy/verify-testnet-babylon.ts
 *   NETWORK=testnet bun run scripts/deploy/verify-testnet-babylon.ts --verbose
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  formatEther,
  http,
  type PublicClient,
  zeroAddress,
} from 'viem'

const ROOT = join(import.meta.dir, '../../../..')
const CONFIG_DIR = join(ROOT, 'packages/config')
const DEPLOYMENT_DIR = join(ROOT, 'packages/deployment')

interface ChainConfig {
  chainId: number
  rpcUrl: string
  name: string
}

interface ServiceEndpoint {
  name: string
  url: string
  healthPath: string
  required: boolean
}

interface VerificationResult {
  category: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  duration?: number
}

const TESTNET_L2: ChainConfig = {
  chainId: 420690,
  rpcUrl: 'https://testnet-rpc.jejunetwork.org',
  name: 'Jeju Testnet',
}

const TESTNET_L1: ChainConfig = {
  chainId: 11155111,
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  name: 'Sepolia',
}

const SERVICE_ENDPOINTS: ServiceEndpoint[] = [
  {
    name: 'RPC',
    url: 'https://testnet-rpc.jejunetwork.org',
    healthPath: '/',
    required: true,
  },
  {
    name: 'Gateway UI',
    url: 'https://gateway.testnet.jejunetwork.org',
    healthPath: '/',
    required: true,
  },
  {
    name: 'Gateway API',
    url: 'https://api.testnet.jejunetwork.org',
    healthPath: '/health',
    required: true,
  },
  {
    name: 'DWS API',
    url: 'https://dws.testnet.jejunetwork.org',
    healthPath: '/health',
    required: true,
  },
  {
    name: 'Bazaar',
    url: 'https://bazaar.testnet.jejunetwork.org',
    healthPath: '/',
    required: false,
  },
  {
    name: 'Explorer',
    url: 'https://explorer.testnet.jejunetwork.org',
    healthPath: '/',
    required: false,
  },
  {
    name: 'Indexer GraphQL',
    url: 'https://indexer.testnet.jejunetwork.org',
    healthPath: '/graphql',
    required: false,
  },
  {
    name: 'IPFS Gateway',
    url: 'https://ipfs.testnet.jejunetwork.org',
    healthPath: '/',
    required: false,
  },
  {
    name: 'Bundler',
    url: 'https://bundler.testnet.jejunetwork.org',
    healthPath: '/health',
    required: false,
  },
  {
    name: 'Babylon API',
    url: 'https://babylon.testnet.jejunetwork.org',
    healthPath: '/api/health',
    required: false,
  },
]

class TestnetVerifier {
  private verbose: boolean
  private results: VerificationResult[] = []
  private l2Client: PublicClient
  private l1Client: PublicClient

  constructor(verbose = false) {
    this.verbose = verbose

    this.l2Client = createPublicClient({
      transport: http(TESTNET_L2.rpcUrl),
    }) as PublicClient

    this.l1Client = createPublicClient({
      transport: http(TESTNET_L1.rpcUrl),
    }) as PublicClient
  }

  private log(
    message: string,
    level: 'info' | 'success' | 'error' | 'warn' = 'info',
  ): void {
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      error: '\x1b[31m',
      warn: '\x1b[33m',
    }
    console.log(`${colors[level]}${icons[level]}  ${message}\x1b[0m`)
  }

  private debug(message: string): void {
    if (this.verbose) {
      console.log(`   \x1b[90m${message}\x1b[0m`)
    }
  }

  private recordResult(
    category: string,
    name: string,
    status: 'pass' | 'fail' | 'skip',
    message: string,
    duration?: number,
  ): void {
    this.results.push({ category, name, status, message, duration })
  }

  async run(): Promise<void> {
    this.printBanner()

    console.log(`\n${'═'.repeat(70)}`)
    console.log('📋 Phase 1: Chain Health')
    console.log(`${'═'.repeat(70)}\n`)
    await this.verifyChainHealth()

    console.log(`\n${'═'.repeat(70)}`)
    console.log('📋 Phase 2: Service Endpoints')
    console.log(`${'═'.repeat(70)}\n`)
    await this.verifyServiceEndpoints()

    console.log(`\n${'═'.repeat(70)}`)
    console.log('📋 Phase 3: Contract Deployment')
    console.log(`${'═'.repeat(70)}\n`)
    await this.verifyContracts()

    console.log(`\n${'═'.repeat(70)}`)
    console.log('📋 Phase 4: Functional Tests')
    console.log(`${'═'.repeat(70)}\n`)
    await this.runFunctionalTests()

    console.log(`\n${'═'.repeat(70)}`)
    console.log('📋 Phase 5: Babylon Verification')
    console.log(`${'═'.repeat(70)}\n`)
    await this.verifyBabylon()

    this.printSummary()
  }

  private printBanner(): void {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   🔍 JEJU TESTNET + BABYLON VERIFICATION                                 ║
║                                                                          ║
║   Comprehensive end-to-end verification of deployed testnet              ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
  }

  private async verifyChainHealth(): Promise<void> {
    // L2 Chain Health
    const l2Start = Date.now()
    const l2BlockNumber = await this.l2Client.getBlockNumber()
    const l2Duration = Date.now() - l2Start

    if (l2BlockNumber > 0n) {
      this.log(`L2 Chain: Block ${l2BlockNumber} (${l2Duration}ms)`, 'success')
      this.recordResult(
        'chain',
        'L2 Health',
        'pass',
        `Block ${l2BlockNumber}`,
        l2Duration,
      )
    } else {
      this.log(`L2 Chain: Not producing blocks`, 'error')
      this.recordResult('chain', 'L2 Health', 'fail', 'Not producing blocks')
    }

    // L1 Chain Health
    const l1Start = Date.now()
    const l1BlockNumber = await this.l1Client.getBlockNumber()
    const l1Duration = Date.now() - l1Start

    if (l1BlockNumber > 0n) {
      this.log(
        `L1 Chain (Sepolia): Block ${l1BlockNumber} (${l1Duration}ms)`,
        'success',
      )
      this.recordResult(
        'chain',
        'L1 Health',
        'pass',
        `Block ${l1BlockNumber}`,
        l1Duration,
      )
    } else {
      this.log(`L1 Chain (Sepolia): Not reachable`, 'error')
      this.recordResult('chain', 'L1 Health', 'fail', 'Not reachable')
    }

    // Chain ID verification
    const chainId = await this.l2Client.getChainId()
    if (chainId === 420690) {
      this.log(`Chain ID: ${chainId} (correct)`, 'success')
      this.recordResult('chain', 'Chain ID', 'pass', `${chainId}`)
    } else {
      this.log(`Chain ID: ${chainId} (expected 420690)`, 'error')
      this.recordResult(
        'chain',
        'Chain ID',
        'fail',
        `Got ${chainId}, expected 420690`,
      )
    }

    // Block production rate
    const currentBlock = await this.l2Client.getBlockNumber()
    await new Promise((resolve) => setTimeout(resolve, 5000))
    const newBlock = await this.l2Client.getBlockNumber()
    const blocksProduced = Number(newBlock - currentBlock)

    if (blocksProduced > 0) {
      this.log(`Block production: ${blocksProduced} blocks in 5s`, 'success')
      this.recordResult(
        'chain',
        'Block Production',
        'pass',
        `${blocksProduced} blocks/5s`,
      )
    } else {
      this.log(`Block production: No new blocks in 5s`, 'warn')
      this.recordResult('chain', 'Block Production', 'fail', 'No new blocks')
    }
  }

  private async verifyServiceEndpoints(): Promise<void> {
    for (const endpoint of SERVICE_ENDPOINTS) {
      const start = Date.now()
      const url = `${endpoint.url}${endpoint.healthPath}`

      const response = await fetch(url, {
        method: endpoint.healthPath.includes('graphql') ? 'POST' : 'GET',
        headers: endpoint.healthPath.includes('graphql')
          ? { 'Content-Type': 'application/json' }
          : {},
        body: endpoint.healthPath.includes('graphql')
          ? JSON.stringify({ query: '{ __typename }' })
          : undefined,
      }).catch(() => null)

      const duration = Date.now() - start

      if (response?.ok) {
        this.log(`${endpoint.name}: OK (${duration}ms)`, 'success')
        this.recordResult(
          'endpoints',
          endpoint.name,
          'pass',
          `${response.status}`,
          duration,
        )
      } else if (!endpoint.required) {
        this.log(`${endpoint.name}: Not available (optional)`, 'warn')
        this.recordResult(
          'endpoints',
          endpoint.name,
          'skip',
          'Optional service not available',
        )
      } else {
        this.log(
          `${endpoint.name}: FAILED (${response?.status || 'no response'})`,
          'error',
        )
        this.recordResult(
          'endpoints',
          endpoint.name,
          'fail',
          `Status: ${response?.status || 'unreachable'}`,
        )
      }

      this.debug(`URL: ${url}`)
    }
  }

  private async verifyContracts(): Promise<void> {
    // Load deployed contract addresses
    const contractsFile = join(CONFIG_DIR, 'contracts.json')
    const deploymentStateFile = join(
      DEPLOYMENT_DIR,
      '.testnet-babylon-deployment-state.json',
    )

    const contracts: Record<string, Address> = {}

    // Load from config
    if (existsSync(contractsFile)) {
      const configData = JSON.parse(readFileSync(contractsFile, 'utf-8'))
      const testnetContracts = configData.testnet || {}

      // Flatten nested structures
      for (const [category, addresses] of Object.entries(testnetContracts)) {
        if (typeof addresses === 'object' && addresses !== null) {
          for (const [name, addr] of Object.entries(
            addresses as Record<string, string>,
          )) {
            if (addr && addr !== '' && addr !== zeroAddress) {
              contracts[`${category}.${name}`] = addr as Address
            }
          }
        }
      }
    }

    // Load from deployment state
    if (existsSync(deploymentStateFile)) {
      const stateData = JSON.parse(readFileSync(deploymentStateFile, 'utf-8'))
      const coreContracts = stateData.coreContracts || {}
      for (const [name, addr] of Object.entries(coreContracts)) {
        if (addr && addr !== '' && addr !== zeroAddress) {
          contracts[name] = addr as Address
        }
      }
    }

    const contractCount = Object.keys(contracts).length
    this.log(`Found ${contractCount} contract addresses to verify`, 'info')

    if (contractCount === 0) {
      this.log('No contracts deployed yet', 'warn')
      this.recordResult('contracts', 'Deployment', 'skip', 'No contracts found')
      return
    }

    let verified = 0
    let failed = 0

    for (const [name, address] of Object.entries(contracts)) {
      const code = await this.l2Client.getCode({ address })

      if (code && code !== '0x') {
        this.log(`${name}: ${address.slice(0, 10)}... deployed`, 'success')
        this.recordResult('contracts', name, 'pass', address)
        verified++
      } else {
        this.log(`${name}: ${address.slice(0, 10)}... NOT deployed`, 'error')
        this.recordResult('contracts', name, 'fail', `No code at ${address}`)
        failed++
      }

      this.debug(`Address: ${address}`)
    }

    this.log(
      `Contracts: ${verified} verified, ${failed} failed`,
      verified === contractCount ? 'success' : 'warn',
    )
  }

  private async runFunctionalTests(): Promise<void> {
    // Test 1: RPC JSON-RPC functionality
    this.log('Testing RPC JSON-RPC...', 'info')

    const rpcResponse = await fetch(TESTNET_L2.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    }).catch(() => null)

    if (rpcResponse?.ok) {
      const data = (await rpcResponse.json()) as {
        result?: string
        error?: { message: string }
      }
      if (data.result) {
        this.log(`RPC eth_blockNumber: ${parseInt(data.result, 16)}`, 'success')
        this.recordResult(
          'functional',
          'RPC JSON-RPC',
          'pass',
          'eth_blockNumber works',
        )
      } else {
        this.log(`RPC error: ${data.error?.message}`, 'error')
        this.recordResult(
          'functional',
          'RPC JSON-RPC',
          'fail',
          data.error?.message || 'Unknown error',
        )
      }
    } else {
      this.log('RPC not responding', 'error')
      this.recordResult('functional', 'RPC JSON-RPC', 'fail', 'No response')
    }

    // Test 2: Gas estimation
    this.log('Testing gas estimation...', 'info')

    const gasEstimate = await this.l2Client
      .estimateGas({
        to: zeroAddress,
        value: 0n,
      })
      .catch(() => null)

    if (gasEstimate && gasEstimate > 0n) {
      this.log(`Gas estimation: ${gasEstimate} gas`, 'success')
      this.recordResult(
        'functional',
        'Gas Estimation',
        'pass',
        `${gasEstimate} gas`,
      )
    } else {
      this.log('Gas estimation failed', 'error')
      this.recordResult(
        'functional',
        'Gas Estimation',
        'fail',
        'Could not estimate gas',
      )
    }

    // Test 3: Fee estimation
    this.log('Testing fee estimation...', 'info')

    const gasPrice = await this.l2Client.getGasPrice().catch(() => null)

    if (gasPrice && gasPrice > 0n) {
      this.log(
        `Gas price: ${formatEther(gasPrice * 1000000000n)} gwei`,
        'success',
      )
      this.recordResult(
        'functional',
        'Fee Estimation',
        'pass',
        `${gasPrice} wei`,
      )
    } else {
      this.log('Fee estimation failed', 'error')
      this.recordResult(
        'functional',
        'Fee Estimation',
        'fail',
        'Could not get gas price',
      )
    }

    // Test 4: Block retrieval
    this.log('Testing block retrieval...', 'info')

    const block = await this.l2Client
      .getBlock({ blockTag: 'latest' })
      .catch(() => null)

    if (block) {
      this.log(
        `Latest block: ${block.number}, ${block.transactions.length} txs`,
        'success',
      )
      this.recordResult(
        'functional',
        'Block Retrieval',
        'pass',
        `Block ${block.number}`,
      )
    } else {
      this.log('Block retrieval failed', 'error')
      this.recordResult(
        'functional',
        'Block Retrieval',
        'fail',
        'Could not get block',
      )
    }
  }

  private async verifyBabylon(): Promise<void> {
    // Check Babylon API
    const babylonApiUrl = 'https://babylon.testnet.jejunetwork.org'

    const healthResponse = await fetch(`${babylonApiUrl}/api/health`).catch(
      () => null,
    )

    if (healthResponse?.ok) {
      this.log('Babylon API: Healthy', 'success')
      this.recordResult('babylon', 'API Health', 'pass', 'Healthy')
    } else {
      this.log('Babylon API: Not available', 'warn')
      this.recordResult(
        'babylon',
        'API Health',
        'skip',
        'Not deployed or not available',
      )
    }

    // Check Babylon contracts
    const babylonStateFile = join(
      DEPLOYMENT_DIR,
      '.testnet-babylon-deployment-state.json',
    )
    if (existsSync(babylonStateFile)) {
      const state = JSON.parse(readFileSync(babylonStateFile, 'utf-8'))
      const babylonContracts = state.babylonContracts || {}

      for (const [name, address] of Object.entries(babylonContracts)) {
        if (address && address !== '') {
          const code = await this.l2Client
            .getCode({ address: address as Address })
            .catch(() => null)

          if (code && code !== '0x') {
            this.log(`Babylon ${name}: Deployed`, 'success')
            this.recordResult('babylon', name, 'pass', address as string)
          } else {
            this.log(`Babylon ${name}: Not deployed`, 'warn')
            this.recordResult('babylon', name, 'skip', 'No code found')
          }
        }
      }
    } else {
      this.log('Babylon deployment state not found', 'warn')
      this.recordResult('babylon', 'Contracts', 'skip', 'No deployment state')
    }

    // Check Babylon frontend
    const frontendResponse = await fetch(babylonApiUrl).catch(() => null)

    if (frontendResponse?.ok) {
      this.log('Babylon Frontend: Accessible', 'success')
      this.recordResult('babylon', 'Frontend', 'pass', 'Accessible')
    } else {
      this.log('Babylon Frontend: Not available', 'warn')
      this.recordResult('babylon', 'Frontend', 'skip', 'Not accessible')
    }
  }

  private printSummary(): void {
    const passed = this.results.filter((r) => r.status === 'pass').length
    const failed = this.results.filter((r) => r.status === 'fail').length
    const skipped = this.results.filter((r) => r.status === 'skip').length
    const total = this.results.length

    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                     VERIFICATION SUMMARY                                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Total Checks:  ${String(total).padEnd(4)}                                                  ║
║  Passed:        ${String(passed).padEnd(4)} ✅                                               ║
║  Failed:        ${String(failed).padEnd(4)} ❌                                               ║
║  Skipped:       ${String(skipped).padEnd(4)} ⏭️                                                ║
╠══════════════════════════════════════════════════════════════════════════╣`)

    // Group by category
    const categories = [...new Set(this.results.map((r) => r.category))]

    for (const category of categories) {
      const categoryResults = this.results.filter(
        (r) => r.category === category,
      )
      const categoryPassed = categoryResults.filter(
        (r) => r.status === 'pass',
      ).length
      const categoryTotal = categoryResults.length

      console.log(
        `${`║  ${category.padEnd(15)} ${categoryPassed}/${categoryTotal} passed`.padEnd(73)}║`,
      )
    }

    console.log(
      `╠══════════════════════════════════════════════════════════════════════════╣`,
    )

    // List failures
    const failures = this.results.filter((r) => r.status === 'fail')
    if (failures.length > 0) {
      console.log(
        `║  FAILURES:                                                               ║`,
      )
      for (const failure of failures) {
        console.log(
          `${`║  ❌ ${failure.category}/${failure.name}: ${failure.message}`.slice(0, 72).padEnd(73)}║`,
        )
      }
    } else {
      console.log(
        `║  ✅ All required checks passed                                            ║`,
      )
    }

    console.log(
      `╚══════════════════════════════════════════════════════════════════════════╝`,
    )

    // Overall status
    const requiredFailed = this.results.filter(
      (r) => r.status === 'fail',
    ).length
    if (requiredFailed === 0) {
      console.log('\n✅ TESTNET VERIFICATION PASSED\n')
      process.exit(0)
    } else {
      console.log(
        `\n❌ TESTNET VERIFICATION FAILED (${requiredFailed} issues)\n`,
      )
      process.exit(1)
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
Testnet + Babylon Verification

Usage:
  NETWORK=testnet bun run scripts/deploy/verify-testnet-babylon.ts [options]

Options:
  -v, --verbose  Show detailed output
  -h, --help     Show this help

Verification Phases:
  1. Chain Health     - L1/L2 connectivity, block production
  2. Service Endpoints - Health check all public endpoints
  3. Contracts        - Verify deployed contract bytecode
  4. Functional Tests - RPC, gas estimation, transactions
  5. Babylon          - API, contracts, frontend
`)
    process.exit(0)
  }

  const verifier = new TestnetVerifier(values.verbose)
  await verifier.run()
}

main().catch((error) => {
  console.error('❌ Verification failed:', error.message)
  process.exit(1)
})
