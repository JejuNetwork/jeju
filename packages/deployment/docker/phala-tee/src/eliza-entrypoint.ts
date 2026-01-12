/**
 * Eliza TEE Entrypoint
 *
 * Handles Eliza agent startup with auto-registration to ComputeRegistry.
 * Manages attestation lifecycle and provider registration.
 */

import { spawn } from 'bun'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  autoRegister: boolean
  computeRegistryAddress: `0x${string}` | null
  rpcUrl: string
  operatorPrivateKey: `0x${string}` | null
  chainId: number
  serviceType: string
  modelId: string
  endpoint: string
  minStake: bigint
  elizaPort: number
  healthPort: number
  teeEnabled: boolean
  teePlatform: number
  attestationRefreshInterval: number
}

function loadConfig(): Config {
  return {
    autoRegister: process.env.AUTO_REGISTER === 'true',
    computeRegistryAddress: process.env.COMPUTE_REGISTRY_ADDRESS
      ? (process.env.COMPUTE_REGISTRY_ADDRESS as `0x${string}`)
      : null,
    rpcUrl: process.env.JEJU_RPC_URL ?? 'http://localhost:6546',
    operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY
      ? (process.env.OPERATOR_PRIVATE_KEY as `0x${string}`)
      : null,
    chainId: parseInt(process.env.JEJU_CHAIN_ID ?? '420691', 10),
    serviceType: process.env.SERVICE_TYPE ?? 'inference',
    modelId: process.env.MODEL_ID ?? 'eliza-agent',
    endpoint:
      process.env.SERVICE_ENDPOINT ??
      `http://localhost:${process.env.ELIZA_PORT ?? '3000'}`,
    minStake: parseEther(process.env.MIN_ATTESTATION_STAKE ?? '0.1'),
    elizaPort: parseInt(process.env.ELIZA_PORT ?? '3000', 10),
    healthPort: parseInt(process.env.HEALTH_PORT ?? '8080', 10),
    teeEnabled: process.env.TEE_ENABLED === 'true',
    teePlatform: parseInt(process.env.TEE_PLATFORM ?? '4', 10), // 4 = PHALA
    attestationRefreshInterval: parseInt(
      process.env.ATTESTATION_REFRESH_INTERVAL ?? '43200000',
      10,
    ),
  }
}

// ============================================================================
// ABI
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
] as const

// ============================================================================
// Attestation
// ============================================================================

interface Attestation {
  nodeId: `0x${string}`
  mrEnclave: `0x${string}`
  mrSigner: `0x${string}`
  quote: string
  timestamp: number
}

