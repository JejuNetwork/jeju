#!/usr/bin/env bun
/**
 * Crucible Start Script
 *
 * Full decentralized start:
 * 1. Checks DWS is running
 * 2. Builds and deploys frontend to DWS IPFS storage
 * 3. Deploys backend worker to DWS workerd
 * 4. Registers with JNS for decentralized routing
 * 5. Connects to SQLit database
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  CORE_PORTS,
  getCurrentNetwork,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { keccak256 } from 'viem'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_DIR = join(APP_DIR, 'dist')
const WEB_DIR = join(DIST_DIR, 'web')
const API_DIR = join(DIST_DIR, 'api')

const network = getCurrentNetwork()
const host = getLocalhostHost()

// DWS endpoints - resolved dynamically
const DWS_PORT = CORE_PORTS.DWS_API.get()
const DWS_URL = process.env.DWS_URL ?? `http://${host}:${DWS_PORT}`

// SQLit endpoint - resolved dynamically via DWS
const SQLIT_URL = process.env.SQLIT_URL ?? getSQLitBlockProducerUrl()

// Crucible ports - from centralized port config
// Frontend on CRUCIBLE_API (4020), Backend API on CRUCIBLE_EXECUTOR (4021)
const CRUCIBLE_PORT = CORE_PORTS.CRUCIBLE_API.get()
const CRUCIBLE_API_PORT = CORE_PORTS.CRUCIBLE_EXECUTOR.get()

// Response schemas
const UploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const WorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
})

interface StartConfig {
  dwsUrl: string
  sqlitUrl: string
  network: 'localnet' | 'testnet' | 'mainnet'
  frontendPort: number
  apiPort: number
}

/**
 * Wait for a service to be healthy
 */
async function waitForService(
  name: string,
  url: string,
  healthPath: string,
  timeoutMs = 30000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const checkInterval = 500

  console.log(`[Crucible] Waiting for ${name} at ${url}${healthPath}...`)

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}${healthPath}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        console.log(`[Crucible] ${name} is ready.`)
        return true
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((r) => setTimeout(r, checkInterval))
  }

  return false
}

/**
 * Build frontend and API
 */
async function build(): Promise<void> {
  if (
    existsSync(join(WEB_DIR, 'index.html')) &&
    existsSync(join(API_DIR, 'index.js'))
  ) {
    console.log('[Crucible] Build exists, skipping...')
    return
  }

  console.log('[Crucible] Building...')
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

/**
 * Upload a file to DWS IPFS storage
 * Requires DWS to be running - no fallback to local serving
 */
async function uploadToIPFS(
  dwsUrl: string,
  filePath: string,
  name: string,
): Promise<{ cid: string; hash: `0x${string}`; size: number }> {
  const content = await readFile(resolve(APP_DIR, filePath))
  const hash = keccak256(content) as `0x${string}`

  const formData = new FormData()
  formData.append('file', new Blob([content]), name)
  formData.append('name', name)

  const response = await fetch(`${dwsUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Failed to upload ${name} to IPFS: ${response.status} - ${errorText}`,
    )
  }

  const rawJson: unknown = await response.json()
  const parsed = UploadResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(
      `Invalid upload response for ${name}: ${parsed.error.message}`,
    )
  }

  return { cid: parsed.data.cid, hash, size: content.length }
}

/**
 * Upload directory recursively
 */
async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  prefix = '',
): Promise<Map<string, { cid: string; hash: `0x${string}`; size: number }>> {
  const results = new Map<
    string,
    { cid: string; hash: `0x${string}`; size: number }
  >()
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
    }
  }

  return results
}

// Default localnet deployer address (first Anvil account)
const LOCALNET_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Store worker process for cleanup
let _workerProcess: ReturnType<typeof Bun.spawn> | null = null

/**
 * Deploy backend worker to DWS workerd
 * Uses DWS worker runtime for decentralized execution
 * Also starts a local Bun process as backup for immediate availability
 */
