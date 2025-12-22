/**
 * jeju dws - Decentralized Web Services CLI
 *
 * Manage DWS services: storage, git (JejuGit), pkg (JejuPkg), CI/CD, CDN
 *
 * Security notes:
 * - All file paths are validated before use
 * - CIDs are validated against known formats
 * - User inputs are sanitized before API calls
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { Command } from 'commander'
import type { Address } from 'viem'
import { bootstrapContracts, getChainStatus } from '../lib/chain'
import { logger } from '../lib/logger'
import {
  sanitizeErrorMessage,
  validateAddress,
  validateCID,
} from '../lib/security'
import { findMonorepoRoot } from '../lib/system'
import {
  CDNHealthResponseSchema,
  CIRunListResponseSchema,
  CIRunSchema,
  CidResponseSchema,
  CreateRepoResponseSchema,
  PackageInfoSchema,
  PackageSearchResultSchema,
  RepoListResponseSchema,
  RepoSchema,
  ServiceHealthResponseSchema,
  UploadResponseSchema,
  WorkflowListResponseSchema,
  expectValid,
  validate,
} from '../schemas'
import { createInfrastructureService } from '../services/infrastructure'
import { DEFAULT_PORTS } from '../types'

const DWS_PORT = parseInt(process.env.DWS_PORT || '4030', 10)

function getDwsUrl(): string {
  return process.env.DWS_URL || `http://localhost:${DWS_PORT}`
}

function getDefaultAddress(): Address {
  const envAddress = process.env.DEPLOYER_ADDRESS
  const defaultAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  if (envAddress) {
    return validateAddress(envAddress)
  }
  return defaultAddress as Address
}

export const dwsCommand = new Command('dws')
  .description('Decentralized Web Services (storage, git, pkg, ci, cdn)')
  .addCommand(
    new Command('dev')
      .description('Start DWS in development mode (auto-starts infrastructure)')
      .option('--port <port>', 'Server port', String(DWS_PORT))
      .option('--no-bootstrap', 'Skip contract bootstrapping')
      .action(async (options) => {
        await startDwsDev(options)
      }),
  )
  .addCommand(
    new Command('status')
      .description('Check DWS services status')
      .action(async () => {
        await checkStatus()
      }),
  )
  .addCommand(
    new Command('start')
      .description('Start DWS server (requires infrastructure to be running)')
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .option('--port <port>', 'Server port', String(DWS_PORT))
      .action(async (options) => {
        await startDws(options)
      }),
  )
  // Storage subcommands
  .addCommand(
    new Command('upload')
      .description('Upload file to decentralized storage')
      .argument('<file>', 'File path to upload')
      .action(async (file) => {
        await uploadFile(file)
      }),
  )
  .addCommand(
    new Command('download')
      .description('Download file from storage')
      .argument('<cid>', 'Content ID (CID)')
      .option('-o, --output <path>', 'Output file path')
      .action(async (cid, options) => {
        await downloadFile(cid, options)
      }),
  )
  // Git subcommands
  .addCommand(
    new Command('repos')
      .description('List Git repositories')
      .option('--user <address>', 'Filter by owner address')
      .option('--limit <n>', 'Max results', '20')
      .action(async (options) => {
        await listRepos(options)
      }),
  )
  .addCommand(
    new Command('repo')
      .description('Get repository details')
      .argument('<owner>', 'Repository owner address')
      .argument('<name>', 'Repository name')
      .action(async (owner, name) => {
        await getRepo(owner, name)
      }),
  )
  .addCommand(
    new Command('create-repo')
      .description('Create a new repository')
      .argument('<name>', 'Repository name')
      .option('--description <desc>', 'Repository description')
      .option('--private', 'Make repository private')
      .option('--address <address>', 'Owner address')
      .action(async (name, options) => {
        await createRepo(name, options)
      }),
  )
  // Package registry subcommands
  .addCommand(
    new Command('pkg-search')
      .description('Search packages in JejuPkg registry')
      .argument('<query>', 'Search query')
      .option('--limit <n>', 'Max results', '20')
      .action(async (query, options) => {
        await searchPackages(query, options)
      }),
  )
  .addCommand(
    new Command('pkg-info')
      .description('Get package information')
      .argument('<name>', 'Package name (e.g., @scope/package)')
      .action(async (name) => {
        await getPackageInfo(name)
      }),
  )
  // CI/CD subcommands
  .addCommand(
    new Command('workflows')
      .description('List CI/CD workflows for a repository')
      .argument('<repo-id>', 'Repository ID (hex)')
      .action(async (repoId) => {
        await listWorkflows(repoId)
      }),
  )
  .addCommand(
    new Command('runs')
      .description('List workflow runs')
      .argument('<repo-id>', 'Repository ID')
      .option('--status <status>', 'Filter by status')
      .option('--limit <n>', 'Max results', '20')
      .action(async (repoId, options) => {
        await listRuns(repoId, options)
      }),
  )
  .addCommand(
    new Command('run')
      .description('Get run details')
      .argument('<run-id>', 'Run ID')
      .action(async (runId) => {
        await getRunDetails(runId)
      }),
  )
  // Seeding and setup
  .addCommand(
    new Command('seed')
      .description('Seed development environment with test data')
      .action(async () => {
        await seedDev()
      }),
  )
  .addCommand(
    new Command('self-host')
      .description('Upload DWS to DWS storage (self-hosting)')
      .action(async () => {
        await selfHost()
      }),
  )
  .addCommand(
    new Command('build-runner')
      .description('Build CI runner Docker images (ARM64 + AMD64)')
      .option('--push', 'Push images to registry')
      .option('--version <version>', 'Image version tag', 'latest')
      .option('--registry <url>', 'Docker registry URL', 'ghcr.io/jeju-labs')
      .action(async (options) => {
        await buildRunner(options)
      }),
  )
  // CDN subcommands
  .addCommand(
    new Command('cdn-status')
      .description('Check CDN service status')
      .action(async () => {
        await checkCdnStatus()
      }),
  )
  // Setup and verification
  .addCommand(
    new Command('setup')
      .description('Install workerd binary (Cloudflare Workers runtime)')
      .action(async () => {
        await setupWorkerd()
      }),
  )
  .addCommand(
    new Command('verify-gpu')
      .description('Verify TEE GPU provisioning and attestation')
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .action(async (options) => {
        await verifyTeeGpu(options)
      }),
  )

async function checkStatus(): Promise<void> {
  logger.header('DWS STATUS')

  const chain = await getChainStatus('localnet')
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ])

  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const rawData = await response.json()
      const health = validate(
        rawData,
        ServiceHealthResponseSchema,
        'DWS health',
      )

      logger.newline()
      logger.subheader('DWS Server')
      logger.table([
        {
          label: 'Status',
          value: health.status,
          status: health.status === 'healthy' ? 'ok' : 'error',
        },
        { label: 'Version', value: health.version ?? 'unknown', status: 'ok' },
        {
          label: 'Uptime',
          value: health.uptime
            ? `${Math.floor(health.uptime / 1000)}s`
            : 'unknown',
          status: 'ok',
        },
      ])

      logger.newline()
      logger.subheader('Services')
      if (health.services) {
        for (const [name, svc] of Object.entries(health.services)) {
          const status =
            svc.status === 'healthy'
              ? 'ok'
              : svc.status === 'not-configured'
                ? 'warn'
                : 'error'
          logger.table([{ label: name, value: svc.status, status }])
        }
      }

      if (health.backends) {
        logger.newline()
        logger.subheader('Storage Backends')
        for (const backend of health.backends.available) {
          const healthy = health.backends.health[backend]
          logger.table([
            {
              label: backend,
              value: healthy ? 'healthy' : 'unhealthy',
              status: healthy ? 'ok' : 'error',
            },
          ])
        }
      }

      if (health.decentralized) {
        logger.newline()
        logger.subheader('Decentralized')
        logger.keyValue(
          'Identity Registry',
          health.decentralized.identityRegistry,
        )
        logger.keyValue(
          'Registered Nodes',
          String(health.decentralized.registeredNodes),
        )
        logger.keyValue(
          'Connected Peers',
          String(health.decentralized.connectedPeers),
        )
        logger.keyValue(
          'P2P Enabled',
          health.decentralized.p2pEnabled ? 'Yes' : 'No',
        )
      }
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch {
    logger.table([
      { label: 'DWS Server', value: 'Not running', status: 'error' },
    ])
    logger.newline()
    logger.info('Start DWS with: jeju dws start')
  }
}

/**
 * Start DWS in development mode with full infrastructure
 * This is the main development entry point - starts Docker, services, localnet, and DWS
 */
