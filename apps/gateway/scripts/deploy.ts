#!/usr/bin/env bun
/**
 * Gateway Deployment Script
 *
 * Deploys Gateway to DWS infrastructure:
 * 1. Builds frontend and API
 * 2. Uploads static assets to IPFS/CDN
 * 3. Registers backend workers with DWS
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
import { keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

// Worker deployment schema
const DWSWorkerDeployResponseSchema = z.object({
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

function getConfig(): DeployConfig {
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

  // SECURITY NOTE: Deployment key is passed via environment for now.
  // This is acceptable for deployment scripts run by operators.
  // For production, consider using hardware wallets or KMS-based signing
  // for deployment transactions.
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required. ' +
        'This key is used only for deployment transactions.',
    )
  }

  // Validate key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid private key format. Must be 0x-prefixed 64 hex chars.')
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}`,
    cdnEnabled: process.env.CDN_ENABLED !== 'false',
  } as DeployConfig
}

async function ensureBuild(): Promise<void> {
  const requiredFiles = ['./dist/api/a2a-server.js', './dist/index.html']

  for (const file of requiredFiles) {
    if (!existsSync(resolve(APP_DIR, file))) {
      console.log('[Gateway] Build not found, running build first...')
      const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
        cwd: APP_DIR,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      await proc.exited
      return
    }
  }

  console.log('[Gateway] Build found')
}

interface UploadResult {
  cid: string
  hash: `0x${string}`
  size: number
}

/**
 * Verify content is retrievable from storage
 * This prevents LARP deployments where content was "uploaded" but isn't actually accessible
 */