async function getAttestation(): Promise<Attestation | null> {
  const dstackEndpoint = process.env.DSTACK_ATTESTATION_ENDPOINT
  const isProduction = process.env.NODE_ENV === 'production'

  if (!dstackEndpoint) {
    if (isProduction) {
      console.error(
        '[Attestation] FATAL: DSTACK_ATTESTATION_ENDPOINT not set. ' +
          'Cannot register with ComputeRegistry without real TEE attestation in production.',
      )
      return null
    }

    // Development mode - warn loudly but allow mock
    console.warn('⚠️'.repeat(20))
    console.warn(
      '[Attestation] WARNING: Using MOCK attestation - NOT FOR PRODUCTION',
    )
    console.warn(
      '[Attestation] Set DSTACK_ATTESTATION_ENDPOINT for real TEE attestation',
    )
    console.warn('⚠️'.repeat(20))

    const mockNodeId = `0x${'MOCK'.repeat(16)}`
    const mockMrEnclave = `0x${'MOCK'.repeat(16)}`
    const mockMrSigner = `0x${'MOCK'.repeat(16)}`

    return {
      nodeId: mockNodeId as `0x${string}`,
      mrEnclave: mockMrEnclave as `0x${string}`,
      mrSigner: mockMrSigner as `0x${string}`,
      quote: 'MOCK-DEVELOPMENT-ONLY',
      timestamp: Date.now(),
    }
  }

  try {
    const response = await fetch(`${dstackEndpoint}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_data: Buffer.from(Date.now().toString()).toString('hex'),
      }),
    })

    if (response.ok) {
      const data = (await response.json()) as {
        node_id: string
        mr_enclave: string
        mr_signer: string
        quote: string
        timestamp: number
      }

      return {
        nodeId: data.node_id as `0x${string}`,
        mrEnclave: data.mr_enclave as `0x${string}`,
        mrSigner: data.mr_signer as `0x${string}`,
        quote: data.quote,
        timestamp: data.timestamp,
      }
    }

    console.error('[Attestation] Failed to get attestation:', response.status)
    return null
  } catch (error) {
    console.error('[Attestation] Failed to get attestation:', error)
    return null
  }
}

// ============================================================================
// Registration
// ============================================================================

async function registerProvider(config: Config): Promise<boolean> {
  if (!config.autoRegister) {
    console.log('[Register] Auto-registration disabled')
    return false
  }

  if (!config.computeRegistryAddress) {
    console.error('[Register] COMPUTE_REGISTRY_ADDRESS not set')
    return false
  }

  if (!config.operatorPrivateKey) {
    console.error('[Register] OPERATOR_PRIVATE_KEY not set')
    return false
  }

  console.log('[Register] Starting provider registration...')

  // Create clients
  const chain = {
    id: config.chainId,
    name: 'Jeju',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })

  const account = privateKeyToAccount(config.operatorPrivateKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  // Check if already registered
  try {
    const provider = await publicClient.readContract({
      address: config.computeRegistryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'providers',
      args: [account.address],
    })

    const registeredAt = provider[5]
    if (registeredAt > 0n) {
      console.log('[Register] Already registered, refreshing TEE status...')

      // Refresh TEE status
      const hash = await walletClient.writeContract({
        address: config.computeRegistryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'refreshTEEStatus',
        args: [account.address],
      })

      await publicClient.waitForTransactionReceipt({ hash })
      console.log('[Register] TEE status refreshed')
      return true
    }
  } catch {
    // Not registered, continue with registration
  }

  // Get attestation
  const attestation = await getAttestation()
  if (!attestation) {
    console.error('[Register] Failed to get attestation')
    return false
  }

  console.log('[Register] Attestation obtained:', {
    nodeId: `${attestation.nodeId.slice(0, 18)}...`,
    mrEnclave: `${attestation.mrEnclave.slice(0, 18)}...`,
  })

  // Get service type hash
  const serviceTypeHash = await publicClient.readContract({
    address: config.computeRegistryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'SERVICE_INFERENCE',
  })

  // Register
  console.log('[Register] Submitting registration transaction...')

  const hash = await walletClient.writeContract({
    address: config.computeRegistryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'registerWithTEE',
    args: [
      `Eliza TEE Agent - ${config.modelId}`,
      config.endpoint,
      attestation.nodeId,
      config.teePlatform,
      attestation.mrEnclave,
      attestation.mrSigner,
      serviceTypeHash,
    ],
    value: config.minStake,
  })

  console.log('[Register] Transaction submitted:', hash)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (receipt.status === 'success') {
    console.log('[Register] Provider registered successfully')
    return true
  } else {
    console.error('[Register] Registration failed')
    return false
  }
}

// ============================================================================
// Eliza Runtime
// ============================================================================

async function startEliza(config: Config): Promise<void> {
  console.log('[Eliza] Starting Eliza agent...')

  // Start Eliza as subprocess
  const _elizaProcess = spawn({
    cmd: ['bun', 'run', 'start'],
    cwd: '/app/eliza',
    env: {
      ...process.env,
      PORT: config.elizaPort.toString(),
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })

  // Wait for Eliza to be ready
  const maxWait = 60000
  const startTime = Date.now()

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(
        `http://localhost:${config.elizaPort}/health`,
        {
          signal: AbortSignal.timeout(5000),
        },
      )
      if (response.ok) {
        console.log('[Eliza] Agent is ready')
        return
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Eliza failed to start within timeout')
}

// ============================================================================
// Health Service
// ============================================================================

async function startHealthService(config: Config): Promise<void> {
  console.log('[Health] Starting health service...')

  // Import and start health service
  await import('./health-service.js')

  console.log(`[Health] Health service running on port ${config.healthPort}`)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60))
  console.log('  ELIZA TEE CONTAINER STARTUP')
  console.log('='.repeat(60))

  const config = loadConfig()

  console.log('\nConfiguration:')
  console.log(`  Auto-register: ${config.autoRegister}`)
  console.log(`  TEE enabled: ${config.teeEnabled}`)
  console.log(`  Model ID: ${config.modelId}`)
  console.log(`  Endpoint: ${config.endpoint}`)
  console.log(`  Eliza port: ${config.elizaPort}`)
  console.log(`  Health port: ${config.healthPort}`)

  // Start health service first
  await startHealthService(config)

  // Start Eliza
  await startEliza(config)

  // Register with ComputeRegistry
  if (config.autoRegister && config.computeRegistryAddress) {
    const registered = await registerProvider(config)
    if (!registered) {
      console.warn(
        '[Startup] Registration failed, continuing without registration',
      )
    }
  }

  // Schedule periodic attestation refresh
  if (config.autoRegister && config.teeEnabled) {
    setInterval(async () => {
      console.log('[Attestation] Refreshing registration...')
      await registerProvider(config)
    }, config.attestationRefreshInterval)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('  ELIZA TEE CONTAINER READY')
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('Startup failed:', error)
  process.exit(1)
})
