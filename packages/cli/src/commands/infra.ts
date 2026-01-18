/** Infrastructure deployment and management commands */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { createInfrastructureService } from '../services/infrastructure'

const infraCommand = new Command('infra')
  .description('Infrastructure deployment and management')
  .alias('infrastructure')

infraCommand
  .command('start')
  .description(
    'Start all local development infrastructure (Docker, services, localnet)',
  )
  .option('--no-localnet', 'Skip starting localnet')
  .action(async (_options: { localnet?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const infra = createInfrastructureService(rootDir)

    const success = await infra.ensureRunning()

    if (!success) {
      process.exit(1)
    }

    logger.newline()
    logger.info('Infrastructure URLs:')
    const env = infra.getEnvVars()
    for (const [key, value] of Object.entries(env)) {
      if (key.includes('URL') || key.includes('RPC')) {
        logger.keyValue(key, value)
      }
    }
  })

infraCommand
  .command('stop')
  .description('Stop all local development infrastructure')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const infra = createInfrastructureService(rootDir)

    logger.header('STOPPING INFRASTRUCTURE')

    await infra.stopLocalnet()
    await infra.stopServices()

    logger.success('All infrastructure stopped')
  })

infraCommand
  .command('status')
  .description('Show infrastructure status')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const infra = createInfrastructureService(rootDir)

    const status = await infra.getStatus()
    infra.printStatus(status)

    if (status.allHealthy) {
      logger.newline()
      logger.success('All infrastructure healthy')
    } else {
      logger.newline()
      logger.error('Some infrastructure is not running')
      logger.info('  Run: jeju infra start')
    }
  })

infraCommand
  .command('restart')
  .description('Restart all local development infrastructure')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const infra = createInfrastructureService(rootDir)

    logger.header('RESTARTING INFRASTRUCTURE')

    await infra.stopLocalnet()
    await infra.stopServices()

    await new Promise((r) => setTimeout(r, 2000))

    const success = await infra.ensureRunning()

    if (!success) {
      process.exit(1)
    }
  })

infraCommand
  .command('logs')
  .description('Show logs from Docker services')
  .option('-f, --follow', 'Follow log output')
  .option('--service <name>', 'Specific service (sqlit, ipfs, cache, da)')
  .action(async (options: { follow?: boolean; service?: string }) => {
    const rootDir = findMonorepoRoot()

    const args = ['compose', 'logs']
    if (options.follow) args.push('-f')
    if (options.service) {
      const serviceMap: Record<string, string> = {
        sqlit: 'sqlit',
        ipfs: 'ipfs',
        cache: 'cache-service',
        da: 'da-server',
      }
      const serviceName = serviceMap[options.service] || options.service
      args.push(serviceName)
    }

    await execa('docker', args, {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

infraCommand
  .command('indexer')
  .description('Start the blockchain indexer')
  .option('--db-only', 'Only start the database')
  .option('--rebuild', 'Rebuild from scratch (drop database)')
  .option('--port <port>', 'GraphQL API port', '4350')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const indexerPath = join(rootDir, 'apps/indexer')

    if (!existsSync(indexerPath)) {
      logger.error('Indexer app not found')
      return
    }

    logger.header('INDEXER')

    // Start database if needed
    await execa('bun', ['run', 'db:up'], {
      cwd: indexerPath,
      stdio: 'inherit',
    }).catch(() => {
      logger.warn('Database may already be running')
    })

    if (options.dbOnly) {
      logger.success('Database started')
      return
    }

    if (options.rebuild) {
      await execa('bun', ['run', 'db:drop'], {
        cwd: indexerPath,
        stdio: 'inherit',
      }).catch(() => {})
      await execa('bun', ['run', 'db:create'], {
        cwd: indexerPath,
        stdio: 'inherit',
      })
    }

    logger.step('Running migrations...')
    await execa('bun', ['run', 'db:migrate'], {
      cwd: indexerPath,
      stdio: 'inherit',
    })

    logger.step('Starting indexer...')
    logger.keyValue('GraphQL API', `http://localhost:${options.port}/graphql`)
    logger.newline()

    await execa('bun', ['run', 'dev'], {
      cwd: indexerPath,
      stdio: 'inherit',
      env: {
        ...process.env,
        GQL_PORT: options.port,
      },
    })
  })

infraCommand
  .command('validate')
  .description('Validate all deployment configurations (Helm, Kurtosis)')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(rootDir, 'packages/deployment/scripts/validate.ts')

    if (!existsSync(scriptPath)) {
      logger.error('Validation script not found')
      return
    }

    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

infraCommand
  .command('genesis')
  .description('Generate L2 genesis files using op-node')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options: { network: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/l2-genesis.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('L2 genesis script not found')
      return
    }

    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
  })

