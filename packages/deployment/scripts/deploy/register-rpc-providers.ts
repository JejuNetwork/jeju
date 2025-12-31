#!/usr/bin/env bun
/**
 * Register RPC Providers with DWS Marketplace
 * 
 * Reads deployed chain endpoints from Kubernetes ConfigMap and registers
 * them with the DWS RPC marketplace for decentralized access.
 * 
 * Usage:
 *   bun run packages/deployment/scripts/deploy/register-rpc-providers.ts --network testnet
 */

import { $ } from 'bun'
import type { NetworkType } from '@jejunetwork/config'
import { createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const ChainEndpointSchema = z.object({
  chainId: z.number(),
  chainName: z.string(),
  stackType: z.string(),
  internalRpcUrl: z.string().optional(),
  internalWsUrl: z.string().optional(),
  externalRpcUrl: z.string().nullable().optional(),
  externalWsUrl: z.string().nullable().optional(),
  isL2: z.boolean().optional(),
  l1ChainId: z.number().nullable().optional(),
  status: z.string().optional(),
})

const EndpointsConfigSchema = z.object({
  version: z.string(),
  environment: z.string(),
  updatedAt: z.string(),
  chains: z.record(ChainEndpointSchema),
})

type ChainEndpoint = z.infer<typeof ChainEndpointSchema>

interface RPCProviderRegistration {
  chainId: number
  endpoint: string
  wsEndpoint?: string
  region: string
  tier: 'free' | 'standard' | 'premium'
  maxRps: number
}

async function getEndpointsFromConfigMap(namespace: string): Promise<Record<string, ChainEndpoint>> {
  console.log(`[Register] Reading endpoints from ConfigMap dws-rpc-endpoints in namespace ${namespace}...`)
  
  const result = await $`kubectl get configmap dws-rpc-endpoints -n ${namespace} -o jsonpath='{.data.endpoints\\.json}'`.quiet().nothrow()
  
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get ConfigMap: ${result.stderr.toString()}`)
  }
  
  const jsonStr = result.stdout.toString().replace(/^'|'$/g, '')
  const config = EndpointsConfigSchema.parse(JSON.parse(jsonStr))
  
  console.log(`[Register] Found ${Object.keys(config.chains).length} chains in ConfigMap`)
  return config.chains
}

async function getDwsEndpoint(network: NetworkType): Promise<string> {
  const endpoints: Record<NetworkType, string> = {
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
    localnet: 'http://localhost:4030',
  }
  return endpoints[network]
}

async function registerProvider(
  dwsEndpoint: string, 
  registration: RPCProviderRegistration,
  operatorAddress: Address
): Promise<{ providerId: string; chainId: number; status: string }> {
  const response = await fetch(`${dwsEndpoint}/rpc/providers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': operatorAddress,
    },
    body: JSON.stringify(registration),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to register provider for chain ${registration.chainId}: ${error}`)
  }
  
  return response.json() as Promise<{ providerId: string; chainId: number; status: string }>
}

async function testRpcEndpoint(endpoint: string, isSolana: boolean = false): Promise<{ ok: boolean; latency: number; blockNumber?: string }> {
  const start = Date.now()
  
  try {
    const body = isSolana
      ? { jsonrpc: '2.0', method: 'getSlot', params: [], id: 1 }
      : { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    
    const latency = Date.now() - start
    const data = await response.json() as { result?: string | number; error?: { message: string } }
    
    if (data.result !== undefined) {
      const blockNumber = isSolana 
        ? data.result.toString() 
        : parseInt(data.result as string, 16).toString()
      return { ok: true, latency, blockNumber }
    }
    
    return { ok: false, latency }
  } catch {
    return { ok: false, latency: Date.now() - start }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const networkArg = args.find(a => a.startsWith('--network='))?.split('=')[1] 
    ?? args[args.indexOf('--network') + 1] 
    ?? 'testnet'
  
  const network = networkArg as NetworkType
  console.log(`\n=== Registering RPC Providers for ${network} ===\n`)
  
  // Get operator private key
  const privateKey = process.env.DWS_OPERATOR_KEY ?? process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DWS_OPERATOR_KEY or DEPLOYER_PRIVATE_KEY required')
  }
  
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  console.log(`[Register] Operator address: ${account.address}`)
  
  // Get DWS endpoint
  const dwsEndpoint = await getDwsEndpoint(network)
  console.log(`[Register] DWS endpoint: ${dwsEndpoint}`)
  
  // Get chain endpoints from ConfigMap
  const namespace = network === 'mainnet' ? 'dws' : 'dws'
  let chains: Record<string, ChainEndpoint>
  
  try {
    chains = await getEndpointsFromConfigMap(namespace)
  } catch (err) {
    console.warn(`[Register] Could not read from ConfigMap, using fallback configuration`)
    // Fallback to hardcoded configuration for testnet
    chains = {
      'ethereum-sepolia': {
        chainId: 11155111,
        chainName: 'ethereum-sepolia',
        stackType: 'ethereum',
        internalRpcUrl: 'http://geth-l1.l1.svc.cluster.local:8545',
      },
      'base-sepolia': {
        chainId: 84532,
        chainName: 'base-sepolia',
        stackType: 'op-stack',
        internalRpcUrl: 'http://op-geth-base.l2-base.svc.cluster.local:8545',
      },
      'optimism-sepolia': {
        chainId: 11155420,
        chainName: 'optimism-sepolia',
        stackType: 'op-stack',
        internalRpcUrl: 'http://op-geth-optimism.l2-optimism.svc.cluster.local:8545',
      },
      'arbitrum-sepolia': {
        chainId: 421614,
        chainName: 'arbitrum-sepolia',
        stackType: 'nitro',
        internalRpcUrl: 'http://nitro-arbitrum.l2-arbitrum.svc.cluster.local:8547',
      },
      'bsc-testnet': {
        chainId: 97,
        chainName: 'bsc-testnet',
        stackType: 'bsc',
        internalRpcUrl: 'http://bsc-geth-testnet.l1-bsc.svc.cluster.local:8545',
      },
      'solana-devnet': {
        chainId: 103,
        chainName: 'solana-devnet',
        stackType: 'solana',
        externalRpcUrl: 'https://api.devnet.solana.com',
      },
      'jeju-testnet': {
        chainId: 420690,
        chainName: 'jeju-testnet',
        stackType: 'op-stack',
        internalRpcUrl: 'http://reth-sequencer.execution.svc.cluster.local:8545',
        externalRpcUrl: 'https://testnet-rpc.jejunetwork.org',
      },
    }
  }
  
  console.log(`\n[Register] Processing ${Object.keys(chains).length} chains...\n`)
  
  const results: Array<{
    chainName: string
    chainId: number
    endpoint: string
    status: 'registered' | 'failed' | 'skipped'
    providerId?: string
    error?: string
    rpcTest?: { ok: boolean; latency: number; blockNumber?: string }
  }> = []
  
  for (const [name, chain] of Object.entries(chains)) {
    console.log(`[${name}] Processing chain ${chain.chainId}...`)
    
    // Determine best endpoint to use
    const endpoint = chain.externalRpcUrl ?? chain.internalRpcUrl
    if (!endpoint) {
      console.log(`[${name}] No endpoint available, skipping`)
      results.push({ chainName: name, chainId: chain.chainId, endpoint: '', status: 'skipped' })
      continue
    }
    
    // Test the endpoint first
    const isSolana = chain.stackType === 'solana'
    console.log(`[${name}] Testing endpoint ${endpoint}...`)
    const rpcTest = await testRpcEndpoint(endpoint, isSolana)
    
    if (!rpcTest.ok) {
      console.log(`[${name}] Endpoint not responding, skipping registration`)
      results.push({ chainName: name, chainId: chain.chainId, endpoint, status: 'skipped', rpcTest })
      continue
    }
    
    console.log(`[${name}] Endpoint OK - block ${rpcTest.blockNumber} (${rpcTest.latency}ms)`)
    
    // Register with DWS
    try {
      const registration: RPCProviderRegistration = {
        chainId: chain.chainId,
        endpoint,
        region: 'us-east-1',
        tier: 'standard',
        maxRps: 100,
      }
      
      const result = await registerProvider(dwsEndpoint, registration, account.address)
      console.log(`[${name}] Registered with provider ID: ${result.providerId}`)
      
      results.push({
        chainName: name,
        chainId: chain.chainId,
        endpoint,
        status: 'registered',
        providerId: result.providerId,
        rpcTest,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`[${name}] Registration failed: ${error}`)
      results.push({
        chainName: name,
        chainId: chain.chainId,
        endpoint,
        status: 'failed',
        error,
        rpcTest,
      })
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('REGISTRATION SUMMARY')
  console.log('='.repeat(80))
  
  const registered = results.filter(r => r.status === 'registered')
  const failed = results.filter(r => r.status === 'failed')
  const skipped = results.filter(r => r.status === 'skipped')
  
  console.log(`\nRegistered: ${registered.length}`)
  for (const r of registered) {
    console.log(`  ✅ ${r.chainName} (${r.chainId}) - ${r.providerId}`)
  }
  
  if (failed.length > 0) {
    console.log(`\nFailed: ${failed.length}`)
    for (const r of failed) {
      console.log(`  ❌ ${r.chainName} (${r.chainId}) - ${r.error}`)
    }
  }
  
  if (skipped.length > 0) {
    console.log(`\nSkipped: ${skipped.length}`)
    for (const r of skipped) {
      console.log(`  ⏭️  ${r.chainName} (${r.chainId})`)
    }
  }
  
  console.log('\n' + '='.repeat(80))
  
  // Return non-zero exit code if any failed
  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
