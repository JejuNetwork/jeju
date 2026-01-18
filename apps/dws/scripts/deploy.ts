#!/usr/bin/env bun
/**
 * DWS Deployment Script
 *
 * Deploys DWS to DWS infrastructure (self-hosting):
 * 1. Builds frontend and API
 * 2. Uploads static assets to storage
 * 3. Registers app deployment
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  getCurrentNetwork,
  getL1RpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { $ } from 'bun'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const DWS_DIR = resolve(import.meta.dir, '..')

// Schemas for API responses
const StorageUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  backends: z.array(z.string()).optional(),
})

// Configuration
interface DeployConfig {
  network: NetworkType
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
  jnsName: string
}

function getConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<NetworkType, Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: `http://127.0.0.1:4030`,
      rpcUrl: getL1RpcUrl(),
      jnsName: 'dws.jeju',
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      jnsName: 'dws.jeju',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      jnsName: 'dws.jeju',
    },
  }

  // SECURITY NOTE: This is a deployment script that runs on the developer's machine.
  // For production deployments, prefer using KMS via 'jeju deploy' CLI command.
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  const kmsKeyId = process.env.DEPLOYER_KMS_KEY_ID

  if (!privateKey && !kmsKeyId) {
    throw new Error(
      'DEPLOYER_KMS_KEY_ID (recommended) or DEPLOYER_PRIVATE_KEY/PRIVATE_KEY required. ' +
        'KMS is recommended for production deployments.',
    )
  }

  if (privateKey && network === 'mainnet') {
    console.warn(
      '[Deploy] WARNING: Using direct DEPLOYER_PRIVATE_KEY for mainnet deployment. ' +
        'Consider using DEPLOYER_KMS_KEY_ID for enhanced security.',
    )
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}` | undefined,
    kmsKeyId,
  } as DeployConfig
}

// Build Check
async function checkBuild(): Promise<void> {
  const requiredFiles = [
    join(DWS_DIR, 'dist/web/index.html'),
    join(DWS_DIR, 'dist/index.js'),
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      console.log('Build not found, running build first...')
      await $`bun run build`.cwd(DWS_DIR)
      return
    }
  }

  console.log('✅ Build found')
}

// Upload file using multipart form with retry
async function uploadFile(
  dwsUrl: string,
  content: Buffer,
  filename: string,
  retries = 8,
): Promise<{ cid: string; size: number }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const formData = new FormData()
      formData.append('file', new Blob([content]), filename)
      formData.append('tier', 'popular')
      formData.append('category', 'app')
      formData.append('backends', 'ipfs')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 180_000)
      const response = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to upload ${filename}: ${error}`)
      }

      const result = StorageUploadResponseSchema.parse(await response.json())
      return { cid: result.cid, size: content.length }
    } catch (err) {
      if (attempt === retries) throw err
      console.log(`   ⚠️  Retry ${attempt}/${retries} for ${filename}...`)
      await new Promise((r) => setTimeout(r, 4000 * attempt))
    }
  }
  throw new Error(`Failed to upload ${filename} after ${retries} attempts`)
}

// Upload directory recursively
interface UploadResult {
  files: Map<string, string>
  totalSize: number
}

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  exclude: string[] = [],
): Promise<UploadResult> {
  const files = new Map<string, string>()
  let totalSize = 0

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      // Skip excluded files
      if (exclude.some((e) => relativePath.includes(e))) continue

      if (entry.isDirectory()) {
        await processDir(fullPath, relativePath)
      } else {
        const content = await readFile(fullPath)
        totalSize += content.length

        const uploadName = relativePath.replaceAll('/', '_')
        const result = await uploadFile(
          dwsUrl,
          Buffer.from(content),
          uploadName,
        )
        files.set(relativePath, result.cid)
        console.log(`   📄 ${relativePath} -> ${result.cid.slice(0, 16)}...`)
      }
    }
  }

  await processDir(dirPath)
  return { files, totalSize }
}

// Register app deployment
async function registerApp(
  config: DeployConfig,
  staticFiles: Map<string, string>,
  apiCid: string,
): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  // Find index.html CID
  const indexCid = staticFiles.get('index.html')
  if (!indexCid) {
    throw new Error('index.html not found in uploaded files')
  }

  const appConfig = {
    name: 'dws',
    displayName: 'Decentralized Web Services',
    staticCid: indexCid,
    apiCid,
    apiPaths: [
      '/api/',
      '/health',
      '/storage',
      '/storage/*',
      '/compute',
      '/compute/*',
      '/cdn',
      '/cdn/*',
      '/git',
      '/git/*',
      '/pkg',
      '/pkg/*',
      '/ci',
      '/ci/*',
      '/oauth3',
      '/oauth3/*',
      '/containers',
      '/containers/*',
      '/a2a',
      '/a2a/*',
      '/mcp',
      '/mcp/*',
      '/funding',
      '/funding/*',
      '/registry',
      '/registry/*',
      '/workerd',
      '/workerd/*',
      '/workers',
      '/workers/*',
      '/sqlit',
      '/sqlit/*',
      '/nodes',
      '/nodes/*',
      '/kms',
      '/kms/*',
      '/auth',
      '/auth/*',
      '/account',
      '/account/*',
      '/secrets',
      '/secrets/*',
      '/logs',
      '/logs/*',
      '/previews',
      '/previews/*',
      '/vault',
      '/vault/*',
      '/apps',
      '/apps/*',
      '/faucet',
      '/faucet/*',
      '/triggers',
      '/triggers/*',
      '/gateway',
      '/gateway/*',
      '/cache',
      '/cache/*',
      '/inference',
      '/inference/*',
    ],
    spa: true,
    staticFiles: Object.fromEntries(staticFiles),
    deployer: account.address,
  }

  const response = await fetch(`${config.dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appConfig),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`App registration warning: ${error}`)
  } else {
    console.log('✅ App registered')
  }
}

// Main deploy function
async function deploy(): Promise<void> {
  console.log('🚀 Deploying DWS to DWS...\n')

  const config = getConfig()
  console.log(`📡 Network: ${config.network}`)
  console.log(`🌐 DWS: ${config.dwsUrl}\n`)

  // Check/run build
  await checkBuild()

  // Upload static assets (from dist/ which includes index.html and web/ subfolder)
  // Exclude the API bundle (index.js) since we handle it separately
  console.log('\n📦 Uploading static assets...')
  const staticResult = await uploadDirectory(
    config.dwsUrl,
    join(DWS_DIR, 'dist'),
    ['index.js', '.map', 'dev/'],
  )
  console.log(`   Total: ${(staticResult.totalSize / 1024).toFixed(1)} KB`)
  console.log(`   Files: ${staticResult.files.size}\n`)

  // Upload API bundle separately
  console.log('📦 Uploading API bundle...')
  const apiContent = await readFile(join(DWS_DIR, 'dist/index.js'))
  const apiResult = await uploadFile(
    config.dwsUrl,
    Buffer.from(apiContent),
    'dws-api.js',
  )
  console.log(`   API CID: ${apiResult.cid.slice(0, 16)}...\n`)

  // Register app
  console.log('📝 Registering app...')
  await registerApp(config, staticResult.files, apiResult.cid)

  // Summary
  console.log('\n✅ Deployment complete!')
  console.log('')
  console.log('Endpoints:')
  console.log(`  Frontend: ${config.dwsUrl}`)
  console.log(`  API:      ${config.dwsUrl}/api`)
}

deploy().catch((error) => {
  console.error('❌ Deployment failed:', error.message)
  process.exit(1)
})
