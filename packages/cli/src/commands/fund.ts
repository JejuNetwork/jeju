/**
 * jeju fund - Fund development accounts
 *
 * Security notes:
 * - Addresses are validated before use
 * - Amounts are validated and bounded
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { checkRpcHealth } from '../lib/chain'
import { logger } from '../lib/logger'
import { sanitizeErrorMessage, validateAddress } from '../lib/security'
import { findMonorepoRoot } from '../lib/system'
import { DEFAULT_PORTS, WELL_KNOWN_KEYS } from '../types'

const localnetChain = {
  id: 1337,
  name: 'Network Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [`http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`] } },
} as const

export const fundCommand = new Command('fund')
  .description('Fund accounts (localnet faucet or testnet deployer)')
  .argument('[address]', 'Address to fund')
  .option('-a, --amount <eth>', 'Amount in ETH', '10')
  .option('--all', 'Fund all dev accounts')
  .option('--testnet', 'Fund testnet deployer across all testnets')
  .option('--bridge', 'Bridge ETH to L2s (use with --testnet)')
  .action(async (address, options) => {
    // Handle testnet deployer funding
    if (options.testnet) {
      await fundTestnetDeployer(options.bridge)
      return
    }
    const rpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`

    const isHealthy = await checkRpcHealth(rpcUrl, 3000)
    if (!isHealthy) {
      logger.error('Localnet not running. Start with: jeju dev')
      return
    }

    // Fund all dev accounts
    if (options.all) {
      await fundAllDevAccounts(rpcUrl, options.amount)
      return
    }

    // Fund specific address
    if (address) {
      await fundAddress(rpcUrl, address, options.amount)
      return
    }

    // No args - show balances
    await showBalances(rpcUrl)
  })

async function fundAddress(
  rpcUrl: string,
  address: string,
  amountEth: string,
): Promise<boolean> {
  // Validate address using security utility
  let validAddress: `0x${string}`
  try {
    validAddress = validateAddress(address)
  } catch {
    logger.error('Invalid address format')
    return false
  }

  // Validate amount
  const amountNum = parseFloat(amountEth)
  if (Number.isNaN(amountNum) || amountNum <= 0 || amountNum > 10000) {
    logger.error('Invalid amount: must be between 0 and 10000 ETH')
    return false
  }

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  })

  const funder = WELL_KNOWN_KEYS.dev[0]
  const account = privateKeyToAccount(funder.privateKey as `0x${string}`)

  const funderBalance = await client.getBalance({ address: account.address })
  const requiredAmount = parseEther(amountEth)

  if (funderBalance < requiredAmount) {
    logger.error(`Funder balance too low: ${formatEther(funderBalance)} ETH`)
    return false
  }

  logger.step(`Sending ${amountEth} ETH to ${validAddress.slice(0, 10)}...`)

  try {
    const hash = await walletClient.sendTransaction({
      account,
      to: validAddress,
      value: requiredAmount,
    })

    const receipt = await client.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      const newBalance = await client.getBalance({ address: validAddress })
      logger.success(`Done. Balance: ${formatEther(newBalance)} ETH`)
      return true
    } else {
      logger.error('Transaction failed')
      return false
    }
  } catch (error) {
    logger.error(`Transaction error: ${sanitizeErrorMessage(error as Error)}`)
    return false
  }
}

async function fundAllDevAccounts(
  rpcUrl: string,
  amountEth: string,
): Promise<void> {
  logger.header('FUND DEV ACCOUNTS')

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  })

  const funder = WELL_KNOWN_KEYS.dev[0]
  const account = privateKeyToAccount(funder.privateKey as `0x${string}`)
  const targetAmount = parseFloat(amountEth)

  for (let i = 1; i < WELL_KNOWN_KEYS.dev.length; i++) {
    const target = WELL_KNOWN_KEYS.dev[i]

    const currentBalance = await client.getBalance({
      address: target.address as `0x${string}`,
    })
    const currentEth = parseFloat(formatEther(currentBalance))

    if (currentEth >= targetAmount) {
      logger.info(`#${i}: ${currentEth.toFixed(2)} ETH (already funded)`)
      continue
    }

    const needed = targetAmount - currentEth

    try {
      const hash = await walletClient.sendTransaction({
        account,
        to: target.address as `0x${string}`,
        value: parseEther(needed.toString()),
      })

      await client.waitForTransactionReceipt({ hash })
      logger.success(`#${i}: +${needed.toFixed(2)} ETH`)
    } catch {
      logger.error(`#${i}: Failed`)
    }
  }

  logger.success('Done')
}

async function showBalances(rpcUrl: string): Promise<void> {
  logger.header('DEV ACCOUNT BALANCES')

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  })

  for (let i = 0; i < WELL_KNOWN_KEYS.dev.length; i++) {
    const key = WELL_KNOWN_KEYS.dev[i]
    const balance = await client.getBalance({
      address: key.address as `0x${string}`,
    })
    const eth = formatEther(balance)

    const role = i === 0 ? 'Deployer' : i === 4 ? 'Operator' : `User ${i}`

    logger.table([
      {
        label: `#${i} ${role}`,
        value: `${parseFloat(eth).toFixed(4)} ETH`,
        status: parseFloat(eth) > 0.1 ? 'ok' : 'warn',
      },
    ])
  }

  logger.newline()
  logger.info('Fund address:  jeju fund 0x...')
  logger.info('Fund all:      jeju fund --all')
}

async function fundTestnetDeployer(bridge: boolean): Promise<void> {
  const rootDir = findMonorepoRoot()
  const scriptPath = join(
    rootDir,
    'packages/deployment/scripts/deploy/fund-testnet-deployer.ts',
  )

  if (!existsSync(scriptPath)) {
    logger.error('Fund testnet deployer script not found')
    return
  }

  const args: string[] = []
  if (bridge) args.push('--bridge')

  await execa('bun', ['run', scriptPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}
