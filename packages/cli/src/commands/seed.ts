/** Seed development environment */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const seedCommand = new Command('seed')
  .description('Seed development environment with test data')
  .addCommand(
    new Command('oauth3')
      .description('Seed OAuth3 registry with app and TEE node')
      .option('--app-id <id>', 'OAuth3 App ID', 'example.oauth3.jeju')
      .option('--network <network>', 'Network: localnet, testnet', 'localnet')
      .action(async (options) => {
        await seedOAuth3(options)
      }),
  )
  .addCommand(
    new Command('app')
      .description('Run app-specific seed script')
      .argument('<name>', 'App name')
      .action(async (appName: string) => {
        await seedApp(appName)
      }),
  )

async function seedOAuth3(options: {
  appId: string
  network: string
}): Promise<void> {
  logger.header('OAUTH3 REGISTRY SEEDING')
  logger.keyValue('App ID', options.appId)
  logger.keyValue('Network', options.network)
  logger.newline()

  if (options.network !== 'localnet' && options.network !== 'testnet') {
    logger.warn('Skipping OAuth3 seeding for mainnet. Use CLI deploy instead.')
    return
  }

  const rootDir = findMonorepoRoot()

  // Check for oauth3 package
  const oauth3Path = join(rootDir, 'packages/auth')
  if (!existsSync(oauth3Path)) {
    logger.error('OAuth3 package not found')
    process.exit(1)
  }

  // Check for existing example seed script or use inline logic
  const exampleSeedPath = join(rootDir, 'apps/example/scripts/seed.ts')
  if (existsSync(exampleSeedPath)) {
    logger.step('Running OAuth3 seed script...')
    const proc = Bun.spawn(['bun', 'run', exampleSeedPath], {
      cwd: join(rootDir, 'apps/example'),
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        OAUTH3_APP_ID: options.appId,
      },
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      logger.error('OAuth3 seeding failed')
      process.exit(1)
    }
    logger.success('OAuth3 registry seeded')
  } else {
    // Inline seeding logic
    await seedOAuth3Inline(options)
  }
}

async function seedOAuth3Inline(options: {
  appId: string
  network: string
}): Promise<void> {
  logger.step('Seeding OAuth3 registry...')

  const frontendPort = process.env.FRONTEND_PORT || '4501'
  const teeAgentPort = process.env.OAUTH3_TEE_AGENT_PORT || '8004'

  const devWallets = {
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    council: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    teeOperator: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  }

  logger.subheader('OAuth3 App Registration')
  logger.keyValue('App ID', options.appId)
  logger.keyValue('Owner', devWallets.deployer)
  logger.keyValue(
    'Redirect URI',
    `http://localhost:${frontendPort}/oauth3/callback`,
  )

  // Try to import and use oauth3 package directly
  const rootDir = findMonorepoRoot()
  const registryPath = join(rootDir, 'packages/auth/dist/index.js')

  if (!existsSync(registryPath)) {
    logger.warn(
      'OAuth3 package not built. Run: jeju build typescript --pkg oauth3',
    )
    logger.warn('Skipping registry seeding')
    return
  }

  logger.info('OAuth3 registry seeding requires app-level scripts.')
  logger.info('Run: bun run --cwd apps/example seed')
  logger.newline()

  logger.subheader('TEE Node')
  logger.keyValue('Endpoint', `http://localhost:${teeAgentPort}`)
  logger.keyValue('Operator', devWallets.teeOperator)
  logger.keyValue('Provider', 'simulated')

  logger.newline()
  logger.success('OAuth3 seeding configuration complete')
  logger.info('Next steps:')
  logger.info(`  1. Start TEE agent: bun run --cwd packages/auth start:agent`)
  logger.info(`  2. Start the app: jeju dev`)
  logger.info(`  3. Visit: http://localhost:${frontendPort}`)
}

async function seedApp(appName: string): Promise<void> {
  logger.header(`SEEDING ${appName.toUpperCase()}`)

  const rootDir = findMonorepoRoot()
  const appPath = join(rootDir, 'apps', appName)

  if (!existsSync(appPath)) {
    logger.error(`App not found: ${appName}`)
    process.exit(1)
  }

  // Look for seed script
  const seedPaths = [
    join(appPath, 'scripts/seed.ts'),
    join(appPath, 'src/scripts/seed.ts'),
  ]

  let seedScript: string | undefined
  for (const p of seedPaths) {
    if (existsSync(p)) {
      seedScript = p
      break
    }
  }

  if (!seedScript) {
    logger.warn(`No seed script found for ${appName}`)
    logger.info('Expected locations:')
    logger.info(`  - apps/${appName}/scripts/seed.ts`)
    return
  }

  logger.step(`Running seed script for ${appName}...`)

  const proc = Bun.spawn(['bun', 'run', seedScript], {
    cwd: appPath,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    logger.error(`Seeding ${appName} failed`)
    process.exit(1)
  }

  logger.success(`${appName} seeded`)
}
