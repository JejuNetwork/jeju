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

import { existsSync, rmSync } from 'node:fs'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getDWSUrl,
} from '@jejunetwork/config'
import { z } from 'zod'

const DWS_URL =
  (typeof process !== 'undefined' ? process.env.DWS_URL : undefined) ||
  getCoreAppUrl('DWS_API') ||
  getDWSUrl()
const NETWORK = getCurrentNetwork()

const UploadResponseSchema = z.object({ cid: z.string() })
const DeployResponseSchema = z.object({ id: z.string(), status: z.string() })

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

  // Upload frontend to IPFS
  console.log('\nUploading frontend to IPFS...')
  const frontendDir = 'dist/client'

  if (!existsSync(frontendDir)) {
    throw new Error(`Frontend not built: ${frontendDir} not found`)
  }

  const tarPath = '/tmp/factory-frontend.tar.gz'
  const tarProc = Bun.spawn(['tar', '-czf', tarPath, '-C', frontendDir, '.'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await tarProc.exited

  const tarContent = await Bun.file(tarPath).arrayBuffer()

  const uploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
      'X-File-Name': 'factory-frontend.tar.gz',
    },
    body: tarContent,
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
  console.log(`  Frontend CID: ${frontendCid}`)

  // Upload worker
  console.log('\nUploading worker...')
  const workerPath = 'dist/api/server.js'

  if (!existsSync(workerPath)) {
    throw new Error(`Worker not built: ${workerPath} not found`)
  }

  const workerContent = await Bun.file(workerPath).arrayBuffer()

  const workerUploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/javascript',
      'X-File-Name': 'factory-worker.js',
    },
    body: workerContent,
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

  // Deploy worker to DWS
  console.log('\nDeploying to DWS...')

  const deployRequest = {
    name: 'factory-api',
    version: '1.0.0',
    codeCid: workerCid,
    mainModule: 'server.js',
    routes: ['/api/*', '/health', '/.well-known/*', '/swagger', '/a2a', '/mcp'],
  }

  const deployResponse = await fetch(`${DWS_URL}/workerd/workers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deployRequest),
  })

  if (!deployResponse.ok) {
    throw new Error(`Worker deployment failed: ${await deployResponse.text()}`)
  }

  const deployJson: unknown = await deployResponse.json()
  const deployResult = parseResponse(
    DeployResponseSchema,
    deployJson,
    'deploy response',
  )
  console.log(`  Worker ID: ${deployResult.id}`)

  // Cleanup
  rmSync(tarPath, { force: true })

  const result: DeployResult = {
    frontend: { cid: frontendCid, url: `${DWS_URL}/ipfs/${frontendCid}` },
    backend: {
      workerId: deployResult.id,
      url: `${DWS_URL}/workerd/${deployResult.id}`,
    },
  }

  console.log('\nDeployment complete.')
  console.log(`  Frontend: ${result.frontend.url}`)
  console.log(`  Backend: ${result.backend.url}`)

  return result
}

deploy().catch((error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