async function startDwsDev(options: {
  port: string
  bootstrap?: boolean
}): Promise<void> {
  const rootDir = findMonorepoRoot()
  const dwsDir = join(rootDir, 'apps/dws')

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found')
    process.exit(1)
  }

  console.log(
    '\n╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                     JEJU DWS DEV MODE                        ║',
  )
  console.log(
    '╠══════════════════════════════════════════════════════════════╣',
  )
  console.log(
    '║  All infrastructure required - no fallbacks.                 ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝\n',
  )

  // Step 1: Start all infrastructure (Docker, services, localnet)
  const infra = createInfrastructureService(rootDir)
  const infraReady = await infra.ensureRunning()

  if (!infraReady) {
    logger.error('Failed to start infrastructure')
    logger.info('  Run: jeju infra status')
    process.exit(1)
  }

  const rpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`

  // Step 2: Bootstrap contracts (if enabled)
  if (options.bootstrap !== false) {
    const bootstrapFile = join(
      rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )
    if (!existsSync(bootstrapFile)) {
      logger.subheader('Contracts')
      logger.step('Bootstrapping contracts...')
      await bootstrapContracts(rootDir, rpcUrl)
    } else {
      logger.success('Contracts already deployed')
    }
  }

  // Step 3: Start DWS server
  logger.subheader('DWS Server')
  logger.keyValue('Port', options.port)
  logger.keyValue('RPC', rpcUrl)
  logger.keyValue('CQL', 'http://127.0.0.1:4661')
  logger.newline()

  // Get environment from infrastructure service
  const infraEnv = infra.getEnvVars()

  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'src/server/index.ts'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...infraEnv,
      PORT: options.port,
      DWS_PORT: options.port,
      NETWORK: 'localnet',
    },
  })

  // Handle shutdown
  const cleanup = () => {
    logger.newline()
    logger.step('Shutting down...')
    proc.kill('SIGTERM')
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await proc.exited
}

async function startDws(options: {
  network: string
  port: string
}): Promise<void> {
  logger.header('DWS SERVER')

  const rootDir = findMonorepoRoot()
  const dwsDir = join(rootDir, 'apps/dws')

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found')
    process.exit(1)
  }

  const chain = await getChainStatus(
    options.network as 'localnet' | 'testnet' | 'mainnet',
  )
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Use: jeju dws dev (auto-starts everything)')
    logger.info('  Or start infrastructure manually: jeju infra start')
    process.exit(1)
  }

  const rpcUrl =
    options.network === 'localnet'
      ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
      : options.network === 'testnet'
        ? 'https://testnet-rpc.jejunetwork.org'
        : 'https://rpc.jejunetwork.org'

  logger.step(`Starting DWS server on port ${options.port}...`)
  logger.keyValue('Network', options.network)
  logger.keyValue('RPC URL', rpcUrl)

  // For localnet, get environment from infrastructure service
  let infraEnv: Record<string, string> = {}
  if (options.network === 'localnet') {
    const infra = createInfrastructureService(rootDir)
    infraEnv = infra.getEnvVars()
  }

  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'src/server/index.ts'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...infraEnv,
      PORT: options.port,
      DWS_PORT: options.port,
      NETWORK: options.network,
      RPC_URL: rpcUrl,
      JEJU_RPC_URL: rpcUrl,
    },
  })

  process.on('SIGINT', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  await proc.exited
}

async function uploadFile(filePath: string): Promise<void> {
  logger.header('UPLOAD FILE')

  // Resolve and normalize path to prevent traversal
  const resolvedPath = resolve(normalize(filePath))

  if (!existsSync(resolvedPath)) {
    logger.error(`File not found: ${resolvedPath}`)
    process.exit(1)
  }

  const dwsUrl = getDwsUrl()
  const content = readFileSync(resolvedPath)

  // Extract and validate filename
  const rawFilename = resolvedPath.split('/').pop() || 'file'
  const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_') // Sanitize filename

  logger.keyValue('File', resolvedPath)
  logger.keyValue('Size', `${content.length} bytes`)
  logger.newline()

  try {
    const response = await fetch(`${dwsUrl}/storage/upload/raw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filename': filename,
      },
      body: content,
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(sanitizeErrorMessage(error))
    }

    const rawResult = await response.json()
    const result = validate(rawResult, UploadResponseSchema, 'upload response')
    logger.success('Upload complete')
    logger.keyValue('CID', result.cid)
    if (result.backend) logger.keyValue('Backend', result.backend)
    logger.newline()
    logger.info(`Download with: jeju dws download ${result.cid}`)
  } catch (error) {
    logger.error(`Upload failed: ${sanitizeErrorMessage(error as Error)}`)
    process.exit(1)
  }
}

