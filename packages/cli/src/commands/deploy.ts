/** Deploy to testnet/mainnet */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl } from '@jejunetwork/config'
import { Command } from 'commander'
import { execa } from 'execa'
import prompts from 'prompts'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { checkRpcHealth, getAccountBalance } from '../lib/chain'
import { hasKeys, resolvePrivateKey } from '../lib/keys'
import { logger } from '../lib/logger'
import {
  checkDocker,
  checkFoundry,
  findMonorepoRoot,
  getNetworkDir,
} from '../lib/system'
import { discoverApps } from '../lib/testing'
import { CHAIN_CONFIG, type NetworkType } from '../types'
import { keysCommand } from './keys'

const DeployConfigSchema = z.object({
  network: z.enum(['localnet', 'testnet', 'mainnet']),
  lastDeployed: z.string().optional(),
  deployerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  contracts: z.boolean().optional(),
  infrastructure: z.boolean().optional(),
  apps: z.boolean().optional(),
})

const ContractsDeploymentSchema = z.record(
  z.string(),
  z.string().or(
    z.object({
      address: z.string(),
      deployedAt: z.number().optional(),
      txHash: z.string().optional(),
    }),
  ),
)

interface DeployConfig {
  network: NetworkType
  lastDeployed?: string
  deployerAddress?: string
  contracts?: boolean
  infrastructure?: boolean
  apps?: boolean
}

interface DeployScriptOptions {
  network?: string
  safe?: string
  oracleType?: string
  all?: boolean
  verify?: boolean
  deploy?: boolean
  configure?: boolean
  skipKeys?: boolean
  skipL1?: boolean
  contractsOnly?: boolean
  evmOnly?: boolean
  solanaOnly?: boolean
  dryRun?: boolean
  sp1?: boolean
  phala?: boolean
  name?: string
  backup?: string
  app?: string
  dir?: string
  jns?: string
}

function getConfigPath(): string {
  return join(getNetworkDir(), 'deploy-config.json')
}

function loadConfig(): DeployConfig | undefined {
  const path = getConfigPath()
  if (!existsSync(path)) return undefined
  try {
    const rawData = JSON.parse(readFileSync(path, 'utf-8'))
    const result = DeployConfigSchema.safeParse(rawData)
    if (!result.success) {
      logger.warn(`Invalid deploy config format: ${result.error.message}`)
      return undefined
    }
    return result.data
  } catch {
    return undefined
  }
}

function saveConfig(config: DeployConfig): void {
  const dir = getNetworkDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2))
}

