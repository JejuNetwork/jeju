#!/usr/bin/env bun
/**
 * Indexer Deployment Script
 *
 * Deploys Indexer to DWS infrastructure (fully decentralized):
 * 1. Builds frontend and worker
 * 2. Uploads static assets to DWS storage (IPFS)
 * 3. Deploys backend worker to DWS
 * 4. Registers app with DWS app router (frontend + backend)
 *
 * NO hardcoded K8s or AWS endpoints - fully decentralized.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Schema for DWS storage upload response
const StorageUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  backends: z.array(z.string()).optional(),
})

// Schema for DWS worker deploy response
const DWSWorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
})

interface DeployConfig {
  network: NetworkType
  dwsUrl: string
  privateKey: `0x${string}`
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<
    NetworkType,
    Omit<DeployConfig, 'network' | 'privateKey'>
  > = {
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  return {
    network,
    privateKey: privateKey as `0x${string}`,
    ...configs[network],
  }
}

async function ensureFrontendBuild(): Promise<void> {
  const indexHtmlPath = resolve(APP_DIR, 'dist/index.html')
  if (!existsSync(indexHtmlPath)) {
    console.log('[Indexer] Frontend build not found, running build...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error('Frontend build failed')
    }
  }
  console.log('[Indexer] Frontend build found')
}

async function buildWorker(): Promise<string> {
  console.log('[Indexer] Building worker bundle...')

  const workerEntry = join(APP_DIR, 'api/worker.ts')
  const outDir = join(APP_DIR, 'dist/worker')

  // Build worker using Bun
  const result = await Bun.build({
    entrypoints: [workerEntry],
    outdir: outDir,
    target: 'bun',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
    external: [],
  })

  if (!result.success) {
    console.error('[Indexer] Worker build failed:', result.logs)
    throw new Error('Worker build failed')
  }

  const outputPath = join(outDir, 'worker.js')
  console.log(`[Indexer] Worker built: ${outputPath}`)
  return outputPath
}

// SQLit database configuration (decentralized distributed SQLite)
interface SQLitConfig {
  databaseId: string
}

function getSQLitConfig(network: NetworkType): SQLitConfig {
  // Database IDs are network-specific
  const databaseIds: Record<NetworkType, string> = {
    localnet: 'indexer-localnet',
    testnet: 'indexer-testnet',
    mainnet: 'indexer-mainnet',
  }
  return {
    databaseId: databaseIds[network],
  }
}

async function deployWorker(
  config: DeployConfig,
  workerPath: string,
  sqlitConfig: SQLitConfig,
): Promise<{ functionId: string; codeCid: string }> {
  console.log('[Indexer] Deploying worker to DWS...')

  const account = privateKeyToAccount(config.privateKey)

  // Upload worker code to storage first
  const workerCode = await readFile(workerPath)
  const formData = new FormData()
  formData.append('file', new Blob([workerCode]), 'worker.js')
  formData.append('tier', 'persistent')
  formData.append('category', 'worker')

  const uploadResponse = await fetch(`${config.dwsUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload worker: ${await uploadResponse.text()}`)
  }

  const uploadResult = StorageUploadResponseSchema.parse(
    await uploadResponse.json(),
  )
  console.log(`   Worker code uploaded: ${uploadResult.cid}`)
  console.log(`   SQLit Database: ${sqlitConfig.databaseId}`)

  // Deploy worker with SQLit connection (decentralized distributed SQLite)
  const deployResponse = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify({
      name: 'indexer-api',
      codeCid: uploadResult.cid,
      runtime: 'bun',
      handler: 'worker.js:default',
      memory: 1024,
      timeout: 60000,
      env: {
        JEJU_NETWORK: config.network,
        NETWORK: config.network,
        INDEXER_MODE: 'sqlit',
        SQLIT_DATABASE_ID: sqlitConfig.databaseId,
        OWNER_ADDRESS: account.address,
      },
    }),
  })

  if (!deployResponse.ok) {
    throw new Error(`Failed to deploy worker: ${await deployResponse.text()}`)
  }

  const deployResult = DWSWorkerDeployResponseSchema.parse(
    await deployResponse.json(),
  )
  console.log(`   Worker deployed: ${deployResult.functionId}`)

  return {
    functionId: deployResult.functionId,
    codeCid: uploadResult.cid,
  }
}

interface UploadResult {
  files: Map<string, string>
  totalSize: number
  rootCid: string
}

async function verifyContentRetrievable(
  dwsUrl: string,
  cid: string,
): Promise<boolean> {
  const response = await fetch(`${dwsUrl}/storage/download/${cid}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10000),
  })
  return response.ok
}

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
        throw new Error(`Failed to upload ${filename}: ${error}`)
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

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  exclude: string[] = [],
): Promise<UploadResult> {
  const files = new Map<string, string>()
  let totalSize = 0
  let rootCid = ''

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      // Skip excluded files
      if (exclude.some((e) => relativePath.includes(e))) continue
      // Skip source maps in production
      if (relativePath.endsWith('.map')) continue

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
          rootCid = result.cid
        }

        console.log(`   ${relativePath} -> ${result.cid.slice(0, 16)}...`)
      }
    }
  }

  await processDir(dirPath)
  return { files, totalSize, rootCid }
}

async function registerApp(
  config: DeployConfig,
  staticFiles: Map<string, string>,
  _rootCid: string,
  workerInfo: { functionId: string; codeCid: string },
): Promise<void> {
  // Find index.html CID - this is the entry point
  const indexCid = staticFiles.get('index.html')
  if (!indexCid) {
    throw new Error('index.html not found in uploaded files')
  }

  // Convert Map to Record for JSON serialization
  const staticFilesRecord: Record<string, string> = {}
  for (const [path, cid] of staticFiles) {
    staticFilesRecord[path] = cid
  }

  // Use CID-based worker ID for decentralized routing
  // CID-based routing allows any DWS pod to deploy the worker on-demand from IPFS
  // The worker code is immutable and can be verified by the CID
  const backendWorkerId = workerInfo.codeCid
  const backendEndpoint = `${config.dwsUrl}/workers/${workerInfo.codeCid}/http`

  // App registration data for DWS app router
  const appConfig = {
    name: 'indexer',
    jnsName: 'indexer.jeju',
    frontendCid: indexCid, // CID for index.html (used as fallback)
    staticFiles: staticFilesRecord, // Map of all file paths to CIDs
    backendWorkerId, // Use CID for decentralized routing
    backendEndpoint, // CID-based endpoint
    apiPaths: ['/api', '/health', '/a2a', '/mcp', '/graphql'], // Note: no trailing slashes - isApiPath checks pathname.startsWith(prefix + '/')
    spa: true, // Single-page application
    enabled: true,
  }

  console.log('[Indexer] Registering app with DWS...')
  console.log(`   Frontend CID: ${indexCid}`)
  console.log(`   Static files: ${staticFiles.size}`)
  console.log(`   Backend worker CID: ${workerInfo.codeCid}`)
  console.log(`   Backend endpoint: ${backendEndpoint}`)
  console.log(`   API paths: ${appConfig.apiPaths.join(', ')}`)

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appConfig),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`App registration failed: ${error}`)
  }

  console.log('[Indexer] App registered successfully')

  // Trigger worker sync across all DWS pods for immediate availability
  console.log('[Indexer] Triggering cross-pod worker sync...')
  await syncWorkersAcrossPods(config)
}

/**
 * Sync workers across all DWS pods after deployment
 *
 * This ensures all pods have the worker loaded and available for immediate invocation,
 * eliminating "Function not found" errors due to load balancer routing to a pod
 * that doesn't have the worker loaded yet.
 */
