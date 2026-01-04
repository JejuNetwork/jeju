#!/usr/bin/env bun
/**
 * Otto Deployment Script
 *
 * Deploys Otto to DWS infrastructure using Jeju Network's decentralized deployment.
 * Uses KMS for signing in production (no raw private keys).
 *
 * Usage:
 *   bun run deploy            # Deploy to current network
 *   bun run deploy --preview  # Deploy to preview environment
 *   bun run deploy --prod     # Deploy to production
 *
 * Via Jeju CLI:
 *   jeju deploy otto          # Recommended way
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { createKMSSigner, validateSecureSigning } from '@jejunetwork/kms'
import { keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  functionId: z.string(),
  version: z.number().optional(),
  status: z.string().optional(),
})

const DWSFrontendDeployResponseSchema = z.object({
  cid: z.string(),
  jnsName: z.string().optional(),
  url: z.string().optional(),
})

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
}

function getDeployConfig(): DeployConfig {
  const network = getCurrentNetwork()

  const configs: Record<DeployConfig['network'], Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: getCoreAppUrl('DWS_API'),
      rpcUrl: getL2RpcUrl(),
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
    },
  }

  return {
    network,
    ...configs[network],
  } as DeployConfig
}

async function getSignerAddress(): Promise<`0x${string}`> {
  // In production, use KMS signer
  if (isProductionEnv()) {
    validateSecureSigning()
    const signer = createKMSSigner({ serviceId: 'otto-deploy' })
    await signer.initialize()
    return signer.getAddress()
  }

  // In development, allow private key from env
  const privateKey =
    process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  return account.address
}

async function ensureBuild(): Promise<void> {
  if (
    !existsSync(resolve(APP_DIR, 'dist/server.js')) ||
    !existsSync(resolve(APP_DIR, 'dist/web/index.html'))
  ) {
    console.log('[Otto] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error('Build failed')
    }
  }
  console.log('[Otto] Build found')
}

interface UploadResult {
  cid: string
  hash: `0x${string}`
  size: number
}

async function uploadToIPFS(
  dwsUrl: string,
  filePath: string,
  name: string,
): Promise<UploadResult> {
  const content = await readFile(resolve(APP_DIR, filePath))
  const hash = keccak256(content) as `0x${string}`

  const formData = new FormData()
  formData.append('file', new Blob([content]), name)
  formData.append('name', name)

  const response = await fetch(`${dwsUrl}/storage/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid upload response: ${parsed.error.message}`)
  }

  return {
    cid: parsed.data.cid,
    hash,
    size: content.length,
  }
}

async function uploadFrontend(
  config: DeployConfig,
  signerAddress: `0x${string}`,
): Promise<string> {
  const frontendDir = resolve(APP_DIR, 'dist/web')

  // Upload entire frontend directory
  const formData = new FormData()

  // Collect all files from dist/web
  const collectFiles = async (dir: string, prefix = ''): Promise<void> => {
    const entries = await Bun.file(dir).exists()
      ? []
      : Array.from(new Bun.Glob('**/*').scanSync({ cwd: dir }))

    for (const entry of entries) {
      const filePath = resolve(dir, entry)
      const file = Bun.file(filePath)
      if (await file.exists()) {
        const content = await file.arrayBuffer()
        formData.append(
          'files',
          new Blob([content]),
          prefix + entry,
        )
      }
    }
  }

  // Simple directory upload
  const files = Array.from(new Bun.Glob('**/*').scanSync({ cwd: frontendDir }))
  for (const entry of files) {
    const filePath = resolve(frontendDir, entry)
    const stat = await Bun.file(filePath).exists()
    if (stat) {
      const content = await Bun.file(filePath).arrayBuffer()
      formData.append('files', new Blob([content]), entry)
    }
  }

  formData.append('name', 'otto-frontend')
  formData.append('spa', 'true')

  const response = await fetch(`${config.dwsUrl}/storage/upload-directory`, {
    method: 'POST',
    headers: {
      'x-jeju-address': signerAddress,
    },
    body: formData,
  })

  if (!response.ok) {
    // Fallback to single file upload
    console.log('[Otto] Directory upload not available, using single file...')
    const indexHtml = await readFile(resolve(frontendDir, 'index.html'))
    const singleFormData = new FormData()
    singleFormData.append('file', new Blob([indexHtml]), 'index.html')
    singleFormData.append('name', 'otto-frontend')

    const singleResponse = await fetch(`${config.dwsUrl}/storage/upload`, {
      method: 'POST',
      body: singleFormData,
    })

    if (!singleResponse.ok) {
      throw new Error(`Frontend upload failed: ${await singleResponse.text()}`)
    }

    const rawJson: unknown = await singleResponse.json()
    const parsed = IPFSUploadResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new Error(`Invalid upload response: ${parsed.error.message}`)
    }
    return parsed.data.cid
  }

  const rawJson: unknown = await response.json()
  const parsed = DWSFrontendDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid frontend deploy response: ${parsed.error.message}`)
  }

  return parsed.data.cid
}

async function deployWorker(
  config: DeployConfig,
  serverBundle: UploadResult,
  signerAddress: `0x${string}`,
): Promise<string> {
  const response = await fetch(`${config.dwsUrl}/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': signerAddress,
    },
    body: JSON.stringify({
      name: 'otto-api',
      codeCid: serverBundle.cid,
      runtime: 'bun',
      handler: 'worker.js:default',
      memory: 512,
      timeout: 60000,
      env: {
        NETWORK: config.network,
        RPC_URL: config.rpcUrl,
        DWS_URL: config.dwsUrl,
      },
      routes: [
        { pattern: '/api/*' },
        { pattern: '/a2a/*' },
        { pattern: '/mcp/*' },
        { pattern: '/webhooks/*' },
        { pattern: '/health' },
        { pattern: '/status' },
      ],
      tee: {
        preferred: true,
        platforms: ['dstack', 'phala'],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Worker deployment failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = DWSWorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid deploy response: ${parsed.error.message}`)
  }
  return parsed.data.functionId
}

async function registerJNS(
  config: DeployConfig,
  frontendCid: string,
  workerId: string,
  signerAddress: `0x${string}`,
): Promise<void> {
  const response = await fetch(`${config.dwsUrl}/jns/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': signerAddress,
    },
    body: JSON.stringify({
      name: 'otto.jeju',
      contentHash: frontendCid,
      workerId,
      metadata: {
        app: 'otto',
        version: '1.0.0',
        description: 'Multi-Platform AI Trading Agent',
      },
    }),
  })

  if (!response.ok) {
    console.warn(`[Otto] JNS registration failed: ${await response.text()}`)
    // Non-fatal - JNS might not be available in all environments
  } else {
    console.log('[Otto] JNS registered: otto.jeju')
  }
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║               Otto Deployment to DWS                       ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getDeployConfig()
  const signerAddress = await getSignerAddress()

  console.log(`Network:    ${config.network}`)
  console.log(`DWS:        ${config.dwsUrl}`)
  console.log(`Deployer:   ${signerAddress}`)
  console.log('')

  await ensureBuild()

  // Upload frontend to IPFS
  console.log('\n[1/4] Uploading frontend to IPFS...')
  const frontendCid = await uploadFrontend(config, signerAddress)
  console.log(`   Frontend CID: ${frontendCid}`)

  // Upload server bundle
  console.log('\n[2/4] Uploading server bundle...')
  const serverBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/server.js',
    'otto-server.js',
  )
  console.log(`   Server CID: ${serverBundle.cid}`)

  // Deploy worker
  console.log('\n[3/4] Deploying worker to DWS...')
  const workerId = await deployWorker(config, serverBundle, signerAddress)
  console.log(`   Worker ID: ${workerId}`)

  // Register JNS
  console.log('\n[4/4] Registering JNS name...')
  await registerJNS(config, frontendCid, workerId, signerAddress)

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                       ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Frontend:   ipfs://${frontendCid.slice(0, 30)}...     ║`)
  console.log(`║  API:        https://otto.jejunetwork.org               ║`)
  console.log(`║  Worker:     ${workerId.slice(0, 36)}...  ║`)
  console.log(`║  JNS:        otto.jeju                                  ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Deployment successful.')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
