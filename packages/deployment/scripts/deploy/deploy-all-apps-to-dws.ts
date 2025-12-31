#!/usr/bin/env bun
/**
 * Deploy All Apps to DWS
 *
 * This script deploys all Jeju apps to the DWS provider network:
 * 1. Builds frontends
 * 2. Uploads to IPFS
 * 3. Registers with DWS app router
 * 4. Optionally deploys backend workers
 *
 * Usage:
 *   bun run packages/deployment/scripts/deploy/deploy-all-apps-to-dws.ts --network testnet
 *   bun run packages/deployment/scripts/deploy/deploy-all-apps-to-dws.ts --network testnet --app oauth3
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { getCurrentNetwork, getDWSUrl } from '@jejunetwork/config'

interface AppManifest {
  name: string
  displayName?: string
  version: string
  type?: string
  jns?: {
    name: string
  }
  decentralization?: {
    frontend?: {
      buildDir: string
      buildCommand?: string
      spa: boolean
      jnsName?: string
      ipfs?: boolean
    }
    worker?: {
      name: string
      entrypoint: string
      runtime: string
      routes?: Array<{ pattern: string }>
    }
  }
  dws?: {
    backend?: {
      enabled: boolean
      runtime: string
      entrypoint: string
    }
  }
}

interface DeploymentResult {
  app: string
  success: boolean
  frontendCid?: string
  backendWorkerId?: string
  error?: string
}

// Apps to deploy (in priority order)
const APPS_TO_DEPLOY = [
  'oauth3',      // P0 - Auth gateway
  'autocrat',    // P1 - Governance
  'bazaar',      // P1 - Marketplace
  'crucible',    // P1 - Agent runtime
  'factory',     // P2 - App factory
  'gateway',     // P2 - API gateway
  'monitoring',  // P2 - Monitoring
  'documentation', // P3 - Docs
]

async function loadManifest(appDir: string): Promise<AppManifest | null> {
  const manifestPath = join(appDir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'))
}

async function buildFrontend(appDir: string, manifest: AppManifest): Promise<boolean> {
  const buildCommand = manifest.decentralization?.frontend?.buildCommand || 'bun run build'
  
  console.log(`[${manifest.name}] Building frontend...`)
  try {
    const proc = Bun.spawn(['sh', '-c', buildCommand], {
      cwd: appDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Build failed with exit code ${exitCode}: ${stderr}`)
    }
    console.log(`[${manifest.name}] ✅ Frontend built`)
    return true
  } catch (error) {
    console.error(`[${manifest.name}] ❌ Build failed:`, error)
    return false
  }
}

interface UploadResult {
  manifestCid: string
  staticFiles: Record<string, string>
}

async function uploadToIPFS(appDir: string, manifest: AppManifest, dwsUrl: string): Promise<UploadResult | null> {
  const buildDir = manifest.decentralization?.frontend?.buildDir || 'dist'
  const distPath = join(appDir, buildDir)
  
  if (!existsSync(distPath)) {
    console.error(`[${manifest.name}] Build directory not found: ${distPath}`)
    return null
  }

  console.log(`[${manifest.name}] Uploading to IPFS...`)
  
  try {
    // Recursively find all files
    const { globSync } = await import('glob')
    const files = globSync('**/*', { cwd: distPath, nodir: true })
    
    const uploadedFiles: { path: string; cid: string; size: number }[] = []
    const staticFiles: Record<string, string> = {}
    
    // Upload each file individually (DWS storage expects single 'file' field)
    for (const file of files) {
      const filePath = join(distPath, file)
      const fileContent = readFileSync(filePath)
      
      const formData = new FormData()
      formData.append('file', new Blob([fileContent]), file)
      formData.append('tier', 'popular')
      formData.append('category', 'app')

      const response = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json() as { cid: string }
        uploadedFiles.push({ path: file, cid: result.cid, size: fileContent.length })
        staticFiles[file] = result.cid
      } else {
        console.warn(`[${manifest.name}] Failed to upload ${file}: ${response.status}`)
      }
    }

    if (uploadedFiles.length === 0) {
      console.error(`[${manifest.name}] No files uploaded`)
      return null
    }

    // Create a manifest with all file CIDs
    const manifestData = {
      app: manifest.name,
      version: manifest.version,
      files: uploadedFiles,
      uploadedAt: Date.now(),
    }

    // Upload manifest and use its CID as the root
    const manifestFormData = new FormData()
    manifestFormData.append('file', new Blob([JSON.stringify(manifestData, null, 2)]), 'manifest.json')
    manifestFormData.append('tier', 'popular')
    manifestFormData.append('category', 'app')

    const manifestResponse = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: manifestFormData,
    })

    if (!manifestResponse.ok) {
      console.error(`[${manifest.name}] Failed to upload manifest`)
      return null
    }

    const manifestResult = await manifestResponse.json() as { cid: string }
    console.log(`[${manifest.name}] ✅ Uploaded ${uploadedFiles.length} files to IPFS: ${manifestResult.cid}`)
    return { manifestCid: manifestResult.cid, staticFiles }
  } catch (error) {
    console.error(`[${manifest.name}] Upload error:`, error)
    return null
  }
}