async function verifyContentRetrievable(
  dwsUrl: string,
  cid: string,
  expectedSize: number,
): Promise<boolean> {
  const verifyUrl = `${dwsUrl}/storage/download/${cid}`

  const response = await fetch(verifyUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null)

  if (!response) {
    console.error(`   VERIFICATION FAILED: ${cid} - timeout or network error`)
    return false
  }

  if (!response.ok) {
    console.error(`   VERIFICATION FAILED: ${cid} - status ${response.status}`)
    return false
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) !== expectedSize) {
    console.error(
      `   VERIFICATION FAILED: ${cid} - size mismatch (expected ${expectedSize}, got ${contentLength})`,
    )
    return false
  }

  return true
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
    jpeg: 'image/jpeg',
    ico: 'image/x-icon',
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
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const formData = new FormData()
    formData.append('file', new Blob([content], { type: mimeType }), name)
    formData.append('name', name)

    const response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(90000), // 90 second timeout for large files
    }).catch((err: Error) => {
      lastError = err
      return null
    })

    if (response?.ok) {
      const rawJson: unknown = await response.json()
      const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
      if (!parsed.success) {
        throw new Error(`Invalid upload response: ${parsed.error.message}`)
      }

      // Verify the content is actually retrievable before claiming success
      const verified = await verifyContentRetrievable(
        dwsUrl,
        parsed.data.cid,
        content.length,
      )
      if (!verified) {
        throw new Error(
          `Upload verification failed for ${name} - content not retrievable from storage`,
        )
      }

      return {
        cid: parsed.data.cid,
        hash,
        size: content.length,
      }
    }

    const errorText = response
      ? await response.text()
      : (lastError?.message ?? 'Unknown error')
    console.log(`   Attempt ${attempt}/3 failed for ${name}: ${errorText}`)

    if (attempt < 3) {
      const delay = attempt * 2000 // 2s, 4s
      console.log(`   Retrying in ${delay / 1000}s...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } else {
      throw new Error(
        `Upload failed for ${name} after 3 attempts: ${errorText}`,
      )
    }
  }

  throw new Error(`Upload failed for ${name}: unexpected state`)
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

// Worker deployment function (kept for future backend deployment)
// Currently Gateway runs as a static frontend with optional backend proxy
async function _deployWorker(
  config: DeployConfig,
  apiBundle: UploadResult,
): Promise<string> {
  const account = privateKeyToAccount(config.privateKey)

  const deployRequest = {
    name: 'gateway-api',
    codeCid: apiBundle.cid,
    runtime: 'bun',
    handler: 'a2a-server.js:default',
    memory: 512,
    timeout: 30000,
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
  }

  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify(deployRequest),
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

  const cdnConfig = {
    name: 'gateway',
    domain: 'gateway.jejunetwork.org',
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: [
        '/api/*',
        '/a2a/*',
        '/mcp/*',
        '/rpc/*',
        '/x402/*',
        '/health',
        '/.well-known/*',
      ],
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

async function registerWithDWSAppRouter(
  config: DeployConfig,
  staticFiles: Map<string, UploadResult>,
): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  // Build staticFiles map: path -> CID
  const staticFilesMap: Record<string, string> = {}
  for (const [path, result] of staticFiles) {
    // Normalize paths - add leading slash if missing
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    staticFilesMap[normalizedPath] = result.cid
  }

  // Register with DWS app router for hostname-based routing
  const appRouterData = {
    name: 'gateway',
    jnsName: 'gateway.jeju',
    frontendCid: null, // Use null since we're using staticFiles
    staticFiles: staticFilesMap,
    backendWorkerId: null,
    backendEndpoint: null,
    apiPaths: ['/api', '/health', '/a2a', '/mcp', '/rpc', '/x402'],
    spa: true,
    enabled: true,
  }

  console.log('Registering with DWS app router...')
  console.log(`   staticFiles entries: ${Object.keys(staticFilesMap).length}`)

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
    const result = await response.json()
    console.log(`   Registered: ${result.app?.name || 'gateway'}`)
  }
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║         Gateway Decentralized Deployment to DWS            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  const account = privateKeyToAccount(config.privateKey)
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log(`Deployer: ${account.address}`)
  console.log('')

  await ensureBuild()

  // Upload static assets to IPFS via DWS
  console.log('\n[Step 1/4] Uploading static assets to IPFS...')
  const webAssets = await uploadDirectory(config.dwsUrl, './dist/web', 'web')

  // Upload root-level files
  const rootFiles = [
    'index.html',
    'favicon.svg',
    'agent-card.json',
    'rpc-config.json',
  ]
  for (const file of rootFiles) {
    if (existsSync(resolve(APP_DIR, `./dist/${file}`))) {
      const result = await uploadToIPFS(config.dwsUrl, `./dist/${file}`, file)
      webAssets.set(file, result)
      console.log(`   ${file} -> ${result.cid}`)
    }
  }
  console.log(`   Total: ${webAssets.size} files`)

  // Register with DWS app router (critical for hostname routing)
  console.log('\n[Step 2/4] Registering with DWS app router...')
  await registerWithDWSAppRouter(config, webAssets)

  // Setup CDN caching rules
  console.log('\n[Step 3/4] Configuring CDN...')
  await setupCDN(config, webAssets)

  // Verify deployment
  console.log('\n[Step 4/4] Verifying deployment...')
  const verifyResponse = await fetch(`${config.dwsUrl}/apps/deployed`)
  if (verifyResponse.ok) {
    const apps = await verifyResponse.json()
    const gatewayApp = apps.apps?.find(
      (a: { name: string }) => a.name === 'gateway',
    )
    if (gatewayApp) {
      console.log(`   App registered: ${gatewayApp.name}`)
      console.log(
        `   Frontend CID: ${gatewayApp.frontendCid || 'null (using staticFiles)'}`,
      )
      console.log(
        `   Static Files: ${gatewayApp.staticFiles ? Object.keys(gatewayApp.staticFiles).length : 0} files`,
      )
      console.log(`   Enabled: ${gatewayApp.enabled}`)
    }
  }

  const domain =
    config.network === 'testnet'
      ? 'gateway.testnet.jejunetwork.org'
      : 'gateway.jejunetwork.org'

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Decentralized Deployment Complete              ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend: https://${domain}`)
  console.log(`║  Static Files: ${webAssets.size} files uploaded to IPFS`)
  console.log(`║  Index CID: ${webAssets.get('index.html')?.cid ?? 'N/A'}`)
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log('║  DNS NOTE: Ensure DNS points to DWS ALB, not CloudFront    ║')
  console.log('║  DNS should resolve same as dws.testnet.jejunetwork.org    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