export const deployCommand = new Command('deploy')
  .description('Deploy to testnet or mainnet')
  .argument('[network]', 'testnet | mainnet')
  .option('--contracts', 'Deploy only contracts')
  .option('--infrastructure', 'Deploy only infrastructure')
  .option('--apps', 'Deploy only apps')
  .option('--dry-run', 'Simulate without making changes')
  .option('-y, --yes', 'Skip confirmations')
  .action(async (networkArg, options) => {
    const savedConfig = loadConfig()
    const isDryRun = options.dryRun === true

    // Determine network
    let network: NetworkType
    if (networkArg) {
      network = networkArg as NetworkType
    } else if (savedConfig?.network && savedConfig.network !== 'localnet') {
      const { useLastNetwork } = await prompts({
        type: 'confirm',
        name: 'useLastNetwork',
        message: `Deploy to ${savedConfig.network} again?`,
        initial: true,
      })

      if (useLastNetwork) {
        network = savedConfig.network
      } else {
        const { selectedNetwork } = await prompts({
          type: 'select',
          name: 'selectedNetwork',
          message: 'Select network:',
          choices: [
            { title: 'Testnet', value: 'testnet' },
            { title: 'Mainnet', value: 'mainnet' },
          ],
        })
        if (!selectedNetwork) return
        network = selectedNetwork
      }
    } else {
      const { selectedNetwork } = await prompts({
        type: 'select',
        name: 'selectedNetwork',
        message: 'Select network:',
        choices: [
          { title: 'Testnet', value: 'testnet' },
          { title: 'Mainnet', value: 'mainnet' },
        ],
      })
      if (!selectedNetwork) return
      network = selectedNetwork
    }

    if (network === 'localnet') {
      logger.error('Use `jeju dev` for localnet')
      return
    }

    logger.header(`DEPLOY TO ${network.toUpperCase()}`)

    if (isDryRun) {
      logger.warn('DRY RUN - simulating deployment')
    }

    // Check keys
    let account: ReturnType<typeof privateKeyToAccount> | undefined
    let balance = '0'

    if (!hasKeys(network)) {
      if (isDryRun) {
        logger.warn('Keys not configured (would prompt in real deploy)')
      } else {
        logger.warn(`No keys configured for ${network}`)

        const { generateKeys } = await prompts({
          type: 'confirm',
          name: 'generateKeys',
          message: 'Generate keys now?',
          initial: true,
        })

        if (generateKeys) {
          await keysCommand.parseAsync(['genesis', '-n', network], {
            from: 'user',
          })

          if (!hasKeys(network)) {
            logger.error('Key generation cancelled or failed')
            return
          }
        } else {
          logger.info(`Run: jeju keys genesis -n ${network}`)
          return
        }
      }
    }

    // Get wallet info if keys exist
    if (hasKeys(network)) {
      logger.success('Keys configured')

      try {
        const privateKey = resolvePrivateKey(network)
        account = privateKeyToAccount(privateKey as `0x${string}`)
        const chainConfig = CHAIN_CONFIG[network]

        try {
          balance = await getAccountBalance(chainConfig.rpcUrl, account.address)
          const balanceNum = parseFloat(balance)

          if (balanceNum < 0.1) {
            if (isDryRun) {
              logger.warn(
                `Low balance: ${balance} ETH (would fail in real deploy)`,
              )
            } else {
              logger.error(`Insufficient balance: ${balance} ETH`)
              logger.newline()
              logger.info('Fund the deployer with at least 0.1 ETH:')
              logger.keyValue('Address', account.address)
              logger.keyValue(
                'Network',
                network === 'testnet' ? 'Base Sepolia' : 'Base',
              )

              if (network === 'testnet') {
                logger.newline()
                logger.info('Get testnet ETH from:')
                logger.info('  https://www.alchemy.com/faucets/base-sepolia')
              }
              return
            }
          } else {
            logger.success(
              `Deployer funded: ${parseFloat(balance).toFixed(4)} ETH`,
            )
          }
        } catch {
          if (isDryRun) {
            logger.warn(
              `Cannot connect to ${network} RPC (would fail in real deploy)`,
            )
          } else {
            logger.error(
              `Cannot connect to ${network} RPC: ${chainConfig.rpcUrl}`,
            )
            return
          }
        }
      } catch {
        if (!isDryRun) {
          logger.error('Could not resolve deployer key')
          return
        }
      }
    }

    // Determine what to deploy
    let deployContracts = options.contracts
    let deployInfra = options.infrastructure
    let deployApps = options.apps

    if (!deployContracts && !deployInfra && !deployApps) {
      if (isDryRun) {
        // Default to all in dry-run
        deployContracts = true
        deployInfra = true
        deployApps = true
      } else {
        const { deployChoice } = await prompts({
          type: 'select',
          name: 'deployChoice',
          message: 'What to deploy?',
          choices: [
            { title: 'Everything (contracts + infra + apps)', value: 'all' },
            { title: 'Contracts only', value: 'contracts' },
            { title: 'Infrastructure only', value: 'infrastructure' },
            { title: 'Apps only', value: 'apps' },
          ],
        })

        if (!deployChoice) return

        if (deployChoice === 'all') {
          deployContracts = true
          deployInfra = true
          deployApps = true
        } else {
          deployContracts = deployChoice === 'contracts'
          deployInfra = deployChoice === 'infrastructure'
          deployApps = deployChoice === 'apps'
        }
      }
    }

    // Check dependencies
    if (deployContracts && !isDryRun) {
      const foundryResult = await checkFoundry()
      if (foundryResult.status !== 'ok') {
        logger.error('Foundry required for contracts')
        logger.info('Install: curl -L https://foundry.paradigm.xyz | bash')
        return
      }
      logger.success('Foundry available')
    }

    if (deployInfra && !isDryRun) {
      const dockerResult = await checkDocker()
      if (dockerResult.status !== 'ok') {
        logger.error('Docker required for infrastructure')
        return
      }
      logger.success('Docker available')
    }

    // Confirmation
    if (!options.yes && !isDryRun) {
      logger.newline()
      logger.subheader('Deployment Plan')
      logger.keyValue('Network', network)
      if (account) {
        logger.keyValue('Deployer', account.address)
        logger.keyValue('Balance', `${parseFloat(balance).toFixed(4)} ETH`)
      }
      logger.keyValue('Contracts', deployContracts ? 'Yes' : 'No')
      logger.keyValue('Infrastructure', deployInfra ? 'Yes' : 'No')
      logger.keyValue('Apps', deployApps ? 'Yes' : 'No')
      logger.newline()

      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: `Deploy to ${network}?`,
        initial: false,
      })

      if (!proceed) {
        logger.info('Cancelled')
        return
      }
    }

    const rootDir = findMonorepoRoot()

    // Deploy
    if (deployContracts) {
      await runDeployContracts(rootDir, network, isDryRun)
    }

    if (deployInfra) {
      await runDeployInfra(rootDir, network, isDryRun)
    }

    if (deployApps) {
      await runDeployApps(rootDir, network, isDryRun)
    }

    // Save config
    if (account) {
      saveConfig({
        network,
        lastDeployed: new Date().toISOString(),
        deployerAddress: account.address,
        contracts: deployContracts,
        infrastructure: deployInfra,
        apps: deployApps,
      })
    }

    // Summary
    logger.newline()
    logger.header('DONE')

    if (network === 'testnet') {
      logger.keyValue('RPC', 'https://testnet-rpc.jejunetwork.org')
      logger.keyValue('Explorer', 'https://explorer.testnet.jejunetwork.org')
    } else {
      logger.keyValue('RPC', 'https://rpc.jejunetwork.org')
      logger.keyValue('Explorer', 'https://explorer.jejunetwork.org')
    }
  })

