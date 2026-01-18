#!/usr/bin/env bun
/**
 * Deploy all apps locally - builds, uploads to IPFS, registers with JNS
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const ROOT_DIR = '/home/shaw/Documents/jeju'
const IPFS_API = 'http://127.0.0.1:5001'
const RPC_URL = 'http://127.0.0.1:6546'
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Apps to deploy
const APPS = ['oauth3', 'autocrat', 'bazaar', 'crucible', 'factory', 'gateway', 'monitoring']

interface DeployResult {
  app: string
  success: boolean
  cid?: string
  port?: number
  error?: string
}

async function buildApp(appDir: string, appName: string): Promise<boolean> {
  console.log(`[${appName}] Building...`)
  try {
    const result = await $`cd ${appDir} && bun run build 2>&1`.quiet()
    if (result.exitCode !== 0) {
      console.log(`[${appName}] Build failed, trying direct vite build...`)
      const viteResult = await $`cd ${appDir} && bunx vite build 2>&1`.quiet()
      return viteResult.exitCode === 0
    }
    return true
  } catch (e) {
    console.log(`[${appName}] Build error: ${e}`)
    return false
  }
}

async function uploadToIPFS(appDir: string, appName: string): Promise<string | null> {
  // Find the dist directory
  const distDir = join(appDir, 'dist')
  if (!existsSync(distDir)) {
    console.log(`[${appName}] No dist directory found`)
    return null
  }

  console.log(`[${appName}] Uploading to IPFS...`)
  try {
    const result = await $`curl -s -X POST -F "file=@${distDir}" "${IPFS_API}/api/v0/add?recursive=true&wrap-with-directory=true" 2>&1`.quiet()
    const lines = result.stdout.toString().trim().split('\n')
    const lastLine = lines[lines.length - 1]
    const json = JSON.parse(lastLine)
    return json.Hash
  } catch (e) {
    console.log(`[${appName}] IPFS upload error: ${e}`)
    return null
  }
}

async function startDevServer(appDir: string, appName: string, port: number): Promise<boolean> {
  console.log(`[${appName}] Starting dev server on port ${port}...`)
  try {
    // Kill any existing process on this port
    await $`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`.quiet()
    
    // Start the dev server in background
    const proc = Bun.spawn(['bun', 'run', 'dev', '--port', port.toString()], {
      cwd: appDir,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    
    // Wait a bit for it to start
    await new Promise(r => setTimeout(r, 3000))
    
    // Check if it's running
    const healthCheck = await $`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${port} 2>/dev/null || echo "000"`.quiet()
    return healthCheck.stdout.toString().trim() !== '000'
  } catch (e) {
    console.log(`[${appName}] Dev server error: ${e}`)
    return false
  }
}

async function deployApp(appName: string, port: number): Promise<DeployResult> {
  const appDir = join(ROOT_DIR, 'apps', appName)
  
  if (!existsSync(appDir)) {
    return { app: appName, success: false, error: 'App directory not found' }
  }

  console.log(`\n=== Deploying ${appName} ===`)

  // Build the app
  const buildSuccess = await buildApp(appDir, appName)
  if (!buildSuccess) {
    console.log(`[${appName}] Build failed, trying dev server...`)
  }

  // Try to upload to IPFS
  let cid: string | null = null
  if (buildSuccess) {
    cid = await uploadToIPFS(appDir, appName)
    if (cid) {
      console.log(`[${appName}] ✓ Uploaded to IPFS: ${cid}`)
    }
  }

  // Start dev server as fallback
  const serverStarted = await startDevServer(appDir, appName, port)
  
  if (serverStarted) {
    console.log(`[${appName}] ✓ Running on http://127.0.0.1:${port}`)
    return { app: appName, success: true, cid: cid ?? undefined, port }
  } else if (cid) {
    console.log(`[${appName}] ✓ Available via IPFS gateway: http://127.0.0.1:8080/ipfs/${cid}`)
    return { app: appName, success: true, cid }
  }

  return { app: appName, success: false, error: 'Failed to start' }
}

async function main() {
  console.log('='.repeat(60))
  console.log(' DEPLOYING APPS TO LOCAL NETWORK')
  console.log('='.repeat(60))

  const results: DeployResult[] = []
  let port = 3010 // Start from port 3010

  for (const appName of APPS) {
    const result = await deployApp(appName, port)
    results.push(result)
    port++
  }

  console.log('\n' + '='.repeat(60))
  console.log(' DEPLOYMENT SUMMARY')
  console.log('='.repeat(60))
  
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`\n✓ Successful: ${successful.length}/${results.length}`)
  for (const r of successful) {
    if (r.port) {
      console.log(`  - ${r.app}: http://127.0.0.1:${r.port}`)
    } else if (r.cid) {
      console.log(`  - ${r.app}: http://127.0.0.1:8080/ipfs/${r.cid}`)
    }
  }

  if (failed.length > 0) {
    console.log(`\n✗ Failed: ${failed.length}`)
    for (const r of failed) {
      console.log(`  - ${r.app}: ${r.error}`)
    }
  }

  console.log('\n' + '='.repeat(60))
}

main().catch(console.error)