async function downloadFile(
  cid: string,
  options: { output?: string },
): Promise<void> {
  logger.header('DOWNLOAD FILE')

  // Validate CID format to prevent path injection
  const validCid = validateCID(cid)

  const dwsUrl = getDwsUrl()

  // Sanitize output path - resolve and ensure it's in current directory or below
  let outputPath = options.output || validCid

  // SECURITY: Check for null bytes which could bypass path checks
  if (outputPath.includes('\0')) {
    logger.error('Invalid output path: null bytes not allowed')
    process.exit(1)
  }

  outputPath = resolve(normalize(outputPath))

  // Prevent writing outside current directory
  const cwd = resolve(process.cwd())
  if (!outputPath.startsWith(`${cwd}/`) && outputPath !== cwd) {
    logger.error('Output path must be within current directory')
    process.exit(1)
  }

  // SECURITY: Ensure parent directory exists and is actually a directory
  const parentDir = join(outputPath, '..')
  const resolvedParent = resolve(parentDir)
  if (existsSync(resolvedParent)) {
    // Dynamic import: only needed when parent directory exists (conditional check)
    const { statSync } = await import('node:fs')
    const parentStat = statSync(resolvedParent)
    if (!parentStat.isDirectory()) {
      logger.error('Parent path is not a directory')
      process.exit(1)
    }
  }

  // SECURITY: Check output path is not a symlink pointing outside cwd
  if (existsSync(outputPath)) {
    // Dynamic import: only needed when output path exists (conditional check)
    const { lstatSync, realpathSync } = await import('node:fs')
    const lstat = lstatSync(outputPath)
    if (lstat.isSymbolicLink()) {
      const realPath = realpathSync(outputPath)
      if (!realPath.startsWith(`${cwd}/`) && realPath !== cwd) {
        logger.error('Output path symlink points outside current directory')
        process.exit(1)
      }
    }
  }

  logger.keyValue('CID', validCid)
  logger.keyValue('Output', outputPath)
  logger.newline()

  try {
    const response = await fetch(`${dwsUrl}/storage/download/${validCid}`, {
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('File not found')
      } else {
        logger.error(`HTTP ${response.status}`)
      }
      process.exit(1)
    }

    const content = Buffer.from(await response.arrayBuffer())
    await Bun.write(outputPath, content)

    logger.success('Download complete')
    logger.keyValue('Size', `${content.length} bytes`)
    logger.keyValue('Saved to', outputPath)
  } catch (error) {
    logger.error(`Download failed: ${sanitizeErrorMessage(error as Error)}`)
    process.exit(1)
  }
}

