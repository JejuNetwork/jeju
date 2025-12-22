#!/usr/bin/env bun
/**
 * Deploy TEE GPU Provider for DWS
 *
 * This script deploys and provisions H200/H100 GPU nodes with TEE support
 * for decentralized training workloads.
 *
 * Usage:
 *   bun scripts/deploy-tee-gpu.ts [--gpu-type=h200|h100] [--count=N] [--provider=phala|local]
 */

import { parseArgs } from 'node:util'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, localhost } from 'viem/chains'
import {
  createTEEGPUProvider,
  GPUType,
  type TEEGPUProvider,
  TEEProvider,
} from '../apps/dws/src/containers/tee-gpu-provider'

// ============================================================================
// Configuration
// ============================================================================

interface DeployConfig {
  gpuType: 'h200' | 'h100'
  gpuCount: number
  nodeCount: number
  teeProvider: TEEProvider
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsEndpoint: string
  phalaEndpoint?: string
  phalaApiKey?: string
}

function getConfig(): DeployConfig {
  const { values } = parseArgs({
    options: {
      'gpu-type': { type: 'string', default: 'h200' },
      'gpu-count': { type: 'string', default: '8' },
      'node-count': { type: 'string', default: '1' },
      provider: { type: 'string', default: 'local' },
      network: { type: 'string', default: 'localnet' },
      'dws-endpoint': { type: 'string' },
      'phala-endpoint': { type: 'string' },
      'phala-api-key': { type: 'string' },
    },
  })

  const network = (values.network ?? 'localnet') as
    | 'localnet'
    | 'testnet'
    | 'mainnet'

  // Default endpoints based on network
  const defaultDwsEndpoints: Record<string, string> = {
    localnet: 'http://localhost:4030',
    testnet: 'https://dws-testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
  }

  return {
    gpuType: (values['gpu-type'] ?? 'h200') as 'h200' | 'h100',
    gpuCount: parseInt(values['gpu-count'] ?? '8', 10),
    nodeCount: parseInt(values['node-count'] ?? '1', 10),
    teeProvider: (values.provider === 'phala'
      ? TEEProvider.PHALA
      : TEEProvider.LOCAL) as TEEProvider,
    network,
    dwsEndpoint:
      values['dws-endpoint'] ??
      defaultDwsEndpoints[network] ??
      defaultDwsEndpoints.localnet,
    phalaEndpoint: values['phala-endpoint'] ?? process.env.PHALA_ENDPOINT,
    phalaApiKey: values['phala-api-key'] ?? process.env.PHALA_API_KEY,
  }
}

// ============================================================================
// Deployment
// ============================================================================

