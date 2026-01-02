/**
 * Jeju Preview Command - Preview deployments
 *
 * Like Vercel preview deployments:
 * - jeju preview - Create preview from current branch
 * - jeju preview list - List active previews
 * - jeju preview delete - Remove preview
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Command } from 'commander'
import type { Address } from 'viem'
import { logger } from '../lib/logger'
import type { AppManifest, NetworkType } from '../types'
import { requireLogin } from './login'

interface PreviewDeployment {
  previewId: string
  appName: string
  branchName: string
  commitSha: string
  status: 'pending' | 'building' | 'deploying' | 'active' | 'sleeping' | 'error'
  previewUrl: string
  apiUrl?: string
  createdAt: number
  expiresAt: number
}

/**
 * Get DWS URL for network
 */
function getDWSUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_DWS_URL ?? 'https://dws.jejunetwork.org'
    case 'testnet':
      return (
        process.env.TESTNET_DWS_URL ?? 'https://dws.testnet.jejunetwork.org'
      )
    default:
      return (
        process.env.DWS_URL ??
        getDWSUrl() ??
        `http://${getLocalhostHost()}:4020`
      )
  }
}

/**
 * Get current git branch
 */
function getCurrentBranch(): string {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf-8',
  })
  return result.stdout?.trim() ?? 'main'
}

/**
 * Get current git commit SHA
 */
function getCurrentCommit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  })
  return result.stdout?.trim() ?? ''
}

/**
 * Load manifest from directory
 */
