/** OP Superchain integration */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getNetworkDisplayName,
  getRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { createPublicClient, http } from 'viem'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

const displayName = getNetworkDisplayName()

// Superchain requirements
const SUPERCHAIN_REQUIREMENTS = {
  opStack: {
    name: 'OP Stack Contracts',
    description: 'Standard OP Stack L1/L2 contracts deployed',
    required: true,
  },
  l2ToL2Messenger: {
    name: 'L2ToL2CrossDomainMessenger',
    description: 'Cross-chain messaging preinstall at 0x4200...0023',
    required: true,
  },
  sharedSequencer: {
    name: 'Shared Sequencer Support',
    description: 'op-node configured for shared sequencing',
    required: true,
  },
  upgradeTimelock: {
    name: 'Upgrade Timelock (7+ days)',
    description: 'Contract upgrades require 7+ day delay',
    required: true,
  },
  securityCouncil: {
    name: 'Security Council Multisig',
    description: '4/7 multisig for emergency actions',
    required: true,
  },
  faultProofs: {
    name: 'Fault Proofs',
    description: 'op-challenger and dispute game contracts',
    required: true,
  },
  governance: {
    name: 'Governance Setup',
    description: 'Token and voting mechanism configured',
    required: false,
  },
  bugBounty: {
    name: 'Bug Bounty Program',
    description: 'Active bug bounty with adequate funding',
    required: true,
  },
}

interface DeploymentData {
  network: string
  l1?: Record<string, string>
  l2?: Record<string, string>
  stage2?: Record<string, string>
  governance?: Record<string, string>
}

function loadDeployment(network: NetworkType): DeploymentData | null {
  const rootDir = findMonorepoRoot()
  const paths = [
    join(rootDir, 'packages/contracts/deployments', `${network}.json`),
    join(rootDir, 'packages/contracts/deployments', `l1-${network}.json`),
  ]

  for (const path of paths) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8')) as DeploymentData
    }
  }
  return null
}

async function checkOpStackContracts(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const deployment = loadDeployment(network)
  if (!deployment) {
    return { status: 'fail', details: 'No deployment file found' }
  }

  // Check for essential OP Stack contracts
  const requiredL1 = ['OptimismPortal', 'L2OutputOracle', 'SystemConfig']
  const l1Contracts = deployment.l1 ?? {}

  const missing = requiredL1.filter((c) => !l1Contracts[c])
  if (missing.length > 0) {
    return {
      status: 'fail',
      details: `Missing L1 contracts: ${missing.join(', ')}`,
    }
  }

  return { status: 'pass' }
}

async function checkL2ToL2Messenger(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const rpcUrl = getRpcUrl(network)
  const client = createPublicClient({ transport: http(rpcUrl) })

  const preinstallAddress = '0x4200000000000000000000000000000000000023'

  const code = await client
    .getCode({ address: preinstallAddress as `0x${string}` })
    .catch(() => null)

  if (!code || code === '0x') {
    return {
      status: 'fail',
      details: 'L2ToL2CrossDomainMessenger not deployed at preinstall address',
    }
  }

  return { status: 'pass' }
}

async function checkSharedSequencer(_network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  // This would need to check op-node configuration - can't verify from CLI alone
  // For now, return warning indicating manual verification needed
  return {
    status: 'warn',
    details: 'Manual verification required - check op-node sequencer config',
  }
}

async function checkUpgradeTimelock(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `decentralization-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return { status: 'fail', details: 'No decentralization deployment found' }
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const timelockAddress = deployment.stage2?.GovernanceTimelock

  if (!timelockAddress) {
    return { status: 'fail', details: 'GovernanceTimelock not deployed' }
  }

  const rpcUrl = getRpcUrl(network)
  const client = createPublicClient({ transport: http(rpcUrl) })

  const minDelay = (await client
    .readContract({
      address: timelockAddress as `0x${string}`,
      abi: [
        {
          name: 'getMinDelay',
          type: 'function',
          inputs: [],
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'getMinDelay',
    })
    .catch(() => 0n)) as bigint

  const minDelayDays = Number(minDelay) / (24 * 60 * 60)

  if (minDelayDays < 7) {
    return {
      status: 'fail',
      details: `Timelock delay is ${minDelayDays.toFixed(1)} days (minimum 7 required)`,
    }
  }

  return { status: 'pass', details: `${minDelayDays.toFixed(0)} day delay` }
}

async function checkSecurityCouncil(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `governance-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return { status: 'fail', details: 'No governance deployment found' }
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const councilAddress = deployment.SecurityCouncil

  if (!councilAddress) {
    return { status: 'fail', details: 'SecurityCouncil not deployed' }
  }

  // Verify it's a multisig
  const rpcUrl = getRpcUrl(network)
  const client = createPublicClient({ transport: http(rpcUrl) })

  const code = await client
    .getCode({ address: councilAddress as `0x${string}` })
    .catch(() => null)

  if (!code || code === '0x') {
    return { status: 'fail', details: 'SecurityCouncil has no code' }
  }

  // Note: Full verification would check threshold and owner count
  return {
    status: 'warn',
    details: 'Deployed - verify 4/7 threshold manually',
  }
}

