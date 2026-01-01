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
import { privateKeyToAccount } from 'viem/accounts'
import { type Address, type Hex, hashMessage } from 'viem'

// Get deployer account from environment
function getDeployerAccount() {
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
  if (privateKey) {
    return privateKeyToAccount(privateKey as `0x${string}`)
  }
  return null
}

// Get deployer address from environment
function getDeployerAddress(): Address {
  const account = getDeployerAccount()
  if (account) {
    return account.address
  }
  // Fallback to zero address for read-only operations
  return '0x0000000000000000000000000000000000000000' as Address
}

// Create authenticated headers for DWS requests
async function createAuthHeaders(): Promise<Record<string, string>> {
  const account = getDeployerAccount()
  if (!account) {
    return {
      'Content-Type': 'application/json',
      'x-jeju-address': '0x0000000000000000000000000000000000000000',
    }
  }
  
  // Create a timestamped message for signature
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomUUID()
  const message = `DWS Deploy Request\nTimestamp: ${timestamp}\nNonce: ${nonce}`
  
  // Sign the message
  const signature = await account.signMessage({ message })
  
  return {
    'Content-Type': 'application/json',
    'x-jeju-address': account.address,
    'x-jeju-timestamp': timestamp.toString(),
    'x-jeju-nonce': nonce,
    'x-jeju-signature': signature,
  }
}

interface AppManifest {
  name: string
  displayName?: string
  version: string
  type?: string
  ports?: {
    main?: number
    frontend?: number
    api?: number
  }
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
      teeRequired?: boolean
    }
  }
}

