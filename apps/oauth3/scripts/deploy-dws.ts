#!/usr/bin/env bun
/**
 * OAuth3 DWS Deployment
 *
 * Deploys OAuth3 to DWS decentralized infrastructure:
 * - Frontend: Deployed to DWS IPFS storage
 * - Backend: Deployed to DWS workerd runtime
 *
 * This replaces centralized K8s deployment with proper decentralized workers.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { keccak256 } from 'viem'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(APP_DIR, 'dist')
const STATIC_DIR = `${DIST_DIR}/web`
const WORKER_DIR = `${DIST_DIR}/api`

const network = process.env.NETWORK ?? getCurrentNetwork()
const host = getLocalhostHost()

// Determine DWS URL based on network
function getDwsUrl(): string {
  if (network === 'testnet') {
    return 'https://dws.testnet.jejunetwork.org'
  }
  if (network === 'mainnet') {
    return 'https://dws.jejunetwork.org'
  }
  return getCoreAppUrl('DWS_API')
}

const DWS_URL = getDwsUrl()

// Response schemas for DWS APIs
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const WorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string().optional(),
  status: z.enum(['active', 'inactive', 'error', 'deploying']),
})

const AppDeployedResponseSchema = z.object({
  name: z.string(),
  jnsName: z.string().optional(),
  frontendCid: z.string().nullable().optional(),
  backendWorkerId: z.string().nullable().optional(),
  backendEndpoint: z.string().nullable().optional(),
})

async function ensureBuild(): Promise<void> {
  const requiredFiles = [
    `${STATIC_DIR}/index.html`,
    `${STATIC_DIR}/app.js`,
    `${WORKER_DIR}/worker.js`,
  ]

  const needsBuild = requiredFiles.some((f) => !existsSync(f))

  if (needsBuild) {
    console.log('[OAuth3] Building production bundle...')
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

  // Verify build outputs exist
  for (const f of requiredFiles) {
    if (!existsSync(f)) {
      throw new Error(`Required file not found: ${f}`)
    }
  }
}

async function uploadDirectory(
  dirPath: string,
  prefix = '',
): Promise<Map<string, { cid: string; hash: `0x${string}`; size: number }>> {
  const results = new Map<
    string,
    { cid: string; hash: `0x${string}`; size: number }
  >()

  const entries = await readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const subResults = await uploadDirectory(fullPath, relativePath)
      for (const [path, result] of subResults) {
        results.set(path, result)
      }
    } else {
      const content = await readFile(fullPath)
      const hash = keccak256(content) as `0x${string}`

      // Use multipart form data for upload
      const formData = new FormData()
      formData.append('file', new Blob([content]), entry.name)

      const response = await fetch(`${DWS_URL}/storage/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(
          `Failed to upload ${relativePath}: ${await response.text()}`,
        )
      }

      const rawJson: unknown = await response.json()
      const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
      if (!parsed.success) {
        throw new Error(
          `Invalid upload response for ${relativePath}: ${parsed.error.message}`,
        )
      }

      results.set(relativePath, {
        cid: parsed.data.cid,
        hash,
        size: content.length,
      })

      console.log(`  Uploaded ${relativePath} -> ${parsed.data.cid}`)
    }
  }

  return results
}

async function deployWorker(
  workerCid: string,
  workerHash: `0x${string}`,
): Promise<string> {
  const deployRequest = {
    name: 'oauth3-api',
    codeCid: workerCid,
    codeHash: workerHash,
    runtime: 'bun',
    handler: 'worker.js:default',
    memory: 256,
    timeout: 30000,
    env: {
      NETWORK: network,
      RPC_URL: getL2RpcUrl(),
      DWS_URL: DWS_URL,
      SQLIT_NODES: getSQLitBlockProducerUrl(),
      SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? 'oauth3',
      JWT_SECRET: process.env.JWT_SECRET ?? 'testnet-jwt-secret',
      ALLOWED_ORIGINS: '*',
      SERVICE_AGENT_ID: 'auth.jeju',
    },
  }

  console.log('[OAuth3] Deploying worker to DWS...')
  console.log(`  Code CID: ${workerCid}`)
  console.log(`  Runtime: bun`)
  console.log(`  Memory: 256MB`)

  const response = await fetch(`${DWS_URL}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify(deployRequest),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`[OAuth3] Worker deployment failed: ${error}`)
    throw new Error(`Worker deployment failed: ${error}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = WorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    console.warn(
      `[OAuth3] Invalid worker deploy response: ${parsed.error.message}`,
    )
    throw new Error(`Invalid worker deploy response: ${parsed.error.message}`)
  }

  console.log(`  Worker ID: ${parsed.data.functionId}`)
  console.log(`  Status: ${parsed.data.status}`)

  return parsed.data.functionId
}

async function registerApp(
  staticAssets: Map<string, { cid: string }>,
  workerId: string,
): Promise<void> {
  const indexCid = staticAssets.get('index.html')?.cid
  const staticFiles: Record<string, string> = {}
  for (const [path, result] of staticAssets) {
    staticFiles[path] = result.cid
  }

  // Use DWS worker endpoint (decentralized)
  const backendEndpoint = `${DWS_URL}/workers/${workerId}/http`

  console.log('[OAuth3] Registering app with DWS...')
  console.log(`  Frontend CID: ${indexCid}`)
  console.log(`  Backend Worker: ${workerId}`)
  console.log(`  Backend Endpoint: ${backendEndpoint}`)

  const response = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify({
      name: 'oauth3',
      jnsName: 'auth.jeju',
      frontendCid: indexCid,
      staticFiles: Object.keys(staticFiles).length > 0 ? staticFiles : null,
      backendWorkerId: workerId,
      backendEndpoint: backendEndpoint,
      apiPaths: [
        '/api',
        '/oauth',
        '/wallet',
        '/session',
        '/farcaster',
        '/client',
        '/auth',
        '/callback',
        '/health',
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

  const rawJson: unknown = await response.json()
  const parsed = AppDeployedResponseSchema.safeParse(rawJson)
  if (parsed.success) {
    console.log(`[OAuth3] App registered: ${parsed.data.name}`)
    console.log(`  JNS: ${parsed.data.jnsName}`)
  }
}

async function deploy(): Promise<void> {
  console.log('OAuth3 DWS Deployment')
  console.log('='.repeat(50))
  console.log(`Network: ${network}`)
  console.log(`DWS URL: ${DWS_URL}`)
  console.log('')

  // Step 1: Ensure build exists
  console.log('[1/4] Checking build...')
  await ensureBuild()
  console.log('  Build verified')

  // Step 2: Upload static files to IPFS
  console.log('\n[2/4] Uploading static files to IPFS...')
  const staticAssets = await uploadDirectory(STATIC_DIR)
  console.log(`  Uploaded ${staticAssets.size} files`)

  // Step 3: Upload and deploy worker
  console.log('\n[3/4] Uploading and deploying worker...')
  const workerPath = `${WORKER_DIR}/worker.js`
  const workerContent = await readFile(workerPath)
  const workerHash = keccak256(workerContent) as `0x${string}`

  // Upload worker code to IPFS
  const workerFormData = new FormData()
  workerFormData.append('file', new Blob([workerContent]), 'worker.js')
  
  const workerUploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: workerFormData,
  })

  if (!workerUploadResponse.ok) {
    throw new Error(
      `Failed to upload worker: ${await workerUploadResponse.text()}`,
    )
  }

  const workerUploadJson: unknown = await workerUploadResponse.json()
  const workerUploadParsed = IPFSUploadResponseSchema.safeParse(workerUploadJson)
  if (!workerUploadParsed.success) {
    throw new Error(
      `Invalid worker upload response: ${workerUploadParsed.error.message}`,
    )
  }

  const workerCid = workerUploadParsed.data.cid
  console.log(`  Worker CID: ${workerCid}`)

  // Deploy worker to DWS workerd
  const workerId = await deployWorker(workerCid, workerHash)

  // Step 4: Register app with DWS app router
  console.log('\n[4/4] Registering app...')
  await registerApp(staticAssets, workerId)

  console.log('\n' + '='.repeat(50))
  console.log('Deployment complete.')
  console.log('')
  console.log('OAuth3 is now running on DWS decentralized infrastructure:')
  console.log(`  Frontend: https://oauth3.testnet.jejunetwork.org`)
  console.log(`  Worker: ${DWS_URL}/workers/${workerId}/http`)
  console.log('')
  console.log('Routing is now decentralized via DWS app router.')
}

deploy().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
