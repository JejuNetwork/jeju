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
    await $`cd ${appDir} && ${buildCommand}`.quiet()
    console.log(`[${manifest.name}] ✅ Frontend built`)
    return true
  } catch (error) {
    console.error(`[${manifest.name}] ❌ Build failed:`, error)
    return false
  }
}

async function uploadToIPFS(appDir: string, manifest: AppManifest, dwsUrl: string): Promise<string | null> {
  const buildDir = manifest.decentralization?.frontend?.buildDir || 'dist'
  const distPath = join(appDir, buildDir)
  
  if (!existsSync(distPath)) {
    console.error(`[${manifest.name}] Build directory not found: ${distPath}`)
    return null
  }

  console.log(`[${manifest.name}] Uploading to IPFS...`)
  
  try {
    // Use DWS storage API to upload directory
    const formData = new FormData()
    
    // Recursively add files
    const { globSync } = await import('glob')
    const files = globSync('**/*', { cwd: distPath, nodir: true })
    
    for (const file of files) {
      const filePath = join(distPath, file)
      const fileContent = readFileSync(filePath)
      formData.append('files', new Blob([fileContent]), file)
    }

    const response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[${manifest.name}] Upload failed: ${response.status} ${text}`)
      return null
    }

    const result = await response.json() as { cid: string }
    console.log(`[${manifest.name}] ✅ Uploaded to IPFS: ${result.cid}`)
    return result.cid
  } catch (error) {
    console.error(`[${manifest.name}] Upload error:`, error)
    return null
  }
}

async function registerWithAppRouter(
  manifest: AppManifest,
  dwsUrl: string,
  frontendCid: string | null,
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
  let frontendCid: string | null = null

  if (hasFrontend) {
    const buildSuccess = await buildFrontend(appDir, manifest)
    if (!buildSuccess) {
      return { app: appName, success: false, error: 'Frontend build failed' }
    }

    // Step 2: Upload to IPFS
    frontendCid = await uploadToIPFS(appDir, manifest, dwsUrl)
    if (!frontendCid) {
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
  const registered = await registerWithAppRouter(manifest, dwsUrl, frontendCid, backendEndpoint)
  if (!registered) {
    return { app: appName, success: false, error: 'App router registration failed' }
  }

  return {
    app: appName,
    success: true,
    frontendCid: frontendCid || undefined,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const networkArg = args.find(a => a.startsWith('--network='))?.split('=')[1]
    || args[args.indexOf('--network') + 1]
    || process.env.NETWORK
    || 'testnet'

  const appArg = args.find(a => a.startsWith('--app='))?.split('=')[1]
    || args[args.indexOf('--app') + 1]

  process.env.NETWORK = networkArg
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
