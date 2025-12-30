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
  .description(
    'Validate all deployment configurations (Terraform, Helm, Kurtosis)',
  )
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
  .command('terraform')
  .description('Terraform operations for infrastructure')
  .argument(
    '[command]',
    'Command: init | plan | apply | destroy | output',
    'plan',
  )
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'testnet',
  )
  .action(async (command: string = 'plan', options: { network: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(rootDir, 'packages/deployment/scripts/terraform.ts')

    if (!existsSync(scriptPath)) {
      logger.error('Terraform script not found')
      return
    }

    await execa('bun', ['run', scriptPath, command], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
  })

infraCommand
  .command('helmfile')
  .description('Helmfile operations for Kubernetes deployments')
  .argument(
    '[command]',
    'Command: diff | sync | apply | destroy | status | list',
    'diff',
  )
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'testnet',
  )
  .action(async (command: string = 'diff', options: { network: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(rootDir, 'packages/deployment/scripts/helmfile.ts')

    if (!existsSync(scriptPath)) {
      logger.error('Helmfile script not found')
      return
    }

    await execa('bun', ['run', scriptPath, command], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
  })

infraCommand
  .command('deploy-full')
  .description(
    'Full deployment pipeline (validate, terraform, images, kubernetes, verify)',
  )
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--skip-validate', 'Skip validation step')
  .option('--skip-terraform', 'Skip Terraform step')
  .option('--skip-images', 'Skip Docker image builds')
  .option('--skip-kubernetes', 'Skip Kubernetes deployment')
  .option('--skip-verify', 'Skip verification step')
  .option('--build-sqlit', 'Build SQLit image')
  .action(
    async (options: {
      network: string
      skipValidate?: boolean
      skipTerraform?: boolean
      skipImages?: boolean
      skipKubernetes?: boolean
      skipVerify?: boolean
      buildSQLit?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/deploy-full.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Deploy full script not found')
        return
      }

      const env: Record<string, string> = {
        ...process.env,
        NETWORK: options.network,
      }

      if (options.skipValidate) env.SKIP_VALIDATE = 'true'
      if (options.skipTerraform) env.SKIP_TERRAFORM = 'true'
      if (options.skipImages) env.SKIP_IMAGES = 'true'
      if (options.skipKubernetes) env.SKIP_KUBERNETES = 'true'
      if (options.skipVerify) env.SKIP_VERIFY = 'true'
      if (options.buildSQLit) env.BUILD_SQLIT_IMAGE = 'true'

      await execa('bun', ['run', scriptPath], {
        cwd: rootDir,
        env,
        stdio: 'inherit',
      })
    },
  )

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
  .command('sync-alerts')
  .description('Sync Prometheus alerts to Kubernetes ConfigMap')
  .option('--namespace <ns>', 'Kubernetes namespace')
  .action(async (options: { namespace?: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/monitoring/sync-alerts.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Sync alerts script not found')
      return
    }

    const args = ['run', scriptPath]
    if (options.namespace) args.push('--namespace', options.namespace)

    await execa('bun', args, {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

infraCommand
  .command('sync-dashboards')
  .description('Sync Grafana dashboards to Kubernetes ConfigMap')
  .option('--namespace <ns>', 'Kubernetes namespace')
  .action(async (options: { namespace?: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/monitoring/sync-dashboards.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Sync dashboards script not found')
      return
    }

    const args = ['run', scriptPath]
    if (options.namespace) args.push('--namespace', options.namespace)

    await execa('bun', args, {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

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

infraCommand
  .command('validate-helm')
  .description('Validate Helm charts')
  .option('--chart <chart>', 'Validate specific chart only')
  .action(async (options: { chart?: string }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/tests/scripts/test-helm-charts.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Helm charts validation script not found')
      return
    }

    const args = ['run', scriptPath]
    if (options.chart) args.push('--chart', options.chart)

    await execa('bun', args, {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

export { infraCommand }
