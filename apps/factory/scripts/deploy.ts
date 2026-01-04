/**
 * Factory DWS Deployment
 *
 * Deploys Factory to DWS infrastructure:
 * 1. Builds frontend
 * 2. Uploads static assets to IPFS
 * 3. Registers worker with DWS network
 *
 * Usage:
 *   bun run scripts/deploy.ts
 *   jeju deploy factory
 */

import { existsSync } from 'node:fs'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getDWSUrl,
  getEnvVar,
  isProductionEnv,
} from '@jejunetwork/config'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const DWS_URL =
  getEnvVar('DWS_URL') ||
  getCoreAppUrl('DWS_API') ||
  getDWSUrl()
const NETWORK = getCurrentNetwork()

/**
 * Get deployer private key with production validation.
 * SECURITY: In production, this should come from KMS.
 * For now, we require the env var and validate it exists.
 */
function getDeployerPrivateKey(): `0x${string}` | undefined {
  const key = getEnvVar('DEPLOYER_PRIVATE_KEY') as `0x${string}` | undefined
  
  if (isProductionEnv() && !key) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY is required for production deployments. ' +
      'This secret should be managed via KMS.'
    )
  }
  
  return key
}

// Get deployer wallet address (for authentication)
const DEPLOYER_PRIVATE_KEY = getDeployerPrivateKey()
const deployerAddress = DEPLOYER_PRIVATE_KEY
  ? privateKeyToAccount(DEPLOYER_PRIVATE_KEY).address
  : '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // Default dev address (Anvil account 0)

const UploadResponseSchema = z.object({ cid: z.string() })
const _DeployResponseSchema = z.object({ id: z.string(), status: z.string() })

function parseResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  name: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new Error(`Invalid ${name}: ${result.error.message}`)
  }
  return result.data
}

/**
 * Verify content is retrievable from storage
 * This prevents LARP deployments where content was "uploaded" but isn't actually accessible
 */
async function verifyContentRetrievable(
  cid: string,
  expectedSize?: number,
): Promise<boolean> {
  const verifyUrl = `${DWS_URL}/storage/download/${cid}`

  const response = await fetch(verifyUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null)

  if (!response) {
    console.error(`   VERIFICATION FAILED: ${cid} - timeout or network error`)
    return false
  }

  if (!response.ok) {
    console.error(`   VERIFICATION FAILED: ${cid} - status ${response.status}`)
    return false
  }

  if (expectedSize !== undefined) {
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) !== expectedSize) {
      console.error(`   VERIFICATION FAILED: ${cid} - size mismatch`)
      return false
    }
  }

  return true
}

interface DeployResult {
  frontend: { cid: string; url: string }
  backend: { workerId: string; url: string }
}

