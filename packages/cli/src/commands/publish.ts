/**
 * Jeju Publish Command - Quick deploy to DWS
 *
 * Like `vercel` or `wrangler publish`, deploys the current project
 * with smart defaults based on jeju-manifest.json
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Command } from 'commander'
import type { Address } from 'viem'
import { keccak256, stringToBytes } from 'viem'
import { logger } from '../lib/logger'
import type { AppManifest, NetworkType } from '../types'
import { requireLogin } from './login'

interface PublishResult {
  frontendUrl?: string
  frontendCid?: string
  workerUrl?: string
  workerId?: string
  jnsName?: string
  previewUrl?: string
}

/**
 * Get DWS URL for network
 */
export function getDWSUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return (
        process.env.MAINNET_DWS_URL ??
        getDWSUrl() ??
        'https://dws.jejunetwork.org'
      )
    case 'testnet':
      return (
        process.env.TESTNET_DWS_URL ??
        getDWSUrl() ??
        'https://dws.testnet.jejunetwork.org'
      )
    default:
      return (
        process.env.DWS_URL ??
        getDWSUrl() ??
        `http://${getLocalhostHost()}:4030`
      )
  }
}

/**
 * Get domain suffix for network
 */
function getDomainSuffix(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return 'jejunetwork.org'
    case 'testnet':
      return 'testnet.jejunetwork.org'
    default:
      return 'local.jejunetwork.org'
  }
}

/**
 * Load manifest from directory
 */
function loadManifest(dir: string): AppManifest {
  const manifestPath = join(dir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      'No jeju-manifest.json found. Run `jeju init` to create one.',
    )
  }

  return JSON.parse(readFileSync(manifestPath, 'utf-8'))
}

/**
 * Build the project
 */
async function buildProject(dir: string, manifest: AppManifest): Promise<void> {
  const buildCmd = manifest.commands?.build ?? 'bun run build'
  logger.step(`Building: ${buildCmd}`)

  const proc = spawnSync('sh', ['-c', buildCmd], {
    cwd: dir,
    stdio: 'inherit',
  })

  if (proc.status !== 0) {
    throw new Error('Build failed')
  }
}

/**
 * Upload directory to IPFS via DWS
 */
async function uploadToIPFS(
  dir: string,
  network: NetworkType,
  authToken: string,
): Promise<string> {
  const dwsUrl = getDWSUrlForNetwork(network)

  // Collect all files
  const files = collectFiles(dir)

  if (files.length === 0) {
    throw new Error(`No files found in ${dir}`)
  }

  // Create multipart form data
  const formData = new FormData()
  for (const file of files) {
    const content = readFileSync(file.path)
    formData.append('file', new Blob([content]), file.relativePath)
  }

  const response = await fetch(`${dwsUrl}/storage/upload?directory=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`)
  }

  const result = await response.json()
  return result.cid
}

/**
 * Collect files recursively
 */
function collectFiles(
  dir: string,
  baseDir?: string,
): Array<{ path: string; relativePath: string }> {
  const base = baseDir ?? dir
  const files: Array<{ path: string; relativePath: string }> = []

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base))
    } else {
      files.push({
        path: fullPath,
        relativePath: fullPath.slice(base.length + 1),
      })
    }
  }

  return files
}

/**
 * Deploy worker to DWS
 */
async function deployWorker(
  codeCid: string,
  manifest: AppManifest,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<string> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/workers/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      name: manifest.name,
      codeCid,
      routes: [`/${manifest.name}/*`],
      memory: 128,
      timeout: 30000,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Worker deploy failed: ${error}`)
  }

  const result = await response.json()
  return result.workerId
}

/**
 * Register JNS name
 */
async function registerJNS(
  name: string,
  frontendCid: string | undefined,
  workerId: string | undefined,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<string> {
  const dwsUrl = getDWSUrlForNetwork(network)
  const jnsName = `${name}.jeju`

  const response = await fetch(`${dwsUrl}/jns/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      name: jnsName,
      contentCid: frontendCid,
      workerId,
    }),
  })

  if (!response.ok) {
    // JNS registration is optional, don't fail
    logger.warn(`JNS registration failed: ${response.statusText}`)
    return jnsName
  }

  return jnsName
}

