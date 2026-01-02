/**
 * Jeju Account Command - Manage credits, balance, and usage
 *
 * Provides Vercel-like account management:
 * - View balance and credits
 * - Top up account with ETH/JEJU
 * - View usage statistics
 * - Manage billing tier
 */

import {
  getChainId,
  getDWSUrl,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Command } from 'commander'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { logger } from '../lib/logger'
import type { NetworkType } from '../types'
import { requireLogin } from './login'

// Tier types from DWS
type TierType = 'free' | 'hobby' | 'pro' | 'enterprise'

interface AccountInfo {
  address: Address
  credits: bigint
  tier: TierType
  usage: {
    cpuHoursUsed: number
    cpuHoursLimit: number
    storageUsedGb: number
    storageGbLimit: number
    bandwidthUsedGb: number
    bandwidthGbLimit: number
    deploymentsUsed: number
    deploymentsLimit: number
    invocationsUsed: number
    invocationsLimit: number
  }
  billing: {
    periodStart: number
    periodEnd: number
    estimatedCost: bigint
  }
}

interface TopupResult {
  txHash: string
  amount: bigint
  newBalance: bigint
}

/**
 * Get DWS URL for current network
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
 * Get RPC URL for current network
 */
function getRpcUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_RPC_URL ?? 'https://rpc.jejunetwork.org'
    case 'testnet':
      return (
        process.env.TESTNET_RPC_URL ?? 'https://testnet-rpc.jejunetwork.org'
      )
    default:
      return process.env.RPC_URL ?? getL2RpcUrl()
  }
}

/**
 * Get chain config for network
 */
function getChainForNetwork(network: NetworkType) {
  const chainId = getChainId(network)
  const rpcUrl = getRpcUrlForNetwork(network)

  if (network === 'localnet') {
    return foundry
  }

  return {
    id: chainId,
    name: network === 'mainnet' ? 'Jeju Network' : 'Jeju Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const
}

/**
 * Fetch account info from DWS
 */
async function getAccountInfo(
  address: Address,
  network: NetworkType,
  authToken: string,
): Promise<AccountInfo> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/account/info`, {
    headers: {
      'X-Jeju-Address': address,
      Authorization: `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    // For local development, DWS may not be running
    if (network === 'localnet') {
      logger.warn('DWS not available - showing local defaults')
      return {
        address,
        credits: 0n,
        tier: 'free',
        usage: {
          cpuHoursUsed: 0,
          cpuHoursLimit: 100,
          storageUsedGb: 0,
          storageGbLimit: 1,
          bandwidthUsedGb: 0,
          bandwidthGbLimit: 10,
          deploymentsUsed: 0,
          deploymentsLimit: 3,
          invocationsUsed: 0,
          invocationsLimit: 100_000,
        },
        billing: {
          periodStart: Date.now(),
          periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
          estimatedCost: 0n,
        },
      }
    }
    throw new Error(`Failed to fetch account info: ${response.statusText}`)
  }

  const data = await response.json()

  return {
    address,
    credits: BigInt(data.credits ?? 0),
    tier: data.tier ?? 'free',
    usage: {
      cpuHoursUsed: data.usage?.cpuHoursUsed ?? 0,
      cpuHoursLimit: data.usage?.cpuHoursLimit ?? 100,
      storageUsedGb: data.usage?.storageUsedGb ?? 0,
      storageGbLimit: data.usage?.storageGbLimit ?? 1,
      bandwidthUsedGb: data.usage?.bandwidthUsedGb ?? 0,
      bandwidthGbLimit: data.usage?.bandwidthGbLimit ?? 10,
      deploymentsUsed: data.usage?.deploymentsUsed ?? 0,
      deploymentsLimit: data.usage?.deploymentsLimit ?? 3,
      invocationsUsed: data.usage?.invocationsUsed ?? 0,
      invocationsLimit: data.usage?.invocationsLimit ?? 100_000,
    },
    billing: {
      periodStart: data.billing?.periodStart ?? Date.now(),
      periodEnd:
        data.billing?.periodEnd ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      estimatedCost: BigInt(data.billing?.estimatedCost ?? 0),
    },
  }
}

