#!/usr/bin/env bun
/**
 * Otto Deployment Script
 *
 * Deploys Otto to DWS infrastructure.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getL2RpcUrl,
} from '@jejunetwork/config'
import { keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const APP_DIR = resolve(import.meta.dir, '..')

const IPFSUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

const DWSWorkerDeployResponseSchema = z.object({
  workerId: z.string(),
  status: z.string().optional(),
})

interface DeployConfig {
  network: 'localnet' | 'testnet' | 'mainnet'
  dwsUrl: string
  rpcUrl: string
  privateKey: `0x${string}`
}

function getConfig(): DeployConfig {
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY environment variable required',
    )
  }

  return {
    network,
    ...configs[network],
    privateKey: privateKey as `0x${string}`,
  } as DeployConfig
}

async function ensureBuild(): Promise<void> {
  if (!existsSync(resolve(APP_DIR, 'dist/server.js'))) {
    console.log('[Otto] Build not found, running build first...')
    const proc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await proc.exited
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

async function deployWorker(
  config: DeployConfig,
  serverBundle: UploadResult,
): Promise<string> {
  const account = privateKeyToAccount(config.privateKey)

  const deployRequest = {
    name: 'otto-bot',
    owner: account.address,
    codeCid: serverBundle.cid,
    codeHash: serverBundle.hash,
    entrypoint: 'server.js',
    runtime: 'bun',
    resources: {
      memoryMb: 512,
      cpuMillis: 2000,
      timeoutMs: 60000,
      maxConcurrency: 50,
    },
    scaling: {
      minInstances: 1,
      maxInstances: 10,
      targetConcurrency: 5,
      scaleToZero: false,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: false,
      teePreferred: true,
      minNodeReputation: 50,
    },
    routes: [
      { pattern: '/api/*', zone: 'otto' },
      { pattern: '/a2a/*', zone: 'otto' },
      { pattern: '/mcp/*', zone: 'otto' },
      { pattern: '/webhooks/*', zone: 'otto' },
      { pattern: '/health', zone: 'otto' },
    ],
    env: {
      NETWORK: config.network,
      RPC_URL: config.rpcUrl,
      DWS_URL: config.dwsUrl,
    },
    secrets: [
      'DISCORD_BOT_TOKEN',
      'TELEGRAM_BOT_TOKEN',
      'TWITTER_BEARER_TOKEN',
      'OPENAI_API_KEY',
    ],
  }

  const response = await fetch(`${config.dwsUrl}/workers/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deployRequest),
  })

  if (!response.ok) {
    throw new Error(`Worker deployment failed: ${await response.text()}`)
  }

  const rawJson: unknown = await response.json()
  const parsed = DWSWorkerDeployResponseSchema.safeParse(rawJson)
  if (!parsed.success) {
    throw new Error(`Invalid deploy response: ${parsed.error.message}`)
  }
  return parsed.data.workerId
}

async function deploy(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║               Otto Deployment to DWS                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const config = getConfig()
  console.log(`Network:  ${config.network}`)
  console.log(`DWS:      ${config.dwsUrl}`)
  console.log('')

  await ensureBuild()

  // Upload server bundle
  console.log('\nUploading server bundle...')
  const serverBundle = await uploadToIPFS(
    config.dwsUrl,
    './dist/server.js',
    'otto-server.js',
  )
  console.log(`   Server CID: ${serverBundle.cid}\n`)

  // Deploy worker
  console.log('Deploying worker to DWS...')
  const workerId = await deployWorker(config, serverBundle)
  console.log(`   Worker ID: ${workerId}\n`)

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  API:      https://otto.jejunetwork.org                     ║`)
  console.log(`║  Worker:   ${workerId.slice(0, 36)}...  ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
}

deploy().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