async function runDeployContracts(
  rootDir: string,
  network: NetworkType,
  dryRun: boolean,
): Promise<void> {
  logger.subheader('Contracts')

  const contractsDir = join(rootDir, 'packages/contracts')
  if (!existsSync(contractsDir)) {
    logger.warn('packages/contracts not found')
    return
  }

  logger.step('Building...')
  if (!dryRun) {
    try {
      await execa('forge', ['build'], { cwd: contractsDir, stdio: 'pipe' })
    } catch {
      logger.error('Build failed')
      return
    }
  }
  logger.success('Built')

  const deployScript = join(rootDir, `scripts/deploy/${network}.ts`)
  if (existsSync(deployScript)) {
    logger.step('Deploying...')
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env, NETWORK: network },
      })
    }
    logger.success('Deployed')
  } else {
    const forgeScript = join(contractsDir, 'script/Deploy.s.sol')
    if (existsSync(forgeScript)) {
      logger.step('Deploying via Forge...')
      if (!dryRun) {
        const rpcUrl = CHAIN_CONFIG[network].rpcUrl
        await execa(
          'forge',
          ['script', 'script/Deploy.s.sol', '--rpc-url', rpcUrl, '--broadcast'],
          {
            cwd: contractsDir,
            stdio: 'inherit',
          },
        )
      }
      logger.success('Deployed')
    } else {
      logger.warn('No deploy script found')
    }
  }
}

async function runDeployInfra(
  rootDir: string,
  network: NetworkType,
  dryRun: boolean,
): Promise<void> {
  logger.subheader('Infrastructure')

  const deploymentDir = join(rootDir, 'packages/deployment')
  if (!existsSync(deploymentDir)) {
    logger.warn('packages/deployment not found')
    return
  }

  const deployScript = join(deploymentDir, 'scripts/deploy-full.ts')
  if (existsSync(deployScript)) {
    logger.step('Deploying...')
    if (!dryRun) {
      await execa('bun', ['run', deployScript], {
        cwd: deploymentDir,
        stdio: 'inherit',
        env: { ...process.env, NETWORK: network },
      })
    }
    logger.success('Deployed')
  } else {
    logger.warn('No deploy script found')
  }
}

async function runDeployApps(
  rootDir: string,
  network: NetworkType,
  dryRun: boolean,
): Promise<void> {
  logger.subheader('Apps')

  logger.step('Building...')
  if (!dryRun) {
    await execa('bun', ['run', 'build'], {
      cwd: rootDir,
      stdio: 'pipe',
      reject: false,
    })
  }
  logger.success('Built')

  const k8sDir = join(rootDir, 'packages/deployment/kubernetes')
  const helmfilePath = join(k8sDir, 'helmfile.yaml')

  if (existsSync(helmfilePath)) {
    logger.step('Deploying to Kubernetes...')
    if (!dryRun) {
      await execa('helmfile', ['sync'], {
        cwd: k8sDir,
        stdio: 'inherit',
        env: { ...process.env, ENVIRONMENT: network },
      })
    }
    logger.success('Deployed')
  } else {
    logger.warn('No Kubernetes manifests found')
  }
}

deployCommand
  .command('preflight')
  .description('Pre-deployment checklist (keys, balance, dependencies)')
  .argument('[network]', 'Network: testnet | mainnet', 'testnet')
  .action(async (networkArg) => {
    const network = networkArg as NetworkType

    if (network === 'localnet') {
      logger.info('For localnet, use: jeju dev')
      return
    }

    logger.header(`PREFLIGHT CHECK: ${network.toUpperCase()}`)
    logger.newline()

    let allOk = true

    // 1. Check keys
    logger.subheader('1. Keys')
    if (hasKeys(network)) {
      const privateKey = resolvePrivateKey(network)
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      logger.table([
        {
          label: 'Deployer Key',
          value: `${account.address.slice(0, 20)}...`,
          status: 'ok',
        },
      ])
    } else {
      logger.table([
        {
          label: 'Deployer Key',
          value: 'Not configured',
          status: 'error',
        },
      ])
      logger.info(`  Fix: jeju keys genesis -n ${network}`)
      allOk = false
    }

    // 2. Check balance
    logger.newline()
    logger.subheader('2. Balance')
    if (hasKeys(network)) {
      const privateKey = resolvePrivateKey(network)
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      const config = CHAIN_CONFIG[network]

      try {
        const balance = await getAccountBalance(config.rpcUrl, account.address)
        const balanceNum = parseFloat(balance)
        const minBalance = 0.1

        logger.table([
          {
            label: 'ETH Balance',
            value: `${balanceNum.toFixed(4)} ETH`,
            status: balanceNum >= minBalance ? 'ok' : 'error',
          },
        ])

        if (balanceNum < minBalance) {
          logger.info(`  Required: ${minBalance} ETH minimum`)
          logger.info('  Fix: Get testnet ETH from faucet:')
          logger.info('       jeju faucet --chain base')
          logger.info('       Or: https://www.alchemy.com/faucets/base-sepolia')
          allOk = false
        }
      } catch {
        logger.table([
          {
            label: 'ETH Balance',
            value: 'Cannot connect to RPC',
            status: 'error',
          },
        ])
        allOk = false
      }
    } else {
      logger.table([
        {
          label: 'ETH Balance',
          value: 'Skipped (no keys)',
          status: 'warn',
        },
      ])
    }

    // 3. Check Foundry
    logger.newline()
    logger.subheader('3. Dependencies')
    const foundryResult = await checkFoundry()
    logger.table([
      {
        label: 'Foundry',
        value: foundryResult.status === 'ok' ? 'Installed' : 'Not found',
        status: foundryResult.status === 'ok' ? 'ok' : 'error',
      },
    ])

    if (foundryResult.status !== 'ok') {
      logger.info(
        '  Fix: curl -L https://foundry.paradigm.xyz | bash && foundryup',
      )
      allOk = false
    }

    // 4. Check contracts build
    const rootDir = findMonorepoRoot()
    const contractsDir = join(rootDir, 'packages/contracts')
    const outDir = join(contractsDir, 'out')

    logger.table([
      {
        label: 'Contracts',
        value: existsSync(outDir) ? 'Built' : 'Not built',
        status: existsSync(outDir) ? 'ok' : 'warn',
      },
    ])

    if (!existsSync(outDir)) {
      logger.info('  Fix: cd packages/contracts && forge build')
    }

    // Summary
    logger.newline()
    if (allOk) {
      logger.success('All checks passed. Ready to deploy.')
      logger.newline()
      logger.info(`Run: jeju deploy ${network} --token`)
    } else {
      logger.error('Some checks failed. Fix issues above before deploying.')
    }
  })