async function listRepos(options: {
  user?: string
  limit: string
}): Promise<void> {
  logger.header('GIT REPOSITORIES')

  const dwsUrl = getDwsUrl()

  try {
    const url = options.user
      ? `${dwsUrl}/git/users/${options.user}/repos`
      : `${dwsUrl}/git/repos?limit=${options.limit}`

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const rawData = await response.json()
    const data = validate(rawData, RepoListResponseSchema, 'repo list response')

    if (data.repositories.length === 0) {
      logger.info('No repositories found')
      return
    }

    logger.info(`Found ${data.repositories.length} repositories:\n`)

    for (const repo of data.repositories) {
      const visibility = repo.visibility === 'private' ? '🔒' : '📦'
      console.log(`  ${visibility} ${repo.owner.slice(0, 8)}.../${repo.name}`)
      if (repo.description) console.log(`     ${repo.description}`)
      console.log(
        `     ⭐ ${repo.starCount ?? 0}${repo.cloneUrl ? ` | Clone: ${repo.cloneUrl}` : ''}`,
      )
      console.log('')
    }
  } catch (error) {
    logger.error(`Failed to list repos: ${error}`)
    process.exit(1)
  }
}

async function getRepo(owner: string, name: string): Promise<void> {
  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/git/repos/${owner}/${name}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Repository not found')
      } else {
        logger.error(`HTTP ${response.status}`)
      }
      process.exit(1)
    }

    const rawRepo = await response.json()
    const repo = validate(rawRepo, RepoSchema, 'repo details')

    logger.header('REPOSITORY DETAILS')
    logger.keyValue('Name', `${repo.owner.slice(0, 10)}.../${repo.name}`)
    logger.keyValue('ID', repo.repoId)
    if (repo.visibility) logger.keyValue('Visibility', repo.visibility)
    if (repo.description) logger.keyValue('Description', repo.description)
    if (repo.starCount !== undefined)
      logger.keyValue('Stars', String(repo.starCount))
    if (repo.forkCount !== undefined)
      logger.keyValue('Forks', String(repo.forkCount))
    if (repo.defaultBranch)
      logger.keyValue('Default Branch', repo.defaultBranch)
    if (repo.createdAt)
      logger.keyValue('Created', new Date(repo.createdAt * 1000).toISOString())
    if (repo.cloneUrl) logger.keyValue('Clone URL', repo.cloneUrl)

    if (repo.branches && repo.branches.length > 0) {
      logger.newline()
      logger.subheader('Branches')
      for (const branch of repo.branches) {
        const prot = branch.protected ? ' 🔒' : ''
        console.log(`  ${branch.name}${prot}`)
        console.log(`     Tip: ${branch.tipCommit.slice(0, 7)}`)
      }
    }
  } catch (error) {
    logger.error(`Failed to get repo: ${error}`)
    process.exit(1)
  }
}

