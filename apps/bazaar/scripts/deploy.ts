/**
 * Bazaar Deployment Script
 *
 * Deploys Bazaar to DWS infrastructure:
 * 1. Builds frontend and worker
 * 2. Uploads static assets to IPFS/CDN
 * 3. Registers worker with DWS network
 * 4. Updates on-chain registry
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCoreAppUrl, getL1RpcUrl } from '@jejunetwork/config/ports'
import { $ } from 'bun'
import { type Address, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  DWSWorkerDeployResponseSchema,
  IPFSUploadResponseSchema,
} from '../schemas/api'

// ============================================================================
// Configuration
// ============================================================================

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  workerRegistryAddress: Address
  cdnEnabled: boolean
}

function getConfig(): DeployConfig {
  const network = (process.env.NETWORK || 'localnet') as DeployConfig['network']

  const configs: Record<DeployConfig['network'], Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL1RpcUrl(),
      workerRegistryAddress:
        '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      workerRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address, // Set via WORKER_REGISTRY_ADDRESS env
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      workerRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address, // Set via WORKER_REGISTRY_ADDRESS env
    },
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}`,
    cdnEnabled: process.env.CDN_ENABLED !== 'false',
  } as DeployConfig
}

// ============================================================================
// Build Check
// ============================================================================

async function checkBuild(): Promise<void> {
  const requiredFiles = [
    './dist/static/index.html',
    './dist/worker/worker.js',
    './dist/deployment.json',
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      console.log('Build not found, running build first...')
      await $`bun run scripts/build.ts`
      return
    }
  }

  console.log('✅ Build found')
}

// ============================================================================
// IPFS Upload
// ============================================================================

interface UploadResult {
  cid: string
  hash: `0x${string}`
  size: number
}

async function uploadToIPFS(
  dwsUrl: string,
  filePath: string,
  name: string,
): Promise<UploadResult> {
  const content = await readFile(filePath)
  const hash = keccak256(content) as `0x${string}`

  const formData = new FormData()
  formData.append('file', new Blob([content]), name)
  formData.append('name', name)

  const response = await fetch(`${dwsUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid upload response: ${parsed.error.message}`)
  }

  return {
    cid: parsed.data.cid,
    hash,
    size: content.length,
  }
}

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  prefix: string = '',
): Promise<Map<string, UploadResult>> {
  const results = new Map<string, UploadResult>()
  const entries = await readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    const key = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const subResults = await uploadDirectory(dwsUrl, fullPath, key)
      for (const [k, v] of subResults) {
        results.set(k, v)
      }
    } else {
      const result = await uploadToIPFS(dwsUrl, fullPath, key)
      results.set(key, result)
      console.log(`   📤 ${key} -> ${result.cid}`)
    }
  }

  return results
}

// ============================================================================
// Worker Deployment
// ============================================================================

async function deployWorker(
  config: DeployConfig,
  workerBundle: UploadResult,
): Promise<string> {
  const deployRequest = {
    name: 'bazaar-api',
    owner: privateKeyToAccount(config.privateKey).address,
    codeCid: workerBundle.cid,
    codeHash: workerBundle.hash,
    entrypoint: 'worker.js',
    runtime: 'workerd',
    resources: {
      memoryMb: 256,
      cpuMillis: 1000,
      timeoutMs: 30000,
      maxConcurrency: 100,
    },
    scaling: {
      minInstances: 1,
      maxInstances: 10,
      targetConcurrency: 5,
      scaleToZero: false,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: false,
      teePreferred: true,
      minNodeReputation: 50,
    },
    routes: [
      { pattern: '/api/*', zone: 'bazaar' },
      { pattern: '/health', zone: 'bazaar' },
      { pattern: '/.well-known/*', zone: 'bazaar' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
    secrets: ['PRIVATE_KEY', 'COVENANTSQL_PRIVATE_KEY'],
    database: {
      type: 'covenantsql',
      name: 'bazaar-db',
    },
  }

  const response = await fetch(`${config.dwsUrl}/workers/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deployRequest),
  })

  if (!response.ok) {
    throw new Error(`Worker deployment failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = DWSWorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid deploy response: ${parsed.error.message}`)
  }
  return parsed.data.workerId
}

// ============================================================================
// CDN Setup
// ============================================================================

async function setupCDN(
  config: DeployConfig,
  staticAssets: Map<string, UploadResult>,
): Promise<void> {
  if (!config.cdnEnabled) {
    console.log('   CDN disabled, skipping...')
    return
  }

  // Register static assets with CDN
  const assets = Array.from(staticAssets.entries()).map(([path, result]) => ({
    path: `/${path}`,
    cid: result.cid,
    contentType: getContentType(path),
    immutable:
      path.includes('-') && (path.endsWith('.js') || path.endsWith('.css')),
  }))

  const cdnConfig = {
    name: 'bazaar',
    domain: 'bazaar.jejunetwork.org',
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: ['/api/*', '/health', '/.well-known/*'],
    },
    assets,
    cacheRules: [
      { pattern: '/assets/**', ttl: 31536000, immutable: true },
      { pattern: '/*.js', ttl: 86400 },
      { pattern: '/*.css', ttl: 86400 },
      { pattern: '/index.html', ttl: 60, staleWhileRevalidate: 3600 },
    ],
  }

  const response = await fetch(`${config.dwsUrl}/cdn/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cdnConfig),
  })

  if (!response.ok) {
    console.warn(`   ⚠️ CDN configuration failed: ${await response.text()}`)
  } else {
    console.log('   ✅ CDN configured')
  }
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

// ============================================================================
// Main Deploy Function
// ============================================================================

async function deploy(): Promise<void> {
  console.log('🚀 Deploying Bazaar to DWS...\n')

  const config = getConfig()
  console.log(`📡 Network: ${config.network}`)
  console.log(`🌐 DWS: ${config.dwsUrl}\n`)

  // Check build exists
  await checkBuild()

  // Upload static assets
  console.log('\n📦 Uploading static assets...')
  const staticAssets = await uploadDirectory(config.dwsUrl, './dist/static')
  console.log(`   Total: ${staticAssets.size} files\n`)

  // Upload worker bundle
  console.log('📦 Uploading worker bundle...')
  const workerBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/worker/worker.js',
    'bazaar-api-worker.js',
  )
  console.log(`   Worker CID: ${workerBundle.cid}\n`)

  // Deploy worker
  console.log('🔧 Deploying worker to DWS...')
  const workerId = await deployWorker(config, workerBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  // Setup CDN
  console.log('🌐 Configuring CDN...')
  await setupCDN(config, staticAssets)

  // Print summary
  const indexCid = staticAssets.get('index.html')?.cid
  console.log('\n✅ Deployment complete!')
  console.log('\n📍 Endpoints:')
  console.log(`   Frontend: https://bazaar.jejunetwork.org`)
  console.log(`   IPFS: ipfs://${indexCid}`)
  console.log(`   API: ${config.dwsUrl}/workers/${workerId}`)
  console.log(`   Health: ${config.dwsUrl}/workers/${workerId}/health`)
}

// Run deployment
deploy().catch((error) => {
  console.error('❌ Deployment failed:', error)
  process.exit(1)
})