deployCommand
  .command('status')
  .description('Check deployment status')
  .argument('[network]', 'testnet | mainnet')
  .action(async (networkArg) => {
    const savedConfig = loadConfig()
    const network = (networkArg ||
      savedConfig?.network ||
      'testnet') as NetworkType

    if (network === 'localnet') {
      logger.info('Use `jeju status` for localnet')
      return
    }

    const config = CHAIN_CONFIG[network]

    logger.header(`${network.toUpperCase()} STATUS`)

    const rpcHealthy = await checkRpcHealth(config.rpcUrl, 5000)
    logger.table([
      {
        label: 'RPC',
        value: config.rpcUrl,
        status: rpcHealthy ? 'ok' : 'error',
      },
    ])

    if (savedConfig?.lastDeployed && savedConfig.network === network) {
      logger.table([
        {
          label: 'Last deployed',
          value: new Date(savedConfig.lastDeployed).toLocaleString(),
          status: 'ok',
        },
      ])
      if (savedConfig.deployerAddress) {
        logger.table([
          {
            label: 'Deployer',
            value: savedConfig.deployerAddress,
            status: 'ok',
          },
        ])
      }
    }

    const rootDir = findMonorepoRoot()
    const deploymentsFile = join(
      rootDir,
      `packages/contracts/deployments/${network}/contracts.json`,
    )

    if (existsSync(deploymentsFile)) {
      const rawData = JSON.parse(readFileSync(deploymentsFile, 'utf-8'))
      const result = ContractsDeploymentSchema.safeParse(rawData)
      if (!result.success) {
        logger.warn('Invalid contracts deployment file format')
        logger.table([
          {
            label: 'Contracts',
            value: 'Invalid format',
            status: 'error',
          },
        ])
        return
      }
      const deployments = result.data
      const count = Object.keys(deployments).length
      logger.table([
        {
          label: 'Contracts',
          value: `${count} deployed`,
          status: 'ok',
        },
      ])
    } else {
      logger.table([
        {
          label: 'Contracts',
          value: 'Not deployed',
          status: 'warn',
        },
      ])
    }
  })

deployCommand
  .command('check')
  .description(
    'Comprehensive readiness check for deployment (infrastructure, keys, contracts, network)',
  )
  .argument('[network]', 'testnet | mainnet', 'testnet')
  .action(async (networkArg) => {
    const network = networkArg as NetworkType

    if (network === 'localnet') {
      logger.info('Use `jeju status` for localnet')
      return
    }

    logger.header(`DEPLOYMENT CHECK - ${network.toUpperCase()}`)

    // Run the comprehensive check script
    const rootDir = findMonorepoRoot()
    const checkScript = join(
      rootDir,
      'packages/deployment/scripts/verify/check-testnet-readiness.ts',
    )

    if (!existsSync(checkScript)) {
      logger.error('Check script not found')
      return
    }

    await execa('bun', ['run', checkScript, network], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

deployCommand
  .command('verify')
  .description('Verify contract deployments')
  .argument('<type>', 'oif | contracts')
  .argument('[network]', 'testnet | mainnet', 'testnet')
  .action(async (type, networkArg) => {
    const network = networkArg as NetworkType

    if (type === 'oif') {
      const rootDir = findMonorepoRoot()
      const verifyScript = join(
        rootDir,
        'packages/deployment/scripts/verify/verify-oif-deployment.ts',
      )

      if (!existsSync(verifyScript)) {
        logger.error('OIF verify script not found')
        return
      }

      await execa('bun', ['run', verifyScript, network], {
        cwd: rootDir,
        stdio: 'inherit',
      })
    } else {
      logger.error(`Unknown verify type: ${type}`)
      logger.info('Available: oif')
    }
  })

deployCommand
  .command('token')
  .description('Deploy NetworkToken and BanManager')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'localnet',
  )
  .option(
    '--safe <address>',
    'Safe multi-sig address (required for testnet/mainnet)',
  )
  .action(async (options) => {
    await runDeployScript('token', options.network, options)
  })

deployCommand
  .command('oif')
  .description('Deploy Open Intents Framework')
  .argument('[network]', 'localnet | testnet | mainnet', 'localnet')
  .option('--oracle-type <type>', 'Oracle type: simple, hyperlane, superchain')
  .action(async (network, options) => {
    await runDeployScript('oif', network, options)
  })

deployCommand
  .command('oif-multichain')
  .description('Deploy OIF to multiple chains')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--all', 'Deploy to all configured chains')
  .action(async (options) => {
    await runDeployScript('oif-multichain', options.network, options)
  })

deployCommand
  .command('jns')
  .description('Deploy Jeju Name Service')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('jns', options.network, options)
  })