infraCommand
  .command('build-images')
  .description('Build Docker images for all apps')
  .option('--push', 'Push images to registry')
  .option('--network <network>', 'Network: localnet | testnet | mainnet')
  .option('--app <app>', 'Build specific app only')
  .action(
    async (options: { push?: boolean; network?: string; app?: string }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/build-images.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Build images script not found')
        return
      }

      const args = ['run', scriptPath]
      if (options.push) args.push('--push')
      if (options.network) args.push('--network', options.network)
      if (options.app) args.push('--app', options.app)

      await execa('bun', args, {
        cwd: rootDir,
        stdio: 'inherit',
      })
    },
  )

infraCommand
  .command('build-sqlit')
  .description('Build multi-arch SQLit Docker image')
  .option('--push', 'Push image to registry')
  .option('--arm-only', 'Build ARM64 only')
  .option('--x86-only', 'Build x86_64 only')
  .action(
    async (options: {
      push?: boolean
      armOnly?: boolean
      x86Only?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/build-sqlit.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Build SQLit script not found')
        return
      }

      const args = ['run', scriptPath]
      if (options.push) args.push('--push')
      if (options.armOnly) args.push('--arm-only')
      if (options.x86Only) args.push('--x86-only')

      await execa('bun', args, {
        cwd: rootDir,
        stdio: 'inherit',
      })
    },
  )