async function checkFaultProofs(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `decentralization-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return { status: 'fail', details: 'No decentralization deployment found' }
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const cannonProver = deployment.stage2?.CannonProver
  const disputeFactory = deployment.stage2?.DisputeGameFactory

  if (!cannonProver || !disputeFactory) {
    return {
      status: 'fail',
      details: 'CannonProver or DisputeGameFactory not deployed',
    }
  }

  const rpcUrl = getRpcUrl(network)
  const client = createPublicClient({ transport: http(rpcUrl) })

  // Check if MIPS is configured (not in test mode)
  const mipsAddress = (await client
    .readContract({
      address: cannonProver as `0x${string}`,
      abi: [
        {
          name: 'mips',
          type: 'function',
          inputs: [],
          outputs: [{ name: '', type: 'address' }],
          stateMutability: 'view',
        },
      ],
      functionName: 'mips',
    })
    .catch(() => null)) as string | null

  if (
    !mipsAddress ||
    mipsAddress === '0x0000000000000000000000000000000000000000' ||
    mipsAddress === '0x0000000000000000000000000000000000000001'
  ) {
    return { status: 'warn', details: 'CannonProver in TEST MODE' }
  }

  return { status: 'pass' }
}

async function checkGovernance(network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `governance-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return { status: 'warn', details: 'No governance deployment (optional)' }
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const governor = deployment.Governor
  const token = deployment.JejuToken

  if (!governor || !token) {
    return { status: 'warn', details: 'Governance partially configured' }
  }

  return { status: 'pass' }
}

async function checkBugBounty(_network: NetworkType): Promise<{
  status: 'pass' | 'warn' | 'fail'
  details?: string
}> {
  // Bug bounty is external - can't verify programmatically
  return {
    status: 'warn',
    details: 'Verify Immunefi or equivalent program is active',
  }
}

async function checkRequirement(
  key: string,
  network: NetworkType,
): Promise<{ status: 'pass' | 'warn' | 'fail'; details?: string }> {
  switch (key) {
    case 'opStack':
      return checkOpStackContracts(network)
    case 'l2ToL2Messenger':
      return checkL2ToL2Messenger(network)
    case 'sharedSequencer':
      return checkSharedSequencer(network)
    case 'upgradeTimelock':
      return checkUpgradeTimelock(network)
    case 'securityCouncil':
      return checkSecurityCouncil(network)
    case 'faultProofs':
      return checkFaultProofs(network)
    case 'governance':
      return checkGovernance(network)
    case 'bugBounty':
      return checkBugBounty(network)
    default:
      return { status: 'warn', details: 'Unknown requirement' }
  }
}

export const superchainCommand = new Command('superchain').description(
  'OP Superchain integration',
)

