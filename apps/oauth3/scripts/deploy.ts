#!/usr/bin/env bun
/**
 * OAuth3 Deployment Script
 *
 * Deploys OAuth3 to DWS infrastructure (fully decentralized):
 * 1. Builds frontend and API
 * 2. Uploads static assets to IPFS/DWS storage
 * 3. Deploys API as a DWS worker (NOT K8s!)
 * 4. Registers app with DWS deployed apps using worker ID
 * 5. Sets JNS records for decentralized routing
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import { $ } from 'bun'
import type { Address } from 'viem'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Response schemas
const StorageUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  backends: z.array(z.string()).optional(),
})

const WorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.string(),
  cronsRegistered: z.number().optional(),
})

// Configuration
interface DeployConfig {
  network: NetworkType
  dwsUrl: string
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<NetworkType, { dwsUrl: string }> = {
    localnet: {
      dwsUrl: 'http://127.0.0.1:4030',
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
    },
  }

  return {
    network,
    dwsUrl: configs[network].dwsUrl,
  }
}

// Build
async function ensureBuild(): Promise<void> {
  const requiredFiles = [
    join(APP_DIR, 'dist/web/index.html'),
    join(APP_DIR, 'dist/web/app.js'),
    join(APP_DIR, 'dist/api/worker.js'), // Use worker.js for DWS deployment
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      console.log('[Build] Running build...')
      await $`bun run build`.cwd(APP_DIR)
      return
    }
  }

  console.log('[Build] ✅ Build found')
}

/**
 * Verify content is retrievable from storage
 */
async function verifyContentRetrievable(
  dwsUrl: string,
  cid: string,
): Promise<boolean> {
  const response = await fetch(`${dwsUrl}/storage/download/${cid}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null)

  return response?.ok === true
}

// Upload file to DWS storage
async function uploadFile(
  dwsUrl: string,
  content: Buffer,
  filename: string,
  retries = 3,
): Promise<{ cid: string; size: number }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const formData = new FormData()
      formData.append('file', new Blob([content]), filename)
      formData.append('tier', 'popular')
      formData.append('category', 'app')

      const response = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Upload failed for ${filename}: ${error}`)
      }

      const result = StorageUploadResponseSchema.parse(await response.json())

      // Verify the content is retrievable before returning success
      const verified = await verifyContentRetrievable(dwsUrl, result.cid)
      if (!verified) {
        throw new Error(
          `Upload verification failed for ${filename} - content not retrievable`,
        )
      }

      return { cid: result.cid, size: content.length }
    } catch (err) {
      if (attempt === retries) throw err
      console.log(`   Retry ${attempt}/${retries} for ${filename}...`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error(`Failed to upload ${filename} after ${retries} attempts`)
}

// Upload directory recursively
interface UploadResult {
  files: Map<string, string> // path -> CID
  totalSize: number
}

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  exclude: string[] = [],
): Promise<UploadResult> {
  const files = new Map<string, string>()
  let totalSize = 0

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (exclude.some((e) => relativePath.includes(e))) continue

      if (entry.isDirectory()) {
        await processDir(fullPath, relativePath)
      } else {
        const content = await readFile(fullPath)
        totalSize += content.length

        const result = await uploadFile(
          dwsUrl,
          Buffer.from(content),
          relativePath,
        )
        files.set(relativePath, result.cid)
        console.log(`   ${relativePath} -> ${result.cid.slice(0, 16)}...`)
      }
    }
  }

  await processDir(dirPath)
  return { files, totalSize }
}

/**
 * Deploy API as a DWS worker (serverless function)
 * This is the key for permissionless deployment - no K8s needed!
 */
