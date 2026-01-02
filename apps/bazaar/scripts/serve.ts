#!/usr/bin/env bun
/**
 * Bazaar Production Serve Script (DWS-Native)
 *
 * Deploys and runs Bazaar on the decentralized Jeju DWS infrastructure:
 * 1. Builds frontend and uploads to DWS IPFS storage
 * 2. Deploys backend worker to DWS workerd
 * 3. Initializes SQLit database with proper provisioning
 * 4. Registers with DWS app router for decentralized routing
 *
 * Usage:
 *   bun run start                    # Full DWS deployment
 *   USE_DWS=false bun run start      # Fallback to standalone mode
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { Subprocess } from 'bun'
import { z } from 'zod'
import { createBazaarApp, initializeDatabase } from '../api/worker'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_STATIC = join(APP_DIR, 'dist/static')
const DIST_WORKER = join(APP_DIR, 'dist/worker')

const FRONTEND_PORT = CORE_PORTS.BAZAAR.get()
const API_PORT = CORE_PORTS.BAZAAR_API.get()

// DWS Configuration - resolved dynamically from network
const network = getCurrentNetwork()
const DWS_URL = getCoreAppUrl('DWS_API')
const USE_DWS = process.env.USE_DWS !== 'false'

// Response schemas for DWS API validation
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const WorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.enum(['pending', 'deploying', 'active', 'inactive', 'error']),
})

const AppRegistrationResponseSchema = z.object({
  success: z.boolean(),
  name: z.string().optional(),
})

interface ProcessInfo {
  name: string
  process: Subprocess
}

interface DeploymentState {
  frontendCid: string | null
  backendWorkerId: string | null
  backendEndpoint: string | null
  staticFiles: Record<string, string>
  sqlit: SQLitClient | null
}

const state: DeploymentState = {
  frontendCid: null,
  backendWorkerId: null,
  backendEndpoint: null,
  staticFiles: {},
  sqlit: null,
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup(): void {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Bazaar] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Bazaar] Stopping ${name}...`)
    try {
      process.kill()
    } catch {
      // Process may have already exited
    }
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const host = getLocalhostHost()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return true
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function checkBuild(): Promise<boolean> {
  const requiredFiles = [
    join(DIST_STATIC, 'index.html'),
    join(DIST_WORKER, 'worker.js'),
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      return false
    }
  }
  return true
}

async function runBuild(): Promise<void> {
  console.log('[Bazaar] Building for production...')

  const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Build failed with exit code ${exitCode}`)
  }

  console.log('[Bazaar] Build complete.')
}

async function uploadToIPFS(filePath: string, name: string): Promise<string> {
  const content = await readFile(filePath)

  const formData = new FormData()
  formData.append('file', new Blob([content]), name)
  formData.append('tier', 'popular')
  formData.append('category', 'app')

  const response = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid IPFS response: ${parsed.error.message}`)
  }

  return parsed.data.cid
}

async function uploadFrontendToIPFS(): Promise<void> {
  console.log('[Bazaar] Uploading frontend to DWS IPFS storage...')

  if (!existsSync(DIST_STATIC)) {
    throw new Error('Frontend build not found. Run build first.')
  }

  // Recursively find and upload all static files
  const uploadDir = async (
    dir: string,
    prefix = '',
  ): Promise<Record<string, string>> => {
    const results: Record<string, string> = {}
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const key = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        const subResults = await uploadDir(fullPath, key)
        Object.assign(results, subResults)
      } else {
        const cid = await uploadToIPFS(fullPath, key)
        results[key] = cid
        console.log(`   ${key} -> ${cid.slice(0, 16)}...`)
      }
    }

    return results
  }

  state.staticFiles = await uploadDir(DIST_STATIC)

  // Upload manifest with all file CIDs
  const manifest = {
    app: 'bazaar',
    version: '2.0.0',
    files: Object.entries(state.staticFiles).map(([path, cid]) => ({
      path,
      cid,
    })),
    uploadedAt: Date.now(),
  }

  const manifestContent = JSON.stringify(manifest, null, 2)
  const manifestBlob = new Blob([manifestContent])
  const manifestFormData = new FormData()
  manifestFormData.append('file', manifestBlob, 'manifest.json')
  manifestFormData.append('tier', 'popular')
  manifestFormData.append('category', 'app')

  const manifestResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: manifestFormData,
  })

  if (!manifestResponse.ok) {
    throw new Error(`Manifest upload failed: ${await manifestResponse.text()}`)
  }

  const manifestJson: unknown = await manifestResponse.json()
  const manifestParsed = IPFSUploadResponseSchema.safeParse(manifestJson)
  if (!manifestParsed.success) {
    throw new Error(
      `Invalid manifest response: ${manifestParsed.error.message}`,
    )
  }

  state.frontendCid = manifestParsed.data.cid
  console.log(
    `[Bazaar] Frontend uploaded: ${Object.keys(state.staticFiles).length} files`,
  )
  console.log(`[Bazaar] Frontend CID: ${state.frontendCid}`)
}

async function deployWorkerToWorkerd(): Promise<void> {
  console.log('[Bazaar] Deploying backend worker to DWS workerd...')

  const workerPath = join(DIST_WORKER, 'worker.js')
  if (!existsSync(workerPath)) {
    throw new Error('Worker bundle not found. Run build first.')
  }

  // Upload worker code to IPFS first
  const workerCode = await readFile(workerPath)
  const codeFormData = new FormData()
  codeFormData.append(
    'file',
    new Blob([workerCode], { type: 'application/javascript' }),
    'bazaar-api-worker.js',
  )
  codeFormData.append('tier', 'compute')
  codeFormData.append('category', 'worker')

  const codeResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: codeFormData,
  })

  if (!codeResponse.ok) {
    throw new Error(`Worker code upload failed: ${await codeResponse.text()}`)
  }

  const codeJson: unknown = await codeResponse.json()
  const codeParsed = IPFSUploadResponseSchema.safeParse(codeJson)
  if (!codeParsed.success) {
    throw new Error(`Invalid code upload response: ${codeParsed.error.message}`)
  }

  const codeCid = codeParsed.data.cid
  console.log(`[Bazaar] Worker code CID: ${codeCid}`)

  // Deploy to workerd
  const base64Code = workerCode.toString('base64')

  const deployRequest = {
    name: 'bazaar-api',
    code: base64Code,
    codeCid,
    memoryMb: 256,
    timeoutMs: 30000,
    cpuTimeMs: 5000,
    compatibilityDate: '2025-06-01',
    bindings: [
      { name: 'APP_NAME', type: 'text' as const, value: 'bazaar' },
      { name: 'JEJU_NETWORK', type: 'text' as const, value: network },
      { name: 'RPC_URL', type: 'text' as const, value: getL2RpcUrl() },
      {
        name: 'INDEXER_URL',
        type: 'text' as const,
        value: getIndexerGraphqlUrl(),
      },
      {
        name: 'SQLIT_NODES',
        type: 'text' as const,
        value: getSQLitBlockProducerUrl(),
      },
    ],
  }

  const deployResponse = await fetch(`${DWS_URL}/workerd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    },
    body: JSON.stringify(deployRequest),
  })

  if (!deployResponse.ok) {
    const errorText = await deployResponse.text()
    throw new Error(`Worker deployment failed: ${errorText}`)
  }

  const deployJson: unknown = await deployResponse.json()
  const deployParsed = WorkerDeployResponseSchema.safeParse(deployJson)
  if (!deployParsed.success) {
    throw new Error(`Invalid deploy response: ${deployParsed.error.message}`)
  }

  state.backendWorkerId = deployParsed.data.workerId
  state.backendEndpoint = `${DWS_URL}/workerd/${state.backendWorkerId}/http`

  console.log(`[Bazaar] Worker deployed: ${state.backendWorkerId}`)
  console.log(`[Bazaar] Worker endpoint: ${state.backendEndpoint}`)
}

async function initializeSQLitDatabase(): Promise<void> {
  console.log('[Bazaar] Initializing SQLit database...')

  const blockProducerEndpoint = getSQLitBlockProducerUrl()
  const databaseId = process.env.SQLIT_DATABASE_ID || 'bazaar-db'

  try {
    state.sqlit = getSQLit({
      blockProducerEndpoint,
      databaseId,
      debug: network === 'localnet',
    })

    // Check if SQLit is healthy
    const isHealthy = await state.sqlit.isHealthy()
    if (!isHealthy) {
      throw new Error('SQLit is not healthy')
    }

    // Initialize database tables
    await initializeDatabase(state.sqlit)

    console.log(`[Bazaar] SQLit database initialized: ${databaseId}`)
    console.log(`[Bazaar] SQLit endpoint: ${blockProducerEndpoint}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`SQLit initialization failed: ${message}`)
  }
}

async function registerWithAppRouter(): Promise<void> {
  console.log('[Bazaar] Registering with DWS app router...')

  const registrationData = {
    name: 'bazaar',
    jnsName: 'bazaar.jeju',
    frontendCid: state.frontendCid,
    staticFiles: state.staticFiles,
    backendWorkerId: state.backendWorkerId,
    backendEndpoint: state.backendEndpoint,
    apiPaths: ['/api', '/health', '/.well-known'],
    spa: true,
    enabled: true,
  }

  const response = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registrationData),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`App router registration failed: ${errorText}`)
  }

  const regJson: unknown = await response.json()
  const regParsed = AppRegistrationResponseSchema.safeParse(regJson)
  if (!regParsed.success || !regParsed.data.success) {
    throw new Error('App router registration returned failure')
  }

  console.log('[Bazaar] Registered with app router.')
}

async function startStandaloneFallback(): Promise<void> {
  console.log('[Bazaar] Starting in standalone mode (DWS unavailable)...')

  // Start API server directly
  const app = createBazaarApp({
    NETWORK: network,
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL,
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    SQLIT_NODES: getSQLitBlockProducerUrl(),
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID || 'bazaar-db',
    SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY || '',
  })

  const host = getLocalhostHost()
  app.listen(API_PORT, () => {
    console.log(`[Bazaar] API running at http://${host}:${API_PORT}`)
  })

  // Serve static files
  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      let path = url.pathname

      // Proxy API requests
      if (
        path.startsWith('/api/') ||
        path === '/health' ||
        path.startsWith('/.well-known/')
      ) {
        return fetch(`http://${host}:${API_PORT}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Normalize path
      if (path === '/') path = '/index.html'

      // Serve static file
      const file = Bun.file(`${DIST_STATIC}${path}`)
      if (await file.exists()) {
        const contentType = getContentType(path)
        return new Response(await file.arrayBuffer(), {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': getCacheControl(path),
          },
        })
      }

      // SPA fallback
      const indexFile = Bun.file(`${DIST_STATIC}/index.html`)
      if (await indexFile.exists()) {
        return new Response(await indexFile.arrayBuffer(), {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Bazaar] Frontend running at http://${host}:${FRONTEND_PORT}`)
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.map')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}

function getCacheControl(path: string): string {
  if (path.match(/-[a-f0-9]{8,}\.(js|css)$/)) {
    return 'public, max-age=31536000, immutable'
  }
  if (path.endsWith('.js') || path.endsWith('.css')) {
    return 'public, max-age=86400'
  }
  if (path.endsWith('.html')) {
    return 'no-cache'
  }
  return 'public, max-age=3600'
}

async function checkDWSHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${DWS_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const host = getLocalhostHost()

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Bazaar DWS Production Deployment                  ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Network:   ${network.padEnd(46)}║`)
  console.log(`║  DWS URL:   ${DWS_URL.padEnd(46).slice(0, 46)}║`)
  console.log(
    `║  Mode:      ${(USE_DWS ? 'Decentralized (DWS)' : 'Standalone').padEnd(46)}║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Check for build
  if (!(await checkBuild())) {
    await runBuild()
  } else {
    console.log('[Bazaar] Using existing build.')
  }

  // Check DWS availability
  if (USE_DWS) {
    console.log('[Bazaar] Checking DWS availability...')
    const dwsHealthy = await checkDWSHealth()

    if (!dwsHealthy) {
      console.warn(
        '[Bazaar] DWS is not available. Falling back to standalone mode.',
      )
      await startStandaloneFallback()
      return
    }

    console.log('[Bazaar] DWS is healthy.')

    // Initialize SQLit database first
    await initializeSQLitDatabase()

    // Upload frontend to IPFS
    await uploadFrontendToIPFS()

    // Deploy worker to workerd
    await deployWorkerToWorkerd()

    // Register with app router
    await registerWithAppRouter()

    // Wait for worker to be ready
    console.log('[Bazaar] Waiting for worker to be ready...')
    const workerReady = await waitForPort(API_PORT, 30000).catch(() => false)

    // Print success
    console.log('')
    console.log(
      '╔════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║           Bazaar Deployed Successfully                      ║',
    )
    console.log(
      '╠════════════════════════════════════════════════════════════╣',
    )
    console.log(
      `║  Frontend CID:  ${(state.frontendCid || 'N/A').slice(0, 42).padEnd(42)}║`,
    )
    console.log(
      `║  Worker ID:     ${(state.backendWorkerId || 'N/A').slice(0, 42).padEnd(42)}║`,
    )
    console.log(
      `║  Worker Status: ${(workerReady ? 'Ready' : 'Pending').padEnd(42)}║`,
    )
    console.log(
      '╠════════════════════════════════════════════════════════════╣',
    )
    console.log(
      `${`║  Local Proxy:   http://${host}:${FRONTEND_PORT}`.padEnd(61)}║`,
    )
    console.log(
      `║  DWS Endpoint:  ${(state.backendEndpoint || DWS_URL).slice(0, 42).padEnd(42)}║`,
    )
    console.log(
      `║  Health:        ${(state.backendEndpoint || DWS_URL).slice(0, 30) + '/health'.padEnd(42).slice(0, 42)}║`,
    )
    console.log(
      '╚════════════════════════════════════════════════════════════╝',
    )
    console.log('')
    console.log('Press Ctrl+C to stop')

    // Start local proxy for development convenience
    Bun.serve({
      port: FRONTEND_PORT,
      async fetch(req) {
        const url = new URL(req.url)
        const path = url.pathname

        // API requests go to workerd
        if (
          path.startsWith('/api/') ||
          path === '/health' ||
          path.startsWith('/.well-known/')
        ) {
          const targetUrl = `${state.backendEndpoint}${path}${url.search}`
          return fetch(targetUrl, {
            method: req.method,
            headers: req.headers,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? req.body
                : undefined,
          }).catch((error) => {
            console.error('[Bazaar] Proxy error:', error.message)
            return new Response(
              JSON.stringify({ error: 'Backend unavailable' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          })
        }

        // Static files from IPFS/CDN
        const filePath = path === '/' ? 'index.html' : path.slice(1)
        const fileCid = state.staticFiles[filePath]

        if (fileCid) {
          const ipfsResponse = await fetch(
            `${DWS_URL}/storage/${fileCid}`,
          ).catch(() => null)

          if (ipfsResponse?.ok) {
            return new Response(await ipfsResponse.arrayBuffer(), {
              headers: {
                'Content-Type': getContentType(filePath),
                'Cache-Control': getCacheControl(filePath),
              },
            })
          }
        }

        // SPA fallback - serve index.html
        const indexCid = state.staticFiles['index.html']
        if (indexCid) {
          const indexResponse = await fetch(
            `${DWS_URL}/storage/${indexCid}`,
          ).catch(() => null)

          if (indexResponse?.ok) {
            return new Response(await indexResponse.arrayBuffer(), {
              headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache',
              },
            })
          }
        }

        return new Response('Not Found', { status: 404 })
      },
    })

    console.log(
      `[Bazaar] Local proxy running at http://${host}:${FRONTEND_PORT}`,
    )
  } else {
    await startStandaloneFallback()
  }
}

main().catch((err) => {
  console.error('[Bazaar] Fatal error:', err)
  cleanup()
  process.exit(1)
})
