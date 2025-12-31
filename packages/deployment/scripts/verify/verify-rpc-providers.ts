#!/usr/bin/env bun
/**
 * Verify RPC Provider Health
 * 
 * Tests all registered RPC providers in the DWS marketplace and
 * verifies they are responding correctly.
 * 
 * Usage:
 *   bun run packages/deployment/scripts/verify/verify-rpc-providers.ts --network testnet
 *   bun run packages/deployment/scripts/verify/verify-rpc-providers.ts --network testnet --verbose
 */

import { RPC_CHAINS, type NetworkType } from '@jejunetwork/config'
import { z } from 'zod'

const RPCProviderSchema = z.object({
  id: z.string(),
  chainId: z.number(),
  region: z.string(),
  tier: z.string(),
  latency: z.number(),
  uptime: z.number(),
  status: z.string(),
})

const ChainInfoSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  network: z.string().optional(),
  providers: z.number(),
  avgLatency: z.number().nullable(),
})

const DWSRPCHealthSchema = z.object({
  status: z.string(),
  service: z.string(),
  chains: z.array(ChainInfoSchema),
  totalProviders: z.number(),
  activeSessions: z.number(),
})

interface TestResult {
  chainId: number
  chainName: string
  endpoint: string
  status: 'ok' | 'error' | 'timeout'
  blockNumber?: string
  latencyMs: number
  error?: string
}

function getDwsEndpoint(network: NetworkType): string {
  const endpoints: Record<NetworkType, string> = {
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
    localnet: 'http://localhost:4030',
  }
  return endpoints[network]
}

async function testEvmRpc(endpoint: string): Promise<Omit<TestResult, 'chainId' | 'chainName' | 'endpoint'>> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const latencyMs = Date.now() - start
    const data = (await response.json()) as { result?: string; error?: { message: string } }

    if (data.result) {
      const blockNumber = parseInt(data.result, 16).toString()
      return { status: 'ok', blockNumber, latencyMs }
    }
    return { status: 'error', latencyMs, error: data.error?.message ?? 'No result' }
  } catch (err) {
    const latencyMs = Date.now() - start
    const error = err instanceof Error ? err.message : String(err)
    if (error.includes('abort')) {
      return { status: 'timeout', latencyMs, error: 'Timeout (10s)' }
    }
    return { status: 'error', latencyMs, error }
  }
}

async function testSolanaRpc(endpoint: string): Promise<Omit<TestResult, 'chainId' | 'chainName' | 'endpoint'>> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getSlot',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const latencyMs = Date.now() - start
    const data = (await response.json()) as { result?: number; error?: { message: string } }

    if (data.result !== undefined) {
      return { status: 'ok', blockNumber: data.result.toString(), latencyMs }
    }
    return { status: 'error', latencyMs, error: data.error?.message ?? 'No result' }
  } catch (err) {
    const latencyMs = Date.now() - start
    const error = err instanceof Error ? err.message : String(err)
    if (error.includes('abort')) {
      return { status: 'timeout', latencyMs, error: 'Timeout (10s)' }
    }
    return { status: 'error', latencyMs, error }
  }
}