async function deployWorker(
  config: DeployConfig,
  apiCid: string,
  owner: Address,
): Promise<string> {
  console.log('\n[Worker] Deploying API as DWS worker...')
  console.log(`   codeCid: ${apiCid}`)
  console.log(`   owner: ${owner}`)

  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': owner,
    },
    body: JSON.stringify({
      name: 'oauth3-api',
      runtime: 'bun',
      handler: 'index.handler',
      codeCid: apiCid,
      memory: 512,
      timeout: 30000,
      env: {
        NODE_ENV: 'production',
        JEJU_NETWORK: config.network,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Worker deployment failed: ${error}`)
  }

  const result = WorkerDeployResponseSchema.parse(await response.json())
  console.log('[Worker] ✅ Deployed as DWS worker')
  console.log(`   functionId: ${result.functionId}`)
  console.log(`   status: ${result.status}`)

  return result.functionId
}

// Register app with DWS
async function registerApp(
  config: DeployConfig,
  staticFiles: Map<string, string>,
  workerId: string,
): Promise<void> {
  const indexCid = staticFiles.get('index.html')
  if (!indexCid) {
    throw new Error('index.html not found in uploaded files')
  }

  // Use the worker ID for backend routing - NO hardcoded K8s URLs!
  const appConfig = {
    name: 'oauth3',
    jnsName: 'auth.jeju',
    frontendCid: null, // Use staticFiles map instead of directory CID
    staticFiles: Object.fromEntries(staticFiles),
    backendWorkerId: workerId, // DWS worker ID for serverless routing
    backendEndpoint: null, // No direct endpoint - route through DWS workers
    apiPaths: [
      '/api/*',
      '/oauth/*',
      '/session',
      '/session/*',
      '/health',
      '/callback',
      '/callback/*',
      '/wallet/*',
      '/farcaster/*',
      '/client/*',
      '/auth/*',
      '/webhook/*',
      '/.well-known/*',
    ],
    spa: true,
    enabled: true,
  }

  console.log('\n[Register] App config:')
  console.log(`   name: ${appConfig.name}`)
  console.log(`   jnsName: ${appConfig.jnsName}`)
  console.log(`   staticFiles: ${staticFiles.size} files`)
  console.log(`   backendWorkerId: ${appConfig.backendWorkerId}`)
  console.log(`   spa: ${appConfig.spa}`)

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appConfig),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`[Register] Warning: ${error}`)
  } else {
    console.log('[Register] ✅ App registered with DWS')
  }
}

// Main deploy function
async function deploy(): Promise<void> {
  console.log('OAuth3 Decentralized Deployment')
  console.log('================================\n')

  const config = getConfig()
  console.log(`Network: ${config.network}`)
  console.log(`DWS URL: ${config.dwsUrl}\n`)

  // Get deployer address from environment or use default dev address
  const deployerAddress = (process.env.DEPLOYER_ADDRESS ??
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') as Address

  // Build
  await ensureBuild()

  // Upload frontend static assets
  console.log('\n[Upload] Static assets...')
  const staticResult = await uploadDirectory(
    config.dwsUrl,
    join(APP_DIR, 'dist/web'),
  )
  console.log(`   Total: ${(staticResult.totalSize / 1024).toFixed(1)} KB`)
  console.log(`   Files: ${staticResult.files.size}`)

  // Upload API bundle to storage first (use worker.js for DWS worker deployment)
  console.log('\n[Upload] API bundle...')
  const apiContent = await readFile(join(APP_DIR, 'dist/api/worker.js'))
  const apiResult = await uploadFile(
    config.dwsUrl,
    Buffer.from(apiContent),
    'oauth3-api.js',
  )
  console.log(`   API CID: ${apiResult.cid}`)

  // Deploy API as DWS worker (NOT K8s!)
  const workerId = await deployWorker(config, apiResult.cid, deployerAddress)

  // Register app with DWS using the worker ID
  console.log('\n[Register] Registering app with DWS...')
  await registerApp(config, staticResult.files, workerId)

  // Summary
  const indexCid = staticResult.files.get('index.html')
  const appJsCid = staticResult.files.get('app.js')

  console.log('\n================================')
  console.log('✅ Deployment Complete')
  console.log('================================')
  console.log(`Network: ${config.network}`)
  console.log(`Frontend:`)
  console.log(`   index.html CID: ${indexCid}`)
  console.log(`   app.js CID: ${appJsCid}`)
  console.log(`Backend:`)
  console.log(`   Worker ID: ${workerId}`)
  console.log(`   API CID: ${apiResult.cid}`)
  console.log('')
  console.log('🌐 Fully decentralized deployment:')
  console.log('   - Frontend served from IPFS via DWS storage')
  console.log('   - Backend runs as DWS serverless worker')
  console.log('   - NO K8s or AWS infrastructure required!')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
