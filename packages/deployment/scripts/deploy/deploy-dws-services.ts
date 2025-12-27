#!/usr/bin/env bun
/**
 * Deploy Decentralized Services to DWS
 *
 * This script provisions OAuth3, Farcaster, Messaging, and KMS as
 * fully decentralized services on DWS with on-chain registration.
 *
 * Usage:
 *   bun run scripts/deploy/deploy-dws-services.ts --network localnet|testnet|mainnet
 *
 * Process:
 * 1. Build and bundle each service worker
 * 2. Upload to IPFS
 * 3. Register on-chain via DWSServiceProvisioning
 * 4. Wait for DWS nodes to deploy
 * 5. Activate services
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'

const NETWORK_CONFIGS = {
  mainnet: { chain: base, rpcUrl: 'https://mainnet.base.org' },
  testnet: { chain: baseSepolia, rpcUrl: 'https://sepolia.base.org' },
  localnet: { chain: foundry, rpcUrl: 'http://localhost:6546' },
} as const

type Network = keyof typeof NETWORK_CONFIGS

interface ServiceDefinition {
  name: string
  category: string
  entrypoint: string
  runtime: 'workerd' | 'bun' | 'docker'
  requirements: {
    minMemoryMb: number
    minCpuMillis: number
    minStorageMb: number
    teeRequired: boolean
    teePlatform: string
    minInstances: number
    maxInstances: number
    minNodeStake: bigint
    minNodeReputation: bigint
    mpcRequired: boolean
    mpcClusterId: `0x${string}`
  }
  pricing: {
    basePrice: bigint
    minPrice: bigint
    maxPrice: bigint
    pricePerSecond: bigint
    pricePerMb: bigint
  }
  sourceDir: string
}

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

const SERVICES: ServiceDefinition[] = [
  {
    name: 'oauth3',
    category: 'auth',
    entrypoint: 'dws-worker/index.ts',
    runtime: 'bun',
    requirements: {
      minMemoryMb: 256,
      minCpuMillis: 500,
      minStorageMb: 100,
      teeRequired: true,
      teePlatform: '',
      minInstances: 3,
      maxInstances: 10,
      minNodeStake: 1000n * 10n ** 18n,
      minNodeReputation: 100n,
      mpcRequired: true,
      mpcClusterId: ZERO_BYTES32,
    },
    pricing: {
      basePrice: 1000000n,
      minPrice: 500000n,
      maxPrice: 5000000n,
      pricePerSecond: 100n,
      pricePerMb: 1000n,
    },
    sourceDir: 'packages/auth/src',
  },
  {
    name: 'farcaster-signer',
    category: 'social',
    entrypoint: 'dws-worker/index.ts',
    runtime: 'bun',
    requirements: {
      minMemoryMb: 128,
      minCpuMillis: 250,
      minStorageMb: 50,
      teeRequired: true,
      teePlatform: '',
      minInstances: 2,
      maxInstances: 8,
      minNodeStake: 500n * 10n ** 18n,
      minNodeReputation: 50n,
      mpcRequired: true,
      mpcClusterId: ZERO_BYTES32,
    },
    pricing: {
      basePrice: 500000n,
      minPrice: 250000n,
      maxPrice: 2000000n,
      pricePerSecond: 50n,
      pricePerMb: 500n,
    },
    sourceDir: 'packages/farcaster/src',
  },
  {
    name: 'messaging-relay',
    category: 'communication',
    entrypoint: 'dws-worker/index.ts',
    runtime: 'bun',
    requirements: {
      minMemoryMb: 512,
      minCpuMillis: 500,
      minStorageMb: 1024,
      teeRequired: false,
      teePlatform: '',
      minInstances: 5,
      maxInstances: 20,
      minNodeStake: 200n * 10n ** 18n,
      minNodeReputation: 25n,
      mpcRequired: false,
      mpcClusterId: ZERO_BYTES32,
    },
    pricing: {
      basePrice: 100000n,
      minPrice: 50000n,
      maxPrice: 500000n,
      pricePerSecond: 10n,
      pricePerMb: 100n,
    },
    sourceDir: 'packages/messaging/src',
  },
  {
    name: 'kms-api',
    category: 'security',
    entrypoint: 'dws-worker/api.ts',
    runtime: 'bun',
    requirements: {
      minMemoryMb: 256,
      minCpuMillis: 500,
      minStorageMb: 100,
      teeRequired: true,
      teePlatform: '',
      minInstances: 3,
      maxInstances: 10,
      minNodeStake: 2000n * 10n ** 18n,
      minNodeReputation: 200n,
      mpcRequired: true,
      mpcClusterId: ZERO_BYTES32,
    },
    pricing: {
      basePrice: 2000000n,
      minPrice: 1000000n,
      maxPrice: 10000000n,
      pricePerSecond: 200n,
      pricePerMb: 2000n,
    },
    sourceDir: 'packages/kms/src',
  },
]

const SERVICE_PROVISIONING_ABI = [
  {
    name: 'provisionService',
    type: 'function',
    inputs: [
      { name: 'serviceName', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'codeCid', type: 'string' },
      { name: 'codeHash', type: 'bytes32' },
      { name: 'entrypoint', type: 'string' },
      { name: 'runtime', type: 'string' },
      {
        name: 'requirements',
        type: 'tuple',
        components: [
          { name: 'minMemoryMb', type: 'uint256' },
          { name: 'minCpuMillis', type: 'uint256' },
          { name: 'minStorageMb', type: 'uint256' },
          { name: 'teeRequired', type: 'bool' },
          { name: 'teePlatform', type: 'string' },
          { name: 'minInstances', type: 'uint256' },
          { name: 'maxInstances', type: 'uint256' },
          { name: 'minNodeStake', type: 'uint256' },
          { name: 'minNodeReputation', type: 'uint256' },
          { name: 'mpcRequired', type: 'bool' },
          { name: 'mpcClusterId', type: 'bytes32' },
        ],
      },
      {
        name: 'pricing',
        type: 'tuple',
        components: [
          { name: 'basePrice', type: 'uint256' },
          { name: 'minPrice', type: 'uint256' },
          { name: 'maxPrice', type: 'uint256' },
          { name: 'pricePerSecond', type: 'uint256' },
          { name: 'pricePerMb', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'serviceId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'activateService',
    type: 'function',
    inputs: [{ name: 'serviceId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getServiceEndpoints',
    type: 'function',
    inputs: [{ name: 'serviceId', type: 'bytes32' }],
    outputs: [{ name: 'endpoints', type: 'string[]' }],
    stateMutability: 'view',
  },
] as const

async function bundleService(
  rootDir: string,
  service: ServiceDefinition,
): Promise<{ code: string; hash: `0x${string}` }> {
  console.log(`Building ${service.name}...`)

  const entryPath = join(rootDir, service.sourceDir, service.entrypoint)

  if (!existsSync(entryPath)) {
    console.log(`  Skipping ${service.name}: entry point not found`)
    return { code: '', hash: ZERO_BYTES32 }
  }

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    external: ['viem', 'elysia'],
  })

  if (!result.success) {
    throw new Error(
      `Build failed for ${service.name}: ${result.logs.join('\n')}`,
    )
  }

  const code = await result.outputs[0].text()
  const hash = keccak256(toBytes(code))

  console.log(
    `  Built ${service.name}: ${code.length} bytes, hash: ${hash.slice(0, 18)}...`,
  )

  return { code, hash }
}

async function uploadToIPFS(
  ipfsUrl: string,
  content: string,
  name: string,
): Promise<string> {
  console.log(`Uploading ${name} to IPFS...`)

  const formData = new FormData()
  formData.append(
    'file',
    new Blob([content], { type: 'application/javascript' }),
    name,
  )

  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.status}`)
  }

  const result = (await response.json()) as { Hash: string; Size: string }
  console.log(`  Uploaded: ${result.Hash} (${result.Size} bytes)`)

  return result.Hash
}

async function provisionService(
  privateKey: `0x${string}`,
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  serviceProvisioningAddress: `0x${string}`,
  service: ServiceDefinition,
  codeCid: string,
  codeHash: `0x${string}`,
): Promise<`0x${string}`> {
  console.log(`Provisioning ${service.name} on-chain...`)

  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const hash = await walletClient.writeContract({
    address: serviceProvisioningAddress,
    abi: SERVICE_PROVISIONING_ABI,
    functionName: 'provisionService',
    args: [
      service.name,
      service.category,
      codeCid,
      codeHash,
      service.entrypoint,
      service.runtime,
      {
        minMemoryMb: BigInt(service.requirements.minMemoryMb),
        minCpuMillis: BigInt(service.requirements.minCpuMillis),
        minStorageMb: BigInt(service.requirements.minStorageMb),
        teeRequired: service.requirements.teeRequired,
        teePlatform: service.requirements.teePlatform,
        minInstances: BigInt(service.requirements.minInstances),
        maxInstances: BigInt(service.requirements.maxInstances),
        minNodeStake: service.requirements.minNodeStake,
        minNodeReputation: service.requirements.minNodeReputation,
        mpcRequired: service.requirements.mpcRequired,
        mpcClusterId: service.requirements.mpcClusterId,
      },
      {
        basePrice: service.pricing.basePrice,
        minPrice: service.pricing.minPrice,
        maxPrice: service.pricing.maxPrice,
        pricePerSecond: service.pricing.pricePerSecond,
        pricePerMb: service.pricing.pricePerMb,
      },
    ],
  })

  console.log(`  Transaction: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  const serviceId = keccak256(toBytes(`${service.name}:${receipt.blockNumber}`))

  console.log(`  Service ID: ${serviceId}`)

  return serviceId
}

async function waitForDeployments(
  rpcUrl: string,
  chain: (typeof NETWORK_CONFIGS)[Network]['chain'],
  serviceProvisioningAddress: `0x${string}`,
  serviceId: `0x${string}`,
  minInstances: number,
  timeoutMs: number = 300000,
): Promise<string[]> {
  console.log(`Waiting for ${minInstances} deployments...`)

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const endpoints = (await publicClient.readContract({
      address: serviceProvisioningAddress,
      abi: SERVICE_PROVISIONING_ABI,
      functionName: 'getServiceEndpoints',
      args: [serviceId],
    })) as string[]

    if (endpoints.length >= minInstances) {
      console.log(`  ${endpoints.length} deployments active`)
      return endpoints
    }

    console.log(`  ${endpoints.length}/${minInstances} deployments, waiting...`)
    await Bun.sleep(10000)
  }

  throw new Error('Timeout waiting for deployments')
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    network: { type: 'string', short: 'n', default: 'localnet' },
    'dry-run': { type: 'boolean', default: false },
    'skip-wait': { type: 'boolean', default: false },
    service: { type: 'string', short: 's' },
  },
})

async function main() {
  const network = (values.network ?? 'localnet') as Network
  const dryRun = values['dry-run'] ?? false
  const skipWait = values['skip-wait'] ?? false
  const targetService = values.service

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as
    | `0x${string}`
    | undefined
  const serviceProvisioningAddress = process.env.SERVICE_PROVISIONING_ADDRESS as
    | `0x${string}`
    | undefined
  const ipfsUrl = process.env.IPFS_URL ?? 'http://localhost:5001'

  if (!dryRun) {
    if (!privateKey) {
      console.error('DEPLOYER_PRIVATE_KEY environment variable required')
      process.exit(1)
    }

    if (!serviceProvisioningAddress) {
      console.error(
        'SERVICE_PROVISIONING_ADDRESS environment variable required',
      )
      process.exit(1)
    }
  }

  const networkConfig = NETWORK_CONFIGS[network]
  const rootDir = process.cwd()

  console.log(`\nDeploying decentralized services to ${network}\n`)
  console.log('='.repeat(60))
  console.log(`  Network: ${network}`)
  console.log(`  RPC: ${networkConfig.rpcUrl}`)
  console.log(`  IPFS: ${ipfsUrl}`)
  console.log(`  Dry Run: ${dryRun}`)
  console.log('='.repeat(60))

  const servicesToDeploy = targetService
    ? SERVICES.filter((s) => s.name === targetService)
    : SERVICES

  if (servicesToDeploy.length === 0) {
    console.error(`Service not found: ${targetService}`)
    process.exit(1)
  }

  const deployedServices: {
    name: string
    serviceId: `0x${string}`
    codeCid: string
    endpoints: string[]
  }[] = []

  for (const service of servicesToDeploy) {
    console.log(`\n[${service.name}]`)

    const { code, hash } = await bundleService(rootDir, service)

    if (!code) {
      console.log(`  Skipped: No code to deploy`)
      continue
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would upload ${code.length} bytes to IPFS`)
      console.log(`  [DRY RUN] Would provision service on-chain`)
      continue
    }

    const codeCid = await uploadToIPFS(ipfsUrl, code, `${service.name}.js`)

    // After dryRun check above, privateKey and serviceProvisioningAddress are validated
    if (!privateKey || !serviceProvisioningAddress) {
      throw new Error(
        'Configuration missing: privateKey and serviceProvisioningAddress required',
      )
    }

    const serviceId = await provisionService(
      privateKey,
      networkConfig.rpcUrl,
      networkConfig.chain,
      serviceProvisioningAddress,
      service,
      codeCid,
      hash,
    )

    let endpoints: string[] = []
    if (!skipWait) {
      endpoints = await waitForDeployments(
        networkConfig.rpcUrl,
        networkConfig.chain,
        serviceProvisioningAddress,
        serviceId,
        1,
        60000,
      )
    }

    deployedServices.push({
      name: service.name,
      serviceId,
      codeCid,
      endpoints,
    })

    if (endpoints.length > 0) {
      console.log(`  Deployed: ${endpoints[0]}`)
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Complete - no changes made')
    return
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('\nDeployment Summary:\n')

  for (const svc of deployedServices) {
    console.log(`${svc.name}:`)
    console.log(`  Service ID: ${svc.serviceId}`)
    console.log(`  Code CID: ${svc.codeCid}`)
    if (svc.endpoints.length > 0) {
      console.log(`  Endpoints: ${svc.endpoints.join(', ')}`)
    }
    console.log()
  }

  const deploymentsDir = join(rootDir, 'deployments')
  if (!existsSync(deploymentsDir)) {
    await Bun.write(join(deploymentsDir, '.gitkeep'), '')
  }

  await Bun.write(
    join(deploymentsDir, `dws-services-${network}.json`),
    JSON.stringify(
      {
        network,
        deployedAt: new Date().toISOString(),
        services: deployedServices,
      },
      null,
      2,
    ),
  )

  console.log(
    `Deployment manifest written to deployments/dws-services-${network}.json`,
  )
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