async function registerWithAppRouter(
  manifest: AppManifest,
  dwsUrl: string,
  frontendCid: string | null,
  staticFiles: Record<string, string> | null,
  backendEndpoint: string | null,
): Promise<boolean> {
  const jnsName = manifest.jns?.name || manifest.decentralization?.frontend?.jnsName || `${manifest.name}.jeju`
  
  // Determine API paths from manifest
  const apiPaths = manifest.decentralization?.worker?.routes?.map(r => r.pattern.replace('/*', '')) ||
    ['/api', '/health', '/a2a', '/mcp']

  const registrationData = {
    name: manifest.name,
    jnsName,
    frontendCid,
    staticFiles,
    backendWorkerId: null,
    backendEndpoint,
    apiPaths,
    spa: manifest.decentralization?.frontend?.spa ?? true,
    enabled: true,
  }

  console.log(`[${manifest.name}] Registering with DWS app router...`)
  
  try {
    const response = await fetch(`${dwsUrl}/apps/deployed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registrationData),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[${manifest.name}] Registration failed: ${response.status} ${text}`)
      return false
    }

    const result = await response.json()
    console.log(`[${manifest.name}] ✅ Registered with app router`)
    return true
  } catch (error) {
    console.error(`[${manifest.name}] Registration error:`, error)
    return false
  }
}

async function deployApp(appName: string, network: string): Promise<DeploymentResult> {
  const appsDir = join(process.cwd(), 'apps')
  const appDir = join(appsDir, appName)
  
  if (!existsSync(appDir)) {
    return { app: appName, success: false, error: `App directory not found: ${appDir}` }
  }

  const manifest = await loadManifest(appDir)
  if (!manifest) {
    return { app: appName, success: false, error: 'jeju-manifest.json not found' }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Deploying ${manifest.displayName || manifest.name} to DWS`)
  console.log(`${'='.repeat(60)}`)

  const dwsUrl = getDWSUrl(network)

  // Step 1: Build frontend
  const hasFrontend = manifest.decentralization?.frontend || existsSync(join(appDir, 'index.html'))
  let uploadResult: UploadResult | null = null

  if (hasFrontend) {
    const buildSuccess = await buildFrontend(appDir, manifest)
    if (!buildSuccess) {
      return { app: appName, success: false, error: 'Frontend build failed' }
    }

    // Step 2: Upload to IPFS
    uploadResult = await uploadToIPFS(appDir, manifest, dwsUrl)
    if (!uploadResult) {
      console.log(`[${manifest.name}] ⚠️ IPFS upload failed, will use backend-only routing`)
    }
  }

  // Step 3: Determine backend endpoint
  // For now, route to the existing K8s service if it exists
  // In the future, deploy as DWS worker
  let backendEndpoint: string | null = null
  if (manifest.dws?.backend?.enabled) {
    // Check if there's a K8s service for this app
    backendEndpoint = `http://${appName}.${appName}.svc.cluster.local:${manifest.ports?.main || 4000}`
    console.log(`[${manifest.name}] Backend endpoint: ${backendEndpoint}`)
  }

  // Step 4: Register with app router
  const registered = await registerWithAppRouter(
    manifest,
    dwsUrl,
    uploadResult?.manifestCid ?? null,
    uploadResult?.staticFiles ?? null,
    backendEndpoint,
  )
  if (!registered) {
    return { app: appName, success: false, error: 'App router registration failed' }
  }

  return {
    app: appName,
    success: true,
    frontendCid: uploadResult?.manifestCid,
  }
}

async function main() {
  const args = process.argv.slice(2)
  
  // Parse --network arg
  let networkArg = 'testnet'
  const networkIdx = args.indexOf('--network')
  if (networkIdx !== -1 && args[networkIdx + 1] && !args[networkIdx + 1].startsWith('--')) {
    networkArg = args[networkIdx + 1]
  } else {
    const networkEq = args.find(a => a.startsWith('--network='))
    if (networkEq) networkArg = networkEq.split('=')[1]
  }
  networkArg = networkArg || process.env.JEJU_NETWORK || 'testnet'
  
  // Parse --app or --apps arg
  let appArg: string | undefined
  const appIdx = args.indexOf('--app')
  const appsIdx = args.indexOf('--apps')
  const idx = appIdx !== -1 ? appIdx : appsIdx
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    appArg = args[idx + 1]
  } else {
    const appEq = args.find(a => a.startsWith('--app=') || a.startsWith('--apps='))
    if (appEq) appArg = appEq.split('=')[1]
  }

  process.env.JEJU_NETWORK = networkArg
  const network = getCurrentNetwork()
  
  console.log(`\n${'#'.repeat(60)}`)
  console.log(`# Deploying Apps to DWS - Network: ${network}`)
  console.log(`${'#'.repeat(60)}\n`)

  const dwsUrl = getDWSUrl(network)
  console.log(`DWS URL: ${dwsUrl}`)

  // Verify DWS is accessible
  try {
    const healthResponse = await fetch(`${dwsUrl}/health`)
    if (!healthResponse.ok) {
      console.error('ERROR: DWS is not healthy')
      process.exit(1)
    }
    console.log('✅ DWS is healthy\n')
  } catch (error) {
    console.error('ERROR: Cannot connect to DWS:', error)
    process.exit(1)
  }

  // Deploy apps
  const appsToDeoploy = appArg ? [appArg] : APPS_TO_DEPLOY
  const results: DeploymentResult[] = []

  for (const app of appsToDeoploy) {
    const result = await deployApp(app, network)
    results.push(result)
  }

  // Summary
  console.log(`\n${'#'.repeat(60)}`)
  console.log('# Deployment Summary')
  console.log(`${'#'.repeat(60)}\n`)

  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`✅ Successful: ${successful.length}`)
  for (const result of successful) {
    console.log(`   - ${result.app}${result.frontendCid ? ` (CID: ${result.frontendCid.slice(0, 20)}...)` : ''}`)
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`)
    for (const result of failed) {
      console.log(`   - ${result.app}: ${result.error}`)
    }
  }

  // Print deployed apps list
  console.log('\n📋 View deployed apps:')
  console.log(`   curl ${dwsUrl}/apps/deployed | jq`)

  // Exit with error if any failed
  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch(console.error)
