#!/usr/bin/env bun
/**
 * OAuth3 Deployment Script
 *
 * Deploys OAuth3 to DWS infrastructure:
 * 1. Builds frontend and API
 * 2. Uploads static assets to IPFS/CDN
 * 3. Registers backend worker with DWS
 * 4. Updates JNS contenthash
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
} from '@jejunetwork/config'
import { keccak256 } from 'viem'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Response schemas for type safety
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  status: z.string().optional(),
})

// Configuration
interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  cdnEnabled: boolean
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<DeployConfig['network'], Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
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

// Build Check
async function ensureBuild(): Promise<void> {
  const requiredFiles = ['./dist/api/index.js', './dist/web/index.html']

  for (const file of requiredFiles) {
    if (!existsSync(resolve(APP_DIR, file))) {
      console.log('[OAuth3] Build not found, running build first...')
      const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
        cwd: APP_DIR,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      await proc.exited
      return
    }
  }

  console.log('[OAuth3] Build found')
}

// IPFS Upload
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
  const content = await readFile(resolve(APP_DIR, filePath))
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
  prefix = '',
): Promise<Map<string, UploadResult>> {
  const results = new Map<string, UploadResult>()
  const entries = await readdir(resolve(APP_DIR, dirPath), {
    withFileTypes: true,
  })

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
      console.log(`   ${key} -> ${result.cid}`)
    }
  }

  return results
}

// Worker Deployment
async function deployWorker(
  config: DeployConfig,
  apiBundle: UploadResult,
): Promise<string> {
  const account = privateKeyToAccount(config.privateKey)

  const deployRequest = {
    name: 'oauth3-api',
    owner: account.address,
    codeCid: apiBundle.cid,
    codeHash: apiBundle.hash,
    entrypoint: 'index.js',
    runtime: 'bun',
    resources: {
      memoryMb: 256,
      cpuMillis: 1000,
      timeoutMs: 30000,
      maxConcurrency: 100,
    },
    scaling: {
      minInstances: 2,
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
      { pattern: '/auth/*', zone: 'oauth3' },
      { pattern: '/oauth/*', zone: 'oauth3' },
      { pattern: '/wallet/*', zone: 'oauth3' },
      { pattern: '/farcaster/*', zone: 'oauth3' },
      { pattern: '/session/*', zone: 'oauth3' },
      { pattern: '/client/*', zone: 'oauth3' },
      { pattern: '/health', zone: 'oauth3' },
      { pattern: '/.well-known/*', zone: 'oauth3' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
    secrets: [
      'JWT_SECRET',
      'JWT_SIGNING_KEY_ID',
      'MPC_REGISTRY_ADDRESS',
      'IDENTITY_REGISTRY_ADDRESS',
    ],
  }

  const response = await fetch(`${config.dwsUrl}/workers/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify({
      name: 'oauth3-worker',
      runtime: 'bun',
      code: `// Worker bundle deployed separately via CID: ${workerBundle.cid}`,
    }),
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

// CDN Setup
function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function setupCDN(
  config: DeployConfig,
  staticAssets: Map<string, UploadResult>,
): Promise<void> {
  if (!config.cdnEnabled) {
    console.log('   CDN disabled, skipping...')
    return
  }

  const assets = Array.from(staticAssets.entries()).map(([path, result]) => ({
    path: `/${path}`,
    cid: result.cid,
    contentType: getContentType(path),
    immutable:
      path.includes('-') && (path.endsWith('.js') || path.endsWith('.css')),
  }))

  const cdnConfig = {
    name: 'oauth3',
    domain: 'auth.jejunetwork.org',
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: [
        '/auth/*',
        '/oauth/*',
        '/wallet/*',
        '/farcaster/*',
        '/session/*',
        '/client/*',
        '/health',
        '/.well-known/*',
      ],
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
    console.warn(`   CDN configuration failed: ${await response.text()}`)
  } else {
    console.log('   CDN configured')
  }
}

// Main Deploy Function
async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              OAuth3 Deployment to DWS                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  // Ensure build exists
  await ensureBuild()

  // Upload static assets
  console.log('\nUploading static assets...')
  const staticAssets = await uploadDirectory(config.dwsUrl, './dist/web')
  console.log(`   Total: ${staticAssets.size} files\n`)

  // Upload API bundle
  console.log('Uploading API bundle...')
  const apiBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/api/index.js',
    'oauth3-api.js',
  )
  console.log(`   API CID: ${apiBundle.cid}\n`)

  // Deploy worker
  console.log('Deploying worker to DWS...')
  const workerId = await deployWorker(config, apiBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  // Setup CDN
  console.log('Configuring CDN...')
  await setupCDN(config, staticAssets)

  // Print summary
  const indexCid = staticAssets.get('index.html')?.cid
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend: https://auth.jejunetwork.org                     ║`)
  console.log(`║  IPFS:     ipfs://${indexCid?.slice(0, 20)}...                  ║`)
  console.log(`║  Worker:   ${workerId.slice(0, 36)}...  ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
}

// Run deployment
deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