export const publishCommand = new Command('publish')
  .description('Deploy current project to Jeju Network')
  .alias('deploy-app')
  .option('--prod', 'Deploy to production')
  .option('--preview', 'Create a preview deployment')
  .option('--name <name>', 'Override project name')
  .option('--skip-build', 'Skip build step')
  .option('--dry-run', 'Show what would be deployed')
  .action(async (options) => {
    const cwd = process.cwd()
    const credentials = requireLogin()
    const network = credentials.network as NetworkType

    // Load manifest
    let manifest: AppManifest
    try {
      manifest = loadManifest(cwd)
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      return
    }

    if (options.name) {
      manifest.name = options.name
    }

    logger.header('JEJU PUBLISH')
    logger.info(`Project: ${manifest.name}`)
    logger.info(`Network: ${network}`)

    const result: PublishResult = {}
    const domainSuffix = getDomainSuffix(network)

    // Build
    if (!options.skipBuild) {
      await buildProject(cwd, manifest)
      logger.success('Build complete')
    }

    if (options.dryRun) {
      logger.info('Dry run - skipping deployment')
      return
    }

    // Deploy frontend
    const frontendConfig = manifest.architecture?.frontend
    if (frontendConfig) {
      const outputDir =
        typeof frontendConfig === 'object'
          ? (frontendConfig.outputDir ?? 'dist')
          : 'dist'
      const frontendPath = join(cwd, outputDir)

      if (existsSync(frontendPath)) {
        logger.step('Uploading frontend to IPFS...')
        result.frontendCid = await uploadToIPFS(
          frontendPath,
          network,
          credentials.authToken,
        )
        result.frontendUrl = `https://${manifest.name}.${domainSuffix}`
        logger.success(`Frontend: ${result.frontendCid}`)
      }
    }

    // Deploy backend worker
    const backendConfig = manifest.architecture?.backend
    if (backendConfig) {
      const outputDir =
        typeof backendConfig === 'object'
          ? (backendConfig.outputDir ?? 'dist/worker')
          : 'dist/worker'
      const workerPath = join(cwd, outputDir)

      if (existsSync(workerPath)) {
        logger.step('Uploading worker to IPFS...')
        const workerCid = await uploadToIPFS(
          workerPath,
          network,
          credentials.authToken,
        )

        logger.step('Deploying worker...')
        result.workerId = await deployWorker(
          workerCid,
          manifest,
          network,
          credentials.authToken,
          credentials.address as Address,
        )
        result.workerUrl = `https://api.${manifest.name}.${domainSuffix}`
        logger.success(`Worker: ${result.workerId}`)
      }
    }

    // Register JNS
    if (result.frontendCid || result.workerId) {
      logger.step('Registering JNS name...')
      result.jnsName = await registerJNS(
        manifest.name,
        result.frontendCid,
        result.workerId,
        network,
        credentials.authToken,
        credentials.address as Address,
      )
    }

    // Generate preview URL if requested
    if (options.preview) {
      const previewId = keccak256(
        stringToBytes(`${manifest.name}-${Date.now()}`),
      ).slice(0, 10)
      result.previewUrl = `https://${previewId}.preview.${domainSuffix}`
    }

    // Summary
    logger.newline()
    logger.success('Deployed.')
    logger.newline()

    if (result.frontendUrl) {
      logger.keyValue('Frontend', result.frontendUrl)
    }
    if (result.frontendCid) {
      logger.keyValue('IPFS CID', result.frontendCid)
    }
    if (result.workerUrl) {
      logger.keyValue('API', result.workerUrl)
    }
    if (result.workerId) {
      logger.keyValue('Worker ID', result.workerId)
    }
    if (result.jnsName) {
      logger.keyValue('JNS', result.jnsName)
    }
    if (result.previewUrl) {
      logger.keyValue('Preview', result.previewUrl)
    }

    // Save deployment info
    const deploymentPath = join(cwd, '.jeju-deployment.json')
    writeFileSync(
      deploymentPath,
      JSON.stringify(
        {
          ...result,
          deployedAt: Date.now(),
          network,
          address: credentials.address,
        },
        null,
        2,
      ),
    )

    logger.newline()
    logger.info('View logs: jeju logs')
    logger.info('View metrics: jeju account info')
  })
