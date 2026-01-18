#!/usr/bin/env bun
/**
 * Otto Deployment Script
 *
 * Deploys Otto to DWS infrastructure using Jeju Network's decentralized deployment.
 * Uses KMS for signing in production (no raw private keys).
 *
 * Features:
 * - 100% decentralized deployment (NO AWS)
 * - Frontend to IPFS with JNS routing
 * - Backend worker to DWS Workers
 * - SQLit database auto-provisioning
 * - Backup support for database recovery
 *
 * Usage:
 *   bun run deploy            # Deploy to current network
 *   bun run deploy:testnet    # Deploy to testnet
 *   bun run deploy:mainnet    # Deploy to mainnet (requires KMS)
 *
 * Via Jeju CLI:
 *   jeju deploy otto          # Recommended way
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
  getSQLitBlockProducerUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { createKMSSigner, validateSecureSigning } from '@jejunetwork/kms'
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')
const BACKUP_DIR = resolve(APP_DIR, '.jeju/backups')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  version: z.number().optional(),
  status: z.string().optional(),
})

const DWSFrontendDeployResponseSchema = z.object({
  cid: z.string(),
  jnsName: z.string().optional(),
  url: z.string().optional(),
})

const JNSRegisterResponseSchema = z.object({
  success: z.boolean(),
  txHash: z.string().optional(),
  error: z.string().optional(),
})

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  sqlitUrl: string
}

function getDeployConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<DeployConfig['network'], Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
      sqlitUrl: getSQLitBlockProducerUrl(),
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      sqlitUrl: 'https://dws.testnet.jejunetwork.org/sqlit',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      sqlitUrl: 'https://dws.jejunetwork.org/sqlit',
    },
  }

  return {
    network,
    ...configs[network],
  } as DeployConfig
}

function getDatabaseId(network: string): string {
  const seed = `otto-state-${network}`
  const hash = keccak256(toBytes(seed))
  return `otto-${network}-${hash.slice(2, 18)}`
}

async function getSignerAddress(): Promise<`0x${string}`> {
  // In production, use KMS signer
  if (isProductionEnv()) {
    validateSecureSigning()
    const signer = createKMSSigner({ serviceId: 'otto-deploy' })
    await signer.initialize()
    return signer.getAddress()
  }

  // In development, allow private key from env
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  return account.address
}

async function ensureBuild(): Promise<void> {
  if (
    !existsSync(resolve(APP_DIR, 'dist/server.js')) ||
    !existsSync(resolve(APP_DIR, 'dist/web/index.html'))
  ) {
    console.log('[Otto] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error('Build failed')
    }
  }
  console.log('[Otto] Build found')
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

async function uploadFrontend(
  config: DeployConfig,
  signerAddress: `0x${string}`,
): Promise<string> {
  const frontendDir = resolve(APP_DIR, 'dist/web')

  // Upload entire frontend directory
  const formData = new FormData()

  // Collect files from dist/web
  const files = Array.from(new Bun.Glob('**/*').scanSync({ cwd: frontendDir }))
  for (const entry of files) {
    const filePath = resolve(frontendDir, entry)
    const stat = await Bun.file(filePath).exists()
    if (stat) {
      const content = await Bun.file(filePath).arrayBuffer()
      formData.append('files', new Blob([content]), entry)
    }
  }

  formData.append('name', 'otto-frontend')
  formData.append('spa', 'true')

  const response = await fetch(`${config.dwsUrl}/storage/upload-directory`, {
    method: 'POST',
    headers: {
      'x-jeju-address': signerAddress,
    },
    body: formData,
  })

  if (!response.ok) {
    // Fallback to single file upload
    console.log('[Otto] Directory upload not available, using single file...')
    const indexHtml = await readFile(resolve(frontendDir, 'index.html'))
    const singleFormData = new FormData()
    singleFormData.append('file', new Blob([indexHtml]), 'index.html')
    singleFormData.append('name', 'otto-frontend')

    const singleResponse = await fetch(`${config.dwsUrl}/storage/upload`, {
      method: 'POST',
      body: singleFormData,
    })

    if (!singleResponse.ok) {
      throw new Error(`Frontend upload failed: ${await singleResponse.text()}`)
    }

    const rawJson: unknown = await singleResponse.json()
    const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new Error(`Invalid upload response: ${parsed.error.message}`)
    }
    return parsed.data.cid
  }

  const rawJson: unknown = await response.json()
  const parsed = DWSFrontendDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid frontend deploy response: ${parsed.error.message}`)
  }

  return parsed.data.cid
}

async function deployWorker(
  config: DeployConfig,
  serverBundle: UploadResult,
  signerAddress: `0x${string}`,
): Promise<string> {
  const databaseId = getDatabaseId(config.network)

  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': signerAddress,
    },
    body: JSON.stringify({
      name: 'otto-api',
      codeCid: serverBundle.cid,
      runtime: 'bun',
      handler: 'worker.js:default',
      memory: 512,
      timeout: 60000,
      env: {
        NETWORK: config.network,
        RPC_URL: config.rpcUrl,
        DWS_URL: config.dwsUrl,
        SQLIT_URL: config.sqlitUrl,
        SQLIT_DATABASE_ID: databaseId,
      },
      routes: [
        { pattern: '/api/*' },
        { pattern: '/a2a/*' },
        { pattern: '/mcp/*' },
        { pattern: '/webhooks/*' },
        { pattern: '/health' },
        { pattern: '/status' },
      ],
      scaling: {
        minInstances: 1,
        maxInstances: 3,
        targetConcurrency: 10,
        scaleToZero: false,
        cooldownMs: 60000,
      },
      resources: {
        memoryMb: 512,
        cpuMillis: 1000,
        timeoutMs: 60000,
        maxConcurrency: 20,
      },
      tee: {
        preferred: true,
        platforms: ['dstack', 'phala'],
      },
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

async function provisionDatabase(
  config: DeployConfig,
  signerAddress: `0x${string}`,
): Promise<string> {
  const databaseId = getDatabaseId(config.network)

  console.log(`[Otto] Provisioning SQLit database: ${databaseId}`)

  try {
    const response = await fetch(`${config.sqlitUrl}/v2/databases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': signerAddress,
      },
      body: JSON.stringify({
        name: `otto-${config.network}`,
        databaseId,
        encryptionMode: 'none',
        replication: {
          replicaCount: config.network === 'mainnet' ? 3 : 2,
          minConfirmations: 1,
          syncMode: 'async',
          readPreference: 'primary',
          failoverTimeout: 30000,
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      // Database might already exist or service not available
      if (
        text.includes('already exists') ||
        text.includes('DATABASE_EXISTS') ||
        text.includes('NOT_FOUND')
      ) {
        console.log(
          `[Otto] Database provisioning skipped (will auto-provision on first use): ${databaseId}`,
        )
        return databaseId
      }
      console.warn(`[Otto] Database provisioning warning: ${text}`)
    } else {
      console.log(`[Otto] Database provisioned: ${databaseId}`)
    }
  } catch (error) {
    console.warn(
      `[Otto] Database provisioning skipped:`,
      error instanceof Error ? error.message : String(error),
    )
  }

  return databaseId
}

