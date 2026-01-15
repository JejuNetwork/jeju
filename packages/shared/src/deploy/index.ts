/**
 * Standardized DWS Deployment Utility
 *
 * Provides a consistent way to deploy apps to DWS with:
 * - Frontend file uploads with staticFiles mapping
 * - Backend worker uploads
 * - App registration with DWS
 * - Post-deployment verification
 *
 * Usage:
 *   import { deployApp, verifyDeployment } from '@jejunetwork/shared/deploy'
 *
 *   const result = await deployApp({
 *     name: 'my-app',
 *     frontendDir: 'dist/web',
 *     workerPath: 'dist/worker/worker.js',
 *     jnsName: 'my-app.jeju',
 *     apiPaths: ['/api/*', '/health'],
 *     spa: true,
 *   })
 *
 *   await verifyDeployment(result)
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'

// Response schemas
const UploadResponseSchema = z.object({
  cid: z.string().optional(),
  Hash: z.string().optional(),
})

const AppRegistrationResponseSchema = z.object({
  success: z.boolean(),
  app: z.object({
    name: z.string(),
    frontendCid: z.string().nullable(),
    staticFiles: z.record(z.string(), z.string()).nullable(),
    backendWorkerId: z.string().nullable(),
  }).optional(),
})

export interface DeployAppOptions {
  /** App name (used for registration) */
  name: string
  /** JNS name (e.g., 'my-app.jeju') */
  jnsName: string
  /** Path to frontend build directory */
  frontendDir: string
  /** Path to worker bundle (e.g., 'dist/worker/worker.js') */
  workerPath?: string
  /** API paths to route to backend (e.g., ['/api/*', '/health']) */
  apiPaths?: string[]
  /** Whether this is a single-page app (serves index.html for all non-API routes) */
  spa?: boolean
  /** DWS API URL (defaults to network-specific URL) */
  dwsUrl?: string
  /** Deployer address for authentication */
  deployerAddress?: string
  /** Skip source maps when uploading */
  skipSourceMaps?: boolean
  /** Timeout for uploads in ms (default: 60000) */
  uploadTimeout?: number
}

export interface DeployResult {
  name: string
  jnsName: string
  frontendCid: string
  staticFiles: Record<string, string>
  backendWorkerId?: string
  appUrl: string
  healthUrl: string
}

export interface VerificationResult {
  success: boolean
  checks: {
    frontend: { ok: boolean; error?: string }
    health: { ok: boolean; error?: string; response?: Record<string, unknown> }
  }
}

/**
 * Get DWS URL for the current network
 */
export function getDWSUrlForNetwork(network: string): string {
  switch (network) {
    case 'mainnet':
      return 'https://dws.jejunetwork.org'
    case 'testnet':
      return 'https://dws.testnet.jejunetwork.org'
    case 'localnet':
    default:
      return 'http://localhost:4030'
  }
}

/**
 * Upload a file to DWS storage and return its CID
 */
async function uploadFile(
  filePath: string,
  dwsUrl: string,
  timeout: number,
): Promise<string> {
  const formData = new FormData()
  const file = Bun.file(filePath)
  const fileName = filePath.split('/').pop() ?? 'file'
  formData.append('file', file, fileName)

  const response = await fetch(`${dwsUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Upload failed for ${fileName}: ${text}`)
  }

  const json = await response.json()
  const parsed = UploadResponseSchema.parse(json)
  const cid = parsed.cid ?? parsed.Hash

  if (!cid) {
    throw new Error(`No CID returned for ${fileName}`)
  }

  return cid
}

/**
 * Verify that a CID is retrievable from storage
 */