async function deployWorker(
  config: StartConfig,
  codeCid: string,
  codeHash: `0x${string}`,
): Promise<string> {
  // Use deployer address from env or default localnet address
  const deployerAddress =
    process.env.DEPLOYER_ADDRESS ??
    (config.network === 'localnet' ? LOCALNET_DEPLOYER : '')
  if (!deployerAddress) {
    throw new Error('DEPLOYER_ADDRESS required for non-localnet deployments')
  }

  const workerConfig = {
    name: 'crucible-api',
    codeCid,
    codeHash,
    runtime: 'bun',
    handler: 'index.js:default',
    memory: 512,
    timeout: 30000,
    port: config.apiPort,
    env: {
      NETWORK: config.network,
      SQLIT_URL: config.sqlitUrl,
      DWS_URL: config.dwsUrl,
      PORT: String(config.apiPort),
      API_PORT: String(config.apiPort),
      JEJU_NETWORK: config.network,
    },
  }

  // Register worker with DWS (for tracking and future distributed execution)
  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': deployerAddress,
    },
    body: JSON.stringify(workerConfig),
    signal: AbortSignal.timeout(30000),
  })

  let workerId = 'crucible-api'
  if (response.ok) {
    const rawJson: unknown = await response.json()
    const parsed = WorkerDeployResponseSchema.safeParse(rawJson)
    if (parsed.success) {
      workerId = parsed.data.functionId
    }
  } else if (response.status === 409) {
    // Worker already exists, update it
    console.log('[Crucible] Updating existing worker registration...')
    await fetch(`${config.dwsUrl}/workers/crucible-api`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': deployerAddress,
      },
      body: JSON.stringify({
        codeCid,
        codeHash,
        runtime: 'bun',
        handler: 'index.js:default',
        env: workerConfig.env,
      }),
      signal: AbortSignal.timeout(10000),
    })
  }

  // Start local Bun process for the worker (ensures immediate availability)
  // Use --no-install to skip package checks and speed up startup
  console.log('[Crucible] Starting worker process...')
  _workerProcess = Bun.spawn(
    [
      'bun',
      '--no-install',
      '-e',
      `
      const { createCrucibleApp } = await import('./api/worker.ts');
      const app = createCrucibleApp();
      Bun.serve({
        port: ${config.apiPort},
        hostname: '${host}',
        fetch: app.fetch,
      });
      console.log('[Crucible Worker] Started on http://${host}:${config.apiPort}');
      `,
    ],
    {
      cwd: APP_DIR,
      env: {
        ...process.env,
        PORT: String(config.apiPort),
        NETWORK: config.network,
        SQLIT_URL: config.sqlitUrl,
        DWS_URL: config.dwsUrl,
        JEJU_NETWORK: config.network,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )

  // Wait for worker to be ready
  const workerReady = await waitForService(
    'Worker',
    `http://${host}:${config.apiPort}`,
    '/health',
    30000,
  )
  if (!workerReady) {
    throw new Error('Worker failed to start')
  }

  return workerId
}

/**
 * Register frontend assets with DWS CDN
 * Uses JNS-resolved domain for fully decentralized routing
 */
async function setupCDN(
  config: StartConfig,
  assets: Map<string, { cid: string }>,
): Promise<void> {
  const assetList = Array.from(assets.entries()).map(([path, result]) => ({
    path: `/${path}`,
    cid: result.cid,
    contentType: getContentType(path),
    immutable:
      path.includes('-') && (path.endsWith('.js') || path.endsWith('.css')),
  }))

  // Domain is resolved via JNS - use .jeju TLD
  const jnsDomain = 'crucible.jeju'
  const httpDomain =
    config.network === 'localnet'
      ? 'crucible.local.jejunetwork.org'
      : config.network === 'testnet'
        ? 'crucible.testnet.jejunetwork.org'
        : 'crucible.jejunetwork.org'

  const cdnConfig = {
    name: 'crucible',
    jnsName: jnsDomain,
    domain: httpDomain,
    spa: {
      enabled: true,
      fallback: '/index.html',
      // API routes that should be proxied to the worker
      routes: ['/api/*', '/a2a/*', '/mcp/*', '/health', '/.well-known/*'],
    },
    assets: assetList,
    workerEndpoint: `http://${host}:${config.apiPort}`,
    cacheRules: [
      { pattern: '/chunks/**', ttl: 31536000, immutable: true },
      { pattern: '/assets/**', ttl: 31536000, immutable: true },
      { pattern: '/*.js', ttl: 31536000, immutable: true },
      { pattern: '/globals.css', ttl: 86400 },
      { pattern: '/index.html', ttl: 60, staleWhileRevalidate: 3600 },
    ],
  }

  const response = await fetch(`${config.dwsUrl}/cdn/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cdnConfig),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    console.warn('[Crucible] CDN configuration failed:', await response.text())
  } else {
    console.log(`[Crucible] CDN configured for ${jnsDomain} -> ${httpDomain}`)
  }
}

/**
 * Ensure SQLit database exists
 */
async function ensureDatabase(sqlitUrl: string): Promise<void> {
  console.log('[Crucible] Checking SQLit database...')

  try {
    // Create crucible database if it doesn't exist
    const response = await fetch(`${sqlitUrl}/v1/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: 'crucible',
        query: `
          CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            owner TEXT NOT NULL,
            character_cid TEXT,
            state_cid TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );

          CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            room_type TEXT NOT NULL DEFAULT 'chat',
            state_cid TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );

          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            content TEXT NOT NULL,
            action TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (room_id) REFERENCES rooms(room_id),
            FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
          );

          CREATE TABLE IF NOT EXISTS triggers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_id TEXT NOT NULL UNIQUE,
            agent_id TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            config TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
          );

          CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
          CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
          CREATE INDEX IF NOT EXISTS idx_triggers_agent ON triggers(agent_id);
        `,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      console.log('[Crucible] SQLit database ready.')
    } else {
      console.warn('[Crucible] SQLit database setup returned:', response.status)
    }
  } catch (error) {
    console.warn('[Crucible] Could not setup SQLit database:', error)
  }
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

/**
 * Start the frontend server that serves from DWS IPFS
 * Proxies API requests to the DWS worker
 */
async function startFrontendServer(config: StartConfig): Promise<void> {
  // Serve frontend from DWS CDN/IPFS with local file fallback
  Bun.serve({
    port: config.frontendPort,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // API proxy - route to DWS worker
      if (
        path.startsWith('/api/') ||
        path.startsWith('/health') ||
        path.startsWith('/a2a') ||
        path.startsWith('/mcp') ||
        path.startsWith('/.well-known/')
      ) {
        const apiUrl = `http://${host}:${config.apiPort}${path}${url.search}`
        const response = await fetch(apiUrl, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        })
        return response
      }

      // Try DWS CDN first (IPFS-backed)
      const cdnPath = path === '/' ? '/index.html' : path
      try {
        const cdnUrl = `${config.dwsUrl}/cdn/crucible${cdnPath}`
        const cdnResponse = await fetch(cdnUrl, {
          signal: AbortSignal.timeout(5000),
        })
        if (cdnResponse.ok) {
          return cdnResponse
        }
      } catch {
        // CDN not available, fall back to local files
      }

      // Fall back to local files
      const localPath = path === '/' ? '/index.html' : path
      const file = Bun.file(join(WEB_DIR, localPath))
      if (await file.exists()) {
        return new Response(await file.arrayBuffer(), {
          headers: {
            'Content-Type': getContentType(localPath),
            'Cache-Control': localPath.endsWith('.html')
              ? 'no-cache'
              : 'public, max-age=3600',
          },
        })
      }

      // SPA fallback - serve index.html for client-side routing
      if (!path.includes('.')) {
        const indexFile = Bun.file(join(WEB_DIR, 'index.html'))
        if (await indexFile.exists()) {
          return new Response(await indexFile.arrayBuffer(), {
            headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
          })
        }
      }

      return new Response('Not Found', { status: 404 })
    },
  })
}