async function getDwsMarketplaceHealth(dwsEndpoint: string) {
  try {
    const response = await fetch(`${dwsEndpoint}/rpc/health`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return DWSRPCHealthSchema.parse(await response.json())
  } catch (err) {
    console.error('Failed to get DWS marketplace health:', err)
    return null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const networkArg = args.find(a => a.startsWith('--network='))?.split('=')[1] 
    ?? args[args.indexOf('--network') + 1] 
    ?? 'testnet'
  const verbose = args.includes('--verbose') || args.includes('-v')
  
  const network = networkArg as NetworkType
  console.log(`\n${'='.repeat(80)}`)
  console.log(`RPC PROVIDER VERIFICATION - ${network.toUpperCase()}`)
  console.log(`${'='.repeat(80)}\n`)
  
  const dwsEndpoint = getDwsEndpoint(network)
  console.log(`DWS Endpoint: ${dwsEndpoint}\n`)
  
  // Get DWS marketplace status
  const marketplaceHealth = await getDwsMarketplaceHealth(dwsEndpoint)
  
  if (marketplaceHealth) {
    console.log('--- DWS MARKETPLACE STATUS ---')
    console.log(`Status: ${marketplaceHealth.status}`)
    console.log(`Total Providers: ${marketplaceHealth.totalProviders}`)
    console.log(`Active Sessions: ${marketplaceHealth.activeSessions}`)
    console.log(`Chains with providers: ${marketplaceHealth.chains.filter(c => c.providers > 0).length}`)
    console.log('')
  }
  
  // Define all endpoints to test based on network
  const isTestnet = network === 'testnet'
  
  interface EndpointToTest {
    name: string
    chainId: number
    endpoint: string
    type: 'evm' | 'solana'
    source: 'jeju-node' | 'dws-proxy' | 'external'
  }
  
  const endpoints: EndpointToTest[] = []
  
  // 1. Jeju Network RPC (direct)
  if (isTestnet) {
    endpoints.push({
      name: 'Jeju Testnet (direct)',
      chainId: 420690,
      endpoint: 'https://testnet-rpc.jejunetwork.org',
      type: 'evm',
      source: 'jeju-node',
    })
  }
  
  // 2. DWS Proxy endpoints (if marketplace has providers)
  if (marketplaceHealth && marketplaceHealth.totalProviders > 0) {
    for (const chain of marketplaceHealth.chains) {
      if (chain.providers > 0) {
        endpoints.push({
          name: `${chain.name} (DWS proxy)`,
          chainId: chain.chainId,
          endpoint: `${dwsEndpoint}/rpc/${chain.chainId}`,
          type: chain.chainId === 101 || chain.chainId === 103 ? 'solana' : 'evm',
          source: 'dws-proxy',
        })
      }
    }
  }
  
  // 3. RPC Gateway routes
  const rpcGatewayBase = isTestnet ? 'https://rpc.jejunetwork.org' : 'https://rpc.jejunetwork.org'
  const gatewayChains = isTestnet
    ? [
        { name: 'jeju-testnet', chainId: 420690 },
        { name: 'sepolia', chainId: 11155111 },
        { name: 'base-sepolia', chainId: 84532 },
        { name: 'optimism-sepolia', chainId: 11155420 },
        { name: 'arbitrum-sepolia', chainId: 421614 },
        { name: 'bsc-testnet', chainId: 97 },
      ]
    : [
        { name: 'jeju', chainId: 420691 },
        { name: 'ethereum', chainId: 1 },
        { name: 'base', chainId: 8453 },
        { name: 'optimism', chainId: 10 },
        { name: 'arbitrum', chainId: 42161 },
        { name: 'bsc', chainId: 56 },
      ]
  
  for (const chain of gatewayChains) {
    endpoints.push({
      name: `RPC Gateway - ${chain.name}`,
      chainId: chain.chainId,
      endpoint: `${rpcGatewayBase}/${chain.name}`,
      type: 'evm',
      source: 'jeju-node',
    })
  }
  
  // 4. External fallback RPCs (for comparison)
  const externalRpcs = isTestnet
    ? [
        { name: 'Ethereum Sepolia (publicnode)', chainId: 11155111, endpoint: 'https://ethereum-sepolia-rpc.publicnode.com' },
        { name: 'Base Sepolia (base.org)', chainId: 84532, endpoint: 'https://sepolia.base.org' },
        { name: 'Arbitrum Sepolia (arbitrum.io)', chainId: 421614, endpoint: 'https://sepolia-rollup.arbitrum.io/rpc' },
        { name: 'Optimism Sepolia (optimism.io)', chainId: 11155420, endpoint: 'https://sepolia.optimism.io' },
        { name: 'BSC Testnet (bnbchain)', chainId: 97, endpoint: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545' },
        { name: 'Solana Devnet (solana.com)', chainId: 103, endpoint: 'https://api.devnet.solana.com', type: 'solana' as const },
      ]
    : [
        { name: 'Ethereum (llamarpc)', chainId: 1, endpoint: 'https://eth.llamarpc.com' },
        { name: 'Base (base.org)', chainId: 8453, endpoint: 'https://mainnet.base.org' },
        { name: 'Arbitrum (arbitrum.io)', chainId: 42161, endpoint: 'https://arb1.arbitrum.io/rpc' },
        { name: 'Optimism (optimism.io)', chainId: 10, endpoint: 'https://mainnet.optimism.io' },
        { name: 'BSC (bnbchain)', chainId: 56, endpoint: 'https://bsc-dataseed.bnbchain.org' },
        { name: 'Solana (solana.com)', chainId: 101, endpoint: 'https://api.mainnet-beta.solana.com', type: 'solana' as const },
      ]
  
  for (const rpc of externalRpcs) {
    endpoints.push({
      name: rpc.name,
      chainId: rpc.chainId,
      endpoint: rpc.endpoint,
      type: rpc.type ?? 'evm',
      source: 'external',
    })
  }
  
  // Run all tests
  console.log('--- TESTING ENDPOINTS ---\n')
  
  const results: TestResult[] = []
  
  for (const ep of endpoints) {
    process.stdout.write(`Testing ${ep.name}...`)
    
    const testResult = ep.type === 'solana'
      ? await testSolanaRpc(ep.endpoint)
      : await testEvmRpc(ep.endpoint)
    
    const result: TestResult = {
      chainId: ep.chainId,
      chainName: ep.name,
      endpoint: ep.endpoint,
      ...testResult,
    }
    
    results.push(result)
    
    if (result.status === 'ok') {
      console.log(` OK (${result.latencyMs}ms, block ${result.blockNumber})`)
    } else {
      console.log(` FAILED (${result.error})`)
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('VERIFICATION SUMMARY')
  console.log('='.repeat(80))
  
  // Group by source
  const jejuNodes = results.filter(r => endpoints.find(e => e.name === r.chainName)?.source === 'jeju-node')
  const dwsProxy = results.filter(r => endpoints.find(e => e.name === r.chainName)?.source === 'dws-proxy')
  const external = results.filter(r => endpoints.find(e => e.name === r.chainName)?.source === 'external')
  
  const statusIcon = (status: string) => status === 'ok' ? '✅' : status === 'timeout' ? '⏱️ ' : '❌'
  
  console.log('\n--- JEJU NETWORK NODES ---')
  for (const r of jejuNodes) {
    console.log(`${statusIcon(r.status)} ${r.chainName.padEnd(35)} ${r.status === 'ok' ? `Block ${r.blockNumber?.padStart(12)} (${r.latencyMs}ms)` : r.error?.substring(0, 40)}`)
  }
  
  if (dwsProxy.length > 0) {
    console.log('\n--- DWS MARKETPLACE PROXY ---')
    for (const r of dwsProxy) {
      console.log(`${statusIcon(r.status)} ${r.chainName.padEnd(35)} ${r.status === 'ok' ? `Block ${r.blockNumber?.padStart(12)} (${r.latencyMs}ms)` : r.error?.substring(0, 40)}`)
    }
  }
  
  console.log('\n--- EXTERNAL FALLBACKS ---')
  for (const r of external) {
    console.log(`${statusIcon(r.status)} ${r.chainName.padEnd(35)} ${r.status === 'ok' ? `Block ${r.blockNumber?.padStart(12)} (${r.latencyMs}ms)` : r.error?.substring(0, 40)}`)
  }
  
  // Final tally
  const ok = results.filter(r => r.status === 'ok').length
  const errors = results.filter(r => r.status === 'error').length
  const timeouts = results.filter(r => r.status === 'timeout').length
  
  console.log('\n' + '='.repeat(80))
  console.log(`TOTAL: ${ok} OK, ${errors} ERRORS, ${timeouts} TIMEOUTS (of ${results.length})`)
  console.log('='.repeat(80))
  
  // Recommendations
  console.log('\n--- RECOMMENDATIONS ---')
  
  const jejuNodesFailing = jejuNodes.filter(r => r.status !== 'ok')
  if (jejuNodesFailing.length > 0) {
    console.log('❌ CRITICAL: Jeju-hosted nodes are failing:')
    for (const r of jejuNodesFailing) {
      console.log(`   - ${r.chainName}: ${r.error}`)
    }
    console.log('   Fix: Check K8s deployments and pod health')
  }
  
  const externalOk = external.filter(r => r.status === 'ok').length
  if (externalOk === external.length) {
    console.log('✅ All external fallback RPCs are healthy')
  }
  
  if (dwsProxy.length === 0) {
    console.log('⚠️  No DWS marketplace providers registered')
    console.log('   Fix: Run register-rpc-providers.ts to register nodes')
  }
  
  // Exit with error if critical issues
  if (jejuNodesFailing.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