async function verifyCidRetrievable(
  cid: string,
  dwsUrl: string,
  timeout: number,
): Promise<boolean> {
  const response = await fetch(`${dwsUrl}/storage/download/${cid}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null)

  return response?.ok ?? false
}

/**
 * Upload all files in a directory and return staticFiles mapping
 */
async function uploadFrontendDirectory(
  dir: string,
  dwsUrl: string,
  options: { skipSourceMaps: boolean; timeout: number },
): Promise<{ indexCid: string; staticFiles: Record<string, string> }> {
  const staticFiles: Record<string, string> = {}
  let indexCid = ''

  async function processDirectory(currentDir: string): Promise<void> {
    const entries = readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await processDirectory(fullPath)
      } else {
        // Skip source maps if requested
        if (options.skipSourceMaps && entry.name.endsWith('.map')) {
          continue
        }

        const relPath = `/${relative(dir, fullPath)}`
        console.log(`  Uploading: ${relPath}`)

        const cid = await uploadFile(fullPath, dwsUrl, options.timeout)

        // Verify the upload
        const verified = await verifyCidRetrievable(cid, dwsUrl, 10000)
        if (!verified) {
          throw new Error(`Upload verification failed for ${relPath}`)
        }

        staticFiles[relPath] = cid

        // Track index.html separately
        if (entry.name === 'index.html') {
          indexCid = cid
        }

        console.log(`    CID: ${cid.slice(0, 16)}... (verified)`)
      }
    }
  }

  await processDirectory(dir)

  if (!indexCid) {
    throw new Error('No index.html found in frontend directory')
  }

  return { indexCid, staticFiles }
}

/**
 * Deploy an app to DWS
 */
export async function deployApp(options: DeployAppOptions): Promise<DeployResult> {
  const network = process.env.NETWORK ?? process.env.JEJU_NETWORK ?? 'testnet'
  const dwsUrl = options.dwsUrl ?? getDWSUrlForNetwork(network)
  const deployerAddress = options.deployerAddress ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const timeout = options.uploadTimeout ?? 60000

  console.log(`\nDeploying ${options.name} to DWS`)
  console.log(`  DWS URL: ${dwsUrl}`)
  console.log(`  Network: ${network}`)
  console.log('')

  // Validate frontend directory exists
  if (!existsSync(options.frontendDir)) {
    throw new Error(`Frontend directory not found: ${options.frontendDir}`)
  }

  // Upload frontend files
  console.log('Uploading frontend files...')
  const { indexCid, staticFiles } = await uploadFrontendDirectory(
    options.frontendDir,
    dwsUrl,
    {
      skipSourceMaps: options.skipSourceMaps ?? true,
      timeout,
    },
  )
  console.log(`  Frontend CID (index.html): ${indexCid}`)
  console.log(`  Total files: ${Object.keys(staticFiles).length}`)

  // Upload worker if provided
  let backendWorkerId: string | undefined
  if (options.workerPath) {
    if (!existsSync(options.workerPath)) {
      throw new Error(`Worker file not found: ${options.workerPath}`)
    }

    console.log('\nUploading worker...')
    backendWorkerId = await uploadFile(options.workerPath, dwsUrl, timeout)

    // Verify worker upload
    const verified = await verifyCidRetrievable(backendWorkerId, dwsUrl, 10000)
    if (!verified) {
      throw new Error('Worker upload verification failed')
    }

    console.log(`  Worker CID: ${backendWorkerId} (verified)`)
  }

  // Register app with DWS
  console.log('\nRegistering app with DWS...')
  const registrationPayload = {
    name: options.name,
    jnsName: options.jnsName,
    frontendCid: indexCid,
    staticFiles,
    backendWorkerId: backendWorkerId ?? null,
    backendEndpoint: null, // Always null for direct worker invocation
    apiPaths: options.apiPaths ?? ['/api/*', '/health'],
    spa: options.spa ?? true,
    enabled: true,
  }

  const regResponse = await fetch(`${dwsUrl}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': deployerAddress,
    },
    body: JSON.stringify(registrationPayload),
  })

  if (!regResponse.ok) {
    const text = await regResponse.text()
    throw new Error(`App registration failed: ${text}`)
  }

  const regJson = await regResponse.json()
  const regResult = AppRegistrationResponseSchema.parse(regJson)

  if (!regResult.success) {
    throw new Error('App registration returned success=false')
  }

  console.log('  App registered successfully')

  // Sync to propagate to all pods
  await fetch(`${dwsUrl}/apps/sync`, {
    method: 'POST',
    headers: { 'x-jeju-address': deployerAddress },
  }).catch(() => {})

  // Determine app URL based on network
  const domain = network === 'mainnet'
    ? 'jejunetwork.org'
    : network === 'testnet'
      ? 'testnet.jejunetwork.org'
      : 'localhost:4030'

  const appUrl = network === 'localnet'
    ? `http://${options.name}.${domain}`
    : `https://${options.name}.${domain}`

  const result: DeployResult = {
    name: options.name,
    jnsName: options.jnsName,
    frontendCid: indexCid,
    staticFiles,
    backendWorkerId,
    appUrl,
    healthUrl: `${appUrl}/health`,
  }

  console.log('\nDeployment complete:')
  console.log(`  App URL: ${result.appUrl}`)
  console.log(`  Health: ${result.healthUrl}`)

  return result
}

/**
 * Verify that a deployment is working correctly
 */
export async function verifyDeployment(
  result: DeployResult,
  options?: { timeout?: number; retries?: number },
): Promise<VerificationResult> {
  const timeout = options?.timeout ?? 15000
  const retries = options?.retries ?? 3

  console.log('\nVerifying deployment...')

  const checks: VerificationResult['checks'] = {
    frontend: { ok: false },
    health: { ok: false },
  }

  // Check frontend (should return HTML)
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(result.appUrl, {
        signal: AbortSignal.timeout(timeout),
      })

      if (!response.ok) {
        checks.frontend.error = `HTTP ${response.status}`
        continue
      }

      const text = await response.text()
      if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
        checks.frontend.ok = true
        console.log('  Frontend: OK (HTML served)')
        break
      } else {
        checks.frontend.error = 'Response is not HTML'
      }
    } catch (error) {
      checks.frontend.error = error instanceof Error ? error.message : 'Unknown error'
      if (attempt < retries) {
        console.log(`  Frontend: Retrying (${attempt}/${retries})...`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  if (!checks.frontend.ok) {
    console.log(`  Frontend: FAILED - ${checks.frontend.error}`)
  }

  // Check health endpoint (should return JSON with status ok/healthy)
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(result.healthUrl, {
        signal: AbortSignal.timeout(timeout),
      })

      if (!response.ok) {
        checks.health.error = `HTTP ${response.status}`
        continue
      }

      const json = await response.json()
      const status = json.status

      if (status === 'ok' || status === 'healthy') {
        checks.health.ok = true
        checks.health.response = json
        console.log(`  Health: OK (status=${status})`)
        break
      } else {
        checks.health.error = `Unexpected status: ${status}`
      }
    } catch (error) {
      checks.health.error = error instanceof Error ? error.message : 'Unknown error'
      if (attempt < retries) {
        console.log(`  Health: Retrying (${attempt}/${retries})...`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  if (!checks.health.ok) {
    console.log(`  Health: FAILED - ${checks.health.error}`)
  }

  const success = checks.frontend.ok && checks.health.ok

  if (!success) {
    throw new Error(
      `Deployment verification failed: frontend=${checks.frontend.ok}, health=${checks.health.ok}`,
    )
  }

  console.log('\nVerification passed!')

  return { success, checks }
}

/**
 * Deploy and verify an app in one call
 * Throws an error if verification fails
 */
export async function deployAndVerify(options: DeployAppOptions): Promise<DeployResult> {
  const result = await deployApp(options)
  await verifyDeployment(result)
  return result
}