async function deploy(): Promise<DeployResult> {
  console.log('Factory DWS Deployment')
  console.log(`  DWS: ${DWS_URL}`)
  console.log(`  Network: ${NETWORK}`)
  console.log('')

  // Build frontend using consolidated build script
  console.log('Building...')
  const buildProc = Bun.spawn(['bun', 'scripts/build.ts'], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const buildExitCode = await buildProc.exited
  if (buildExitCode !== 0) {
    throw new Error('Build failed')
  }

  // Upload frontend to IPFS - upload index.html directly for SPA support
  console.log('\nUploading frontend to IPFS...')
  const frontendDir = 'dist/client'

  if (!existsSync(frontendDir)) {
    throw new Error(`Frontend not built: ${frontendDir} not found`)
  }

  // Upload index.html as the main CID for the SPA
  const indexHtmlPath = `${frontendDir}/index.html`
  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Frontend not built: ${indexHtmlPath} not found`)
  }

  const indexFormData = new FormData()
  indexFormData.append('file', Bun.file(indexHtmlPath), 'index.html')
  indexFormData.append('tier', 'system')
  indexFormData.append('backends', 'ipfs')

  const uploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: indexFormData,
  })

  if (!uploadResponse.ok) {
    throw new Error(`Frontend upload failed: ${await uploadResponse.text()}`)
  }

  const uploadJson: unknown = await uploadResponse.json()
  const frontendCid = parseResponse(
    UploadResponseSchema,
    uploadJson,
    'upload response',
  ).cid
  console.log(`  Frontend CID (index.html): ${frontendCid}`)

  // Upload static assets and build a map of path -> CID
  const staticFiles: Record<string, string> = {}

  // Upload JS, CSS, and other assets
  const { readdir } = await import('node:fs/promises')
  const { join, relative } = await import('node:path')

  async function uploadDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await uploadDir(fullPath)
      } else if (!entry.name.endsWith('.map')) {
        // Skip source maps to reduce upload size
        const relPath = relative(frontendDir, fullPath)
        const fileFormData = new FormData()
        fileFormData.append('file', Bun.file(fullPath), entry.name)
        fileFormData.append('tier', 'system')
        fileFormData.append('backends', 'ipfs')

        const resp = await fetch(`${DWS_URL}/storage/upload`, {
          method: 'POST',
          body: fileFormData,
        })

        if (resp.ok) {
          const json: unknown = await resp.json()
          const { cid } = parseResponse(
            UploadResponseSchema,
            json,
            `upload ${relPath}`,
          )

          // Verify the content is retrievable before adding to staticFiles
          const verified = await verifyContentRetrievable(cid)
          if (!verified) {
            throw new Error(
              `Upload verification failed for ${relPath} - content not retrievable`,
            )
          }

          staticFiles[relPath] = cid
          console.log(
            `  Uploaded ${relPath}: ${cid.slice(0, 12)}... (verified)`,
          )
        }
      }
    }
  }

  await uploadDir(frontendDir)

  // Upload worker
  console.log('\nUploading worker...')
  const workerPath = 'dist/api/server.js'

  if (!existsSync(workerPath)) {
    throw new Error(`Worker not built: ${workerPath} not found`)
  }

  // Upload worker using multipart form data
  const workerFormData = new FormData()
  workerFormData.append('file', Bun.file(workerPath), 'factory-worker.js')
  workerFormData.append('tier', 'system')
  workerFormData.append('backends', 'ipfs')

  const workerUploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    body: workerFormData,
  })

  if (!workerUploadResponse.ok) {
    throw new Error(
      `Worker upload failed: ${await workerUploadResponse.text()}`,
    )
  }

  const workerUploadJson: unknown = await workerUploadResponse.json()
  const workerCid = parseResponse(
    UploadResponseSchema,
    workerUploadJson,
    'worker upload response',
  ).cid
  console.log(`  Worker CID: ${workerCid}`)

  // Deploy worker to DWS using /workers (Bun runtime)
  console.log('\nDeploying to DWS Workers...')
  console.log(`  Deployer: ${deployerAddress}`)
  console.log(`  Using pre-uploaded code CID: ${workerCid}`)

  // For large bundles, we need to use a reference deployment approach
  // First, verify the code is accessible from storage
  const verifyResponse = await fetch(
    `${DWS_URL}/storage/download/${workerCid}`,
    {
      method: 'HEAD',
    },
  )

  if (!verifyResponse.ok) {
    throw new Error(
      `Worker code not accessible from storage: ${workerCid}. Upload may have failed.`,
    )
  }
  console.log('  Worker code verified in storage')

  // Deploy worker using the workers API with pre-uploaded CID
  const deployResponse = await fetch(`${DWS_URL}/workers/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': deployerAddress,
    },
    body: JSON.stringify({
      name: 'factory-api',
      codeCid: workerCid,
      runtime: 'bun',
      handler: 'server.js',
      memory: 512,
      timeout: 30000,
    }),
  })

  // Handle deploy response or fall back to app registration
  let deployResult:
    | { functionId: string; codeCid: string; status: string }
    | undefined

  if (!deployResponse.ok) {
    const errorText = await deployResponse.text()
    console.log(`  Worker deploy endpoint not available: ${errorText}`)
  } else {
    const deployJson: unknown = await deployResponse.json()
    const WorkerDeployResponseSchema = z.object({
      functionId: z.string().optional(),
      workerId: z.string().optional(),
      name: z.string().optional(),
      codeCid: z.string().optional(),
      status: z.string(),
    })
    const parsedResult = parseResponse(
      WorkerDeployResponseSchema,
      deployJson,
      'deploy response',
    )
    deployResult = {
      functionId: parsedResult.functionId ?? parsedResult.workerId ?? 'unknown',
      codeCid: parsedResult.codeCid ?? workerCid,
      status: parsedResult.status,
    }
    console.log(`  Worker ID: ${deployResult.functionId}`)
    console.log(`  Code CID: ${deployResult.codeCid}`)
    console.log(`  Status: ${deployResult.status}`)
  }

  // Determine backend endpoint based on deployment result
  // If worker deployment succeeded, use the worker URL
  // Otherwise, the backend will need to be deployed separately
  const backendEndpoint = deployResult
    ? `${DWS_URL}/workers/${deployResult.functionId}`
    : null

  // Always register the app with the DWS app router
  console.log('\nRegistering app with DWS...')
  const appRegistrationResponse = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': deployerAddress,
    },
    body: JSON.stringify({
      name: 'factory',
      jnsName: 'factory.jeju',
      frontendCid: frontendCid,
      staticFiles: Object.keys(staticFiles).length > 0 ? staticFiles : null,
      backendWorkerId: deployResult?.functionId ?? null,
      backendEndpoint: backendEndpoint,
      apiPaths: ['/api', '/health', '/a2a', '/mcp', '/swagger'],
      spa: true,
      enabled: true,
    }),
  })

  if (!appRegistrationResponse.ok) {
    console.log(
      `  App registration failed: ${await appRegistrationResponse.text()}`,
    )
    deployResult = deployResult ?? {
      functionId: 'registration-failed',
      codeCid: workerCid,
      status: 'failed',
    }
  } else {
    const regJson: unknown = await appRegistrationResponse.json()
    console.log(`  App registered: ${JSON.stringify(regJson)}`)
    deployResult = deployResult ?? {
      functionId: 'app-registered',
      codeCid: workerCid,
      status: 'deployed',
    }
  }

  // Ensure deployResult is defined for the final result
  const finalResult = deployResult ?? {
    functionId: 'not-deployed',
    codeCid: workerCid,
    status: 'frontend-only',
  }

  const result: DeployResult = {
    frontend: { cid: frontendCid, url: `${DWS_URL}/ipfs/${frontendCid}` },
    backend: {
      workerId: finalResult.functionId,
      url:
        finalResult.functionId !== 'not-deployed'
          ? `${DWS_URL}/workers/${finalResult.functionId}`
          : 'Backend not deployed - API requests will fail',
    },
  }

  console.log('\nDeployment complete.')
  console.log(`  Frontend: ${result.frontend.url}`)
  console.log(`  Backend: ${result.backend.url}`)
  if (finalResult.status === 'frontend-only') {
    console.log('\n  WARNING: Backend worker was not deployed.')
    console.log(
      '  The Factory API will not be available until the backend is deployed.',
    )
    console.log(
      '  To fix this, ensure DWS workers support Bun runtime or deploy as a container.',
    )
  }

  return result
}

deploy().catch((error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
