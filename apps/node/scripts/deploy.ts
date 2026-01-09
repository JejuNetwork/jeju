#!/usr/bin/env bun
/**
 * Node Deployment Script
 *
 * Deploys Node static frontend to DWS infrastructure.
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
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
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

  return {
    network,
    ...configs[network],
    cdnEnabled: process.env.CDN_ENABLED !== 'false',
  } as DeployConfig
}

async function ensureBuild(): Promise<void> {
  if (!existsSync(resolve(APP_DIR, 'dist/static/index.html'))) {
    console.log('[Node] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.exited
  }
  console.log('[Node] Build found')
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
  maxRetries = 3,
): Promise<UploadResult> {
  const content = await readFile(resolve(APP_DIR, filePath))
  const hash = keccak256(content) as `0x${string}`

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const formData = new FormData()
    formData.append('file', new Blob([content]), name)
    formData.append('name', name)

    const response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (response.ok) {
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

    lastError = new Error(`Upload failed: ${await response.text()}`)
    if (attempt < maxRetries) {
      console.log(`   Retry ${attempt}/${maxRetries} for ${name}...`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }

  throw lastError ?? new Error('Upload failed after retries')
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

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function registerApp(
  config: DeployConfig,
  name: string,
  displayName: string,
  staticAssets: Map<string, UploadResult>,
): Promise<void> {
  const indexCid = staticAssets.get('index.html')?.cid
  if (!indexCid) {
    console.warn(`   No index.html found for ${name}, skipping registration`)
    return
  }

  const staticFiles: Record<string, string> = {}
  for (const [path, result] of staticAssets) {
    staticFiles[path] = result.cid
  }

  const appConfig = {
    name,
    displayName,
    jnsName: `${name}.jeju`,
    frontendCid: indexCid,
    staticFiles,
    backendWorkerId: null,
    backendEndpoint: null,
    apiPaths: ['/api/', '/health'],
    spa: true,
    enabled: true,
  }

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appConfig),
  })

  if (!response.ok) {
    console.warn(`   App registration warning: ${await response.text()}`)
  } else {
    console.log(`   ${name} registered with DWS gateway`)
  }
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
    name: 'node',
    domain: 'node.jejunetwork.org',
    spa: {
      enabled: true,
      fallback: '/index.html',
      routes: [],
    },
    assets,
    cacheRules: [
      { pattern: '/chunks/**', ttl: 31536000, immutable: true },
      { pattern: '/assets/**', ttl: 31536000, immutable: true },
      { pattern: '/*.js', ttl: 86400 },
      { pattern: '/*.css', ttl: 86400 },
      { pattern: '/index.html', ttl: 60, staleWhileRevalidate: 3600 },
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

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Node Deployment to DWS                         ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  await ensureBuild()

  // Upload static assets (frontend app)
  console.log('\nUploading static assets...')
  const staticAssets = await uploadDirectory(config.dwsUrl, './dist/static')
  console.log(`   Total: ${staticAssets.size} files\n`)

  // Upload lander assets
  console.log('Uploading lander assets...')
  const landerAssets = await uploadDirectory(config.dwsUrl, './dist/lander')
  console.log(`   Total: ${landerAssets.size} files\n`)

  // Merge assets for CDN configuration
  const allAssets = new Map([...staticAssets, ...landerAssets])

  // Setup CDN
  console.log('Configuring CDN...')
  await setupCDN(config, allAssets)

  // Register app with DWS gateway (use lander for main domain)
  console.log('\nRegistering apps with DWS...')
  await registerApp(config, 'node', 'Network Node', landerAssets)

  const appIndexCid = staticAssets.get('index.html')?.cid
  const landerIndexCid = landerAssets.get('index.html')?.cid
  const domain = config.network === 'mainnet' ? '' : 'testnet.'
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  Lander:   https://node.${domain}jejunetwork.org             ║`,
  )
  console.log(
    `║  App:      https://app.node.${domain}jejunetwork.org         ║`,
  )
  console.log(
    `║  Lander:   ipfs://${landerIndexCid?.slice(0, 20)}...                  ║`,
  )
  console.log(
    `║  App:      ipfs://${appIndexCid?.slice(0, 20)}...                  ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
