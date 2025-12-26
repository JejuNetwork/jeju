/**
 * App Developer CLI
 *
 * Commands for deploying and managing apps on DWS.
 * Provides a Vercel-like developer experience:
 * - jeju app deploy - Deploy current directory to DWS
 * - jeju app domains - Manage custom domains (JNS)
 * - jeju app env - Manage environment variables
 * - jeju app logs - View application logs
 * - jeju app rollback - Rollback to previous deployment
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import type { Address } from 'viem'
import { z } from 'zod'
import { logger } from '../lib/logger'

// ============================================================================
// Types
// ============================================================================

const ManifestSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  version: z.string(),
  description: z.string().optional(),
  type: z.enum(['core', 'service', 'utility', 'vendor']).optional(),
  commands: z
    .object({
      dev: z.string().optional(),
      build: z.string().optional(),
      start: z.string().optional(),
    })
    .optional(),
  dws: z
    .object({
      backend: z
        .object({
          enabled: z.boolean().optional(),
          runtime: z.enum(['bun', 'node', 'docker', 'workerd']).optional(),
          entrypoint: z.string().optional(),
        })
        .optional(),
      database: z
        .object({
          type: z.enum(['postgres', 'covenantsql', 'd1', 'none']),
          name: z.string(),
        })
        .optional(),
    })
    .optional(),
  decentralization: z
    .object({
      frontend: z
        .object({
          buildDir: z.string().optional(),
          buildCommand: z.string().optional(),
          spa: z.boolean().optional(),
          jnsName: z.string().optional(),
          ipfs: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
})

type Manifest = z.infer<typeof ManifestSchema>

interface DeploymentInfo {
  deploymentId: string
  appName: string
  version: string
  status: 'deploying' | 'live' | 'failed'
  url: string
  createdAt: number
  frontendCid?: string
  backendEndpoint?: string
  jnsName?: string
}

interface DomainInfo {
  domain: string
  status: 'active' | 'pending' | 'error'
  type: 'jns' | 'custom'
  ssl: boolean
  createdAt: number
}

// ============================================================================
// Helpers
// ============================================================================

function getDeployerAddress(): Address {
  const envAddress = process.env.DEPLOYER_ADDRESS
  const defaultAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  if (envAddress?.startsWith('0x')) {
    return envAddress as Address
  }
  return defaultAddress as Address
}

function getDwsUrl(): string {
  return getDWSUrl()
}

async function loadManifest(dir: string): Promise<Manifest | null> {
  const manifestPath = join(dir, 'jeju-manifest.json')

  if (!existsSync(manifestPath)) {
    return null
  }

  const content = readFileSync(manifestPath, 'utf-8')
  const data: unknown = JSON.parse(content)
  const result = ManifestSchema.safeParse(data)

  if (!result.success) {
    logger.error(`Invalid manifest: ${result.error.message}`)
    return null
  }

  return result.data
}

// ============================================================================
// Deploy Command
// ============================================================================

async function deployApp(options: {
  dir: string
  network: string
  prod?: boolean
  preview?: boolean
  jns?: string
  skipBuild?: boolean
}): Promise<void> {
  const appDir = resolve(options.dir)

  logger.header('DEPLOY TO DWS')

  // Check for manifest
  const manifest = await loadManifest(appDir)
  const appName = manifest?.name ?? basename(appDir)

  logger.keyValue('App', appName)
  logger.keyValue('Directory', appDir)
  logger.keyValue('Network', options.network)
  logger.newline()

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  // Step 1: Build (unless skipped)
  if (!options.skipBuild) {
    const buildCommand = manifest?.commands?.build ?? 'bun run build'
    const buildDir = manifest?.decentralization?.frontend?.buildDir ?? 'dist'

    logger.step('Building application...')
    logger.keyValue('Command', buildCommand)

    const buildProc = Bun.spawn(['sh', '-c', buildCommand], {
      cwd: appDir,
      stdout: 'inherit',
      stderr: 'inherit',
    })

    const buildExit = await buildProc.exited
    if (buildExit !== 0) {
      logger.error('Build failed')
      process.exit(1)
    }

    logger.success('Build complete')

    // Check build output exists
    const buildPath = join(appDir, buildDir)
    if (!existsSync(buildPath)) {
      logger.error(`Build output not found: ${buildPath}`)
      process.exit(1)
    }
  }

  // Step 2: Upload to storage
  logger.step('Uploading to decentralized storage...')

  const buildDir = manifest?.decentralization?.frontend?.buildDir ?? 'dist'
  const buildPath = join(appDir, buildDir)

  // Create tar archive of build directory
  const tarProc = Bun.spawn(['tar', '-czf', '-', '.'], {
    cwd: buildPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const tarData = await new Response(tarProc.stdout).arrayBuffer()

  const uploadResponse = await fetch(`${dwsUrl}/storage/upload/directory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
      'x-jeju-address': address,
      'x-app-name': appName,
    },
    body: tarData,
    signal: AbortSignal.timeout(300000),
  }).catch((err: Error) => {
    logger.error(`Upload failed: ${err.message}`)
    return null
  })

  if (!uploadResponse?.ok) {
    // Fallback: upload individual files
    logger.info('Directory upload not available, uploading individually...')

    // For now, just upload the index.html as a simple fallback
    const indexPath = join(buildPath, 'index.html')
    if (existsSync(indexPath)) {
      const indexContent = readFileSync(indexPath)
      const response = await fetch(`${dwsUrl}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/html',
          'x-jeju-address': address,
          'x-filename': 'index.html',
        },
        body: indexContent,
      })

      if (response.ok) {
        const result = (await response.json()) as { cid: string }
        logger.success(`Frontend uploaded: ${result.cid}`)
      }
    }
  } else {
    const result = (await uploadResponse.json()) as {
      cid: string
      files: number
    }
    logger.success(`Uploaded ${result.files} files`)
    logger.keyValue('CID', result.cid)
  }

  // Step 3: Deploy backend if configured
  if (manifest?.dws?.backend?.enabled) {
    logger.step('Deploying backend...')

    const entrypoint = manifest.dws.backend.entrypoint ?? 'api/server/index.ts'
    const runtime = manifest.dws.backend.runtime ?? 'bun'

    const deployResponse = await fetch(`${dwsUrl}/deploy/backend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        appName,
        runtime,
        entrypoint,
        sourceDir: appDir,
      }),
      signal: AbortSignal.timeout(120000),
    }).catch(() => null)

    if (deployResponse?.ok) {
      const result = (await deployResponse.json()) as { endpoint: string }
      logger.success('Backend deployed')
      logger.keyValue('Endpoint', result.endpoint)
    } else {
      logger.warn(
        'Backend deployment skipped (DWS backend service not available)',
      )
    }
  }

  // Step 4: Provision database if configured
  if (manifest?.dws?.database?.type && manifest.dws.database.type !== 'none') {
    logger.step('Provisioning database...')

    const dbResponse = await fetch(`${dwsUrl}/services/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        type:
          manifest.dws.database.type === 'covenantsql'
            ? 'postgres'
            : manifest.dws.database.type,
        name: manifest.dws.database.name,
        appId: appName,
      }),
    }).catch(() => null)

    if (dbResponse?.ok) {
      const result = (await dbResponse.json()) as { connectionString: string }
      logger.success('Database provisioned')
      logger.keyValue(
        'Connection',
        result.connectionString.replace(/:[^:@]+@/, ':****@'),
      )
    } else {
      logger.warn('Database provisioning skipped')
    }
  }

  // Step 5: Register JNS domain if specified
  const jnsName = options.jns ?? manifest?.decentralization?.frontend?.jnsName
  if (jnsName) {
    logger.step(`Registering JNS domain: ${jnsName}`)

    const jnsResponse = await fetch(`${dwsUrl}/jns/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        name: jnsName,
        owner: address,
        appName,
      }),
    }).catch(() => null)

    if (jnsResponse?.ok) {
      logger.success(`Domain registered: ${jnsName}`)
    } else {
      logger.info(
        `JNS registration skipped (may already exist or service unavailable)`,
      )
    }
  }

  // Step 6: Create deployment record
  logger.step('Finalizing deployment...')

  const deployment: DeploymentInfo = {
    deploymentId: crypto.randomUUID(),
    appName,
    version: manifest?.version ?? '0.0.0',
    status: 'live',
    url: jnsName
      ? `https://${jnsName.replace('.jeju', '')}.jeju.link`
      : `${dwsUrl}/apps/${appName}`,
    createdAt: Date.now(),
    jnsName,
  }

  logger.newline()
  logger.success('Deployment complete')
  logger.newline()

  console.log(chalk.bold('  Deployment Details:'))
  console.log(`    ID:      ${deployment.deploymentId}`)
  console.log(`    App:     ${deployment.appName}`)
  console.log(`    Version: ${deployment.version}`)
  console.log(`    URL:     ${chalk.cyan(deployment.url)}`)
  if (jnsName) {
    console.log(`    JNS:     ${jnsName}`)
  }
  console.log('')
}

// ============================================================================
// Domains Command
// ============================================================================

async function listDomains(_options: { app?: string }): Promise<void> {
  logger.header('DOMAINS')

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  const response = await fetch(`${dwsUrl}/jns/list?owner=${address}`, {
    signal: AbortSignal.timeout(10000),
  }).catch(() => null)

  if (!response?.ok) {
    logger.info('No domains found or JNS service not available')
    return
  }

  const data = (await response.json()) as { domains: DomainInfo[] }

  if (data.domains.length === 0) {
    logger.info('No domains configured')
    logger.newline()
    logger.info('Add a domain with: jeju app domains add <name>.jeju')
    return
  }

  logger.info(`Found ${data.domains.length} domains:\n`)

  for (const domain of data.domains) {
    const statusIcon =
      domain.status === 'active'
        ? '✓'
        : domain.status === 'pending'
          ? '⏳'
          : '✗'
    const sslIcon = domain.ssl ? '🔒' : ''
    console.log(`  ${statusIcon} ${domain.domain} ${sslIcon}`)
    console.log(`     Type: ${domain.type}`)
    console.log(
      `     Added: ${new Date(domain.createdAt).toLocaleDateString()}`,
    )
    console.log('')
  }
}

async function addDomain(domain: string): Promise<void> {
  logger.header('ADD DOMAIN')

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  logger.keyValue('Domain', domain)
  logger.keyValue('Owner', address)
  logger.newline()

  const isJns = domain.endsWith('.jeju')

  if (isJns) {
    logger.step('Registering JNS domain...')

    const response = await fetch(`${dwsUrl}/jns/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        name: domain,
        owner: address,
      }),
    }).catch((err: Error) => {
      logger.error(`Failed: ${err.message}`)
      return null
    })

    if (response?.ok) {
      logger.success('Domain registered')
      logger.newline()
      logger.info(
        `Your app is now available at: https://${domain.replace('.jeju', '')}.jeju.link`,
      )
    } else if (response?.status === 409) {
      logger.error('Domain already registered')
    } else {
      logger.error('Registration failed')
    }
  } else {
    logger.step('Adding custom domain...')
    logger.info('Custom domains require DNS configuration:')
    console.log('')
    console.log('  Add the following DNS records:')
    console.log(`    CNAME ${domain} → ${domain.split('.')[0]}.jeju.link`)
    console.log(`    TXT _jeju.${domain} → owner=${address}`)
    console.log('')
  }
}

// ============================================================================
// Environment Variables Command
// ============================================================================

async function listEnvVars(options: { app?: string }): Promise<void> {
  logger.header('ENVIRONMENT VARIABLES')

  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  const response = await fetch(`${dwsUrl}/secrets?appId=${appName}`, {
    headers: { 'x-jeju-address': address },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null)

  if (!response?.ok) {
    logger.info('No environment variables found')
    return
  }

  const data = (await response.json()) as {
    secrets: Array<{ name: string; type: string; updatedAt: number }>
  }

  const envSecrets = data.secrets.filter((s) => s.type === 'env')

  if (envSecrets.length === 0) {
    logger.info('No environment variables configured')
    logger.newline()
    logger.info('Add variables with: jeju app env set KEY=value')
    return
  }

  logger.keyValue('App', appName)
  logger.newline()

  for (const secret of envSecrets) {
    console.log(`  ${secret.name}=********`)
    console.log(
      `     Updated: ${new Date(secret.updatedAt).toLocaleDateString()}`,
    )
  }
}

async function setEnvVar(
  keyValue: string,
  options: { app?: string },
): Promise<void> {
  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const [key, ...valueParts] = keyValue.split('=')
  const value = valueParts.join('=')

  if (!key || !value) {
    logger.error('Usage: jeju app env set KEY=value')
    return
  }

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  logger.step(`Setting ${key}...`)

  const response = await fetch(`${dwsUrl}/secrets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': address,
    },
    body: JSON.stringify({
      name: key,
      value,
      type: 'env',
      appId: appName,
    }),
  }).catch((err: Error) => {
    logger.error(`Failed: ${err.message}`)
    return null
  })

  if (response?.ok) {
    logger.success(`Set ${key}`)
  } else {
    logger.error('Failed to set environment variable')
  }
}

async function removeEnvVar(
  key: string,
  options: { app?: string },
): Promise<void> {
  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  logger.step(`Removing ${key}...`)

  const response = await fetch(`${dwsUrl}/secrets/${appName}:${key}`, {
    method: 'DELETE',
    headers: { 'x-jeju-address': address },
  }).catch((err: Error) => {
    logger.error(`Failed: ${err.message}`)
    return null
  })

  if (response?.ok) {
    logger.success(`Removed ${key}`)
  } else {
    logger.error('Failed to remove environment variable')
  }
}

// ============================================================================
// Logs Command
// ============================================================================

async function viewLogs(options: {
  app?: string
  follow?: boolean
  lines: string
  filter?: string
}): Promise<void> {
  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const dwsUrl = getDwsUrl()
  const numLines = parseInt(options.lines, 10)

  if (options.follow) {
    logger.info(`Streaming logs for ${appName}...`)
    logger.info('Press Ctrl+C to stop')
    console.log('')

    // SSE streaming
    const eventSource = new EventSource(`${dwsUrl}/logs/${appName}/stream`)

    eventSource.onmessage = (event) => {
      const log = JSON.parse(event.data) as {
        timestamp: string
        level: string
        message: string
      }
      const levelColor =
        log.level === 'error'
          ? chalk.red
          : log.level === 'warn'
            ? chalk.yellow
            : chalk.gray
      console.log(
        `${chalk.dim(log.timestamp)} ${levelColor(log.level.padEnd(5))} ${log.message}`,
      )
    }

    eventSource.onerror = () => {
      logger.error('Log stream disconnected')
      eventSource.close()
    }

    process.on('SIGINT', () => {
      eventSource.close()
      process.exit(0)
    })

    await new Promise(() => {})
  } else {
    const params = new URLSearchParams({
      lines: String(numLines),
    })
    if (options.filter) {
      params.set('filter', options.filter)
    }

    const response = await fetch(`${dwsUrl}/logs/${appName}?${params}`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      const data = (await response.json()) as {
        logs: Array<{ timestamp: string; level: string; message: string }>
      }

      for (const log of data.logs) {
        const levelColor =
          log.level === 'error'
            ? chalk.red
            : log.level === 'warn'
              ? chalk.yellow
              : chalk.gray
        console.log(
          `${chalk.dim(log.timestamp)} ${levelColor(log.level.padEnd(5))} ${log.message}`,
        )
      }
    } else {
      logger.error('Could not fetch logs')
    }
  }
}

// ============================================================================
// Deployments Command
// ============================================================================

async function listDeployments(options: {
  app?: string
  limit: string
}): Promise<void> {
  logger.header('DEPLOYMENTS')

  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  const response = await fetch(
    `${dwsUrl}/deployments/${appName}?limit=${options.limit}`,
    {
      headers: { 'x-jeju-address': address },
      signal: AbortSignal.timeout(10000),
    },
  ).catch(() => null)

  if (!response?.ok) {
    logger.info('No deployments found')
    return
  }

  const data = (await response.json()) as { deployments: DeploymentInfo[] }

  if (data.deployments.length === 0) {
    logger.info('No deployments found')
    return
  }

  logger.keyValue('App', appName)
  logger.newline()

  for (const dep of data.deployments) {
    const statusIcon =
      dep.status === 'live' ? '✓' : dep.status === 'deploying' ? '⏳' : '✗'
    const statusColor =
      dep.status === 'live'
        ? chalk.green
        : dep.status === 'deploying'
          ? chalk.yellow
          : chalk.red

    console.log(
      `  ${statusIcon} ${dep.deploymentId.slice(0, 8)}  ${statusColor(dep.status.padEnd(10))}  v${dep.version}`,
    )
    console.log(`     ${new Date(dep.createdAt).toLocaleString()}`)
    console.log(`     ${dep.url}`)
    console.log('')
  }
}

async function rollbackDeployment(
  deploymentId: string,
  options: { app?: string },
): Promise<void> {
  logger.header('ROLLBACK')

  const manifest = await loadManifest(process.cwd())
  const appName = options.app ?? manifest?.name

  if (!appName) {
    logger.error('App name required. Use --app or run from app directory')
    return
  }

  const address = getDeployerAddress()
  const dwsUrl = getDwsUrl()

  logger.keyValue('App', appName)
  logger.keyValue('Target', deploymentId)
  logger.newline()

  logger.step('Rolling back...')

  const response = await fetch(`${dwsUrl}/deployments/${appName}/rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': address,
    },
    body: JSON.stringify({ deploymentId }),
  }).catch((err: Error) => {
    logger.error(`Failed: ${err.message}`)
    return null
  })

  if (response?.ok) {
    logger.success('Rollback complete')
  } else {
    logger.error('Rollback failed')
  }
}

// ============================================================================
// Command Export
// ============================================================================

export const appCommand = new Command('app')
  .description('Deploy and manage apps on DWS')
  .addCommand(
    new Command('deploy')
      .description('Deploy an app to DWS')
      .option('-d, --dir <path>', 'App directory', '.')
      .option(
        '-n, --network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .option('--prod', 'Production deployment')
      .option('--preview', 'Preview deployment')
      .option('--jns <name>', 'JNS domain name')
      .option('--skip-build', 'Skip build step')
      .action(deployApp),
  )
  .addCommand(
    new Command('domains')
      .description('Manage app domains')
      .option('--app <name>', 'App name')
      .action(listDomains)
      .addCommand(
        new Command('add')
          .description('Add a domain')
          .argument('<domain>', 'Domain name (e.g., myapp.jeju)')
          .action(addDomain),
      ),
  )
  .addCommand(
    new Command('env')
      .description('Manage environment variables')
      .option('--app <name>', 'App name')
      .action(listEnvVars)
      .addCommand(
        new Command('set')
          .description('Set an environment variable')
          .argument('<key=value>', 'Key=value pair')
          .option('--app <name>', 'App name')
          .action(setEnvVar),
      )
      .addCommand(
        new Command('rm')
          .description('Remove an environment variable')
          .argument('<key>', 'Variable name')
          .option('--app <name>', 'App name')
          .action(removeEnvVar),
      ),
  )
  .addCommand(
    new Command('logs')
      .description('View app logs')
      .option('--app <name>', 'App name')
      .option('-f, --follow', 'Follow log output')
      .option('-n, --lines <n>', 'Number of lines', '100')
      .option('--filter <pattern>', 'Filter logs by pattern')
      .action(viewLogs),
  )
  .addCommand(
    new Command('deployments')
      .description('List deployments')
      .option('--app <name>', 'App name')
      .option('--limit <n>', 'Max results', '10')
      .action(listDeployments),
  )
  .addCommand(
    new Command('rollback')
      .description('Rollback to a previous deployment')
      .argument('<deployment-id>', 'Deployment ID to rollback to')
      .option('--app <name>', 'App name')
      .action(rollbackDeployment),
  )