deployCommand
  .command('oracle')
  .description('Deploy and configure oracle network')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--deploy', 'Deploy contracts')
  .option('--configure', 'Configure oracle node', true)
  .option('--verify', 'Verify contracts')
  .action(async (options) => {
    await runDeployScript(
      'oracle/deploy-and-configure',
      options.network,
      options,
    )
  })

deployCommand
  .command('dao')
  .description('Deploy DAO from manifest configuration')
  .argument('[name]', 'DAO name or path to manifest')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--manifest <path>', 'Path to jeju-manifest.json')
  .option('--seed', 'Auto-seed packages and repos after deployment')
  .option('--fund-treasury <amount>', 'Fund treasury with ETH (wei)')
  .option('--fund-matching <amount>', 'Fund matching pool with ETH (wei)')
  .option('--dry-run', 'Simulate without making changes')
  .option('--skip-council', 'Skip council member setup')
  .option('--skip-funding-config', 'Skip funding configuration')
  .option('--list', 'List all discoverable DAOs')
  .option('-v, --verbose', 'Verbose output')
  .action(async (nameArg, options) => {
    const rootDir = findMonorepoRoot()

    // List mode
    if (options.list) {
      const { discoverDAOManifests } = await import('../lib/dao-deploy')
      const manifests = await discoverDAOManifests(rootDir)
      logger.header('DISCOVERABLE DAOS')
      if (manifests.length === 0) {
        logger.info('No DAO manifests found')
        return
      }
      for (const m of manifests) {
        logger.keyValue(m.displayName ?? m.name, m.governance.ceo.name)
      }
      return
    }

    // Resolve manifest path
    let manifestPath: string
    if (options.manifest) {
      manifestPath = options.manifest
    } else if (nameArg) {
      // Check common locations
      const candidates = [
        join(rootDir, 'vendor', nameArg, 'dao', 'jeju-manifest.json'),
        join(rootDir, 'vendor', nameArg, 'jeju-manifest.json'),
        join(rootDir, 'apps', nameArg, 'jeju-manifest.json'),
        join(rootDir, nameArg, 'jeju-manifest.json'),
        nameArg, // Direct path
      ]
      const found = candidates.find((p) => existsSync(p))
      if (!found) {
        logger.error(`DAO manifest not found for: ${nameArg}`)
        logger.info('Searched:')
        for (const c of candidates.slice(0, -1)) {
          logger.info(`  ${c}`)
        }
        logger.info('\nUse --manifest <path> to specify directly')
        logger.info('Or use --list to see discoverable DAOs')
        return
      }
      manifestPath = found
    } else {
      // Default to current directory
      manifestPath = join(process.cwd(), 'jeju-manifest.json')
      if (!existsSync(manifestPath)) {
        logger.error('No DAO name or manifest specified')
        logger.info('Usage: jeju deploy dao <name> [options]')
        logger.info('       jeju deploy dao --manifest <path> [options]')
        logger.info('       jeju deploy dao --list')
        return
      }
    }

    const { deployDAO } = await import('../lib/dao-deploy')
    await deployDAO({
      network: options.network as 'localnet' | 'testnet' | 'mainnet',
      manifestPath,
      rootDir,
      seed: options.seed ?? false,
      fundTreasury: options.fundTreasury,
      fundMatching: options.fundMatching,
      dryRun: options.dryRun ?? false,
      skipCouncil: options.skipCouncil ?? false,
      skipFundingConfig: options.skipFundingConfig ?? false,
      verbose: options.verbose ?? false,
    })
  })

deployCommand
  .command('governance')
  .description('Deploy governance contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('governance', options.network, options)
  })

deployCommand
  .command('council')
  .description('Deploy Council contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('council', options.network, options)
  })

deployCommand
  .command('launchpad')
  .description('Deploy token launchpad')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('launchpad', options.network, options)
  })

deployCommand
  .command('eil')
  .description('Deploy Ethereum Intent Layer')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('eil', options.network, options)
  })

deployCommand
  .command('eil-paymaster')
  .description('Deploy EIL Paymaster')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('eil-paymaster', options.network, options)
  })