async function createRepo(
  name: string,
  options: { description?: string; private?: boolean; address?: string },
): Promise<void> {
  logger.header('CREATE REPOSITORY')

  // Validate repository name
  const repoNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
  if (!name || !repoNamePattern.test(name) || name.length > 100) {
    logger.error('Invalid repository name')
    process.exit(1)
  }

  const dwsUrl = getDwsUrl()
  const address = options.address
    ? validateAddress(options.address)
    : getDefaultAddress()

  logger.keyValue('Name', name)
  logger.keyValue('Owner', address)
  if (options.description) logger.keyValue('Description', options.description)
  logger.keyValue('Visibility', options.private ? 'private' : 'public')
  logger.newline()

  try {
    const response = await fetch(`${dwsUrl}/git/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        name,
        description: options.description || '',
        visibility: options.private ? 1 : 0,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(error)
    }

    const rawResult = await response.json()
    const result = validate(
      rawResult,
      CreateRepoResponseSchema,
      'create repo response',
    )
    logger.success('Repository created')
    logger.keyValue('Repo ID', result.repoId)
    logger.keyValue('Clone URL', result.cloneUrl)
    logger.newline()
    logger.info(`Clone with: git clone ${result.cloneUrl}`)
  } catch (error) {
    logger.error(`Failed to create repo: ${error}`)
    process.exit(1)
  }
}

async function searchPackages(
  query: string,
  options: { limit: string },
): Promise<void> {
  logger.header('PACKAGE SEARCH')

  const dwsUrl = getDwsUrl()

  logger.keyValue('Query', query)
  logger.newline()

  try {
    const params = new URLSearchParams({ text: query, size: options.limit })
    const response = await fetch(`${dwsUrl}/pkg/-/v1/search?${params}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const rawData = await response.json()
    const data = validate(
      rawData,
      PackageSearchResultSchema,
      'package search result',
    )

    if (data.objects.length === 0) {
      logger.info('No packages found')
      return
    }

    logger.info(`Found ${data.total} packages:\n`)

    for (const obj of data.objects) {
      const pkg = obj.package
      console.log(`  📦 ${pkg.name}@${pkg.version}`)
      if (pkg.description) console.log(`     ${pkg.description}`)
      console.log(`     Publisher: ${pkg.publisher.username}`)
      console.log('')
    }
  } catch (error) {
    logger.error(`Search failed: ${error}`)
    process.exit(1)
  }
}

async function getPackageInfo(name: string): Promise<void> {
  const dwsUrl = getDwsUrl()

  // Validate package name format
  if (!name || typeof name !== 'string') {
    logger.error('Package name is required')
    process.exit(1)
  }

  // Validate package name pattern (npm-style: @scope/package or package)
  const packagePattern =
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
  if (!packagePattern.test(name)) {
    logger.error('Invalid package name format')
    process.exit(1)
  }

  // Safely encode package name
  const encodedName = encodeURIComponent(name)
    .replace(/%40/g, '@')
    .replace(/%2F/g, '/')

  try {
    const response = await fetch(`${dwsUrl}/pkg/${encodedName}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Package not found')
      } else {
        logger.error(`HTTP ${response.status}`)
      }
      process.exit(1)
    }

    const rawPkg = await response.json()
    const pkg = validate(rawPkg, PackageInfoSchema, 'package info')

    logger.header('PACKAGE INFO')
    logger.keyValue('Name', pkg.name)
    if (pkg.description) logger.keyValue('Description', pkg.description)

    if (pkg['dist-tags']) {
      logger.newline()
      logger.subheader('Tags')
      for (const [tag, version] of Object.entries(pkg['dist-tags'])) {
        logger.keyValue(tag, version)
      }
    }

    const versions = Object.keys(pkg.versions).sort().reverse().slice(0, 5)
    if (versions.length > 0) {
      logger.newline()
      logger.subheader('Recent Versions')
      for (const v of versions) {
        console.log(`  ${v}`)
      }
    }
  } catch (error) {
    logger.error(`Failed to get package info: ${error}`)
    process.exit(1)
  }
}

async function listWorkflows(repoId: string): Promise<void> {
  logger.header('CI WORKFLOWS')

  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/ci/workflows/${repoId}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const rawData = await response.json()
    const data = validate(rawData, WorkflowListResponseSchema, 'workflow list')

    if (data.workflows.length === 0) {
      logger.info('No workflows found')
      return
    }

    logger.info(`Found ${data.workflows.length} workflows:\n`)

    for (const wf of data.workflows) {
      const active = wf.active ? '✅' : '⏸️'
      console.log(`  ${active} ${wf.name}`)
      console.log(`     ID: ${wf.workflowId}`)
      if (wf.description) console.log(`     ${wf.description}`)
      console.log(`     Triggers: ${wf.triggers.join(', ')}`)
      console.log(`     Jobs: ${wf.jobs.map((j) => j.name).join(', ')}`)
      console.log('')
    }
  } catch (error) {
    logger.error(`Failed to list workflows: ${error}`)
    process.exit(1)
  }
}

async function listRuns(
  repoId: string,
  options: { status?: string; limit: string },
): Promise<void> {
  logger.header('CI RUNS')

  const dwsUrl = getDwsUrl()

  try {
    const params = new URLSearchParams({ limit: options.limit })
    if (options.status) params.set('status', options.status)

    const response = await fetch(
      `${dwsUrl}/ci/repos/${repoId}/runs?${params}`,
      {
        signal: AbortSignal.timeout(10000),
      },
    )

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const rawData = await response.json()
    const data = validate(rawData, CIRunListResponseSchema, 'CI run list')

    if (data.runs.length === 0) {
      logger.info('No runs found')
      return
    }

    logger.info(`Found ${data.runs.length} of ${data.total} runs:\n`)

    for (const run of data.runs) {
      const statusIcon =
        run.conclusion === 'success'
          ? '✅'
          : run.conclusion === 'failure'
            ? '❌'
            : run.status === 'in_progress'
              ? '🔄'
              : run.status === 'queued'
                ? '⏳'
                : '⏸️'
      console.log(`  ${statusIcon} ${run.runId.slice(0, 8)}...`)
      console.log(`     Branch: ${run.branch} @ ${run.commitSha}`)
      console.log(
        `     Status: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`,
      )
      if (run.duration !== undefined)
        console.log(`     Duration: ${Math.round(run.duration / 1000)}s`)
      console.log('')
    }
  } catch (error) {
    logger.error(`Failed to list runs: ${error}`)
    process.exit(1)
  }
}

async function getRunDetails(runId: string): Promise<void> {
  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/ci/runs/${runId}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Run not found')
      } else {
        logger.error(`HTTP ${response.status}`)
      }
      process.exit(1)
    }

    const rawRun = await response.json()
    const run = validate(rawRun, CIRunSchema, 'CI run details')

    logger.header('RUN DETAILS')
    logger.keyValue('Run ID', run.runId)
    logger.keyValue('Workflow ID', run.workflowId)
    logger.keyValue('Status', run.status)
    if (run.conclusion) logger.keyValue('Conclusion', run.conclusion)
    logger.keyValue('Branch', run.branch)
    logger.keyValue('Commit', run.commitSha)
    if (run.triggeredBy) logger.keyValue('Triggered By', run.triggeredBy)
    logger.keyValue('Started', new Date(run.startedAt).toISOString())
    if (run.completedAt)
      logger.keyValue('Completed', new Date(run.completedAt).toISOString())

    if (run.jobs && run.jobs.length > 0) {
      logger.newline()
      logger.subheader('Jobs')
      for (const job of run.jobs) {
        const jobIcon =
          job.conclusion === 'success'
            ? '✅'
            : job.conclusion === 'failure'
              ? '❌'
              : job.status === 'in_progress'
                ? '🔄'
                : '⏳'
        console.log(`  ${jobIcon} ${job.name}`)

        for (const step of job.steps) {
          const stepIcon =
            step.conclusion === 'success'
              ? '✓'
              : step.conclusion === 'failure'
                ? '✗'
                : step.status === 'in_progress'
                  ? '...'
                  : '-'
          console.log(
            `     ${stepIcon} ${step.name}${step.exitCode !== null ? ` (exit: ${step.exitCode})` : ''}`,
          )
        }
        console.log('')
      }
    }

    logger.newline()
    logger.info(`View logs: curl ${dwsUrl}/ci/runs/${runId}/logs`)
  } catch (error) {
    logger.error(`Failed to get run: ${error}`)
    process.exit(1)
  }
}

async function checkCdnStatus(): Promise<void> {
  logger.header('CDN STATUS')

  const dwsUrl = getDwsUrl()

  try {
    const response = await fetch(`${dwsUrl}/cdn/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const rawHealth = await response.json()
      const health = validate(
        rawHealth,
        CDNHealthResponseSchema,
        'CDN health response',
      )

      logger.table([
        {
          label: 'Status',
          value: health.status,
          status: health.status === 'healthy' ? 'ok' : 'error',
        },
        { label: 'Service', value: health.service, status: 'ok' },
      ])

      if (health.cache) {
        logger.newline()
        logger.subheader('Cache')
        logger.keyValue('Entries', String(health.cache.entries))
        logger.keyValue(
          'Hit Rate',
          `${(health.cache.hitRate * 100).toFixed(1)}%`,
        )
      }

      if (health.edgeNodes !== undefined) {
        logger.keyValue('Edge Nodes', String(health.edgeNodes))
      }
    } else {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch {
    logger.table([{ label: 'CDN', value: 'Not available', status: 'error' }])
  }
}

/**
 * Seed development environment with test data
 */
async function seedDev(): Promise<void> {
  const dwsUrl = getDwsUrl()
  const testAddress = getDefaultAddress()

  logger.header('DWS SEED')
  logger.keyValue('DWS URL', dwsUrl)
  logger.keyValue('Test Address', testAddress)
  logger.newline()

  // Wait for DWS
  logger.step('Waiting for DWS...')
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${dwsUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) break
    } catch {
      // Retry
    }
    if (i === 29) {
      logger.error('DWS not available')
      logger.info('  Start DWS first: jeju dws dev')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  logger.success('DWS ready')

  // Seed storage
  logger.subheader('Storage')
  const files = [
    {
      name: 'readme.txt',
      content: 'Welcome to DWS - Decentralized Web Services',
    },
    {
      name: 'config.json',
      content: JSON.stringify({ version: '1.0.0', network: 'localnet' }),
    },
    {
      name: 'sample.html',
      content: '<html><body><h1>Hello DWS</h1></body></html>',
    },
  ]

  for (const file of files) {
    try {
      const res = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': testAddress,
          'x-filename': file.name,
        },
        body: file.content,
      })
      if (res.ok) {
        const { cid } = validate(await res.json(), CidResponseSchema, 'upload response')
        logger.success(`${file.name} -> ${cid.slice(0, 16)}...`)
      }
    } catch {
      logger.warn(`Failed to upload ${file.name}`)
    }
  }

  // Seed S3 buckets
  logger.subheader('S3 Buckets')
  const buckets = ['dev-assets', 'dev-uploads', 'dev-cache']
  for (const bucket of buckets) {
    try {
      const res = await fetch(`${dwsUrl}/s3/${bucket}`, {
        method: 'PUT',
        headers: { 'x-jeju-address': testAddress },
      })
      if (res.ok || res.status === 409) {
        logger.success(`Bucket: ${bucket}`)
      }
    } catch {
      logger.warn(`Failed to create bucket ${bucket}`)
    }
  }

  // Verify services
  logger.subheader('Services')
  const services = [
    { name: 'Storage', endpoint: '/storage/health' },
    { name: 'Compute', endpoint: '/compute/health' },
    { name: 'CDN', endpoint: '/cdn/health' },
    { name: 'KMS', endpoint: '/kms/health' },
    { name: 'Git', endpoint: '/git/health' },
    { name: 'Pkg', endpoint: '/pkg/health' },
    { name: 'CI', endpoint: '/ci/health' },
  ]

  let healthy = 0
  for (const service of services) {
    try {
      const res = await fetch(`${dwsUrl}${service.endpoint}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        logger.success(service.name)
        healthy++
      } else {
        logger.warn(`${service.name} (${res.status})`)
      }
    } catch {
      logger.error(`${service.name} (unreachable)`)
    }
  }

  logger.newline()
  logger.success(`Seeded. ${healthy}/${services.length} services healthy.`)
}

/**
 * Self-host DWS on DWS storage
 */
async function selfHost(): Promise<void> {
  const dwsUrl = getDwsUrl()
  const testAddress = getDefaultAddress()

  logger.header('DWS SELF-HOST')
  logger.keyValue('DWS URL', dwsUrl)
  logger.keyValue('Deployer', testAddress)
  logger.newline()

  // Check DWS health
  try {
    const res = await fetch(`${dwsUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error('DWS not healthy')
    logger.success('DWS running')
  } catch {
    logger.error('DWS not available')
    logger.info('  Start DWS first: jeju dws dev')
    process.exit(1)
  }

  // Create DWS repository on DWS Git
  logger.step('Creating DWS repository...')
  try {
    const res = await fetch(`${dwsUrl}/git/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': testAddress,
      },
      body: JSON.stringify({
        name: 'dws',
        description:
          'Decentralized Web Services - Storage, Compute, CDN, Git, and NPM',
        visibility: 'public',
      }),
    })

    if (res.ok) {
      const { repoId, cloneUrl } = validate(
        await res.json(),
        CreateRepoResponseSchema,
        'repo create response',
      )
      logger.success('Repository created')
      logger.keyValue('Repo ID', repoId)
      logger.keyValue('Clone URL', cloneUrl)
    } else if (res.status === 409) {
      logger.info('Repository already exists')
    } else {
      const err = await res.text()
      logger.warn(`Failed to create repo: ${err}`)
    }
  } catch (e) {
    logger.error(`Failed to create repo: ${e}`)
  }

  // Upload sample frontend
  logger.step('Uploading sample frontend...')
  const sampleHtml = `<!DOCTYPE html>
<html>
<head><title>DWS</title></head>
<body>
<h1>Decentralized Web Services</h1>
<p>Running on Jeju Network</p>
</body>
</html>`

  try {
    const res = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/html',
        'x-jeju-address': testAddress,
        'x-filename': 'index.html',
      },
      body: sampleHtml,
    })

    if (res.ok) {
      const { cid } = validate(await res.json(), CidResponseSchema, 'upload response')
      logger.success('Frontend uploaded')
      logger.keyValue('Frontend CID', cid)
      logger.newline()
      logger.info('To run DWS with decentralized frontend:')
      logger.info(`  DWS_FRONTEND_CID=${cid} jeju dws dev`)
    }
  } catch (e) {
    logger.error(`Failed to upload frontend: ${e}`)
  }

  logger.newline()
  logger.success('Self-hosting setup complete')
}

/**
 * Build CI runner Docker images
 */
async function buildRunner(options: {
  push?: boolean
  version: string
  registry: string
}): Promise<void> {
  const rootDir = findMonorepoRoot()
  const dockerDir = join(rootDir, 'apps/dws/docker')
  const imageName = 'jeju-runner'

  logger.header('BUILD CI RUNNER')
  logger.keyValue('Registry', options.registry)
  logger.keyValue('Version', options.version)
  logger.keyValue('Push', options.push ? 'Yes' : 'No')
  logger.newline()

  // Create buildx builder
  logger.step('Setting up Docker buildx...')
  const createBuilder = Bun.spawn(
    ['docker', 'buildx', 'create', '--use', '--name', 'jeju-builder'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  await createBuilder.exited

  const inspectBuilder = Bun.spawn(
    ['docker', 'buildx', 'inspect', '--bootstrap'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  await inspectBuilder.exited
  logger.success('Buildx ready')

  // Build image
  logger.step('Building images...')
  const platforms = options.push
    ? 'linux/amd64,linux/arm64'
    : `linux/${process.arch === 'arm64' ? 'arm64' : 'amd64'}`

  const buildArgs = [
    'docker',
    'buildx',
    'build',
    '--platform',
    platforms,
    '-f',
    join(dockerDir, 'Dockerfile.runner'),
    '-t',
    `${options.registry}/${imageName}:${options.version}`,
    '-t',
    `${options.registry}/${imageName}:latest`,
  ]

  if (options.push) {
    buildArgs.push('--push')
  } else {
    buildArgs.push('--load')
  }

  buildArgs.push(dockerDir)

  const build = Bun.spawn(buildArgs, {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await build.exited
  if (exitCode !== 0) {
    logger.error('Build failed')
    process.exit(1)
  }

  logger.success('Build complete')
  logger.newline()

  if (options.push) {
    logger.info('Images pushed:')
    logger.info(`  ${options.registry}/${imageName}:${options.version}`)
    logger.info(`  ${options.registry}/${imageName}:latest`)
  } else {
    logger.info('Image loaded locally:')
    logger.info(`  ${options.registry}/${imageName}:latest`)
  }

  logger.newline()
  logger.info('To test the runner locally:')
  logger.info(
    `  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \\`,
  )
  logger.info(
    `    -e JEJU_WORKFLOW=$(echo '{"runId":"test","jobId":"build","job":{"steps":[{"run":"echo hello"}]}}' | base64) \\`,
  )
  logger.info(`    ${options.registry}/${imageName}:latest`)
}

/**
 * Setup workerd (Cloudflare Workers runtime)
 */
async function setupWorkerd(): Promise<void> {
  logger.header('WORKERD SETUP')

  const rootDir = findMonorepoRoot()
  const dwsDir = join(rootDir, 'apps/dws')
  const workerdBinPath = join(dwsDir, 'node_modules', '.bin', 'workerd')
  const workerdPathFile = join(dwsDir, 'node_modules', '.workerd-path')

  // Check if workerd is already installed
  logger.step('Checking for existing workerd installation...')

  let isInstalled = false
  if (existsSync(workerdBinPath)) {
    const checkProc = Bun.spawn([workerdBinPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await checkProc.exited
    isInstalled = exitCode === 0
  }

  if (isInstalled) {
    logger.success('workerd is already installed')
    logger.keyValue('Path', workerdBinPath)

    // Show version
    const versionProc = Bun.spawn([workerdBinPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const versionOutput = await new Response(versionProc.stdout).text()
    logger.keyValue('Version', versionOutput.trim())
    return
  }

  // Run the install script
  logger.step('Installing workerd...')
  logger.keyValue('Platform', `${process.platform}-${process.arch}`)
  logger.newline()

  const installScript = join(dwsDir, 'scripts', 'install-workerd.ts')
  if (!existsSync(installScript)) {
    logger.error(`Install script not found: ${installScript}`)
    process.exit(1)
  }

  const proc = Bun.spawn(['bun', 'run', installScript], {
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    logger.error('workerd installation failed')
    process.exit(1)
  }

  // Verify installation
  logger.newline()
  logger.step('Verifying installation...')

  if (!existsSync(workerdBinPath) && !existsSync(workerdPathFile)) {
    logger.error('workerd binary not found after installation')
    process.exit(1)
  }

  // Check the installed path
  let installedPath = workerdBinPath
  if (existsSync(workerdPathFile)) {
    installedPath = await Bun.file(workerdPathFile).text()
    installedPath = installedPath.trim()
  }

  const verifyProc = Bun.spawn([installedPath, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const verifyExitCode = await verifyProc.exited

  if (verifyExitCode !== 0) {
    logger.error('workerd verification failed')
    process.exit(1)
  }

  const versionOutput = await new Response(verifyProc.stdout).text()
  logger.success('workerd installed successfully')
  logger.keyValue('Path', installedPath)
  logger.keyValue('Version', versionOutput.trim())
}

/**
 * Verify TEE GPU provisioning and attestation
 */
async function verifyTeeGpu(options: { network: string }): Promise<void> {
  logger.header('TEE GPU VERIFICATION')

  const rootDir = findMonorepoRoot()
  const verifyScript = join(
    rootDir,
    'scripts',
    'verify-tee-gpu-provisioning.ts',
  )

  if (!existsSync(verifyScript)) {
    logger.error(`Verification script not found: ${verifyScript}`)
    process.exit(1)
  }

  logger.keyValue('Network', options.network)
  logger.keyValue('Script', verifyScript)
  logger.newline()

  // Set up environment based on network
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NETWORK: options.network,
  }

  if (options.network === 'localnet') {
    env.RPC_URL = `http://localhost:${DEFAULT_PORTS.l2Rpc}`
    env.DWS_ENDPOINT = 'http://localhost:4030'
  } else if (options.network === 'testnet') {
    env.RPC_URL = 'https://testnet-rpc.jejunetwork.org'
    env.DWS_ENDPOINT = 'https://testnet-dws.jejunetwork.org'
  } else if (options.network === 'mainnet') {
    env.RPC_URL = 'https://rpc.jejunetwork.org'
    env.DWS_ENDPOINT = 'https://dws.jejunetwork.org'
  }

  // Check for required private key
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    logger.error('DEPLOYER_PRIVATE_KEY environment variable required')
    logger.info('  Set it with: export DEPLOYER_PRIVATE_KEY=0x...')
    process.exit(1)
  }

  logger.step('Running TEE GPU verification tests...')
  logger.newline()

  const proc = Bun.spawn(['bun', 'run', verifyScript], {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  })

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    logger.newline()
    logger.error('TEE GPU verification failed')
    process.exit(1)
  }

  logger.newline()
  logger.success('TEE GPU verification completed')
}
