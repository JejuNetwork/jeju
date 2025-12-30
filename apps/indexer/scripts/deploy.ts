#!/usr/bin/env bun
/**
 * Indexer Deployment Script
 *
 * Deploys Indexer to DWS infrastructure.
 * Note: The indexer uses SQLit for decentralized database storage.
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
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  status: z.string().optional(),
})

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

async function ensureBuild(): Promise<void> {
  if (!existsSync(resolve(APP_DIR, 'lib/api/api-server.js'))) {
    console.log('[Indexer] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.exited
  }
  console.log('[Indexer] Build found')
}

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

async function deployWorker(
  config: DeployConfig,
  apiBundle: UploadResult,
): Promise<string> {
  const account = privateKeyToAccount(config.privateKey)

  const deployRequest = {
    name: 'indexer-api',
    owner: account.address,
    codeCid: apiBundle.cid,
    codeHash: apiBundle.hash,
    entrypoint: 'api-server.js',
    runtime: 'bun',
    resources: {
      memoryMb: 1024,
      cpuMillis: 4000,
      timeoutMs: 30000,
      maxConcurrency: 100,
    },
    scaling: {
      minInstances: 2,
      maxInstances: 10,
      targetConcurrency: 10,
      scaleToZero: false,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: false,
      teePreferred: false,
      minNodeReputation: 50,
    },
    routes: [
      { pattern: '/api/*', zone: 'indexer' },
      { pattern: '/graphql', zone: 'indexer' },
      { pattern: '/health', zone: 'indexer' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
      // SQLit will be configured via DWS database service
      DB_TYPE: 'sqlit',
    },
    secrets: [],
    database: {
      type: 'sqlit',
      name: 'indexer',
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
    name: 'indexer',
    domain: 'indexer.jejunetwork.org',
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: ['/api/*', '/graphql', '/health'],
    },
    assets,
    cacheRules: [
      { pattern: '/dist/web/**', ttl: 31536000, immutable: true },
      { pattern: '/index.html', ttl: 300, staleWhileRevalidate: 86400 },
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

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║             Indexer Deployment to DWS                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  await ensureBuild()

  // Upload static assets
  console.log('\nUploading static assets...')
  const webAssets = await uploadDirectory(
    config.dwsUrl,
    './dist/web',
    'dist/web',
  )
  const indexResult = await uploadToIPFS(
    config.dwsUrl,
    './dist/index.html',
    'index.html',
  )
  webAssets.set('index.html', indexResult)
  console.log(`   index.html -> ${indexResult.cid}`)
  console.log(`   Total: ${webAssets.size} files\n`)

  // Upload API bundle
  console.log('Uploading API bundle...')
  const apiBundle = await uploadToIPFS(
    config.dwsUrl,
    './lib/api/api-server.js',
    'indexer-api.js',
  )
  console.log(`   API CID: ${apiBundle.cid}\n`)

  // Deploy worker
  console.log('Deploying worker to DWS (with SQLit database)...')
  const workerId = await deployWorker(config, apiBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  // Setup CDN
  console.log('Configuring CDN...')
  await setupCDN(config, webAssets)

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend: https://indexer.jejunetwork.org                  ║`)
  console.log(`║  GraphQL:  https://indexer.jejunetwork.org/graphql          ║`)
  console.log(
    `║  IPFS:     ipfs://${indexResult.cid.slice(0, 20)}...                  ║`,
  )
  console.log(`║  Worker:   ${workerId.slice(0, 36)}...  ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