deployCommand
  .command('liquidity')
  .description(
    'Deploy liquidity system (RiskSleeve, LiquidityRouter, MultiServiceStakeManager)',
  )
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/contracts/script/DeployLiquidity.s.sol',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Liquidity deploy script not found')
      return
    }

    const network = options.network as NetworkType
    const rpcUrl = CHAIN_CONFIG[network].rpcUrl ?? getL2RpcUrl()

    logger.step('Deploying liquidity contracts...')
    await execa(
      'forge',
      [
        'script',
        'script/DeployLiquidity.s.sol',
        '--rpc-url',
        rpcUrl,
        '--broadcast',
      ],
      {
        cwd: join(rootDir, 'packages/contracts'),
        stdio: 'inherit',
      },
    )
    logger.success('Liquidity contracts deployed')
  })

deployCommand
  .command('account-abstraction')
  .description('Deploy account abstraction infrastructure')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('account-abstraction', options.network, options)
  })

deployCommand
  .command('federation')
  .description('Deploy federation contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('federation', options.network, options)
  })

deployCommand
  .command('decentralization')
  .description('Deploy decentralization contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('decentralization', options.network, options)
  })

deployCommand
  .command('oauth3')
  .description('Deploy OAuth3 contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('oauth3', options.network, options)
  })

deployCommand
  .command('otc')
  .description('Deploy OTC trading contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('otc', options.network, options)
  })

deployCommand
  .command('l1')
  .description('Deploy L1 contracts')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options) => {
    await runDeployScript('deploy-l1-contracts', options.network, options)
  })

deployCommand
  .command('keys')
  .description('Generate operator keys for deployment')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options) => {
    await runDeployScript('generate-operator-keys', options.network, options)
  })

deployCommand
  .command('zkbridge')
  .description('Deploy ZK bridge for cross-chain EVM-Solana bridging')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--evm-only', 'Deploy EVM contracts only')
  .option('--solana-only', 'Deploy Solana programs only')
  .option('--dry-run', 'Simulate deployment')
  .action(async (_options) => {
    logger.error('ZK bridge deployment has been removed.')
    logger.info('Bridge deployment scripts have been deleted.')
    logger.info(
      'Use packages/bridge/scripts/orchestrator.ts directly if needed.',
    )
    process.exit(1)
  })

deployCommand
  .command('zkbridge-setup')
  .description('Setup ZK bridge infrastructure (SP1, Phala TEE)')
  .option('--sp1', 'Setup SP1 prover toolchain')
  .option('--phala', 'Setup Phala TEE endpoint')
  .option('--all', 'Setup all components', true)
  .action(async (_options) => {
    logger.error('ZK bridge setup has been removed.')
    logger.info('Setup scripts have been deleted.')
    logger.info(
      'Refer to packages/bridge/README.md for manual setup instructions.',
    )
    process.exit(1)
  })

deployCommand
  .command('messaging')
  .description('Deploy messaging contracts (KeyRegistry, MessageNodeRegistry)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'testnet',
  )
  .option('--verify', 'Verify contracts on explorer')
  .action(async (options: { network: string; verify?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/deploy-messaging-contracts.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Messaging contracts deploy script not found')
      return
    }

    const args: string[] = ['--network', options.network]
    if (options.verify) args.push('--verify')

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

deployCommand
  .command('dao-all')
  .description('Deploy all discoverable DAOs and setup allocations')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--seed', 'Auto-seed packages and repos')
  .option('--setup-allocations', 'Setup allocations between DAOs', true)
  .option('--dry-run', 'Simulate without making changes')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const { deployMultipleDAOs } = await import('../lib/dao-deploy')

    await deployMultipleDAOs({
      network: options.network as 'localnet' | 'testnet' | 'mainnet',
      manifestPath: '', // Not used for multi-DAO
      rootDir,
      seed: options.seed ?? false,
      fundTreasury: undefined,
      fundMatching: undefined,
      dryRun: options.dryRun ?? false,
      skipCouncil: false,
      skipFundingConfig: false,
      verbose: options.verbose ?? false,
      all: true,
      setupAllocations: options.setupAllocations ?? true,
    })
  })

deployCommand
  .command('rollback')
  .description('Rollback deployment to a previous version')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--backup <backup>', 'Backup name or "latest"', 'latest')
  .action(async (options) => {
    await runDeployScript('rollback-deployment', options.network, {
      backup: options.backup,
    })
  })

deployCommand
  .command('app')
  .description('Deploy an app to the network')
  .argument('<app-name>', 'App name')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (appName, options) => {
    const rootDir = findMonorepoRoot()
    const apps = discoverApps(rootDir)
    const app = apps.find(
      (a) =>
        (a._folderName ?? a.slug ?? a.name) === appName || a.name === appName,
    )

    if (!app) {
      logger.error(`App not found: ${appName}`)
      process.exit(1)
    }

    const folderName = app._folderName ?? app.slug ?? appName
    let appDir = join(rootDir, 'apps', folderName)
    if (!existsSync(appDir)) {
      appDir = join(rootDir, 'vendor', folderName)
    }

    // Extract manifest info for deploy script
    const jnsName = app.jns?.name
    const frontend = app.architecture?.frontend
    const outputDir =
      (typeof frontend === 'object' && frontend.outputDir) || 'dist'
    const frontendDir = join(appDir, outputDir)

    if (!jnsName) {
      logger.error(`App ${appName} does not have a JNS name configured`)
      process.exit(1)
    }

    await runDeployScript('deploy-app', options.network, {
      name: appName,
      dir: frontendDir,
      jns: jnsName,
    })
  })