async function registerJNS(
  config: DeployConfig,
  frontendCid: string,
  workerId: string,
  signerAddress: `0x${string}`,
): Promise<boolean> {
  console.log('[Otto] Registering JNS name: otto.jeju')

  const response = await fetch(`${config.dwsUrl}/jns/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': signerAddress,
    },
    body: JSON.stringify({
      name: 'otto.jeju',
      contentHash: frontendCid,
      workerId,
      metadata: {
        app: 'otto',
        version: '1.0.0',
        description: 'Multi-Platform AI Trading Agent',
        network: config.network,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.warn(`[Otto] JNS registration response: ${text}`)

    // Try alternative JNS registration via contract
    return await registerJNSViaContract(config, frontendCid, signerAddress)
  }

  const rawJson: unknown = await response.json()
  const parsed = JNSRegisterResponseSchema.safeParse(rawJson)

  if (!parsed.success || !parsed.data.success) {
    console.warn('[Otto] JNS registration via API failed, trying contract...')
    return await registerJNSViaContract(config, frontendCid, signerAddress)
  }

  console.log(`[Otto] JNS registered: otto.jeju (tx: ${parsed.data.txHash})`)
  return true
}

async function registerJNSViaContract(
  config: DeployConfig,
  frontendCid: string,
  signerAddress: `0x${string}`,
): Promise<boolean> {
  // For testnet/mainnet, JNS can be registered via the JNS contract
  // This is a permissionless operation using only the EVM private key
  console.log('[Otto] Attempting JNS registration via contract...')

  try {
    const response = await fetch(`${config.dwsUrl}/jns/set-contenthash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': signerAddress,
      },
      body: JSON.stringify({
        name: 'otto.jeju',
        contenthash: `ipfs://${frontendCid}`,
      }),
    })

    if (response.ok) {
      console.log('[Otto] JNS contenthash set via contract')
      return true
    }

    console.warn(
      '[Otto] JNS contract registration failed:',
      await response.text(),
    )
  } catch (error) {
    console.warn(
      '[Otto] JNS contract registration error:',
      error instanceof Error ? error.message : String(error),
    )
  }

  // JNS might not be available in all environments
  console.warn('[Otto] JNS registration skipped - may not be available')
  return false
}

