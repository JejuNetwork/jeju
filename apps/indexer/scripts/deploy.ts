#!/usr/bin/env bun
/**
 * Indexer Deployment Script
 *
 * Deploys Indexer to DWS infrastructure (decentralized):
 * 1. Builds frontend if needed
 * 2. Uploads static assets to DWS storage (IPFS)
 * 3. Registers app with DWS app router
 *
 * The indexer backend runs as a Kubernetes service (subsquid-api.indexer.svc.cluster.local)
 * which DWS proxies to for /api, /graphql, /health, etc.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Schema for DWS storage upload response
const StorageUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  backends: z.array(z.string()).optional(),
})

interface DeployConfig {
  network: NetworkType
  dwsUrl: string
  backendEndpoint: string
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<NetworkType, Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: 'http://127.0.0.1:4030',
      // Local development backend
      backendEndpoint: 'http://127.0.0.1:4352',
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      // Kubernetes service endpoint for indexer backend
      backendEndpoint: 'http://indexer-api.indexer.svc.cluster.local:4352',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      backendEndpoint: 'http://indexer-api.indexer.svc.cluster.local:4352',
    },
  }

  return {
    network,
    ...configs[network],
  } as DeployConfig
}

async function ensureBuild(): Promise<void> {
  const indexHtmlPath = resolve(APP_DIR, 'dist/index.html')
  if (!existsSync(indexHtmlPath)) {
    console.log('[Indexer] Build not found, running build first...')
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
  console.log('[Indexer] Build found')
}

interface UploadResult {
  files: Map<string, string>
  totalSize: number
  rootCid: string
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
  rootCid: string,
): Promise<void> {
  // Find index.html CID - this is the entry point
  const indexCid = staticFiles.get('index.html')
  if (!indexCid) {
    throw new Error('index.html not found in uploaded files')
  }

  // App registration data for DWS app router
  const appConfig = {
    name: 'indexer',
    jnsName: 'indexer.jeju',
    frontendCid: rootCid, // Using root CID for the whole directory
    backendWorkerId: null, // No DWS worker - using K8s backend
    backendEndpoint: config.backendEndpoint,
    apiPaths: ['/api', '/health', '/a2a', '/mcp', '/graphql'], // Include /graphql for the GraphQL API
    spa: true, // Single-page application
    enabled: true,
  }

  console.log('[Indexer] Registering app with DWS...')
  console.log(`   Frontend CID: ${rootCid}`)
  console.log(`   Backend: ${config.backendEndpoint}`)
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
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║             Indexer Deployment to DWS                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log(`Backend:  ${config.backendEndpoint}`)
  console.log('')

  // Ensure build exists
  await ensureBuild()

  // Upload static assets from dist directory
  console.log('\nUploading static assets...')
  const staticResult = await uploadDirectory(config.dwsUrl, join(APP_DIR, 'dist'))
  console.log(`   Total: ${(staticResult.totalSize / 1024).toFixed(1)} KB`)
  console.log(`   Files: ${staticResult.files.size}`)

  // Register app with DWS
  console.log('\nRegistering app with DWS...')
  await registerApp(config, staticResult.files, staticResult.rootCid)

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
  console.log(`║  API:      ${domain}/api`.padEnd(61) + '║')
  console.log(`║  GraphQL:  ${domain}/graphql`.padEnd(61) + '║')
  console.log(`║  IPFS:     ipfs://${staticResult.rootCid.slice(0, 20)}...`.padEnd(61) + '║')
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error: Error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