/**
 * Get ETH balance from chain
 */
async function getEthBalance(
  address: Address,
  network: NetworkType,
): Promise<bigint> {
  const rpcUrl = getRpcUrlForNetwork(network)
  const chain = getChainForNetwork(network)

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  return client.getBalance({ address })
}

/**
 * Get x402 credits from DWS
 */
async function getCredits(
  address: Address,
  network: NetworkType,
): Promise<bigint> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const response = await fetch(`${dwsUrl}/funding/balance/${address}`)

  if (!response.ok) {
    // For local development, DWS may not be running
    if (network === 'localnet') {
      return 0n
    }
    throw new Error(`Failed to fetch credits: ${response.statusText}`)
  }

  const data = await response.json()
  return BigInt(data.balance ?? 0)
}

/**
 * Top up account with ETH
 */
async function topupAccount(
  privateKey: `0x${string}`,
  amount: bigint,
  network: NetworkType,
): Promise<TopupResult> {
  const rpcUrl = getRpcUrlForNetwork(network)
  const chain = getChainForNetwork(network)
  const dwsUrl = getDWSUrlForNetwork(network)

  const account = privateKeyToAccount(privateKey)

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  // Get payment recipient from DWS
  const paymentInfoResponse = await fetch(`${dwsUrl}/funding/info`)

  if (!paymentInfoResponse.ok) {
    throw new Error(
      `Failed to get payment info: ${paymentInfoResponse.statusText}. Is DWS running?`,
    )
  }

  const paymentInfo = await paymentInfoResponse.json()
  const paymentRecipient: Address = paymentInfo.paymentAddress

  if (!paymentRecipient) {
    throw new Error('Payment recipient address not configured in DWS')
  }

  // Send ETH to payment recipient
  const txHash = await walletClient.sendTransaction({
    to: paymentRecipient,
    value: amount,
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Register the payment with DWS
  const registerResponse = await fetch(`${dwsUrl}/funding/topup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Jeju-Address': account.address,
    },
    body: JSON.stringify({
      txHash,
      amount: amount.toString(),
    }),
  })

  let newBalance = amount
  if (registerResponse.ok) {
    const result = await registerResponse.json()
    newBalance = BigInt(result.newBalance ?? amount)
  }

  return {
    txHash,
    amount,
    newBalance,
  }
}

// Main account command
export const accountCommand = new Command('account').description(
  'Manage your Jeju Network account',
)

// Account info (default)
accountCommand
  .command('info', { isDefault: true })
  .description('View account information and usage')
  .action(async () => {
    const credentials = requireLogin()

    logger.header('JEJU ACCOUNT')

    const address = credentials.address as Address
    const network = credentials.network as NetworkType

    logger.keyValue('Address', address)
    logger.keyValue('Network', network)
    logger.newline()

    // Get ETH balance
    logger.step('Fetching balances...')
    const ethBalance = await getEthBalance(address, network)
    const credits = await getCredits(address, network)

    logger.keyValue('ETH Balance', `${formatEther(ethBalance)} ETH`)
    logger.keyValue('DWS Credits', `${formatEther(credits)} credits`)
    logger.newline()

    // Get usage info
    logger.step('Fetching usage...')
    const info = await getAccountInfo(address, network, credentials.authToken)

    logger.keyValue('Tier', info.tier.toUpperCase())
    logger.newline()

    // Usage bars
    logger.info('Usage this period:')

    const usageItems = [
      {
        label: 'CPU Hours',
        used: info.usage.cpuHoursUsed,
        limit: info.usage.cpuHoursLimit,
        unit: 'hrs',
      },
      {
        label: 'Storage',
        used: info.usage.storageUsedGb,
        limit: info.usage.storageGbLimit,
        unit: 'GB',
      },
      {
        label: 'Bandwidth',
        used: info.usage.bandwidthUsedGb,
        limit: info.usage.bandwidthGbLimit,
        unit: 'GB',
      },
      {
        label: 'Deployments',
        used: info.usage.deploymentsUsed,
        limit: info.usage.deploymentsLimit,
        unit: '',
      },
      {
        label: 'Invocations',
        used: info.usage.invocationsUsed,
        limit: info.usage.invocationsLimit,
        unit: '',
      },
    ]

    for (const item of usageItems) {
      const percent =
        item.limit > 0 ? Math.round((item.used / item.limit) * 100) : 0
      const barLength = 20
      const filled = Math.round((percent / 100) * barLength)
      const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled)

      const status = percent >= 90 ? '⚠️ ' : percent >= 75 ? '📊' : '✓ '

      const limitStr =
        item.limit < 0 ? 'unlimited' : `${item.limit}${item.unit}`
      console.log(
        `  ${status} ${item.label.padEnd(12)} [${bar}] ${item.used}/${limitStr} (${percent}%)`,
      )
    }

    logger.newline()
    logger.info(
      `Billing period: ${new Date(info.billing.periodStart).toLocaleDateString()} - ${new Date(info.billing.periodEnd).toLocaleDateString()}`,
    )

    if (info.tier === 'free') {
      logger.newline()
      logger.info('Upgrade to Pro for higher limits: jeju account upgrade')
    }
  })

// Top up credits
accountCommand
  .command('topup')
  .description('Add credits to your account')
  .argument('<amount>', 'Amount in ETH to add')
  .option(
    '-k, --private-key <key>',
    'Private key (or use DEPLOYER_PRIVATE_KEY)',
  )
  .action(async (amountStr, options) => {
    const credentials = requireLogin()

    const amount = parseEther(amountStr)
    if (amount <= 0n) {
      logger.error('Amount must be greater than 0')
      return
    }

    logger.header('JEJU TOPUP')

    const address = credentials.address as Address
    const network = credentials.network as NetworkType

    // Get private key
    let privateKey: `0x${string}`
    if (options.privateKey) {
      privateKey = options.privateKey as `0x${string}`
    } else if (process.env.DEPLOYER_PRIVATE_KEY) {
      privateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
    } else {
      logger.error('Private key required for topup')
      logger.info('Set DEPLOYER_PRIVATE_KEY or use --private-key flag')
      return
    }

    // Validate private key matches logged in address
    const account = privateKeyToAccount(privateKey)
    if (account.address.toLowerCase() !== address.toLowerCase()) {
      logger.error('Private key does not match logged in address')
      return
    }

    // Check balance
    const balance = await getEthBalance(address, network)
    if (balance < amount) {
      logger.error(
        `Insufficient balance. Have ${formatEther(balance)} ETH, need ${amountStr} ETH`,
      )
      return
    }

    logger.step(`Topping up ${amountStr} ETH...`)
    logger.info(`From: ${address}`)
    logger.info(`Network: ${network}`)

    const result = await topupAccount(privateKey, amount, network)

    logger.success('Topup successful.')
    logger.keyValue('Transaction', result.txHash)
    logger.keyValue('Amount', `${formatEther(result.amount)} ETH`)
    logger.keyValue('New Balance', `${formatEther(result.newBalance)} credits`)
  })

// View balance
accountCommand
  .command('balance')
  .description('View current balances')
  .action(async () => {
    const credentials = requireLogin()

    const address = credentials.address as Address
    const network = credentials.network as NetworkType

    const ethBalance = await getEthBalance(address, network)
    const credits = await getCredits(address, network)

    logger.keyValue('Address', address)
    logger.keyValue('Network', network)
    logger.keyValue('ETH', `${formatEther(ethBalance)} ETH`)
    logger.keyValue('Credits', `${formatEther(credits)} credits`)
  })

// Upgrade tier
accountCommand
  .command('upgrade')
  .description('Upgrade your account tier')
  .argument('[tier]', 'Target tier: hobby, pro, enterprise')
  .action(async (tier) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType

    const dwsUrl = getDWSUrlForNetwork(network)

    logger.header('JEJU UPGRADE')

    if (!tier) {
      // Show tier comparison
      logger.info('Available tiers:\n')

      const tiers = [
        {
          name: 'FREE',
          price: '$0/mo',
          features: [
            '100 CPU hours/mo',
            '1 GB storage',
            '10 GB bandwidth',
            '3 deployments',
            '100K invocations',
          ],
        },
        {
          name: 'HOBBY',
          price: '$20/mo',
          features: [
            '1,000 CPU hours/mo',
            '10 GB storage',
            '100 GB bandwidth',
            '10 deployments',
            '1M invocations',
          ],
        },
        {
          name: 'PRO',
          price: '$100/mo',
          features: [
            '10,000 CPU hours/mo',
            '100 GB storage',
            '1 TB bandwidth',
            '50 deployments',
            '10M invocations',
          ],
        },
        {
          name: 'ENTERPRISE',
          price: 'Custom',
          features: [
            'Unlimited CPU',
            'Unlimited storage',
            'Unlimited bandwidth',
            'Unlimited deployments',
            'Unlimited invocations',
          ],
        },
      ]

      for (const t of tiers) {
        console.log(`  ${t.name} - ${t.price}`)
        for (const f of t.features) {
          console.log(`    • ${f}`)
        }
        console.log('')
      }

      logger.info('Run `jeju account upgrade <tier>` to upgrade')
      return
    }

    const validTiers = ['hobby', 'pro', 'enterprise']
    if (!validTiers.includes(tier.toLowerCase())) {
      logger.error(`Invalid tier: ${tier}`)
      logger.info(`Valid tiers: ${validTiers.join(', ')}`)
      return
    }

    // Call upgrade API
    const response = await fetch(`${dwsUrl}/account/upgrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Jeju-Address': credentials.address,
        Authorization: `Bearer ${credentials.authToken}`,
      },
      body: JSON.stringify({ tier: tier.toLowerCase() }),
    })

    if (!response.ok) {
      const error = await response.text()
      logger.error(`Upgrade failed: ${error}`)
      return
    }

    logger.success(`Upgraded to ${tier.toUpperCase()} tier`)
    logger.info('Run `jeju account info` to see your new limits')
  })

