/** Check token deployment status and bridge tokens */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRpcUrl, type NetworkType } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { createPublicClient, formatUnits, http } from 'viem'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// Known token configurations
const KNOWN_TOKENS: Record<
  string,
  { name: string; totalSupply: string; homeChain: string }
> = {
  JEJU: {
    name: 'Jeju',
    totalSupply: '10,000,000,000 (max)',
    homeChain: 'jeju',
  },
}

// ERC20 minimal ABI for balance/info checks
const ERC20_ABI = [
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

interface TokenDeployment {
  address: string
  name: string
  symbol: string
  decimals: number
}

interface NetworkDeployments {
  token?: TokenDeployment
  router?: string
}

function loadDeployments(
  network: NetworkType,
): Record<string, NetworkDeployments> {
  const rootDir = findMonorepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments',
    `token-${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    return {}
  }

  const content = readFileSync(deploymentPath, 'utf-8')
  return JSON.parse(content) as Record<string, NetworkDeployments>
}

export const tokenCommand = new Command('token')
  .description('Check token deployment status and bridge tokens')
  .addHelpText(
    'after',
    `
Examples:
  ${chalk.cyan('jeju token status jeju --network testnet')}         Check JEJU deployment status
  ${chalk.cyan('jeju token bridge jeju 1000 --from jeju --to base')}  Bridge 1000 JEJU
`,
  )

// Status Command

interface StatusOptions {
  network: 'localnet' | 'testnet' | 'mainnet'
}

tokenCommand
  .command('status <token>')
  .description('Check token deployment status')
  .option('-n, --network <network>', 'Target network', 'testnet')
  .action(async (token: string, options: StatusOptions) => {
    const tokenSymbol = token.toUpperCase()
    logger.info(`Checking ${tokenSymbol} status on ${options.network}...\n`)

    // Token info from known tokens
    const tokenInfo = KNOWN_TOKENS[tokenSymbol]
    console.log(chalk.bold('Token Info:'))
    console.log(`  Name:          ${tokenInfo?.name ?? tokenSymbol}`)
    console.log(`  Symbol:        ${tokenSymbol}`)
    console.log(`  Decimals:      18`)
    console.log(`  Total Supply:  ${tokenInfo?.totalSupply ?? 'Custom'}`)
    console.log()

    // Load actual deployments
    const deployments = loadDeployments(options.network)
    const chains = getNetworkConfig(options.network, tokenSymbol)

    console.log(chalk.bold('Deployment Status:'))

    // Check home chain
    const homeDeployment = deployments[chains.homeChain]
    console.log(`  ${chalk.cyan(chains.homeChain)} (home):`)
    if (homeDeployment?.token?.address) {
      console.log(
        `    Token:   ${chalk.green(homeDeployment.token.address.slice(0, 10))}...`,
      )

      // Try to fetch on-chain data
      const rpcUrl = getRpcUrl(options.network)
      const client = createPublicClient({ transport: http(rpcUrl) })

      const tokenAddress = homeDeployment.token.address as `0x${string}`
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
        }),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
        client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }),
      ]).catch(() => [null, null, null, null])

      if (name && symbol && decimals !== null && totalSupply !== null) {
        console.log(`    On-chain: ${name} (${symbol})`)
        console.log(
          `    Supply:   ${formatUnits(totalSupply as bigint, decimals as number)}`,
        )
      }
    } else {
      console.log(`    Token:   ${chalk.dim('Not deployed')}`)
    }

    // Check synthetic chains
    for (const chain of chains.syntheticChains) {
      const chainDeployment = deployments[chain]
      console.log(`  ${chalk.dim(chain)} (synthetic):`)

      if (chainDeployment?.token?.address) {
        console.log(
          `    Token:   ${chalk.green(chainDeployment.token.address.slice(0, 10))}...`,
        )
        if (chainDeployment.router) {
          console.log(
            `    Router:  ${chalk.green(chainDeployment.router.slice(0, 10))}...`,
          )
        } else {
          console.log(`    Router:  ${chalk.dim('Not configured')}`)
        }
      } else {
        console.log(`    Token:   ${chalk.dim('Not deployed')}`)
        console.log(`    Router:  ${chalk.dim('Not configured')}`)
      }
    }
    console.log()

    // Fee configuration (static for now - could be fetched from contract)
    console.log(chalk.bold('Fee Configuration:'))
    console.log(`  XLP Reward:    80% of bridge fees`)
    console.log(`  Protocol:      10% of bridge fees`)
    console.log(`  Burn:          10% of bridge fees`)
    console.log(`  Bridge Fee:    0.05% - 1%`)
    console.log(`  ZK Discount:   20% off bridge fees`)
  })

// Bridge Command

interface BridgeOptions {
  from: string
  to: string
  recipient?: string
  zk?: boolean
  confirm?: boolean
}

tokenCommand
  .command('bridge <token> <amount>')
  .description('Bridge tokens between chains')
  .requiredOption('--from <chain>', 'Source chain')
  .requiredOption('--to <chain>', 'Destination chain')
  .option('--recipient <address>', 'Recipient address (defaults to sender)')
  .option('--zk', 'Use ZK verification for lower fees')
  .option('--confirm', 'Execute the bridge transaction')
  .action(async (token: string, amount: string, options: BridgeOptions) => {
    const tokenName = token.toUpperCase()
    logger.info(
      `Bridging ${amount} ${tokenName} from ${options.from} to ${options.to}...`,
    )

    if (options.zk) {
      logger.info(
        chalk.green('Using ZK verification - 20% fee discount applied'),
      )
    }

    // Quote the transfer
    console.log(chalk.bold('\nTransfer Quote:'))
    console.log(`  Amount:        ${amount} ${tokenName}`)
    console.log(
      `  Bridge Fee:    ${options.zk ? '0.04%' : '0.05%'} (${calculateFee(amount, options.zk)})`,
    )
    console.log(`  Gas Payment:   ~0.001 ETH`)
    console.log(
      `  Net Received:  ${calculateNet(amount, options.zk)} ${tokenName}`,
    )
    console.log(
      `  Est. Time:     ${options.zk ? '10-15 minutes' : '3-5 minutes'}`,
    )
    console.log()

    if (!options.confirm) {
      logger.info('To proceed, run with --confirm flag')
      return
    }

    // Execute bridge
    logger.error('Bridge execution not yet implemented')
    logger.info('Bridge contracts must be deployed first')
    logger.info('Deploy with: jeju deploy token --network <network>')
    process.exit(1)
  })

// Helpers

function getNetworkConfig(network: string, tokenSymbol?: string) {
  // JEJU's home chain is the Jeju network
  const isJeju = tokenSymbol === 'JEJU'

  if (network === 'mainnet') {
    return {
      homeChain: isJeju ? 'jeju' : 'ethereum',
      syntheticChains: isJeju
        ? ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']
        : [
            'base',
            'arbitrum',
            'optimism',
            'polygon',
            'avalanche',
            'bsc',
            'solana',
          ],
    }
  }
  return {
    homeChain: isJeju ? 'jeju-testnet' : 'sepolia',
    syntheticChains: isJeju
      ? ['sepolia', 'base-sepolia', 'arbitrum-sepolia', 'solana-devnet']
      : ['base-sepolia', 'arbitrum-sepolia', 'jeju-testnet', 'solana-devnet'],
  }
}

function calculateFee(amount: string, zk?: boolean): string {
  const amountNum = parseFloat(amount)
  const feePercent = zk ? 0.0004 : 0.0005
  return (amountNum * feePercent).toFixed(4)
}

function calculateNet(amount: string, zk?: boolean): string {
  const amountNum = parseFloat(amount)
  const feePercent = zk ? 0.0004 : 0.0005
  return (amountNum * (1 - feePercent)).toFixed(4)
}