superchainCommand
  .command('check')
  .description('Check Superchain compatibility')
  .option('-n, --network <network>', 'Network to check', 'mainnet')
  .option('--verbose', 'Show detailed output')
  .action(async (options) => {
    const network = options.network as NetworkType
    logger.header('SUPERCHAIN COMPATIBILITY CHECK')

    console.log(
      chalk.cyan(`\nChecking ${displayName} for Superchain compatibility...\n`),
    )

    let passed = 0
    let failed = 0
    let optional = 0

    for (const [key, req] of Object.entries(SUPERCHAIN_REQUIREMENTS)) {
      const result = await checkRequirement(key, network)

      const icon =
        result.status === 'pass'
          ? chalk.green('✓')
          : result.status === 'warn'
            ? chalk.yellow('⚠')
            : chalk.red('✗')

      const reqText = req.required ? '' : chalk.dim(' (optional)')

      console.log(`${icon} ${req.name}${reqText}`)
      if (options.verbose && result.details) {
        console.log(chalk.dim(`   ${result.details}`))
      } else if (result.status !== 'pass' && result.details) {
        console.log(chalk.dim(`   ${result.details}`))
      }

      if (result.status === 'pass') {
        passed++
      } else if (!req.required) {
        optional++
      } else {
        failed++
      }
    }

    console.log()
    console.log(chalk.bold('Summary:'))
    console.log(`  ${chalk.green('Passed:')} ${passed}`)
    console.log(`  ${chalk.red('Failed:')} ${failed}`)
    console.log(`  ${chalk.yellow('Optional warnings:')} ${optional}`)

    if (failed === 0) {
      console.log(chalk.green('\n✓ Ready for Superchain submission.'))
      console.log('\nNext steps:')
      console.log('  1. Submit application at https://optimism.io/superchain')
      console.log('  2. Complete security audit')
      console.log('  3. Join governance calls')
    } else {
      console.log(
        chalk.yellow(
          `\n⚠ ${failed} requirements need attention before Superchain submission.`,
        ),
      )
      console.log('\nRun with --verbose for more details.')
    }
  })

superchainCommand
  .command('register')
  .description('Register with Superchain registry')
  .option('--chain-id <id>', 'Your chain ID')
  .option('--name <name>', 'Network name')
  .option('--rpc <url>', 'RPC URL')
  .option('--explorer <url>', 'Explorer URL')
  .action(async (options) => {
    logger.header('REGISTER WITH SUPERCHAIN')

    console.log(chalk.cyan('\nSuperchain Registry Submission\n'))

    console.log(
      'This command helps prepare your submission to the Superchain Registry.',
    )
    console.log('The actual submission is done via GitHub PR to:')
    console.log(
      chalk.blue(
        '  https://github.com/ethereum-optimism/superchain-registry\n',
      ),
    )

    console.log(chalk.bold('Your Chain Details:'))
    console.log(`  Name: ${options.name || displayName}`)
    console.log(`  Chain ID: ${options.chainId || 'Not specified'}`)
    console.log(`  RPC: ${options.rpc || 'Not specified'}`)
    console.log(`  Explorer: ${options.explorer || 'Not specified'}`)

    console.log(chalk.bold('\nRequired Files:'))
    console.log('  1. chain.toml - Chain configuration')
    console.log('  2. rollup.json - Rollup configuration')
    console.log('  3. genesis.json - Genesis state')

    console.log(chalk.bold('\nNext Steps:'))
    console.log('  1. Run `jeju superchain check` to verify compatibility')
    console.log('  2. Generate required files with `jeju superchain export`')
    console.log('  3. Fork superchain-registry and create PR')
    console.log('  4. Wait for Optimism Foundation review')
  })

superchainCommand
  .command('status')
  .description('Show Superchain integration status')
  .option('-n, --network <network>', 'Network to check', 'mainnet')
  .action(async (options) => {
    const network = options.network as NetworkType
    logger.header('SUPERCHAIN STATUS')

    console.log(chalk.cyan(`\n${displayName} Superchain Status\n`))

    // Load actual deployment data
    const deployment = loadDeployment(network)

    console.log(chalk.bold('OP Stack Components:'))
    if (deployment?.l1) {
      console.log(
        `  OptimismPortal:  ${deployment.l1.OptimismPortal ? 'Deployed' : 'Not deployed'}`,
      )
      console.log(
        `  L2OutputOracle:  ${deployment.l1.L2OutputOracle ? 'Deployed' : 'Not deployed'}`,
      )
      console.log(
        `  SystemConfig:    ${deployment.l1.SystemConfig ? 'Deployed' : 'Not deployed'}`,
      )
    } else {
      console.log('  No L1 deployment data found')
    }

    console.log(chalk.bold('\nCross-Chain Messaging:'))
    console.log(
      '  L2ToL2CrossDomainMessenger: 0x4200000000000000000000000000000000000023',
    )
    console.log('  Hyperlane Mailbox: Check with `jeju status`')

    console.log(chalk.bold('\nJeju Federation:'))
    console.log('  Check with: `jeju federation status`')

    console.log(chalk.bold('\nData Availability:'))
    console.log('  Primary: Jeju DA (PeerDAS-integrated)')
    console.log('  Fallback: Ethereum blobs / calldata')

    console.log()
    console.log(
      chalk.dim(
        'Run `jeju superchain check` for detailed compatibility analysis.',
      ),
    )
  })

export default superchainCommand
