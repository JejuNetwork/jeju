/**
 * Factory DWS Deployment Script
 *
 * Deploys Factory to DWS:
 * 1. Builds static frontend and uploads to IPFS
 * 2. Packages backend worker and deploys to DWS workerd
 * 3. Updates on-chain registry with deployment info
 */

import { rmSync } from 'node:fs'
import { z } from 'zod'
import { expectValid } from '../src/schemas'

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const NETWORK = process.env.NETWORK || 'localnet'

// ============================================================================
// Response Schemas
// ============================================================================

const UploadResponseSchema = z.object({
  cid: z.string(),
})

const DeployResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
})

interface DeployResult {
  frontend: {
    cid: string
    url: string
  }
  backend: {
    workerId: string
    url: string
  }
}

async function main(): Promise<DeployResult> {
  console.log('🏭 Factory DWS Deployment')
  console.log(`📡 DWS URL: ${DWS_URL}`)
  console.log(`🌐 Network: ${NETWORK}`)
  console.log('')

  // Step 1: Build frontend
  console.log('📦 Building frontend...')
  const buildProc = Bun.spawn(['bun', 'scripts/build-client.ts'], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const buildExitCode = await buildProc.exited
  if (buildExitCode !== 0) {
    throw new Error('Frontend build failed')
  }
  console.log('✅ Frontend built')

  // Step 2: Upload frontend to IPFS via DWS
  console.log('📤 Uploading frontend to IPFS...')
  const frontendDir = 'dist/client'

  // Create tarball of frontend
  const tarPath = '/tmp/factory-frontend.tar.gz'
  const tarProc = Bun.spawn(['tar', '-czf', tarPath, '-C', frontendDir, '.'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await tarProc.exited

  // Upload to DWS storage
  const tarFile = Bun.file(tarPath)
  const tarContent = await tarFile.arrayBuffer()

  const uploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
      'X-File-Name': 'factory-frontend.tar.gz',
    },
    body: tarContent,
  })

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text()
    throw new Error(`Frontend upload failed: ${error}`)
  }

  const uploadJson: unknown = await uploadResponse.json()
  const uploadResult = expectValid(
    UploadResponseSchema,
    uploadJson,
    'upload response',
  )
  const frontendCid = uploadResult.cid
  console.log(`✅ Frontend uploaded: ${frontendCid}`)

  // Step 3: Package and deploy backend worker
  console.log('📦 Packaging backend worker...')

  // Build worker bundle
  const workerBuildResult = await Bun.build({
    entrypoints: ['./src/worker/index.ts'],
    outdir: 'dist/worker',
    target: 'bun',
    minify: true,
    sourcemap: 'linked',
  })

  if (!workerBuildResult.success) {
    console.error('Worker build failed:', workerBuildResult.logs)
    throw new Error('Worker build failed')
  }

  // Upload worker to DWS storage
  const workerFile = Bun.file('dist/worker/index.js')
  const workerContent = await workerFile.arrayBuffer()

  const workerUploadResponse = await fetch(`${DWS_URL}/storage/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/javascript',
      'X-File-Name': 'factory-worker.js',
    },
    body: workerContent,
  })

  if (!workerUploadResponse.ok) {
    const error = await workerUploadResponse.text()
    throw new Error(`Worker upload failed: ${error}`)
  }

  const workerUploadJson: unknown = await workerUploadResponse.json()
  const workerUploadResult = expectValid(
    UploadResponseSchema,
    workerUploadJson,
    'worker upload response',
  )
  const workerCid = workerUploadResult.cid
  console.log(`✅ Worker uploaded: ${workerCid}`)

  // Step 4: Deploy worker to DWS workerd
  console.log('🚀 Deploying worker to DWS workerd...')

  const manifest = await Bun.file('./src/worker/manifest.json').json()

  const deployResponse = await fetch(`${DWS_URL}/workerd/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      codeCid: workerCid,
      mainModule: 'index.js',
      bindings: manifest.bindings,
      limits: manifest.limits,
      routes: manifest.routes,
    }),
  })

  if (!deployResponse.ok) {
    const error = await deployResponse.text()
    throw new Error(`Worker deployment failed: ${error}`)
  }

  const deployJson: unknown = await deployResponse.json()
  const deployResult = expectValid(
    DeployResponseSchema,
    deployJson,
    'deploy response',
  )
  console.log(`✅ Worker deployed: ${deployResult.id}`)

  // Step 5: Return deployment info
  const result: DeployResult = {
    frontend: {
      cid: frontendCid,
      url: `${DWS_URL}/ipfs/${frontendCid}`,
    },
    backend: {
      workerId: deployResult.id,
      url: `${DWS_URL}/workerd/${deployResult.id}`,
    },
  }

  console.log('')
  console.log('🎉 Deployment complete!')
  console.log('')
  console.log('Frontend:')
  console.log(`  CID: ${result.frontend.cid}`)
  console.log(`  URL: ${result.frontend.url}`)
  console.log('')
  console.log('Backend:')
  console.log(`  Worker ID: ${result.backend.workerId}`)
  console.log(`  URL: ${result.backend.url}`)

  // Clean up
  rmSync(tarPath, { force: true })

  return result
}

main().catch((err) => {
  console.error('❌ Deployment failed:', err.message)
  process.exit(1)
})