/**
 * Main start function
 */
async function start(): Promise<void> {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Crucible - Decentralized Start                    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Network:  ${network}`)
  console.log(`DWS:      ${DWS_URL}`)
  console.log(`SQLit:    ${SQLIT_URL}`)
  console.log('')

  const config: StartConfig = {
    dwsUrl: DWS_URL,
    sqlitUrl: SQLIT_URL,
    network: network as 'localnet' | 'testnet' | 'mainnet',
    frontendPort: CRUCIBLE_PORT,
    apiPort: CRUCIBLE_API_PORT,
  }

  // 1. Check DWS is running - REQUIRED for decentralized deployment
  const dwsReady = await waitForService('DWS', config.dwsUrl, '/health', 60000)
  if (!dwsReady) {
    console.error('')
    console.error('═══════════════════════════════════════════════════════════')
    console.error(' ERROR: DWS is not available')
    console.error(
      ' Crucible requires DWS for decentralized storage and workers',
    )
    console.error('')
    console.error(' Start DWS first:')
    console.error('   jeju dev --app dws')
    console.error('')
    console.error(' Or run the full localnet:')
    console.error('   jeju dev')
    console.error('═══════════════════════════════════════════════════════════')
    process.exit(1)
  }

  // 2. Check SQLit is running
  const sqlitReady = await waitForService(
    'SQLit',
    config.sqlitUrl,
    '/v1/status',
    10000,
  )
  if (sqlitReady) {
    await ensureDatabase(config.sqlitUrl)
  } else {
    console.warn('[Crucible] SQLit not available - database features disabled')
  }

  // 3. Build if needed
  await build()

  // 4. Upload frontend to DWS IPFS
  console.log('')
  console.log('[Crucible] Uploading frontend to DWS IPFS...')
  const webAssets = await uploadDirectory(config.dwsUrl, 'dist/web')
  console.log(`[Crucible] Uploaded ${webAssets.size} files to IPFS`)

  // 5. Upload and deploy backend worker
  console.log('[Crucible] Deploying backend worker to DWS...')
  const apiBundle = await uploadToIPFS(
    config.dwsUrl,
    'dist/api/index.js',
    'crucible-api.js',
  )
  console.log(`[Crucible] API CID: ${apiBundle.cid}`)

  const workerId = await deployWorker(config, apiBundle.cid, apiBundle.hash)
  console.log(`[Crucible] Worker deployed: ${workerId}`)

  // 6. Setup CDN routing
  console.log('[Crucible] Configuring CDN...')
  await setupCDN(config, webAssets)

  // 7. Start frontend server
  console.log('')
  console.log('[Crucible] Starting frontend server...')
  await startFrontendServer(config)

  const indexCid = webAssets.get('index.html')?.cid

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Crucible is Running                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `${`║  Frontend:  http://${host}:${config.frontendPort}`.padEnd(63)}║`,
  )
  console.log(`${`║  API:       http://${host}:${config.apiPort}`.padEnd(63)}║`)
  console.log(
    `${`║  IPFS:      ipfs://${indexCid?.slice(0, 32)}...`.padEnd(63)}║`,
  )
  console.log(`${`║  Worker:    ${workerId.slice(0, 40)}...`.padEnd(63)}║`)
  console.log(`${'║'.padEnd(63)}║`)
  console.log(`${'║  Storage:   DWS IPFS'.padEnd(63)}║`)
  console.log(`${'║  Runtime:   DWS Workerd'.padEnd(63)}║`)
  console.log(
    `${`║  Database:  SQLit ${sqlitReady ? '(connected)' : '(unavailable)'}`.padEnd(63)}║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
}

start().catch((error) => {
  console.error('[Crucible] Start failed:', error)
  process.exit(1)
})