function loadManifest(dir: string): AppManifest | null {
  const manifestPath = join(dir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'))
}

/**
 * Create a preview deployment
 */
async function createPreview(
  appName: string,
  branchName: string,
  commitSha: string,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<PreviewDeployment> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/previews/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
    body: JSON.stringify({
      appName,
      branchName,
      commitSha,
      type: 'branch',
      ttlHours: 72,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create preview: ${error}`)
  }

  return response.json()
}

/**
 * List preview deployments
 */
async function listPreviews(
  appName: string | undefined,
  network: NetworkType,
  authToken: string,
  address: Address,
): Promise<PreviewDeployment[]> {
  const dwsUrl = getDWSUrlForNetwork(network)
  const params = new URLSearchParams()
  if (appName) params.set('app', appName)

  const response = await fetch(`${dwsUrl}/previews/list?${params}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return data.previews ?? []
}

/**
 * Delete a preview deployment
 */
async function deletePreview(
  previewId: string,
  network: NetworkType,
  authToken: string,
): Promise<void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/previews/${previewId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to delete preview: ${error}`)
  }
}

/**
 * Get preview deployment status
 */
async function getPreview(
  previewId: string,
  network: NetworkType,
  authToken: string,
): Promise<PreviewDeployment | null> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/previews/${previewId}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

export const previewCommand = new Command('preview').description(
  'Manage preview deployments',
)

// Create preview (default)
previewCommand
  .command('create', { isDefault: true })
  .description('Create a preview deployment')
  .option('--branch <branch>', 'Branch name (default: current branch)')
  .option('--name <name>', 'App name (default: from manifest)')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    const manifest = loadManifest(cwd)
    const appName = options.name ?? manifest?.name

    if (!appName) {
      logger.error('App name required. Use --name or create jeju-manifest.json')
      return
    }

    // Get git info
    const branchName = options.branch ?? getCurrentBranch()
    const commitSha = getCurrentCommit()

    if (!commitSha) {
      logger.error('Not a git repository or no commits')
      return
    }

    logger.header('JEJU PREVIEW')
    logger.info(`App: ${appName}`)
    logger.info(`Branch: ${branchName}`)
    logger.info(`Commit: ${commitSha.slice(0, 7)}`)
    logger.newline()

    // Build project first
    if (manifest?.commands?.build) {
      logger.step('Building...')
      const proc = spawnSync('sh', ['-c', manifest.commands.build], {
        cwd,
        stdio: 'inherit',
      })
      if (proc.status !== 0) {
        logger.error('Build failed')
        return
      }
      logger.success('Build complete')
    }

    // Create preview
    logger.step('Creating preview deployment...')
    const preview = await createPreview(
      appName,
      branchName,
      commitSha,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    logger.success('Preview created.')
    logger.newline()
    logger.keyValue('Preview ID', preview.previewId)
    logger.keyValue('URL', preview.previewUrl)
    if (preview.apiUrl) {
      logger.keyValue('API', preview.apiUrl)
    }
    logger.keyValue('Status', preview.status)
    logger.keyValue('Expires', new Date(preview.expiresAt).toLocaleDateString())

    // If status is building/deploying, poll for completion
    if (preview.status === 'building' || preview.status === 'deploying') {
      logger.newline()
      logger.info('Waiting for deployment to complete...')

      let current = preview
      while (current.status === 'building' || current.status === 'deploying') {
        await Bun.sleep(3000)
        const updated = await getPreview(
          preview.previewId,
          network,
          credentials.authToken,
        )
        if (!updated) break
        current = updated
        process.stdout.write('.')
      }

      logger.newline()
      if (current.status === 'active') {
        logger.success('Preview is live.')
        logger.keyValue('URL', current.previewUrl)
      } else if (current.status === 'error') {
        logger.error('Preview deployment failed')
      }
    }
  })

// List previews
previewCommand
  .command('list')
  .description('List preview deployments')
  .alias('ls')
  .option('--app <name>', 'Filter by app name')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name from manifest if not provided
    let appName = options.app
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    logger.header('PREVIEW DEPLOYMENTS')

    const previews = await listPreviews(
      appName,
      network,
      credentials.authToken,
      credentials.address as Address,
    )

    if (previews.length === 0) {
      logger.info('No preview deployments found')
      logger.info('Run `jeju preview` to create one')
      return
    }

    console.log('')
    console.log(
      `${'  APP'.padEnd(15) + 'BRANCH'.padEnd(20) + 'STATUS'.padEnd(12)}URL`,
    )
    console.log(`  ${'-'.repeat(70)}`)

    for (const preview of previews) {
      const app = preview.appName.slice(0, 13).padEnd(13)
      const branch = preview.branchName.slice(0, 18).padEnd(18)
      const statusIcon =
        preview.status === 'active'
          ? '✓'
          : preview.status === 'error'
            ? '✗'
            : preview.status === 'sleeping'
              ? '💤'
              : '○'
      const status = `${statusIcon} ${preview.status}`.padEnd(10)

      console.log(`  ${app} ${branch} ${status} ${preview.previewUrl}`)
    }

    logger.newline()
  })

// Delete preview
previewCommand
  .command('delete <preview-id>')
  .description('Delete a preview deployment')
  .alias('rm')
  .option('-f, --force', 'Skip confirmation')
  .action(async (previewId, options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType

    if (!options.force) {
      logger.warn(`This will delete preview: ${previewId}`)
      logger.info('Run with --force to confirm')
      return
    }

    logger.step(`Deleting preview ${previewId}...`)

    await deletePreview(previewId, network, credentials.authToken)

    logger.success('Preview deleted')
  })

// Get preview status
previewCommand
  .command('status [preview-id]')
  .description('Get preview deployment status')
  .action(async (previewId) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType

    // If no preview ID, try to find from current directory
    if (!previewId) {
      const cwd = process.cwd()
      const manifest = loadManifest(cwd)
      const branchName = getCurrentBranch()

      if (manifest) {
        const previews = await listPreviews(
          manifest.name,
          network,
          credentials.authToken,
          credentials.address as Address,
        )
        const current = previews.find((p) => p.branchName === branchName)
        if (current) {
          previewId = current.previewId
        }
      }
    }

    if (!previewId) {
      logger.error('Preview ID required or no preview found for current branch')
      return
    }

    const preview = await getPreview(previewId, network, credentials.authToken)

    if (!preview) {
      logger.error(`Preview not found: ${previewId}`)
      return
    }

    logger.header('PREVIEW STATUS')
    logger.keyValue('ID', preview.previewId)
    logger.keyValue('App', preview.appName)
    logger.keyValue('Branch', preview.branchName)
    logger.keyValue('Commit', preview.commitSha.slice(0, 7))
    logger.keyValue('Status', preview.status)
    logger.keyValue('URL', preview.previewUrl)
    if (preview.apiUrl) {
      logger.keyValue('API', preview.apiUrl)
    }
    logger.keyValue('Created', new Date(preview.createdAt).toLocaleString())
    logger.keyValue('Expires', new Date(preview.expiresAt).toLocaleString())
  })

// Open preview in browser
previewCommand
  .command('open [preview-id]')
  .description('Open preview in browser')
  .action(async (previewId) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType

    // Find preview
    let preview: PreviewDeployment | null = null

    if (previewId) {
      preview = await getPreview(previewId, network, credentials.authToken)
    } else {
      // Try current branch
      const cwd = process.cwd()
      const manifest = loadManifest(cwd)
      const branchName = getCurrentBranch()

      if (manifest) {
        const previews = await listPreviews(
          manifest.name,
          network,
          credentials.authToken,
          credentials.address as Address,
        )
        preview = previews.find((p) => p.branchName === branchName) ?? null
      }
    }

    if (!preview) {
      logger.error('Preview not found')
      return
    }

    logger.info(`Opening ${preview.previewUrl}...`)

    // Open in browser
    const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawnSync(openCmd, [preview.previewUrl])
  })