async function deploy() {
  const config = getConfig()
  console.log('='.repeat(60))
  console.log('TEE GPU Deployment')
  console.log('='.repeat(60))
  console.log(`GPU Type: ${config.gpuType.toUpperCase()}`)
  console.log(`GPUs per Node: ${config.gpuCount}`)
  console.log(`Node Count: ${config.nodeCount}`)
  console.log(`TEE Provider: ${config.teeProvider}`)
  console.log(`Network: ${config.network}`)
  console.log(`DWS Endpoint: ${config.dwsEndpoint}`)
  if (config.phalaEndpoint) {
    console.log(`Phala Endpoint: ${config.phalaEndpoint}`)
  }
  console.log('='.repeat(60))

  // Get deployer account
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex
  if (!privateKey) {
    console.error('Error: DEPLOYER_PRIVATE_KEY environment variable required')
    process.exit(1)
  }

  const account = privateKeyToAccount(privateKey)
  console.log(`Deployer: ${account.address}`)

  // Setup clients
  const chain = config.network === 'localnet' ? localhost : baseSepolia
  const rpcUrl =
    process.env.RPC_URL ??
    (config.network === 'localnet' ? 'http://localhost:9545' : undefined)

  createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  console.log(`\nChain: ${chain.name}`)

  // Deploy GPU nodes
  const providers: TEEGPUProvider[] = []

  for (let i = 0; i < config.nodeCount; i++) {
    const nodeId = `${config.gpuType}-node-${Date.now()}-${i}`
    console.log(`\n[${i + 1}/${config.nodeCount}] Deploying node: ${nodeId}`)

    const provider = createTEEGPUProvider({
      gpuType: config.gpuType === 'h200' ? GPUType.H200 : GPUType.H100,
      nodeId,
      address: account.address,
      endpoint: config.dwsEndpoint,
      teeProvider: config.teeProvider,
      teeEndpoint: config.phalaEndpoint,
      teeApiKey: config.phalaApiKey,
      gpuCount: config.gpuCount,
    })

    // Initialize provider
    const attestation = await provider.initialize()
    console.log(`  Attestation: ${attestation.mrEnclave.slice(0, 20)}...`)
    console.log(`  Provider: ${attestation.provider}`)
    console.log(`  Timestamp: ${new Date(attestation.timestamp).toISOString()}`)

    providers.push(provider)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('Deployment Complete')
  console.log(`${'='.repeat(60)}`)
  console.log(`Total Nodes: ${providers.length}`)
  console.log(`Total GPUs: ${providers.length * config.gpuCount}`)
  console.log(`GPU Type: ${config.gpuType.toUpperCase()}`)

  // Register with DWS
  console.log('\nRegistering with DWS...')

  try {
    const registerResponse = await fetch(
      `${config.dwsEndpoint}/compute/nodes/register`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': account.address,
        },
        body: JSON.stringify({
          address: account.address,
          gpuTier: config.gpuType === 'h200' ? 5 : 4, // H200 = tier 5, H100 = tier 4
          capabilities: [
            'tee',
            config.gpuType === 'h200' ? GPUType.H200 : GPUType.H100,
            'fp8',
            'tensor-cores',
          ],
        }),
      },
    )

    if (!registerResponse.ok) {
      console.warn(
        `Warning: DWS registration returned ${registerResponse.status}`,
      )
    } else {
      const result = await registerResponse.json()
      console.log(`Registered with DWS: ${JSON.stringify(result)}`)
    }
  } catch (error) {
    console.warn(`Warning: Could not register with DWS: ${error}`)
  }

  // Test job submission
  console.log('\nSubmitting test job...')

  const testProvider = providers[0]
  if (testProvider) {
    const jobId = `test-${Date.now()}`
    const request = {
      jobId,
      imageRef: 'ghcr.io/jeju-network/training:latest',
      command: [
        'python',
        '-c',
        'import torch; print(torch.cuda.is_available())',
      ],
      env: {},
      resources: {
        cpuCores: 8,
        memoryMb: 32768,
        storageMb: 51200,
        gpuType: config.gpuType === 'h200' ? GPUType.H200 : GPUType.H100,
        gpuCount: 1,
      },
      input: {
        trajectoryManifestCID: 'test-trajectories',
        rewardsManifestCID: 'test-rewards',
        policyModelCID: 'test-policy',
        rlConfig: { batchSize: 32, learningRate: 0.0001 },
      },
      attestationRequired: true,
    }

    await testProvider.submitJob(request)
    console.log(`Test job submitted: ${jobId}`)

    // Wait for completion
    let attempts = 0
    const maxAttempts = 30
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000))
      const status = testProvider.getJobStatus(jobId)

      if (status.status === 'completed') {
        console.log('\nTest job completed.')
        console.log(`Output CID: ${status.result?.outputCID}`)
        if (status.result?.metrics) {
          console.log(`Training Loss: ${status.result.metrics.trainingLoss}`)
          console.log(
            `GPU Utilization: ${status.result.metrics.gpuUtilization}%`,
          )
        }
        if (status.result?.attestation) {
          console.log(
            `Attestation: ${status.result.attestation.mrEnclave.slice(0, 20)}...`,
          )
        }
        break
      } else if (status.status === 'failed') {
        console.error(`Test job failed: ${status.result?.error}`)
        break
      }

      attempts++
    }

    if (attempts >= maxAttempts) {
      console.warn('Test job timed out (this may be normal for local mode)')
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('GPU nodes are ready for training workloads.')
  console.log('='.repeat(60))

  // Keep running to serve requests
  if (config.teeProvider !== TEEProvider.LOCAL) {
    console.log('\nPress Ctrl+C to shutdown...')
    await new Promise(() => {
      /* keep process running */
    })
  }
}

// ============================================================================
// Main
// ============================================================================

deploy().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