async function createBackup(config: DeployConfig): Promise<void> {
  console.log('[Otto] Creating database backup...')

  // Ensure backup directory exists
  const backupDir = resolve(BACKUP_DIR, config.network)
  await Bun.write(resolve(backupDir, '.gitkeep'), '')

  try {
    const response = await fetch(`${config.sqlitUrl}/v2/backup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        databaseId: getDatabaseId(config.network),
      }),
    })

    if (response.ok) {
      const backup = await response.json()
      const backupFile = resolve(backupDir, `backup-${Date.now()}.json`)
      await writeFile(backupFile, JSON.stringify(backup, null, 2))
      console.log(`[Otto] Backup created: ${backupFile}`)
    }
  } catch (error) {
    console.warn(
      '[Otto] Backup creation skipped:',
      error instanceof Error ? error.message : String(error),
    )
  }
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
  loaded?: number
  skipped?: number
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
  const rawJson: unknown = await response.json()
  return rawJson as SyncResult
}

async function syncWorkersAcrossPods(config: DeployConfig): Promise<void> {
  // Call sync endpoints multiple times to hit different pods behind load balancer
  const syncCount = 5
  const syncPromises: Promise<SyncResult>[] = []
  const errors: string[] = []

  for (let i = 0; i < syncCount; i++) {
    syncPromises.push(syncEndpoint(`${config.dwsUrl}/workers/sync`))
    syncPromises.push(syncEndpoint(`${config.dwsUrl}/apps/sync`))
  }

  const results = await Promise.allSettled(syncPromises)

  let workersLoaded = 0

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      if (result.value.loaded !== undefined) {
        workersLoaded += result.value.loaded
      }
    } else if (result.status === 'rejected') {
      errors.push(String(result.reason))
    } else if (!result.value.success && result.value.error) {
      errors.push(result.value.error)
    }
  }

  console.log(
    `[Otto] Sync complete: ${workersLoaded} workers loaded across pods`,
  )

  if (errors.length > 0) {
    console.warn(
      `[Otto] Some sync errors (non-fatal): ${errors.slice(0, 3).join(', ')}`,
    )
  }

  // Also register the app with the correct configuration
  try {
    await fetch(`${config.dwsUrl}/apps/deployed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'otto',
        jnsName: 'otto.jeju',
        frontendCid: null, // Will be set by JNS
        staticFiles: null,
        backendWorkerId: null,
        backendEndpoint: `${config.dwsUrl}/workers/otto-api/http`,
        apiPaths: [
          '/api/*',
          '/a2a/*',
          '/mcp/*',
          '/webhooks/*',
          '/health',
          '/status',
        ],
        spa: true,
        enabled: true,
      }),
    })
  } catch {
    console.log('[Otto] App registration skipped')
  }
}

