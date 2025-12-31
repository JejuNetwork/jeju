#!/usr/bin/env bun
/**
 * Example Decentralized Deployment Script
 *
 * Deploys Example app to DWS infrastructure:
 * 1. Builds frontend and API
 * 2. Uploads static assets to IPFS storage
 * 3. Deploys API as a workerd worker
 * 4. Registers app with DWS app router
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  getCurrentNetwork,
  getL1RpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { $ } from 'bun'
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Schemas
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const WorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.string(),
  runtime: z.string(),
})

const AppDeployResponseSchema = z.object({
  success: z.boolean(),
  app: z.object({
    name: z.string(),
    jnsName: z.string(),
    frontendCid: z.string().nullable(),
    staticFiles: z.record(z.string(), z.string()).nullable(),
    backendWorkerId: z.string().nullable(),
    backendEndpoint: z.string().nullable(),
    enabled: z.boolean(),
  }).optional(),
})

// Configuration
interface DeployConfig {
  network: NetworkType
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  jnsName: string
  domain: string
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<NetworkType, Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: 'http://127.0.0.1:4030',
      rpcUrl: getL1RpcUrl(),
      jnsName: 'example.jeju',
      domain: 'example.localhost',
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      jnsName: 'example.jeju',
      domain: 'example.testnet.jejunetwork.org',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      jnsName: 'example.jeju',
      domain: 'example.jejunetwork.org',
    },
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}`,
  } as DeployConfig
}

// Build Check
async function checkBuild(): Promise<void> {
  const requiredFiles = [
    join(APP_DIR, 'dist/index.html'),
    join(APP_DIR, 'dist/api/index.js'),
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      console.log('Build not found, running build first...')
      await $`bun run build`.cwd(APP_DIR)
      return
    }
  }
  console.log('[Deploy] Build found')
}

// Upload file to IPFS
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
        throw new Error(`Upload failed: ${error}`)
      }

      const result = IPFSUploadResponseSchema.parse(await response.json())
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
  files: Map<string, string>
  totalSize: number
  rootCid: string
}

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  exclude: string[] = [],
): Promise<UploadResult> {
  const files = new Map<string, string>()
  let totalSize = 0
  let indexCid = ''

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      // Skip excluded paths
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

        // Track index.html CID as root
        if (relativePath === 'index.html') {
          indexCid = result.cid
        }

        console.log(`   ${relativePath} -> ${result.cid.slice(0, 16)}...`)
      }
    }
  }

  await processDir(dirPath)
  return { files, totalSize, rootCid: indexCid }
}

// Deploy worker to DWS (returns null if workerd not available)
async function deployWorker(
  config: DeployConfig,
  codeCid: string,
): Promise<string | null> {
  const account = privateKeyToAccount(config.privateKey)

  try {
    const response = await fetch(`${config.dwsUrl}/workerd/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': account.address,
      },
      body: JSON.stringify({
        name: 'example-api',
        codeCid,
        memoryMb: 256,
        timeoutMs: 30000,
        cpuTimeMs: 1000,
        compatibilityDate: new Date().toISOString().split('T')[0],
        bindings: [
          { name: 'APP_NAME', type: 'text', value: 'Example' },
          { name: 'NETWORK', type: 'text', value: config.network },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.warn(`[Deploy] Worker deployment not available: ${error}`)
      console.log('[Deploy] Continuing with frontend-only deployment...')
      return null
    }

    const result = WorkerDeployResponseSchema.parse(await response.json())
    return result.workerId
  } catch (err) {
    console.warn(`[Deploy] Worker deployment failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    console.log('[Deploy] Continuing with frontend-only deployment...')
    return null
  }
}

// Register app with DWS app router
async function registerApp(
  config: DeployConfig,
  staticFiles: Map<string, string>,
  backendWorkerId: string | null,
): Promise<void> {
  // Convert Map to Record with leading slashes for paths
  const staticFilesRecord: Record<string, string> = {}
  for (const [path, cid] of staticFiles) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    staticFilesRecord[normalizedPath] = cid
  }

  const indexCid = staticFiles.get('index.html')

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'example',
      jnsName: config.jnsName,
      frontendCid: indexCid ?? null,
      staticFiles: staticFilesRecord,
      backendWorkerId,
      backendEndpoint: null,
      apiPaths: ['/api', '/health', '/a2a', '/mcp', '/x402', '/auth', '/webhooks'],
      spa: true,
      enabled: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`[Deploy] App registration warning: ${error}`)
    return
  }

  const result = AppDeployResponseSchema.parse(await response.json())
  if (result.success) {
    console.log('[Deploy] App registered successfully')
  }
}

// Check DWS health
async function checkDWSHealth(dwsUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${dwsUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Main deploy function
async function deploy(): Promise<void> {
  console.log('')
  console.log('==================================================================')
  console.log('           Example Decentralized Deployment to DWS')
  console.log('==================================================================')
  console.log('')

  const config = getConfig()
  const account = privateKeyToAccount(config.privateKey)

  console.log(`[Deploy] Network: ${config.network}`)
  console.log(`[Deploy] DWS: ${config.dwsUrl}`)
  console.log(`[Deploy] Deployer: ${account.address}`)
  console.log('')

  // Check DWS health
  console.log('[Deploy] Checking DWS health...')
  const dwsHealthy = await checkDWSHealth(config.dwsUrl)
  if (!dwsHealthy) {
    throw new Error(`DWS not reachable at ${config.dwsUrl}`)
  }
  console.log('[Deploy] DWS is healthy')

  // Check/run build
  await checkBuild()

  // Upload static assets (frontend)
  console.log('')
  console.log('[Deploy] Uploading frontend assets...')
  const frontendResult = await uploadDirectory(
    config.dwsUrl,
    join(APP_DIR, 'dist'),
    ['api'], // Exclude API directory
  )
  console.log(`[Deploy] Frontend: ${frontendResult.files.size} files, ${(frontendResult.totalSize / 1024).toFixed(1)} KB`)
  console.log(`[Deploy] Frontend CID: ${frontendResult.rootCid}`)

  // Upload and deploy API worker
  console.log('')
  console.log('[Deploy] Uploading API bundle...')
  const apiContent = await readFile(join(APP_DIR, 'dist/api/index.js'))
  const apiUpload = await uploadFile(
    config.dwsUrl,
    Buffer.from(apiContent),
    'example-api.js',
  )
  console.log(`[Deploy] API CID: ${apiUpload.cid}`)

  console.log('')
  console.log('[Deploy] Deploying API worker...')
  const workerId = await deployWorker(config, apiUpload.cid)
  if (workerId) {
    console.log(`[Deploy] Worker ID: ${workerId}`)
  } else {
    console.log('[Deploy] No worker deployed (frontend-only mode)')
  }

  // Register app
  console.log('')
  console.log('[Deploy] Registering app with DWS...')
  await registerApp(config, frontendResult.files, workerId)

  // Summary
  const indexCid = frontendResult.files.get('index.html')
  console.log('')
  console.log('==================================================================')
  console.log('                    Deployment Complete')
  console.log('==================================================================')
  console.log('')
  console.log('Endpoints:')
  console.log(`  Frontend: https://${config.domain}`)
  if (workerId) {
    console.log(`  API:      https://${config.domain}/api/v1`)
    console.log(`  Health:   https://${config.domain}/health`)
    console.log(`  A2A:      https://${config.domain}/a2a`)
    console.log(`  MCP:      https://${config.domain}/mcp`)
  } else {
    console.log('')
    console.log('  NOTE: Backend API not deployed. The frontend is a')
    console.log('        static SPA that needs a backend service.')
    console.log('        For full decentralized deployment, workerd')
    console.log('        execution must be available on the network.')
  }
  console.log('')
  console.log('IPFS:')
  console.log(`  Frontend index: ipfs://${indexCid}`)
  console.log(`  Frontend files: ${frontendResult.files.size} files uploaded`)
  console.log(`  API:            ipfs://${apiUpload.cid}`)
  console.log('')
  console.log('DWS:')
  if (workerId) {
    console.log(`  Worker:   ${workerId}`)
  }
  console.log(`  JNS:      ${config.jnsName}`)
  console.log('')
}

deploy().catch((error) => {
  console.error('[Deploy] Deployment failed:', error.message)
  process.exit(1)
})