interface DeploymentResult {
  app: string
  success: boolean
  frontendCid?: string
  backendWorkerId?: string
  backendEndpoint?: string
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

// Retry helper with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<Response> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000) // 60s timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      // Retry on server errors (502, 503, 504)
      if (response.status >= 502 && response.status <= 504 && attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // Only retry on network errors, not aborts
      if (attempt < maxRetries - 1 && lastError.name !== 'AbortError') {
        const delay = baseDelayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError ?? new Error('All retry attempts failed')
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
    
    // Upload each file individually with retry
    for (const file of files) {
      const filePath = join(distPath, file)
      const fileContent = readFileSync(filePath)
      
      const formData = new FormData()
      formData.append('file', new Blob([fileContent]), file)
      formData.append('tier', 'popular')
      formData.append('category', 'app')

      try {
        const response = await fetchWithRetry(`${dwsUrl}/storage/upload`, {
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
      } catch (error) {
        console.warn(`[${manifest.name}] Failed to upload ${file}: ${error instanceof Error ? error.message : String(error)}`)
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

    // Upload manifest with retry
    const manifestFormData = new FormData()
    manifestFormData.append('file', new Blob([JSON.stringify(manifestData, null, 2)]), 'manifest.json')
    manifestFormData.append('tier', 'popular')
    manifestFormData.append('category', 'app')

    const manifestResponse = await fetchWithRetry(`${dwsUrl}/storage/upload`, {
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

interface WorkerDeployResult {
  workerId: string
  endpoint: string
}

/**
 * Deploy backend as DWS worker (decentralized compute)
 * 
 * This is the CORRECT way to deploy backends - via DWS compute registry.
 * Workers run on node operators who have registered with the compute marketplace.
 * 
 * Flow:
 * 1. Bundle the worker code
 * 2. Upload bundle to IPFS
 * 3. Register worker with DWS compute registry
 * 4. Return the endpoint where worker is accessible
 */
async function deployDWSWorker(
  manifest: AppManifest,
  dwsUrl: string
): Promise<WorkerDeployResult | null> {
  const workerConfig = manifest.dws?.backend
  if (!workerConfig?.enabled) return null

  const appDir = join(process.cwd(), 'apps', manifest.name)
  const entrypoint = workerConfig.entrypoint || 'api/server.ts'
  const runtime = workerConfig.runtime || 'bun'

  try {
    // Step 1: Bundle the worker
    console.log(`   Building worker bundle from ${entrypoint}...`)
    const bundleDir = join(appDir, '.dws-bundle')
    const bundlePath = join(bundleDir, 'worker.js')
    
    // Use Bun to bundle
    const bundleProc = Bun.spawn([
      'bun', 'build', 
      join(appDir, entrypoint),
      '--outfile', bundlePath,
      '--target', runtime === 'workerd' ? 'browser' : 'bun',
      '--minify',
    ], {
      cwd: appDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    
    const bundleExit = await bundleProc.exited
    if (bundleExit !== 0) {
      const stderr = await new Response(bundleProc.stderr).text()
      console.error(`   Bundle failed: ${stderr}`)
      return null
    }

    // Step 2: Upload bundle to IPFS with retry
    console.log(`   Uploading worker bundle to IPFS...`)
    const bundleContent = readFileSync(bundlePath)
    const formData = new FormData()
    formData.append('file', new Blob([bundleContent]), 'worker.js')
    formData.append('tier', 'compute')
    formData.append('category', 'worker')

    let uploadResponse: Response
    try {
      uploadResponse = await fetchWithRetry(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        body: formData,
      })
    } catch (error) {
      console.error(`   Failed to upload worker: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }

    if (!uploadResponse.ok) {
      console.error(`   Failed to upload worker: ${uploadResponse.status}`)
      return null
    }

    const uploadResult = await uploadResponse.json() as { cid: string }
    const bundleCid = uploadResult.cid
    console.log(`   Worker bundle CID: ${bundleCid}`)

    // Step 3: Register with DWS workerd service
    // Uses the actual /workerd API endpoint as defined in apps/dws/api/server/routes/workerd.ts
    console.log(`   Registering worker with DWS workerd...`)
    
    // Read the bundle to get the code
    const bundleCode = readFileSync(bundlePath)
    const base64Code = bundleCode.toString('base64')
    
    const workerData = {
      name: `${manifest.name}-worker`,
      code: base64Code, // Base64 encoded worker code
      codeCid: bundleCid, // Also provide CID for reference
      memoryMb: 256,
      timeoutMs: 30000,
      cpuTimeMs: 5000,
      compatibilityDate: '2024-01-01',
      bindings: [
        { name: 'APP_NAME', type: 'text' as const, value: manifest.name },
        { name: 'APP_VERSION', type: 'text' as const, value: manifest.version },
      ],
    }

    // Create authenticated headers
    const authHeaders = await createAuthHeaders()
    
    let registerResponse: Response
    try {
      registerResponse = await fetchWithRetry(`${dwsUrl}/workerd`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(workerData),
      })
    } catch (error) {
      console.error(`   Failed to register worker (network error): ${error instanceof Error ? error.message : String(error)}`)
      return null
    }

    if (!registerResponse.ok) {
      const text = await registerResponse.text()
      // Check if it's a WAF block (HTML response)
      if (text.includes('403 Forbidden') || text.includes('<html>')) {
        console.error(`   Worker registration blocked by WAF - run 'terraform apply' in packages/deployment/terraform/`)
        console.error(`   Or deploy to localnet first: NETWORK=localnet bun run deploy`)
      } else {
        console.error(`   Failed to register worker: ${registerResponse.status} ${text}`)
      }
      return null
    }

    const registerResult = await registerResponse.json() as { 
      workerId: string
      name: string
      codeCid: string
      status: string
    }

    // Construct the worker endpoint URL
    const endpoint = `${dwsUrl}/workerd/${registerResult.workerId}/http`

    return {
      workerId: registerResult.workerId,
      endpoint,
    }
  } catch (error) {
    console.error(`   Worker deployment error: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function registerWithAppRouter(
  manifest: AppManifest,
  dwsUrl: string,
  frontendCid: string | null,
  staticFiles: Record<string, string> | null,
  backendEndpoint: string | null,
  backendWorkerId: string | null = null,
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
    backendWorkerId, // Now properly tracks the DWS worker ID
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

  // Step 3: Deploy backend as DWS worker (NOT K8s)
  // This is the correct decentralized approach - workers run on DWS compute nodes
  let backendEndpoint: string | null = null
  let backendWorkerId: string | null = null
  
  if (manifest.dws?.backend?.enabled) {
    console.log(`[${manifest.name}] Deploying backend as DWS worker...`)
    
    const workerResult = await deployDWSWorker(manifest, dwsUrl)
    if (workerResult) {
      backendWorkerId = workerResult.workerId
      backendEndpoint = workerResult.endpoint
      console.log(`[${manifest.name}] ✅ Backend deployed as DWS worker: ${backendWorkerId}`)
    } else {
      console.log(`[${manifest.name}] ⚠️ Backend worker deployment failed, will use frontend-only mode`)
    }
  }

  // Step 4: Register with app router
  const registered = await registerWithAppRouter(
    manifest,
    dwsUrl,
    uploadResult?.manifestCid ?? null,
    uploadResult?.staticFiles ?? null,
    backendEndpoint,
    backendWorkerId,
  )
  if (!registered) {
    return { app: appName, success: false, error: 'App router registration failed' }
  }

  return {
    app: appName,
    success: true,
    frontendCid: uploadResult?.manifestCid,
    backendWorkerId: backendWorkerId ?? undefined,
    backendEndpoint: backendEndpoint ?? undefined,
  }
}

async function main() {
  const args = process.argv.slice(2)
  
  // Parse --network arg (command line takes precedence, then env vars, then default)
  let networkArg: string | undefined
  const networkIdx = args.indexOf('--network')
  if (networkIdx !== -1 && args[networkIdx + 1] && !args[networkIdx + 1].startsWith('--')) {
    networkArg = args[networkIdx + 1]
  } else {
    const networkEq = args.find(a => a.startsWith('--network='))
    if (networkEq) networkArg = networkEq.split('=')[1]
  }
  // Check env vars if no command line arg
  networkArg = networkArg || process.env.NETWORK || process.env.JEJU_NETWORK || 'testnet'
  
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
    const parts = [result.app]
    if (result.frontendCid) parts.push(`Frontend: ${result.frontendCid.slice(0, 16)}...`)
    if (result.backendWorkerId) parts.push(`Worker: ${result.backendWorkerId.slice(0, 16)}...`)
    console.log(`   - ${parts.join(' | ')}`)
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
