#!/usr/bin/env bun
/**
 * Autocrat Production Server
 *
 * Deploys and serves Autocrat using full DWS decentralized infrastructure:
 * - Frontend: Deployed to DWS IPFS storage
 * - Backend: Deployed to DWS workerd runtime
 * - Database: SQLit distributed database
 *
 * This is the "bun run start" entrypoint for production mode.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { getSQLit } from '@jejunetwork/db'
import type { Subprocess } from 'bun'
import { keccak256 } from 'viem'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(APP_DIR, 'dist')
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`

const network = getCurrentNetwork()
const host = getLocalhostHost()
const DWS_URL = getCoreAppUrl('DWS_API')
const API_PORT = CORE_PORTS.AUTOCRAT_API.get()

interface RunningProcess {
  name: string
  process: Subprocess
}

const processes: RunningProcess[] = []
let shuttingDown = false

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

function cleanup(): void {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Autocrat] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Autocrat] Stopping ${name}...`)
    process.kill()
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function ensureBuild(): Promise<void> {
  const requiredFiles = [`${STATIC_DIR}/index.html`, `${WORKER_DIR}/worker.js`]

  const needsBuild = requiredFiles.some((f) => !existsSync(f))

  if (needsBuild) {
    console.log('[Autocrat] Building production bundle...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error('Build failed')
    }
  } else {
    console.log('[Autocrat] Using existing build')
  }
}

async function waitForDWS(maxWaitMs = 30000): Promise<boolean> {
  const start = Date.now()
  console.log(`[Autocrat] Waiting for DWS at ${DWS_URL}...`)

  while (Date.now() - start < maxWaitMs) {
    const response = await fetch(`${DWS_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null)

    if (response?.ok) {
      console.log('[Autocrat] DWS is ready')
      return true
    }

    await Bun.sleep(500)
  }

  return false
}

async function uploadToIPFS(
  filePath: string,
  name: string,
): Promise<{ cid: string; hash: `0x${string}`; size: number }> {
  const content = await readFile(filePath)
  const hash = keccak256(content) as `0x${string}`

  const formData = new FormData()
  formData.append('file', new Blob([content]), name)
  formData.append('name', name)

  const response = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  }).catch((error) => {
    throw new Error(`Upload failed: ${error.message}`)
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
    const key = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const subResults = await uploadDirectory(fullPath, key)
      for (const [k, v] of subResults) {
        results.set(k, v)
      }
    } else {
      const result = await uploadToIPFS(fullPath, key)
      results.set(key, result)
      console.log(`   ${key} -> ipfs://${result.cid}`)
    }
  }

  return results
}

async function deployWorker(
  workerCid: string,
  workerHash: `0x${string}`,
): Promise<string> {
  const deployRequest = {
    name: 'autocrat-api',
    codeCid: workerCid,
    codeHash: workerHash,
    runtime: 'bun',
    handler: 'worker.js:default',
    memory: 512,
    timeout: 60000,
    env: {
      NETWORK: network,
      RPC_URL: getL2RpcUrl(),
      DWS_URL: DWS_URL,
      SQLIT_NODES: getSQLitBlockProducerUrl(),
      SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? 'autocrat',
    },
  }

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
    console.warn(`[Autocrat] Worker deployment via DWS failed: ${error}`)
    // Return empty string to indicate we should use fallback local worker
    return ''
  }

  const rawJson: unknown = await response.json()
  const parsed = WorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    console.warn(
      `[Autocrat] Invalid worker deploy response: ${parsed.error.message}`,
    )
    return ''
  }

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

  const backendEndpoint = workerId
    ? `${DWS_URL}/workers/${workerId}`
    : `http://${host}:${API_PORT}`

  const response = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify({
      name: 'autocrat',
      jnsName: 'autocrat.jeju',
      frontendCid: indexCid,
      staticFiles: Object.keys(staticFiles).length > 0 ? staticFiles : null,
      backendWorkerId: workerId || null,
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
    console.warn(`[Autocrat] App registration warning: ${errorText}`)
  } else {
    const rawJson: unknown = await response.json()
    const parsed = AppDeployedResponseSchema.safeParse(rawJson)
    if (parsed.success) {
      console.log(`[Autocrat] App registered: ${parsed.data.name}`)
    }
  }
}

async function initializeSQLit(): Promise<void> {
  console.log('[Autocrat] Initializing SQLit database...')

  // Check if SQLit credentials are configured
  const squitPrivateKey = process.env.SQLIT_PRIVATE_KEY
  const sqlitKeyId = process.env.SQLIT_KEY_ID

  if (!squitPrivateKey && !sqlitKeyId) {
    console.warn(
      '[Autocrat] SQLit credentials not configured - database operations will use in-memory fallback',
    )
    console.warn(
      '   Set SQLIT_PRIVATE_KEY or SQLIT_KEY_ID for persistent storage',
    )
    return
  }

  try {
    const sqlit = getSQLit({
      blockProducerEndpoint: getSQLitBlockProducerUrl(),
      databaseId: process.env.SQLIT_DATABASE_ID ?? 'autocrat',
      privateKey: squitPrivateKey as `0x${string}` | undefined,
      keyId: sqlitKeyId,
    })

    const healthy = await sqlit.isHealthy()
    if (!healthy) {
      console.warn(
        '[Autocrat] SQLit not available - database operations will fail until it starts',
      )
      return
    }

    console.log('[Autocrat] SQLit connection verified')
  } catch (error) {
    console.warn(
      `[Autocrat] SQLit initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function startLocalWorker(): Promise<void> {
  console.log(`[Autocrat] Starting local API server on port ${API_PORT}...`)

  const proc = Bun.spawn(['bun', 'run', 'api/worker.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NETWORK: network,
      TEE_MODE: 'simulated',
      TEE_PLATFORM: 'local',
      TEE_REGION: 'local',
      RPC_URL: getL2RpcUrl(),
      DWS_URL: DWS_URL,
      INDEXER_URL: getCoreAppUrl('INDEXER_GRAPHQL'),
      SQLIT_NODES: getSQLitBlockProducerUrl(),
      SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? 'autocrat',
    },
  })

  processes.push({ name: 'api', process: proc })

  // Wait for API to be ready
  const start = Date.now()
  while (Date.now() - start < 30000) {
    const response = await fetch(`http://${host}:${API_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null)

    if (response?.ok) {
      console.log(`[Autocrat] API server ready on port ${API_PORT}`)
      return
    }
    await Bun.sleep(500)
  }

  console.warn('[Autocrat] API server may not be ready yet')
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Autocrat Production Server                    ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Network:  ${network.padEnd(47)}║`)
  console.log(`║  DWS:      ${DWS_URL.padEnd(47)}║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Step 1: Ensure build exists
  await ensureBuild()

  // Step 2: Check if DWS is available
  const dwsAvailable = await waitForDWS(10000)

  let staticAssets: Map<
    string,
    { cid: string; hash: `0x${string}`; size: number }
  > = new Map()
  let workerId = ''

  if (dwsAvailable) {
    try {
      // Step 3: Upload static assets to IPFS via DWS
      console.log('\n[Autocrat] Uploading frontend to DWS IPFS storage...')
      staticAssets = await uploadDirectory(STATIC_DIR)
      console.log(`[Autocrat] Uploaded ${staticAssets.size} files to IPFS`)

      // Step 4: Upload and deploy worker to DWS workerd
      console.log('\n[Autocrat] Deploying worker to DWS...')
      const workerBundle = await uploadToIPFS(
        `${WORKER_DIR}/worker.js`,
        'autocrat-api-worker.js',
      )
      console.log(`[Autocrat] Worker code uploaded: ipfs://${workerBundle.cid}`)

      workerId = await deployWorker(workerBundle.cid, workerBundle.hash)
      if (workerId) {
        console.log(`[Autocrat] Worker deployed: ${workerId}`)
      } else {
        console.log('[Autocrat] Using local worker fallback')
      }

      // Step 5: Register app with DWS app router
      console.log('\n[Autocrat] Registering app with DWS...')
      await registerApp(staticAssets, workerId)
    } catch (error) {
      console.warn(
        `\n[Autocrat] DWS deployment failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      console.warn('[Autocrat] Falling back to local mode')
      staticAssets = new Map()
      workerId = ''
    }
  } else {
    console.warn('\n[Autocrat] DWS not available - running in local mode')
  }

  // Step 6: Initialize SQLit (tables created on first use)
  await initializeSQLit()

  // Step 7: Start local worker if DWS worker deployment failed
  if (!workerId) {
    await startLocalWorker()
  }

  // Print summary
  const frontendPort = CORE_PORTS.AUTOCRAT_WEB.get()
  const indexCid = staticAssets.get('index.html')?.cid

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                 Autocrat is Running                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  if (indexCid) {
    console.log(`║  IPFS CID:   ipfs://${indexCid.slice(0, 38)}...║`)
  }
  if (dwsAvailable) {
    console.log(
      `║  Frontend:   ${`${DWS_URL.replace(':4030', ':8080')}/autocrat`.padEnd(45)}║`,
    )
  }
  console.log(`║  API:        http://${host}:${API_PORT}${' '.repeat(33)}║`)
  console.log(
    `║  Health:     http://${host}:${API_PORT}/health${' '.repeat(26)}║`,
  )
  if (network === 'localnet') {
    console.log(
      `║  Local Dev:  http://${host}:${frontendPort}${' '.repeat(33)}║`,
    )
  }
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log('║  Press Ctrl+C to stop                                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  // If we have a local worker, wait for it to exit
  if (processes.length > 0) {
    await Promise.all(processes.map((p) => p.process.exited))
  } else {
    // Otherwise wait forever
    await new Promise(() => {})
  }
}

main().catch((error) => {
  console.error('[Autocrat] Fatal error:', error)
  cleanup()
  process.exit(1)
})
