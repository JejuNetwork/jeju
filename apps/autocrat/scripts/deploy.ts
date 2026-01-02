#!/usr/bin/env bun
/**
 * Autocrat Deployment Script
 *
 * Deploys Autocrat to DWS infrastructure:
 * 1. Builds frontend and worker
 * 2. Uploads static assets to IPFS/CDN
 * 3. Registers worker with DWS network
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
import { $ } from 'bun'
import { type Address, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Inline schemas for deploy script
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
})

// Configuration

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  workerRegistryAddress: Address
  cdnEnabled: boolean
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<DeployConfig['network'], Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
      workerRegistryAddress:
        '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
    },
    testnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
      workerRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
    },
    mainnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
      workerRegistryAddress:
        '0x0000000000000000000000000000000000000000' as Address,
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

async function checkBuild(): Promise<void> {
  const requiredFiles = [
    './dist/static/index.html',
    './dist/worker/worker.js',
    './dist/deployment.json',
  ]

  for (const file of requiredFiles) {
    if (!existsSync(resolve(APP_DIR, file))) {
      console.log('[Autocrat] Build not found, running build first...')
      await $`bun run scripts/build.ts`.cwd(APP_DIR)
      return
    }
  }

  console.log('[Autocrat] Build found')
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
  workerBundle: UploadResult,
): Promise<string> {
  const deployRequest = {
    name: 'autocrat-api',
    owner: privateKeyToAccount(config.privateKey).address,
    codeCid: workerBundle.cid,
    codeHash: workerBundle.hash,
    entrypoint: 'worker.js',
    runtime: 'workerd',
    resources: {
      memoryMb: 512,
      cpuMillis: 2000,
      timeoutMs: 60000,
      maxConcurrency: 50,
    },
    scaling: {
      minInstances: 1,
      maxInstances: 10,
      targetConcurrency: 5,
      scaleToZero: false,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: true,
      teePreferred: true,
      minNodeReputation: 75,
    },
    routes: [
      { pattern: '/api/*', zone: 'autocrat' },
      { pattern: '/a2a/*', zone: 'autocrat' },
      { pattern: '/mcp/*', zone: 'autocrat' },
      { pattern: '/health', zone: 'autocrat' },
      { pattern: '/.well-known/*', zone: 'autocrat' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
    secrets: ['OPERATOR_KEY', 'ASSESSOR_KEY', 'SQLIT_PRIVATE_KEY'],
    database: {
      type: 'sqlit',
      name: 'autocrat-db',
    },
  }

  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': privateKeyToAccount(config.privateKey).address,
    },
    body: JSON.stringify({
      name: 'autocrat-api',
      codeCid: workerBundle.cid,
      runtime: 'bun',
      handler: 'worker.js:default',
      memory: deployRequest.resources.memoryMb,
      timeout: deployRequest.resources.timeoutMs,
      env: deployRequest.env,
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
  return parsed.data.functionId
}

// CDN Setup

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

  const domain =
    config.network === 'testnet'
      ? 'autocrat.testnet.jejunetwork.org'
      : config.network === 'mainnet'
        ? 'autocrat.jejunetwork.org'
        : 'autocrat.local.jejunetwork.org'

  const cdnConfig = {
    name: 'autocrat',
    domain,
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: ['/api/*', '/a2a/*', '/mcp/*', '/health', '/.well-known/*'],
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

// App Registration

async function registerApp(
  config: DeployConfig,
  staticAssets: Map<string, UploadResult>,
  workerId: string,
): Promise<void> {
  const indexCid = staticAssets.get('index.html')?.cid
  const staticFiles: Record<string, string> = {}
  for (const [path, result] of staticAssets) {
    staticFiles[path] = result.cid
  }

  const backendEndpoint = `${config.dwsUrl}/workers/${workerId}`

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': privateKeyToAccount(config.privateKey).address,
    },
    body: JSON.stringify({
      name: 'autocrat',
      jnsName: 'autocrat.jeju',
      frontendCid: indexCid,
      staticFiles: Object.keys(staticFiles).length > 0 ? staticFiles : null,
      backendWorkerId: workerId,
      backendEndpoint: backendEndpoint,
      apiPaths: [
        '/api',
        '/a2a',
        '/mcp',
        '/health',
        '/rlaif',
        '/fees',
        '/.well-known',
      ],
      spa: true,
      enabled: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`App registration failed: ${errorText}`)
  }

  const result: unknown = await response.json()
  console.log(`   App registered: ${JSON.stringify(result)}`)
}

// Seed Jeju DAO

async function seedJejuDAO(
  config: DeployConfig,
  apiUrl: string,
): Promise<void> {
  console.log('Checking if Jeju DAO exists...')

  // Check if Jeju DAO already exists
  const checkResponse = await fetch(`${apiUrl}/api/v1/dao/jeju`).catch(
    () => null,
  )

  if (checkResponse?.ok) {
    console.log('   Jeju DAO already exists, skipping seed')
    return
  }

  console.log('Seeding Jeju DAO...')

  // Import seed data
  const { JEJU_DAO } = await import('./seed')

  // Get treasury address based on network
  let treasury: Address
  if (config.network === 'localnet') {
    treasury = '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' as Address
  } else {
    const treasuryEnv = process.env.JEJU_DAO_TREASURY
    if (!treasuryEnv) {
      console.warn('   JEJU_DAO_TREASURY not set, using deployer address')
      treasury = privateKeyToAccount(config.privateKey).address
    } else {
      treasury = treasuryEnv as Address
    }
  }

  const response = await fetch(`${apiUrl}/api/v1/dao`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': privateKeyToAccount(config.privateKey).address,
    },
    body: JSON.stringify({
      name: JEJU_DAO.name,
      displayName: JEJU_DAO.displayName,
      description: JEJU_DAO.description,
      treasury,
      manifestCid: JEJU_DAO.manifestCid,
      director: JEJU_DAO.director,
      governance: JEJU_DAO.governance,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`   Failed to create Jeju DAO: ${error}`)
    return
  }

  console.log('   Jeju DAO created')

  // Register board members
  for (const member of JEJU_DAO.board) {
    try {
      await fetch(`${apiUrl}/api/v1/dao/jeju/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': privateKeyToAccount(config.privateKey).address,
        },
        body: JSON.stringify({
          role: member.role,
          name: member.name,
          description: member.description,
          weight: member.weight,
          isHuman: false,
        }),
      })
      console.log(`   Registered ${member.name}`)
    } catch (error) {
      console.warn(
        `   Failed to register ${member.name}: ${(error as Error).message}`,
      )
    }
  }
}

// Main Deploy Function

async function deploy(): Promise<void> {
  console.log('[Autocrat] Deploying to DWS...\n')

  const config = getConfig()
  console.log(`Network: ${config.network}`)
  console.log(`DWS: ${config.dwsUrl}\n`)

  // Check build exists
  await checkBuild()

  // Upload static assets
  console.log('\nUploading static assets...')
  const staticAssets = await uploadDirectory(config.dwsUrl, './dist/static')
  console.log(`   Total: ${staticAssets.size} files\n`)

  // Upload worker bundle
  console.log('Uploading worker bundle...')
  const workerBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/worker/worker.js',
    'autocrat-api-worker.js',
  )
  console.log(`   Worker CID: ${workerBundle.cid}\n`)

  // Deploy worker
  console.log('Deploying worker to DWS...')
  const workerId = await deployWorker(config, workerBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  // Register app with DWS app router (critical for API routing)
  console.log('Registering app with DWS...')
  await registerApp(config, staticAssets, workerId)

  // Setup CDN (optional, for cache rules)
  console.log('Configuring CDN...')
  await setupCDN(config, staticAssets)

  // Calculate API URL
  const apiUrl = `${config.dwsUrl}/workers/${workerId}`

  // Seed Jeju DAO (for testnet and mainnet, localnet uses dev script)
  if (config.network !== 'localnet') {
    console.log('\nSeeding Jeju DAO...')
    await seedJejuDAO(config, apiUrl)
  }

  // Print summary
  const indexCid = staticAssets.get('index.html')?.cid
  const frontendDomain =
    config.network === 'testnet'
      ? 'autocrat.testnet.jejunetwork.org'
      : config.network === 'mainnet'
        ? 'autocrat.jejunetwork.org'
        : 'autocrat.local.jejunetwork.org'

  console.log('\n[Autocrat] Deployment complete.')
  console.log('\nEndpoints:')
  console.log(`   Frontend: https://${frontendDomain}`)
  console.log(`   IPFS: ipfs://${indexCid}`)
  console.log(`   API: ${apiUrl}`)
  console.log(`   Health: ${apiUrl}/health`)

  if (config.network !== 'localnet') {
    console.log('\nJeju DAO:')
    console.log(`   Dashboard: https://${frontendDomain}/dao/jeju`)
  }
}

// Run deployment
deploy().catch((error) => {
  console.error('[Autocrat] Deployment failed:', error)
  process.exit(1)
})