async function verifyDeploymentEndpoints(config: DeployConfig): Promise<void> {
  console.log('[Otto] Verifying deployment endpoints...')

  const domain =
    config.network === 'localnet'
      ? 'localhost:4050'
      : config.network === 'testnet'
        ? 'otto.testnet.jejunetwork.org'
        : 'otto.jejunetwork.org'

  const baseUrl =
    config.network === 'localnet' ? `http://${domain}` : `https://${domain}`

  const healthUrl = `${baseUrl}/health`
  const frontendUrl = baseUrl

  const maxRetries = 5
  const timeout = 15000

  // Wait for sync to propagate
  await Bun.sleep(3000)

  // Check health endpoint with retries
  let healthOk = false
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(timeout),
      })

      if (response.ok) {
        const contentType = response.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          const json = (await response.json()) as { status?: string }
          if (json.status === 'ok' || json.status === 'healthy') {
            console.log(`   Health: OK (status=${json.status})`)
            healthOk = true
            break
          }
        }
      }
      console.log(`   Health: Retry ${attempt}/${maxRetries}...`)
      await Bun.sleep(2000 * attempt)
    } catch (error) {
      console.log(
        `   Health: Retry ${attempt}/${maxRetries} - ${error instanceof Error ? error.message : 'timeout'}`,
      )
      await Bun.sleep(2000 * attempt)
    }
  }

  if (!healthOk) {
    throw new Error(
      'Deployment verification failed: health endpoint not responding',
    )
  }

  // Check frontend with retries
  let frontendOk = false
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(frontendUrl, {
        signal: AbortSignal.timeout(timeout),
      })

      if (response.ok) {
        const text = await response.text()
        if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
          console.log('   Frontend: OK (HTML served)')
          frontendOk = true
          break
        } else {
          console.log(`   Frontend: Retry ${attempt}/${maxRetries} - not HTML`)
        }
      }
      await Bun.sleep(2000 * attempt)
    } catch (error) {
      console.log(
        `   Frontend: Retry ${attempt}/${maxRetries} - ${error instanceof Error ? error.message : 'timeout'}`,
      )
      await Bun.sleep(2000 * attempt)
    }
  }

  if (!frontendOk) {
    throw new Error('Deployment verification failed: frontend not serving HTML')
  }

  console.log('[Otto] Deployment verified successfully!')
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║               Otto Deployment to DWS                       ║')
  console.log('║            100% Decentralized - NO AWS                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getDeployConfig()
  const signerAddress = await getSignerAddress()
  const databaseId = getDatabaseId(config.network)

  console.log(`Network:      ${config.network}`)
  console.log(`DWS:          ${config.dwsUrl}`)
  console.log(`SQLit:        ${config.sqlitUrl}`)
  console.log(`Database ID:  ${databaseId}`)
  console.log(`Deployer:     ${signerAddress}`)
  console.log('')

  await ensureBuild()

  // Create backup before deploying (if database exists)
  await createBackup(config)

  // Provision database first
  console.log('\n[1/5] Provisioning SQLit database...')
  await provisionDatabase(config, signerAddress)

  // Upload frontend to IPFS
  console.log('\n[2/5] Uploading frontend to IPFS...')
  const frontendCid = await uploadFrontend(config, signerAddress)
  console.log(`   Frontend CID: ${frontendCid}`)

  // Upload server bundle
  console.log('\n[3/5] Uploading server bundle...')
  const serverBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/server.js',
    'otto-server.js',
  )
  console.log(`   Server CID: ${serverBundle.cid}`)

  // Deploy worker
  console.log('\n[4/5] Deploying worker to DWS...')
  const workerId = await deployWorker(config, serverBundle, signerAddress)
  console.log(`   Worker ID: ${workerId}`)

  // Register JNS
  console.log('\n[5/5] Registering JNS name...')
  const jnsRegistered = await registerJNS(
    config,
    frontendCid,
    workerId,
    signerAddress,
  )

  // Sync across all DWS pods for immediate availability
  console.log('\n[6/6] Syncing workers across pods...')
  await syncWorkersAcrossPods(config)

  // Verify deployment - FAIL if verification fails
  console.log('\n[7/7] Verifying deployment endpoints...')
  await verifyDeploymentEndpoints(config)

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                       ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend:   ipfs://${frontendCid.slice(0, 30)}...     ║`)
  console.log(`║  Worker:     ${workerId.slice(0, 36)}...  ║`)
  console.log(`║  Database:   ${databaseId}                    ║`)
  console.log(
    `║  JNS:        otto.jeju ${jnsRegistered ? '✓' : '(pending)'}                 ║`,
  )
  console.log('╠════════════════════════════════════════════════════════════╣')
  if (config.network === 'testnet') {
    console.log('║  URL:        https://otto.testnet.jejunetwork.org      ║')
  } else if (config.network === 'mainnet') {
    console.log('║  URL:        https://otto.jejunetwork.org              ║')
  } else {
    console.log('║  URL:        http://localhost:4050                     ║')
  }
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Deployment successful.')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