infraCommand
  .command('auto-update')
  .description('Start auto-update daemon for node management')
  .option('--network <network>', 'Network: localnet | testnet | mainnet')
  .action(async (options: { network?: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/infrastructure/update-manager.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Auto-update manager script not found')
      return
    }

    const args = ['run', scriptPath]
    if (options.network) args.push('--network', options.network)

    await execa('bun', args, {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

// ============================================================================
// DWS Services Commands
// ============================================================================

const dwsServicesCommand = new Command('dws-services').description(
  'Deploy and manage DWS-native services (OAuth3, DA, Email, Hubble, Workers)',
)

dwsServicesCommand
  .command('bootstrap')
  .description('Bootstrap all DWS services for testnet')
  .option('--dry-run', 'Print what would be deployed without deploying')
  .action(async (options: { dryRun?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/dws/bootstrap-testnet.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('DWS bootstrap script not found')
      return
    }

    if (options.dryRun) {
      logger.info('Dry run mode - would deploy the following services:')
      logger.info('  - OAuth3 (2-of-3 MPC)')
      logger.info('  - Data Availability (IPFS-backed)')
      logger.info('  - Email Service')
      logger.info('  - Farcaster Hubble')
      logger.info('  - x402 Facilitator')
      logger.info('  - RPC Gateway')
      logger.info('  - SQLit Adapter')
      return
    }

    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

dwsServicesCommand
  .command('deploy')
  .description('Deploy a specific DWS service')
  .argument(
    '<service>',
    'Service to deploy (oauth3, da, email, hubble, messaging, sqlit, x402, rpc-gateway, sqlit-adapter)',
  )
  .option('--replicas <n>', 'Number of replicas', '2')
  .option('--name <name>', 'Service name')
  .action(
    async (service: string, options: { replicas: string; name?: string }) => {
      const { getDWSUrl, getCurrentNetwork } = await import(
        '@jejunetwork/config'
      )
      const network = getCurrentNetwork()
      const dwsUrl = getDWSUrl(network)

      if (!dwsUrl) {
        logger.error('DWS URL not configured for this network')
        return
      }

      const deployerAddress = process.env.DEPLOYER_ADDRESS
      if (!deployerAddress) {
        logger.error('DEPLOYER_ADDRESS environment variable required')
        return
      }

      const serviceName = options.name ?? `jeju-${service}`
      const replicas = parseInt(options.replicas, 10)

      logger.info(`Deploying ${service} via DWS...`)
      logger.info(`  Name: ${serviceName}`)
      logger.info(`  Replicas: ${replicas}`)
      logger.info(`  DWS URL: ${dwsUrl}`)

      const serviceTypeMap: Record<string, string> = {
        oauth3: 'oauth3',
        da: 'da',
        email: 'email',
        hubble: 'hubble',
        messaging: 'messaging',
        sqlit: 'sqlit',
        x402: 'workers',
        'x402-facilitator': 'workers',
        'rpc-gateway': 'workers',
        'sqlit-adapter': 'workers',
      }

      const endpoint = serviceTypeMap[service]
      if (!endpoint) {
        logger.error(`Unknown service: ${service}`)
        logger.info(
          'Valid services: oauth3, da, email, hubble, messaging, sqlit, x402, rpc-gateway, sqlit-adapter',
        )
        return
      }

      const body: Record<string, unknown> = {
        name: serviceName,
        replicas,
      }

      // Add type for workers
      if (endpoint === 'workers') {
        body.type = service === 'x402' ? 'x402-facilitator' : service
      }

      const response = await fetch(`${dwsUrl}/dws-services/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': deployerAddress,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.text()
        logger.error(`Failed to deploy ${service}: ${error}`)
        return
      }

      const result = (await response.json()) as {
        service: { id: string; status: string; endpoints: string[] }
      }
      logger.success(`${service} deployed successfully`)
      logger.info(`  ID: ${result.service.id}`)
      logger.info(`  Status: ${result.service.status}`)
      if (result.service.endpoints?.length > 0) {
        logger.info(`  Endpoints: ${result.service.endpoints.join(', ')}`)
      }
    },
  )

dwsServicesCommand
  .command('list')
  .description('List all deployed DWS services')
  .option('--type <type>', 'Filter by service type')
  .action(async (options: { type?: string }) => {
    const { getDWSUrl, getCurrentNetwork } = await import('@jejunetwork/config')
    const network = getCurrentNetwork()
    const dwsUrl = getDWSUrl(network)

    if (!dwsUrl) {
      logger.error('DWS URL not configured for this network')
      return
    }

    const endpoints = ['oauth3', 'da', 'email', 'hubble', 'workers']
    const filteredEndpoints = options.type ? [options.type] : endpoints

    logger.info('DWS Services:')
    logger.info('')

    for (const endpoint of filteredEndpoints) {
      const response = await fetch(`${dwsUrl}/dws-services/${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) continue

      const result = (await response.json()) as {
        services: Array<{ id: string; name: string; status: string }>
      }
      if (result.services?.length > 0) {
        logger.info(`${endpoint.toUpperCase()}:`)
        for (const svc of result.services) {
          logger.info(`  - ${svc.name} (${svc.id}) [${svc.status}]`)
        }
        logger.info('')
      }
    }
  })

dwsServicesCommand
  .command('terminate')
  .description('Terminate a DWS service')
  .argument('<id>', 'Service ID to terminate')
  .argument(
    '<type>',
    'Service type (oauth3, da, email, hubble, messaging, sqlit, workers)',
  )
  .action(async (id: string, type: string) => {
    const { getDWSUrl, getCurrentNetwork } = await import('@jejunetwork/config')
    const network = getCurrentNetwork()
    const dwsUrl = getDWSUrl(network)

    if (!dwsUrl) {
      logger.error('DWS URL not configured for this network')
      return
    }

    const deployerAddress = process.env.DEPLOYER_ADDRESS
    if (!deployerAddress) {
      logger.error('DEPLOYER_ADDRESS environment variable required')
      return
    }

    logger.info(`Terminating service ${id}...`)

    const response = await fetch(`${dwsUrl}/dws-services/${type}/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': deployerAddress,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error(`Failed to terminate service: ${error}`)
      return
    }

    logger.success(`Service ${id} terminated`)
  })

infraCommand.addCommand(dwsServicesCommand)

export { infraCommand }