// Usage history
accountCommand
  .command('usage')
  .description('View detailed usage history')
  .option('--days <n>', 'Number of days to show', '30')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const dwsUrl = getDWSUrlForNetwork(network)

    const days = parseInt(options.days, 10)

    const response = await fetch(`${dwsUrl}/account/usage?days=${days}`, {
      headers: {
        'X-Jeju-Address': credentials.address,
        Authorization: `Bearer ${credentials.authToken}`,
      },
    })

    if (!response.ok) {
      logger.error('Failed to fetch usage history')
      return
    }

    const usage = await response.json()

    logger.header('USAGE HISTORY')
    logger.info(`Last ${days} days\n`)

    if (usage.daily && usage.daily.length > 0) {
      for (const day of usage.daily.slice(-14)) {
        // Show last 14 days
        const date = new Date(day.date).toLocaleDateString()
        const cpu = day.cpuHours?.toFixed(1) ?? 0
        const storage = day.storageGb?.toFixed(2) ?? 0
        const invocations = day.invocations ?? 0

        console.log(
          `  ${date}: ${cpu} CPU hrs, ${storage} GB storage, ${invocations} invocations`,
        )
      }
    } else {
      logger.info('No usage data available')
    }
  })

// List transactions
accountCommand
  .command('transactions')
  .description('View transaction history')
  .option('--limit <n>', 'Number of transactions to show', '10')
  .action(async (options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const dwsUrl = getDWSUrlForNetwork(network)

    const limit = parseInt(options.limit, 10)

    const response = await fetch(
      `${dwsUrl}/account/transactions?limit=${limit}`,
      {
        headers: {
          'X-Jeju-Address': credentials.address,
          Authorization: `Bearer ${credentials.authToken}`,
        },
      },
    )

    if (!response.ok) {
      logger.error('Failed to fetch transactions')
      return
    }

    const data = await response.json()

    logger.header('TRANSACTIONS')

    if (data.transactions && data.transactions.length > 0) {
      for (const tx of data.transactions) {
        const date = new Date(tx.timestamp).toLocaleDateString()
        const type = tx.type.padEnd(10)
        const amount = formatEther(BigInt(tx.amount))
        const status = tx.status === 'success' ? '✓' : '✗'

        console.log(
          `  ${status} ${date} ${type} ${amount} ETH  ${tx.txHash?.slice(0, 10)}...`,
        )
      }
    } else {
      logger.info('No transactions found')
    }
  })
