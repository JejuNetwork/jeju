#!/usr/bin/env bun
/**
 * Example Deployment Script
 *
 * Deploys Example app to DWS infrastructure.
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
import { type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

// Schemas
const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
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
      jnsName: 'example.jeju',
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      jnsName: 'example.jeju',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      jnsName: 'example.jeju',
    },
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}`,
  } as DeployConfig
}

// Build Check
async function checkBuild(): Promise<void> {
  const requiredFiles = [
    join(APP_DIR, 'dist/index.html'),
    join(APP_DIR, 'dist/web/main.js'),
  ]

  for (const file of requiredFiles) {
    if (!existsSync(file)) {
      console.log('Build not found, running build first...')
      await $`bun run build`.cwd(APP_DIR)
      return
    }
  }
  console.log('✅ Build found')
}

// Upload directory to IPFS
interface UploadResult {
  cid: string
  size: number
  files: Map<string, string>
}

async function uploadDirectory(dwsUrl: string, dirPath: string): Promise<UploadResult> {
  const files = new Map<string, string>()
  let totalSize = 0

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await processDir(fullPath, relativePath)
      } else {
        const content = await readFile(fullPath)
        totalSize += content.length

        const formData = new FormData()
        formData.append('file', new Blob([content]), relativePath)
        formData.append('tier', 'popular')
        formData.append('category', 'app')

        const response = await fetch(`${dwsUrl}/storage/upload`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          throw new Error(`Failed to upload ${relativePath}: ${response.statusText}`)
        }

        const result = IPFSUploadResponseSchema.parse(await response.json())
        files.set(relativePath, result.cid)
        console.log(`   📄 ${relativePath} -> ${result.cid}`)
      }
    }
  }

  await processDir(dirPath)

  // Return results (directory CID is created from first file for simplicity)
  const firstCid = files.values().next().value
  return { cid: firstCid, size: totalSize, files }
}

// Configure CDN
async function setupCDN(config: DeployConfig, staticAssets: UploadResult): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  const timestamp = Date.now()
  const message = `cdn:example:${staticAssets.cid}:${timestamp}`
  const signature = await account.signMessage({ message })

  const response = await fetch(`${config.dwsUrl}/cdn/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: config.jnsName,
      contentCid: staticAssets.cid,
      spa: true,
      cacheRules: [
        { pattern: '*.js', maxAge: 31536000, immutable: true },
        { pattern: '*.css', maxAge: 31536000, immutable: true },
        { pattern: 'index.html', maxAge: 0, mustRevalidate: true },
      ],
      deployer: account.address,
      signature,
      timestamp,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.warn(`CDN configuration warning: ${error}`)
  }
}

// Main deploy function
async function deploy(): Promise<void> {
  console.log('🚀 Deploying Example to DWS...\n')

  const config = getConfig()
  console.log(`📡 Network: ${config.network}`)
  console.log(`🌐 DWS: ${config.dwsUrl}\n`)

  await checkBuild()

  console.log('\n📦 Uploading static assets...')
  const staticAssets = await uploadDirectory(config.dwsUrl, join(APP_DIR, 'dist'))
  console.log(`   Total: ${staticAssets.size} bytes`)
  console.log(`   Root CID: ${staticAssets.cid}\n`)

  console.log('🌐 Configuring CDN...')
  await setupCDN(config, staticAssets)

  console.log('\n✅ Deployment complete!')
  console.log('')
  console.log('Endpoints:')
  console.log(`  Frontend: https://${config.jnsName}`)
  console.log(`  IPFS:     ipfs://${staticAssets.cid}`)
}

deploy().catch((error) => {
  console.error('❌ Deployment failed:', error)
  process.exit(1)
})