interface SyncResult {
  success: boolean
  podId?: string
  error?: string
}

async function syncEndpoint(url: string): Promise<SyncResult> {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    return {
      success: false,
      error: `${response.status} ${response.statusText}`,
    }
  }
  return (await response.json()) as SyncResult
}

async function syncWorkersAcrossPods(config: DeployConfig): Promise<void> {
  const syncCount = 5
  const syncPromises: Promise<SyncResult>[] = []
  const errors: string[] = []

  for (let i = 0; i < syncCount; i++) {
    syncPromises.push(syncEndpoint(`${config.dwsUrl}/workers/sync`))
    syncPromises.push(syncEndpoint(`${config.dwsUrl}/apps/sync`))
  }

  const results = await Promise.allSettled(syncPromises)
  let successCount = 0
  const uniquePods = new Set<string>()

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      successCount++
      if (result.value.podId) uniquePods.add(result.value.podId)
    } else if (result.status === 'rejected') {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      )
    } else if (result.status === 'fulfilled' && result.value.error) {
      errors.push(result.value.error)
    }
  }

  console.log(
    `   Synced ${successCount}/${results.length} endpoints, reached ${uniquePods.size} unique pods`,
  )
  if (errors.length > 0) {
    console.warn(
      `   Sync errors: ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`,
    )
  }
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║        Indexer Deployment to DWS (Decentralized)            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  // Ensure frontend build exists
  await ensureFrontendBuild()

  // Get SQLit configuration (decentralized distributed SQLite)
  console.log('\nConfiguring SQLit database...')
  const sqlitConfig = getSQLitConfig(config.network)
  console.log(`   Database ID: ${sqlitConfig.databaseId}`)

  // Build worker
  console.log('\nBuilding worker...')
  const workerPath = await buildWorker()

  // Deploy worker to DWS with SQLit connection
  console.log('\nDeploying worker...')
  const workerInfo = await deployWorker(config, workerPath, sqlitConfig)

  // Upload static assets from dist directory (excluding worker dir)
  console.log('\nUploading static assets...')
  const staticResult = await uploadDirectory(
    config.dwsUrl,
    join(APP_DIR, 'dist'),
    ['worker'], // Exclude worker directory
  )
  console.log(`   Total: ${(staticResult.totalSize / 1024).toFixed(1)} KB`)
  console.log(`   Files: ${staticResult.files.size}`)

  // Register app with DWS
  console.log('\nRegistering app with DWS...')
  await registerApp(
    config,
    staticResult.files,
    staticResult.rootCid,
    workerInfo,
  )

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')

  const domain =
    config.network === 'testnet'
      ? 'https://indexer.testnet.jejunetwork.org'
      : config.network === 'mainnet'
        ? 'https://indexer.jejunetwork.org'
        : 'http://indexer.localhost:4030'

  console.log(`║  Frontend: ${domain.padEnd(44)}║`)
  console.log(`${`║  API:      ${domain}/api`.padEnd(61)}║`)
  console.log(`${`║  GraphQL:  ${domain}/graphql`.padEnd(61)}║`)
  console.log(
    `${`║  Worker:   ${workerInfo.codeCid.slice(0, 36)}`.padEnd(61)}║`,
  )
  console.log(
    `${`║  IPFS:     ipfs://${staticResult.rootCid.slice(0, 20)}...`.padEnd(61)}║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error: Error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
