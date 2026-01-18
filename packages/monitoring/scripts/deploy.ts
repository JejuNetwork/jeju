#!/usr/bin/env bun
/**
 * Monitoring Deployment Script
 *
 * Deploys Monitoring to DWS infrastructure.
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

const _DWSWorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  name: z.string(),
  codeCid: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
})

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  cdnEnabled: boolean
}

async function getConfig(): Promise<DeployConfig> {
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

  // Resolve private key - prefer key files over env (env may have placeholders)
  let privateKey: string | undefined

  // First, try to load from CLI key management
  const keyFilePath = join(
    process.env.HOME ?? '',
    '.jeju',
    'keys',
    network,
    'deployer.json',
  )
  if (existsSync(keyFilePath)) {
    const keyData = JSON.parse(await readFile(keyFilePath, 'utf-8')) as {
      privateKey: string
    }
    privateKey = keyData.privateKey
    console.log(`Using deployer key from ${keyFilePath}`)
  }

  // Fall back to environment variables if no key file
  if (!privateKey) {
    const envKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
    // Only use env key if it looks valid (66 chars)
    if (envKey?.startsWith('0x') && envKey.length === 66) {
      privateKey = envKey
    }
  }

  if (!privateKey) {
    throw new Error(
      `No deployer key configured for ${network}.\n\n` +
        'Options:\n' +
        '  1. Set DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable\n' +
        `  2. Run: jeju keys genesis -n ${network}\n` +
        `  3. Create ~/.jeju/keys/${network}/deployer.json manually`,
    )
  }

  // Validate key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error(
      `Invalid private key format. Must be 0x-prefixed 64 hex chars (got ${privateKey.length} chars)`,
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
  if (!existsSync(resolve(APP_DIR, 'dist/api/worker.js'))) {
    console.log('[Monitoring] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.exited
  }
  console.log('[Monitoring] Build found')
}

interface UploadResult {
  cid: string
  hash: `0x${string}`
  size: number
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    map: 'application/json',
  }
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream'
}

async function uploadToIPFS(
  dwsUrl: string,
  filePath: string,
  name: string,
): Promise<UploadResult> {
  const content = await readFile(resolve(APP_DIR, filePath))
  const hash = keccak256(content) as `0x${string}`
  const mimeType = getMimeType(name)

  // Retry upload up to 3 times with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    const formData = new FormData()
    formData.append('file', new Blob([content], { type: mimeType }), name)
    formData.append('name', name)

    const response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60000), // 60 second timeout
    }).catch(() => null)

    if (response?.ok) {
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

    const errorText = response
      ? await response.text()
      : 'Timeout or network error'
    console.log(`   Attempt ${attempt}/3 failed for ${name}: ${errorText}`)

    if (attempt < 3) {
      const delay = attempt * 2000
      console.log(`   Retrying in ${delay / 1000}s...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } else {
      throw new Error(
        `Upload failed for ${name} after 3 attempts: ${errorText}`,
      )
    }
  }

  throw new Error(`Upload failed for ${name}`)
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

  // Register worker with Bun runtime using CID
  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify({
      name: 'monitoring-api',
      codeCid: apiBundle.cid,
      runtime: 'bun',
      handler: 'worker.js',
      memory: 256,
      timeout: 30000,
      env: {
        NETWORK: config.network,
        RPC_URL: config.rpcUrl,
        DWS_URL: config.dwsUrl,
        PROMETHEUS_URL: 'http://localhost:9090',
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.warn(`   Worker registry: ${errorText}`)
  }

  // Return the CID as the worker ID - the Bun runtime uses CID-based lookup
  return apiBundle.cid
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

  const domain =
    config.network === 'testnet'
      ? 'monitoring.testnet.jejunetwork.org'
      : config.network === 'mainnet'
        ? 'monitoring.jejunetwork.org'
        : 'monitoring.localhost'

  const cdnConfig = {
    name: 'monitoring',
    domain,
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: ['/api/*', '/health'],
    },
    assets,
    cacheRules: [
      { pattern: '/web/**', ttl: 31536000, immutable: true },
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

async function registerAppRouter(
  config: DeployConfig,
  staticAssets: Map<string, UploadResult>,
  workerId: string,
): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  // Build staticFiles map: path -> CID
  const staticFilesMap: Record<string, string> = {}
  for (const [path, result] of staticAssets) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    staticFilesMap[normalizedPath] = result.cid
  }

  // workerId is the IPFS CID for the worker bundle
  const appRouterData = {
    name: 'monitoring',
    jnsName: 'monitoring.jeju',
    frontendCid: staticFilesMap['/index.html'] ?? null,
    staticFiles: staticFilesMap,
    backendWorkerId: workerId,
    backendEndpoint: `${config.dwsUrl}/workers/${workerId}/http`,
    apiPaths: ['/a2a/*', '/mcp/*', '/health'],
    spa: true,
    enabled: true,
  }

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify(appRouterData),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.warn(`   Warning: App router registration failed: ${errorText}`)
  } else {
    const result = (await response.json()) as { app?: { name?: string } }
    console.log(`   Registered: ${result.app?.name || 'monitoring'}`)
  }
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║            Monitoring Deployment to DWS                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = await getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  await ensureBuild()

  // Upload static assets
  console.log('\nUploading static assets...')
  const webAssets = await uploadDirectory(config.dwsUrl, './dist/web', 'web')

  const indexResult = await uploadToIPFS(
    config.dwsUrl,
    './dist/index.html',
    'index.html',
  )
  webAssets.set('index.html', indexResult)
  console.log(`   index.html -> ${indexResult.cid}`)

  const faviconResult = await uploadToIPFS(
    config.dwsUrl,
    './dist/favicon.svg',
    'favicon.svg',
  )
  webAssets.set('favicon.svg', faviconResult)
  console.log(`   favicon.svg -> ${faviconResult.cid}`)

  console.log(`   Total: ${webAssets.size} files\n`)

  // Upload worker bundle
  console.log('Uploading worker bundle...')
  const apiBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/api/worker.js',
    'monitoring-worker.js',
  )
  console.log(`   Worker CID: ${apiBundle.cid}\n`)

  // Deploy worker
  console.log('Deploying worker to DWS...')
  const workerId = await deployWorker(config, apiBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  // Setup CDN
  console.log('Configuring CDN...')
  await setupCDN(config, webAssets)

  // Register with DWS app router for hostname-based routing
  console.log('Registering with app router...')
  await registerAppRouter(config, webAssets, workerId)

  const frontendUrl =
    config.network === 'testnet'
      ? 'https://monitoring.testnet.jejunetwork.org'
      : config.network === 'mainnet'
        ? 'https://monitoring.jejunetwork.org'
        : 'http://monitoring.localhost:4030'

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend: ${frontendUrl.padEnd(44)}║`)
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