deployCommand
  .command('frontend')
  .description('Deploy frontend to IPFS and update JNS')
  .argument('<app-name>', 'App name')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (appName, options) => {
    await runDeployScript('deploy-frontend', options.network, { app: appName })
  })

deployCommand
  .command('dao-full')
  .description('Deploy full DAO stack')
  .option('--network <network>', 'Network: localnet | testnet', 'localnet')
  .action(async (options) => {
    await runDeployScript('deploy-dao-full', options.network, {})
  })

deployCommand
  .command('testnet-full')
  .description('Full testnet deployment (infrastructure + contracts)')
  .option('--skip-keys', 'Skip operator key generation')
  .option('--skip-l1', 'Skip L1 contract deployment')
  .option('--contracts-only', 'Deploy contracts only (skip infrastructure)')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/deploy/testnet-full-crosschain.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Testnet full deployment script not found')
      return
    }

    const args: string[] = []
    if (options.skipKeys) args.push('--skip-keys')
    if (options.skipL1) args.push('--skip-l1')
    if (options.contractsOnly) args.push('--contracts-only')

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

deployCommand
  .command('contracts-testnet')
  .description('Deploy all contracts to testnet (Sepolia and Base Sepolia)')
  .action(async () => {
    logger.error('Contracts testnet deployment has been removed.')
    logger.info('Use individual deploy commands instead:')
    logger.info('  jeju deploy token --network testnet')
    logger.info('  jeju deploy oif --network testnet')
    logger.info('  jeju deploy jns --network testnet')
    process.exit(1)
  })

deployCommand
  .command('sync-configs')
  .description('Sync contract addresses across config files')
  .option('--network <network>', 'Network to sync', 'base-sepolia')
  .action(async (_options: { network: string }) => {
    logger.error('Sync configs functionality has been removed.')
    logger.info('Update config files manually after deployment.')
    process.exit(1)
  })

deployCommand
  .command('commerce')
  .description('Deploy Coinbase Commerce contracts (AuthCaptureEscrow)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('commerce', options.network, options)
  })

deployCommand
  .command('moderation')
  .description('Deploy moderation system (BanManager, ModerationMarketplace)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('moderation', options.network, options)
  })

deployCommand
  .command('x402')
  .description('Deploy x402 payment protocol to multiple chains')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--all', 'Deploy to all configured chains')
  .action(async (options) => {
    await runDeployScript('x402-multichain', options.network, options)
  })

deployCommand
  .command('chainlink')
  .description('Deploy Chainlink integration contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('chainlink', options.network, options)
  })

deployCommand
  .command('defi')
  .description('Deploy DeFi protocol contracts')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('defi-protocols', options.network, options)
  })

deployCommand
  .command('jns-register')
  .description('Register JNS names after deployment')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--name <name>', 'JNS name to register')
  .action(async (options) => {
    await runDeployScript('register-jns', options.network, options)
  })

deployCommand
  .command('blocking')
  .description('Deploy user blocking system')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    await runDeployScript('blocking-localnet', options.network, options)
  })

deployCommand
  .command('security-council')
  .description('Deploy Security Council multisig')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/deploy/deploy-security-council.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Security council deploy script not found')
      return
    }

    const args: string[] = []
    if (options.network && options.network !== 'localnet') {
      args.push('--network', options.network)
    }

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

deployCommand
  .command('crucible')
  .description('Deploy Crucible contracts (AgentVault, RoomRegistry)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(rootDir, 'apps/crucible/scripts/deploy.ts')

    if (!existsSync(scriptPath)) {
      logger.error('Crucible deploy script not found')
      return
    }

    logger.header('CRUCIBLE DEPLOYMENT')
    logger.keyValue('Network', options.network)
    logger.newline()

    await execa('bun', ['run', scriptPath], {
      cwd: join(rootDir, 'apps/crucible'),
      stdio: 'inherit',
      env: {
        ...process.env,
        NETWORK: options.network,
      },
    })
  })

deployCommand
  .command('bazaar')
  .description('Deploy Bazaar to DWS (frontend + worker)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--no-cdn', 'Skip CDN configuration')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(rootDir, 'apps/bazaar/scripts/deploy.ts')

    if (!existsSync(scriptPath)) {
      logger.error('Bazaar deploy script not found')
      return
    }

    logger.header('BAZAAR DEPLOYMENT')
    logger.keyValue('Network', options.network)
    logger.keyValue('CDN', options.cdn ? 'enabled' : 'disabled')
    logger.newline()

    await execa('bun', ['run', scriptPath], {
      cwd: join(rootDir, 'apps/bazaar'),
      stdio: 'inherit',
      env: {
        ...process.env,
        NETWORK: options.network,
        CDN_ENABLED: options.cdn ? 'true' : 'false',
      },
    })
  })

