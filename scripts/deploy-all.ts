#!/usr/bin/env bun
/**
 * Deploy All Apps to DWS
 * 
 * This script builds and deploys all apps to the local DWS instance.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { $ } from 'bun'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const ROOT_DIR = resolve(import.meta.dir, '..')
const APPS_DIR = join(ROOT_DIR, 'apps')
const NETWORK = process.env.NETWORK || 'local'
const DWS_URL = process.env.DWS_URL || (NETWORK === 'testnet' 
  ? 'https://dws.testnet.jejunetwork.org'
  : 'http://127.0.0.1:4030')
const IPFS_API_URL = process.env.IPFS_API_URL || ''
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Host header for ALB routing
const DWS_HOST = NETWORK === 'testnet' ? 'dws.testnet.jejunetwork.org' : undefined

// Apps to deploy
const APPS = [
  'dws',
  'oauth3',
  'autocrat',
  'crucible',
  'gateway',
  'factory',
  'bazaar',
  'wallet',
  'node',
  'vpn',
  'monitoring',
  'otto',
  'example',
  'indexer',
]

// Skip apps that are desktop-only or have special requirements
const SKIP_APPS = ['documentation'] // vocs has issues

// Response schema
const StorageUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)

// Upload file with retry
async function uploadFile(content: Buffer, filename: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const formData = new FormData()
      formData.append('file', new Blob([content]), filename)
      formData.append('tier', 'popular')
      formData.append('category', 'app')

      const headers: Record<string, string> = {
        'x-jeju-address': account.address,
      }
      if (DWS_HOST) headers['Host'] = DWS_HOST

      const response = await fetch(`${DWS_URL}/storage/upload`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${await response.text()}`)
      }

      const result = StorageUploadResponseSchema.parse(await response.json())
      return result.cid
    } catch (err) {
      if (attempt === retries) throw err
      console.log(`      Retry ${attempt}/${retries}...`)
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error('Upload failed')
}

// Upload directory
async function uploadDirectory(dirPath: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  async function processDir(currentPath: string, prefix = ''): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await processDir(fullPath, relativePath)
      } else {
        const content = await readFile(fullPath)
        const cid = await uploadFile(Buffer.from(content), relativePath)
        files.set(relativePath, cid)
        console.log(`      ${relativePath} -> ${cid.slice(0, 12)}...`)
      }
    }
  }

  await processDir(dirPath)
  return files
}

// Register app with DWS
async function registerApp(
  name: string,
  files: Map<string, string>,
  apiRoutes: string[] = [],
): Promise<void> {
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  
  // Find index.html CID
  const indexCid = files.get('index.html') || files.values().next().value

  const appConfig = {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    staticCid: indexCid,
    apiPaths: apiRoutes,
    spa: true,
    staticFiles: Object.fromEntries(files),
    deployer: account.address,
  }

  const regHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (DWS_HOST) regHeaders['Host'] = DWS_HOST

  const response = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: regHeaders,
    body: JSON.stringify(appConfig),
  })

  if (!response.ok) {
    console.log(`      Warning: App registration returned ${response.status}`)
  }
}

// Build an app
async function buildApp(appName: string): Promise<boolean> {
  const appDir = join(APPS_DIR, appName)
  
  try {
    const result = await $`bun run build`.cwd(appDir).quiet()
    return result.exitCode === 0
  } catch {
    return false
  }
}

// Find dist directory
function findDistDir(appName: string): string | null {
  const appDir = join(APPS_DIR, appName)
  const candidates = ['dist', 'dist/web', 'build', 'out', '.next/static']
  
  for (const candidate of candidates) {
    const path = join(appDir, candidate)
    if (existsSync(path)) return path
  }
  
  return null
}

// Deploy a single app
async function deployApp(appName: string): Promise<boolean> {
  console.log(`\n  ${appName}:`)
  
  // Build
  console.log(`    Building...`)
  const buildOk = await buildApp(appName)
  if (!buildOk) {
    console.log(`    ❌ Build failed`)
    return false
  }
  console.log(`    ✓ Build complete`)

  // Find dist
  const distDir = findDistDir(appName)
  if (!distDir) {
    console.log(`    ⚠️  No dist directory found, skipping upload`)
    return true
  }

  // Upload
  console.log(`    Uploading...`)
  try {
    const files = await uploadDirectory(distDir)
    console.log(`    ✓ ${files.size} files uploaded`)

    // Register
    console.log(`    Registering...`)
    await registerApp(appName, files)
    console.log(`    ✓ Registered`)

    return true
  } catch (err) {
    console.log(`    ❌ Upload failed: ${(err as Error).message}`)
    return false
  }
}

// Main
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║         DEPLOYING ALL APPS TO DWS                          ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`DWS: ${DWS_URL}`)
  
  // Check DWS health
  try {
    const healthHeaders: Record<string, string> = {}
    if (DWS_HOST) healthHeaders['Host'] = DWS_HOST
    
    const health = await fetch(`${DWS_URL}/health`, { headers: healthHeaders })
    if (!health.ok) throw new Error('DWS not healthy')
    console.log('DWS: ✓ Online')
  } catch (err) {
    console.error(`❌ DWS is not running at ${DWS_URL}`)
    console.error(`   Error: ${(err as Error).message}`)
    if (NETWORK === 'local') {
      console.error('   Start it with: cd apps/dws && bun run dev:api')
    }
    process.exit(1)
  }

  const results: { app: string; success: boolean }[] = []

  for (const app of APPS) {
    if (SKIP_APPS.includes(app)) {
      console.log(`\n  ${app}: ⏭️  Skipped`)
      continue
    }
    
    const success = await deployApp(app)
    results.push({ app, success })
  }

  // Summary
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    DEPLOYMENT SUMMARY                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  
  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)
  
  console.log(`\n  ✅ Successful: ${successful.length}`)
  for (const r of successful) {
    console.log(`     - ${r.app}`)
  }
  
  if (failed.length > 0) {
    console.log(`\n  ❌ Failed: ${failed.length}`)
    for (const r of failed) {
      console.log(`     - ${r.app}`)
    }
  }
  
  console.log('')
  console.log(`View deployed apps: ${DWS_URL}/apps/deployed`)
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
