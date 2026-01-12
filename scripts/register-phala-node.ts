#!/usr/bin/env bun
/**
 * Register Phala TEE Node with ComputeRegistry
 *
 * This script:
 * 1. Auto-detects TEE hardware capabilities
 * 2. Generates attestation from Phala TEE
 * 3. Registers the node with ComputeRegistry
 * 4. Optionally sets up re-attestation cron
 *
 * Usage:
 *   bun scripts/register-phala-node.ts [options]
 *
 * Options:
 *   --endpoint <url>       Node endpoint URL (auto-detected if not provided)
 *   --model <id>           Model ID for inference (default: llama-3.1-8b)
 *   --stake <amount>       Stake amount in ETH (default: 0.1)
 *   --service <type>       Service type: inference, database, training (default: inference)
 *   --cron                 Set up re-attestation cron job
 *   --cron-interval <ms>   Cron interval in ms (default: 12 hours)
 *   --dry-run              Print registration data without submitting
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:6546',
  chainId: parseInt(process.env.JEJU_CHAIN_ID ?? '420691', 10),
  computeRegistry: (process.env.COMPUTE_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address,
  phalaEndpoint:
    process.env.PHALA_ENDPOINT ?? 'http://127.0.0.1:8000',
  privateKey: (process.env.OPERATOR_PRIVATE_KEY ??
    process.env.PRIVATE_KEY) as Hex | undefined,
}

// ============================================================================
// Types
// ============================================================================

interface TEEInfo {
  platform: 'tdx' | 'sgx' | 'sev-snp' | 'phala' | 'nitro' | 'none'
  platformCode: number
  available: boolean
  nodeId: Hex
  mrEnclave: Hex
  mrSigner: Hex
  quote?: Uint8Array
}

interface RegistrationParams {
  name: string
  endpoint: string
  nodeId: Hex
  teePlatform: number
  mrEnclave: Hex
  mrSigner: Hex
  serviceType: Hex
  stake: bigint
}

// ============================================================================
// TEE Detection
// ============================================================================

async function detectTEECapabilities(): Promise<TEEInfo> {
  console.log('\n[TEE Detection] Detecting TEE capabilities...')

  // Try Phala endpoint first
  try {
    const response = await fetch(`${CONFIG.phalaEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const health = (await response.json()) as {
        enclave_id: string
        public_key?: string
        platform?: string
      }

      console.log('[TEE Detection] Phala TEE detected:', health.enclave_id)

      // Get attestation
      const attestation = await getPhalaAttestation()

      return {
        platform: 'phala',
        platformCode: 4, // TEE_PHALA
        available: true,
        nodeId: attestation.nodeId,
        mrEnclave: attestation.mrEnclave,
        mrSigner: attestation.mrSigner,
        quote: attestation.quote,
      }
    }
  } catch {
    console.log('[TEE Detection] Phala endpoint not available')
  }

  // Check for Intel TDX
  if (await checkTDXAvailable()) {
    console.log('[TEE Detection] Intel TDX detected')
    const attestation = await getTDXAttestation()
    return {
      platform: 'tdx',
      platformCode: 1, // TEE_INTEL_TDX
      available: true,
      ...attestation,
    }
  }

  // Check for Intel SGX
  if (await checkSGXAvailable()) {
    console.log('[TEE Detection] Intel SGX detected')
    const attestation = await getSGXAttestation()
    return {
      platform: 'sgx',
      platformCode: 2, // TEE_INTEL_SGX
      available: true,
      ...attestation,
    }
  }

  // Check for AWS Nitro
  if (await checkNitroAvailable()) {
    console.log('[TEE Detection] AWS Nitro detected')
    const attestation = await getNitroAttestation()
    return {
      platform: 'nitro',
      platformCode: 5, // TEE_AWS_NITRO
      available: true,
      ...attestation,
    }
  }

  // No TEE available - generate mock for development
  console.log('[TEE Detection] No hardware TEE detected, using mock')
  return generateMockTEE()
}

async function getPhalaAttestation(): Promise<{
  nodeId: Hex
  mrEnclave: Hex
  mrSigner: Hex
  quote?: Uint8Array
}> {
  const reportData = keccak256(toBytes(BigInt(Date.now())))

  const response = await fetch(`${CONFIG.phalaEndpoint}/attestation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: reportData,
      operator_address: '0x0000000000000000000000000000000000000000',
      nonce: Date.now().toString(),
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`Phala attestation failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    quote: string
    mr_enclave: string
    report_data: string
    signature: string
    timestamp: number
    enclave_id: string
  }

  return {
    nodeId: keccak256(
      toBytes(data.enclave_id + data.timestamp.toString()),
    ) as Hex,
    mrEnclave: data.mr_enclave as Hex,
    mrSigner: keccak256(toBytes(data.enclave_id)) as Hex,
    quote: Buffer.from(data.quote, 'hex'),
  }
}

async function checkTDXAvailable(): Promise<boolean> {
  try {
    const fs = await import('node:fs')
    return fs.existsSync('/dev/tdx_guest') || fs.existsSync('/dev/tdx-guest')
  } catch {
    return false
  }
}

async function getTDXAttestation(): Promise<{
  nodeId: Hex
  mrEnclave: Hex
  mrSigner: Hex
  quote?: Uint8Array
}> {
  // TDX attestation requires calling the TDX guest driver
  // This is a placeholder that needs real implementation
  throw new Error(
    'TDX attestation not yet implemented. ' +
    'To implement: read from /dev/tdx_guest or /dev/tdx-guest using TDX DCAP library. ' +
    'See: https://github.com/intel/SGXDataCenterAttestationPrimitives',
  )
}

async function checkSGXAvailable(): Promise<boolean> {
  try {
    const fs = await import('node:fs')
    return fs.existsSync('/dev/sgx_enclave') || fs.existsSync('/dev/isgx')
  } catch {
    return false
  }
}

async function getSGXAttestation(): Promise<{
  nodeId: Hex
  mrEnclave: Hex
  mrSigner: Hex
  quote?: Uint8Array
}> {
  // SGX attestation requires calling the SGX DCAP library
  // This is a placeholder that needs real implementation
  throw new Error(
    'SGX attestation not yet implemented. ' +
    'To implement: use SGX DCAP library to generate quote from /dev/sgx_enclave. ' +
    'See: https://github.com/intel/SGXDataCenterAttestationPrimitives',
  )
}

async function checkNitroAvailable(): Promise<boolean> {
  try {
    const fs = await import('node:fs')
    return fs.existsSync('/dev/nsm')
  } catch {
    return false
  }
}

async function getNitroAttestation(): Promise<{
  nodeId: Hex
  mrEnclave: Hex
  mrSigner: Hex
  quote?: Uint8Array
}> {
  // AWS Nitro attestation requires calling the NSM (Nitro Security Module) API
  // This is a placeholder that needs real implementation
  throw new Error(
    'AWS Nitro attestation not yet implemented. ' +
    'To implement: use AWS Nitro Enclaves SDK to call /dev/nsm. ' +
    'See: https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-concepts.html',
  )
}

function generateMockTEE(): TEEInfo {
  const isProduction = process.env.NODE_ENV === 'production'
  
  if (isProduction) {
    throw new Error(
      'No TEE hardware detected and NODE_ENV=production. ' +
      'Cannot register without real TEE attestation in production. ' +
      'Ensure you are running on hardware with TDX, SGX, AWS Nitro, or Phala TEE support.',
    )
  }

  console.warn('⚠️'.repeat(20))
  console.warn('[TEE Detection] WARNING: No TEE hardware detected')
  console.warn('[TEE Detection] Using MOCK TEE info - NOT FOR PRODUCTION')
  console.warn('[TEE Detection] This registration will NOT be trusted by verifiers')
  console.warn('⚠️'.repeat(20))

  return {
    platform: 'none',
    platformCode: 0,
    available: false,
    nodeId: ('0x' + 'MOCK'.repeat(16)) as Hex,
    mrEnclave: ('0x' + 'MOCK'.repeat(16)) as Hex,
    mrSigner: ('0x' + 'MOCK'.repeat(16)) as Hex,
  }
}

// ============================================================================
// Registration
// ============================================================================

const COMPUTE_REGISTRY_ABI = [
  {
    name: 'registerWithTEE',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'teePlatform', type: 'uint8' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'serviceType', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'providers',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'stake', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
      { name: 'serviceType', type: 'bytes32' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'refreshTEEStatus',
    type: 'function',
    inputs: [{ name: 'providerAddr', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'SERVICE_INFERENCE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'SERVICE_DATABASE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'SERVICE_TRAINING',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const

async function registerNode(
  params: RegistrationParams,
  dryRun: boolean,
): Promise<string | null> {
  console.log('\n[Registration] Preparing registration...')
  console.log(`  Name: ${params.name}`)
  console.log(`  Endpoint: ${params.endpoint}`)
  console.log(`  Node ID: ${params.nodeId.slice(0, 18)}...`)
  console.log(`  TEE Platform: ${params.teePlatform}`)
  console.log(`  Stake: ${Number(params.stake) / 1e18} ETH`)

  if (dryRun) {
    console.log('\n[Dry Run] Would submit registration with above parameters')
    return null
  }

  if (!CONFIG.privateKey) {
    throw new Error(
      'OPERATOR_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  if (
    CONFIG.computeRegistry === '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error('COMPUTE_REGISTRY_ADDRESS not set')
  }

  const chain = {
    id: CONFIG.chainId,
    name: 'Jeju',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  } as const

  const publicClient = createPublicClient({
    chain,
    transport: http(CONFIG.rpcUrl),
  })

  const account = privateKeyToAccount(CONFIG.privateKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(CONFIG.rpcUrl),
  })

  console.log(`\n[Registration] Operator: ${account.address}`)

  // Check if already registered
  const provider = (await publicClient.readContract({
    address: CONFIG.computeRegistry,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'providers',
    args: [account.address],
  })) as readonly [Address, string, string, Hex, bigint, bigint, bigint, Hex, boolean]

  const registeredAt = provider[5]
  if (registeredAt > 0n) {
    console.log('[Registration] Already registered, refreshing TEE status...')

    const hash = await walletClient.writeContract({
      address: CONFIG.computeRegistry,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'refreshTEEStatus',
      args: [account.address],
    })

    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`[Registration] TEE status refreshed: ${hash}`)
    return hash
  }

  // Register
  console.log('[Registration] Submitting registration transaction...')

  const hash = await walletClient.writeContract({
    address: CONFIG.computeRegistry,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'registerWithTEE',
    args: [
      params.name,
      params.endpoint,
      params.nodeId,
      params.teePlatform,
      params.mrEnclave,
      params.mrSigner,
      params.serviceType,
    ],
    value: params.stake,
  })

  console.log(`[Registration] Transaction: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (receipt.status === 'success') {
    console.log('[Registration] SUCCESS - Node registered')
    return hash
  } else {
    throw new Error('Registration transaction failed')
  }
}

// ============================================================================
// Cron Setup
// ============================================================================

function setupCronRefresh(intervalMs: number): void {
  console.log(
    `\n[Cron] Setting up re-attestation every ${intervalMs / 1000 / 60} minutes`,
  )

  setInterval(async () => {
    console.log('\n[Cron] Running scheduled re-attestation...')
    try {
      const teeInfo = await detectTEECapabilities()

      if (CONFIG.privateKey) {
        const chain = {
          id: CONFIG.chainId,
          name: 'Jeju',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
        } as const

        const publicClient = createPublicClient({
          chain,
          transport: http(CONFIG.rpcUrl),
        })

        const account = privateKeyToAccount(CONFIG.privateKey)
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(CONFIG.rpcUrl),
        })

        const hash = await walletClient.writeContract({
          address: CONFIG.computeRegistry,
          abi: COMPUTE_REGISTRY_ABI,
          functionName: 'refreshTEEStatus',
          args: [account.address],
        })

        await publicClient.waitForTransactionReceipt({ hash })
        console.log(`[Cron] Re-attestation complete: ${hash}`)
      }
    } catch (error) {
      console.error('[Cron] Re-attestation failed:', error)
    }
  }, intervalMs)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60))
  console.log('  PHALA TEE NODE REGISTRATION')
  console.log('='.repeat(60))

  const args = process.argv.slice(2)

  // Parse arguments
  let endpoint = ''
  let modelId = 'llama-3.1-8b'
  let stakeAmount = '0.1'
  let serviceType = 'inference'
  let enableCron = false
  let cronInterval = 12 * 60 * 60 * 1000 // 12 hours
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--endpoint' || args[i] === '-e') {
      endpoint = args[i + 1]
      i++
    } else if (args[i] === '--model' || args[i] === '-m') {
      modelId = args[i + 1]
      i++
    } else if (args[i] === '--stake' || args[i] === '-s') {
      stakeAmount = args[i + 1]
      i++
    } else if (args[i] === '--service') {
      serviceType = args[i + 1]
      i++
    } else if (args[i] === '--cron') {
      enableCron = true
    } else if (args[i] === '--cron-interval') {
      cronInterval = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--dry-run') {
      dryRun = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: bun scripts/register-phala-node.ts [options]

Options:
  -e, --endpoint <url>      Node endpoint URL
  -m, --model <id>          Model ID (default: llama-3.1-8b)
  -s, --stake <amount>      Stake amount in ETH (default: 0.1)
  --service <type>          Service type: inference, database, training
  --cron                    Enable re-attestation cron
  --cron-interval <ms>      Cron interval (default: 43200000 = 12h)
  --dry-run                 Print without submitting

Environment Variables:
  JEJU_RPC_URL              RPC URL (default: http://127.0.0.1:6546)
  COMPUTE_REGISTRY_ADDRESS  ComputeRegistry contract address
  PHALA_ENDPOINT            Phala TEE endpoint
  OPERATOR_PRIVATE_KEY      Private key for transactions
`)
      process.exit(0)
    }
  }

  console.log('\nConfiguration:')
  console.log(`  RPC URL: ${CONFIG.rpcUrl}`)
  console.log(`  Chain ID: ${CONFIG.chainId}`)
  console.log(`  Registry: ${CONFIG.computeRegistry}`)
  console.log(`  Phala Endpoint: ${CONFIG.phalaEndpoint}`)
  console.log(`  Model: ${modelId}`)
  console.log(`  Service: ${serviceType}`)
  console.log(`  Stake: ${stakeAmount} ETH`)
  console.log(`  Dry Run: ${dryRun}`)

  // Detect TEE
  const teeInfo = await detectTEECapabilities()

  console.log('\nTEE Information:')
  console.log(`  Platform: ${teeInfo.platform}`)
  console.log(`  Platform Code: ${teeInfo.platformCode}`)
  console.log(`  Available: ${teeInfo.available}`)
  console.log(`  Node ID: ${teeInfo.nodeId.slice(0, 18)}...`)
  console.log(`  mrEnclave: ${teeInfo.mrEnclave.slice(0, 18)}...`)

  // Auto-detect endpoint if not provided
  if (!endpoint) {
    endpoint = `http://127.0.0.1:3000` // Default inference endpoint
    console.log(`\n[Endpoint] Auto-detected: ${endpoint}`)
  }

  // Get service type hash
  let serviceTypeHash: Hex = keccak256(toBytes(serviceType))

  if (
    CONFIG.computeRegistry !== '0x0000000000000000000000000000000000000000' &&
    !dryRun
  ) {
    const chain = {
      id: CONFIG.chainId,
      name: 'Jeju',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
    } as const

    const publicClient = createPublicClient({
      chain,
      transport: http(CONFIG.rpcUrl),
    })

    const functionName =
      serviceType === 'database'
        ? 'SERVICE_DATABASE'
        : serviceType === 'training'
          ? 'SERVICE_TRAINING'
          : 'SERVICE_INFERENCE'

    serviceTypeHash = (await publicClient.readContract({
      address: CONFIG.computeRegistry,
      abi: COMPUTE_REGISTRY_ABI,
      functionName,
    })) as Hex
  }

  // Register
  const txHash = await registerNode(
    {
      name: `Phala TEE Node - ${modelId}`,
      endpoint,
      nodeId: teeInfo.nodeId,
      teePlatform: teeInfo.platformCode,
      mrEnclave: teeInfo.mrEnclave,
      mrSigner: teeInfo.mrSigner,
      serviceType: serviceTypeHash,
      stake: parseEther(stakeAmount),
    },
    dryRun,
  )

  // Setup cron if requested
  if (enableCron && !dryRun) {
    setupCronRefresh(cronInterval)
    console.log('\n[Cron] Re-attestation cron active. Press Ctrl+C to stop.')
    // Keep process alive
    await new Promise(() => {})
  }

  console.log('\n' + '='.repeat(60))
  console.log('  REGISTRATION COMPLETE')
  console.log('='.repeat(60))

  if (txHash) {
    console.log(`\nTransaction: ${txHash}`)
  }

  console.log(`\nNode ID: ${teeInfo.nodeId}`)
  console.log(`Platform: ${teeInfo.platform} (${teeInfo.platformCode})`)
}

main().catch((error) => {
  console.error('\nError:', error)
  process.exit(1)
})
