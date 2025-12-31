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

// Worker deployment schema (kept for future use)
const _DWSWorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  status: z.string().optional(),
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
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
    owner: account.address,
    codeCid: apiBundle.cid,
    codeHash: apiBundle.hash,
    entrypoint: 'a2a-server.js',
    runtime: 'bun',
    resources: {
      memoryMb: 512,
      cpuMillis: 2000,
      timeoutMs: 30000,
      maxConcurrency: 200,
    },
    scaling: {
      minInstances: 3,
      maxInstances: 50,
      targetConcurrency: 20,
      scaleToZero: false,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: true,
      teePreferred: true,
      minNodeReputation: 80,
    },
    routes: [
      { pattern: '/api/*', zone: 'gateway' },
      { pattern: '/a2a/*', zone: 'gateway' },
      { pattern: '/mcp/*', zone: 'gateway' },
      { pattern: '/rpc/*', zone: 'gateway' },
      { pattern: '/x402/*', zone: 'gateway' },
      { pattern: '/health', zone: 'gateway' },
      { pattern: '/.well-known/*', zone: 'gateway' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
    secrets: ['OPERATOR_KEY', 'BRIDGE_SIGNER_KEY'],
  }

  const response = await fetch(`${config.dwsUrl}/workers/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deployRequest),
  })

  if (!response.ok) {
    throw new Error(`Worker deployment failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = _DWSWorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid deploy response: ${parsed.error.message}`)
  }
  return parsed.data.workerId
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
  frontendCid: string,
): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  // Register with DWS app router for hostname-based routing
  const appRouterData = {
    name: 'gateway',
    jnsName: 'gateway.jeju',
    frontendCid,
    backendWorkerId: null,
    // For testnet, use a public endpoint or null if frontend-only
    backendEndpoint: null,
    apiPaths: ['/api', '/health', '/a2a', '/mcp', '/rpc', '/x402'],
    spa: true,
    enabled: true,
  }

  console.log('Registering with DWS app router...')

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
  const indexResult = await uploadToIPFS(
    config.dwsUrl,
    './dist/index.html',
    'index.html',
  )
  webAssets.set('index.html', indexResult)
  console.log(`   index.html -> ${indexResult.cid}`)
  console.log(`   Total: ${webAssets.size} files`)

  // For a pure frontend deployment, the index.html CID is the main CID
  const frontendCid = indexResult.cid
  console.log(`\n   Frontend CID: ${frontendCid}`)

  // Register with DWS app router (critical for hostname routing)
  console.log('\n[Step 2/4] Registering with DWS app router...')
  await registerWithDWSAppRouter(config, frontendCid)

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
      console.log(`   Frontend CID: ${gatewayApp.frontendCid}`)
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
  console.log(`║  IPFS:     ipfs://${frontendCid}`)
  console.log(`║  DWS:      ${config.dwsUrl}/storage/ipfs/${frontendCid}`)
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log('║  DNS NOTE: Ensure DNS points to DWS ALB, not CloudFront    ║')
  console.log('║  DNS should resolve same as dws.testnet.jejunetwork.org    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