deployCommand
  .command('factory')
  .description('Deploy Factory to DWS')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('--cdn', 'Deploy frontend to CDN only')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()

    let scriptPath: string
    if (options.cdn) {
      scriptPath = join(rootDir, 'apps/factory/scripts/deploy-cdn.ts')
    } else {
      scriptPath = join(rootDir, 'apps/factory/scripts/deploy-dws.ts')
    }

    if (!existsSync(scriptPath)) {
      logger.error('Factory deploy script not found')
      return
    }

    logger.header('FACTORY DEPLOYMENT')
    logger.keyValue('Network', options.network)
    logger.keyValue('Mode', options.cdn ? 'CDN only' : 'Full DWS')
    logger.newline()

    await execa('bun', ['run', scriptPath], {
      cwd: join(rootDir, 'apps/factory'),
      stdio: 'inherit',
      env: {
        ...process.env,
        NETWORK: options.network,
      },
    })
  })

deployCommand
  .command('dws-services')
  .description('Deploy decentralized services to DWS (OAuth3, KMS, Messaging)')
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('-s, --service <name>', 'Deploy only a specific service')
  .option('-d, --dryRun', 'Simulate without making changes', false)
  .option('--skipWait', 'Skip waiting for deployments', false)
  .action(
    async (options: {
      network: string
      service?: string
      dryRun?: boolean
      skipWait?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/deploy/deploy-dws-services.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('DWS services deploy script not found')
        return
      }

      const isDryRun = options.dryRun === true

      logger.header('DWS SERVICES DEPLOYMENT')
      logger.keyValue('Network', options.network)
      if (options.service) {
        logger.keyValue('Service', options.service)
      }
      if (isDryRun) {
        logger.keyValue('Mode', 'Dry Run')
      }
      logger.newline()

      const args: string[] = ['--network', options.network]
      if (options.service) args.push('--service', options.service)
      if (isDryRun) args.push('--dry-run')
      if (options.skipWait === true) args.push('--skip-wait')

      await execa('bun', ['run', scriptPath, ...args], {
        cwd: rootDir,
        stdio: 'inherit',
      })
    },
  )

deployCommand
  .command('mpc-parties')
  .description('Deploy MPC party nodes for threshold signing')
  .option(
    '-n, --network <network>',
    'Network: localnet | testnet | mainnet',
    'localnet',
  )
  .option('-p, --parties <count>', 'Number of party nodes', '3')
  .option('-t, --threshold <k>', 'Signing threshold', '2')
  .option('--stakeAmount <wei>', 'Stake per party in wei')
  .option('-d, --dryRun', 'Simulate without making changes', false)
  .option('--skipDkg', 'Skip distributed key generation', false)
  .action(
    async (options: {
      network: string
      parties: string
      threshold: string
      stakeAmount?: string
      dryRun?: boolean
      skipDkg?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/deploy/deploy-mpc-parties.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('MPC parties deploy script not found')
        return
      }

      const isDryRun = options.dryRun === true

      logger.header('MPC PARTIES DEPLOYMENT')
      logger.keyValue('Network', options.network)
      logger.keyValue('Parties', options.parties)
      logger.keyValue('Threshold', options.threshold)
      if (isDryRun) {
        logger.keyValue('Mode', 'Dry Run')
      }
      logger.newline()

      const args: string[] = [
        '--network',
        options.network,
        '--parties',
        options.parties,
        '--threshold',
        options.threshold,
      ]
      if (options.stakeAmount) args.push('--stake-amount', options.stakeAmount)
      if (isDryRun) args.push('--dry-run')
      if (options.skipDkg === true) args.push('--skip-dkg')

      await execa('bun', ['run', scriptPath, ...args], {
        cwd: rootDir,
        stdio: 'inherit',
      })
    },
  )

async function runDeployScript(
  scriptName: string,
  network: string,
  options: DeployScriptOptions = {},
) {
  const rootDir = findMonorepoRoot()
  // Check if script is in packages/deployment/scripts/deploy/
  let scriptPath = join(
    rootDir,
    'packages/deployment/scripts/deploy',
    `${scriptName}.ts`,
  )
  if (!existsSync(scriptPath)) {
    // Also check packages/deployment/scripts/ for other scripts
    scriptPath = join(
      rootDir,
      'packages/deployment/scripts',
      `${scriptName}.ts`,
    )
  }

  if (!existsSync(scriptPath)) {
    logger.error(`Deploy script not found: ${scriptName}`)
    return
  }

  logger.step(`Running deploy script: ${scriptName}`)

  const args: string[] = []
  if (network && network !== 'localnet') {
    if (scriptName === 'jns' || scriptName === 'deploy-dao-full') {
      args.push(`--${network}`)
    } else if (scriptName === 'rollback-deployment') {
      args.push(`--network=${network}`)
    } else {
      args.push('--network', network)
    }
  }

  // Add other options as CLI args
  for (const [key, value] of Object.entries(options)) {
    if (key === 'network') continue // Already handled
    if (value === true) {
      args.push(`--${key}`)
    } else if (value !== false && value !== undefined && value !== null) {
      if (key === 'backup') {
        args.push(`--backup=${value}`)
      } else if (key === 'app') {
        args.push(String(value))
      } else {
        args.push(`--${key}`, String(value))
      }
    }
  }

  await execa('bun', ['run', scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}
