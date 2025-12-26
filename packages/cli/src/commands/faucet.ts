/** Multi-chain testnet faucet */

import { Command } from 'commander'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  isAddress,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, sepolia } from 'viem/chains'
import { loadPrivateKey } from '../lib/keys'
import { logger } from '../lib/logger'
import { validateAddress } from '../lib/security'

const CHAINS = {
  jeju: {
    id: 84532, // Base Sepolia
    name: 'Jeju Testnet',
    rpc: 'https://sepolia.base.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
    explorer: 'https://sepolia.basescan.org',
    native: 'ETH',
  },
  base: {
    id: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
    explorer: 'https://sepolia.basescan.org',
    native: 'ETH',
  },
  ethereum: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpc: 'https://rpc.sepolia.org',
    faucet: 'https://sepoliafaucet.com',
    explorer: 'https://sepolia.etherscan.io',
    native: 'ETH',
  },
  solana: {
    id: 0,
    name: 'Solana Devnet',
    rpc: 'https://api.devnet.solana.com',
    faucet: 'https://faucet.solana.com',
    explorer: 'https://explorer.solana.com/?cluster=devnet',
    native: 'SOL',
  },
}

type ChainName = keyof typeof CHAINS

export const faucetCommand = new Command('faucet')
  .description('Request testnet funds from faucets')
  .argument('[address]', 'Address to fund (defaults to deployer)')
  .option(
    '-c, --chain <chain>',
    'Chain to use (jeju, base, ethereum, solana)',
    'jeju',
  )
  .option('-a, --amount <eth>', 'Amount in ETH (for self-funding)', '0.1')
  .option('--list', 'List all available faucets')
  .option('--check', 'Check balance only')
  .option('--self-fund', 'Fund from your own wallet (requires DEPLOYER_KEY)')
  .action(async (address, options) => {
    // List faucets
    if (options.list) {
      listFaucets()
      return
    }

    const chainName = options.chain.toLowerCase() as ChainName
    const chain = CHAINS[chainName]

    if (!chain) {
      logger.error(`Unknown chain: ${options.chain}`)
      logger.info(`Available chains: ${Object.keys(CHAINS).join(', ')}`)
      return
    }

    // Get target address
    let targetAddress = address
    if (!targetAddress) {
      const key = loadPrivateKey('deployer')
      if (key) {
        const account = privateKeyToAccount(key as `0x${string}`)
        targetAddress = account.address
        logger.info(`Using deployer address: ${targetAddress}`)
      } else {
        logger.error('No address provided and no deployer key found')
        logger.info('Run: jeju keys generate deployer')
        return
      }
    }

    if (!isAddress(targetAddress)) {
      logger.error('Invalid address format')
      return
    }

    // Check balance
    if (options.check || !options.selfFund) {
      await checkBalance(chainName, targetAddress)
    }

    // Self-fund option
    if (options.selfFund) {
      await selfFund(chainName, targetAddress, options.amount)
      return
    }

    // Show faucet link
    logger.newline()
    logger.header(`${chain.name.toUpperCase()} FAUCET`)
    logger.info(`Get free ${chain.native} for testing:`)
    logger.newline()
    logger.info(`  ${chain.faucet}`)
    logger.newline()

    if (chainName === 'solana') {
      logger.info('For Solana, use the web faucet or run:')
      logger.info(`  solana airdrop 2 ${targetAddress} --url devnet`)
    } else {
      logger.info('Paste your address in the faucet and request funds.')
      logger.info(`Your address: ${targetAddress}`)
    }

    logger.newline()
    logger.info(`Explorer: ${chain.explorer}`)
  })

function listFaucets(): void {
  logger.header('TESTNET FAUCETS')
  logger.newline()

  for (const [key, chain] of Object.entries(CHAINS)) {
    logger.table([
      {
        label: `${chain.name} (${key})`,
        value: chain.native,
        status: 'ok',
      },
    ])
    logger.info(`  Faucet:   ${chain.faucet}`)
    logger.info(`  Explorer: ${chain.explorer}`)
    logger.newline()
  }

  logger.info('Usage: jeju faucet [address] --chain <chain>')
}

async function checkSolanaBalance(
  address: string,
  rpcUrl: string,
): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [address],
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Solana RPC error: ${response.status}`)
  }

  const data = (await response.json()) as {
    result?: { value: number }
    error?: { message: string }
  }
  if (data.error) {
    throw new Error(data.error.message)
  }

  // Balance is in lamports (1 SOL = 1e9 lamports)
  return (data.result?.value ?? 0) / 1e9
}

async function checkBalance(
  chainName: ChainName,
  address: string,
): Promise<void> {
  const chain = CHAINS[chainName]

  if (chainName === 'solana') {
    const solBalance = await checkSolanaBalance(address, chain.rpc)
    logger.table([
      {
        label: `${chain.name} Balance`,
        value: `${solBalance.toFixed(4)} ${chain.native}`,
        status: solBalance >= 0.5 ? 'ok' : 'warn',
      },
    ])

    if (solBalance < 0.5) {
      logger.warn('Low balance. Request funds from faucet.')
    }
    return
  }

  const viemChain = chainName === 'ethereum' ? sepolia : baseSepolia

  const client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc),
  })

  const balance = await client.getBalance({ address: address as `0x${string}` })
  const ethBalance = formatEther(balance)

  logger.table([
    {
      label: `${chain.name} Balance`,
      value: `${parseFloat(ethBalance).toFixed(4)} ${chain.native}`,
      status: parseFloat(ethBalance) >= 0.01 ? 'ok' : 'warn',
    },
  ])

  if (parseFloat(ethBalance) < 0.01) {
    logger.warn('Low balance. Request funds from faucet.')
  }
}

async function requestSolanaAirdrop(
  address: string,
  lamports: number,
  rpcUrl: string,
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'requestAirdrop',
      params: [address, lamports],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`Solana RPC error: ${response.status}`)
  }

  const data = (await response.json()) as {
    result?: string
    error?: { message: string }
  }
  if (data.error) {
    throw new Error(data.error.message)
  }

  return data.result ?? ''
}

async function selfFund(
  chainName: ChainName,
  targetAddress: string,
  amountEth: string,
): Promise<void> {
  if (chainName === 'solana') {
    const chain = CHAINS.solana
    const amountSol = parseFloat(amountEth)

    // Solana devnet limits airdrops to 2 SOL
    if (amountSol > 2) {
      logger.warn('Solana devnet limits airdrops to 2 SOL. Requesting 2 SOL.')
    }

    const lamports = Math.min(amountSol, 2) * 1e9

    logger.step(
      `Requesting ${Math.min(amountSol, 2)} SOL airdrop to ${targetAddress.slice(0, 10)}...`,
    )

    const signature = await requestSolanaAirdrop(
      targetAddress,
      lamports,
      chain.rpc,
    )

    if (signature) {
      logger.success(
        `Airdrop requested. Signature: ${signature.slice(0, 20)}...`,
      )
      logger.info(`Explorer: ${chain.explorer}/tx/${signature}`)
    } else {
      logger.error(
        'Airdrop request failed. The devnet faucet may be rate-limited.',
      )
      logger.info('Try again later or use: https://faucet.solana.com')
    }
    return
  }

  const validAddress = validateAddress(targetAddress)

  const amountNum = parseFloat(amountEth)
  if (Number.isNaN(amountNum) || amountNum <= 0 || amountNum > 100) {
    logger.error('Invalid amount: must be between 0 and 100 ETH')
    return
  }

  const key = loadPrivateKey('deployer')
  if (!key) {
    logger.error('No deployer key found')
    logger.info('Run: jeju keys generate deployer')
    return
  }

  const chain = CHAINS[chainName]
  const viemChain = chainName === 'ethereum' ? sepolia : baseSepolia

  const account = privateKeyToAccount(key as `0x${string}`)

  if (account.address.toLowerCase() === validAddress.toLowerCase()) {
    logger.error('Cannot self-fund to the same address')
    return
  }

  const client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc),
  })

  const walletClient = createWalletClient({
    chain: viemChain,
    transport: http(chain.rpc),
    account,
  })

  const senderBalance = await client.getBalance({ address: account.address })
  const amount = parseEther(amountEth)

  if (senderBalance < amount) {
    logger.error(
      `Insufficient balance: ${formatEther(senderBalance)} ${chain.native}`,
    )
    return
  }

  logger.step(
    `Sending ${amountEth} ${chain.native} to ${validAddress.slice(0, 10)}...`,
  )

  const hash = await walletClient.sendTransaction({
    to: validAddress,
    value: amount,
  })

  const receipt = await client.waitForTransactionReceipt({ hash })

  if (receipt.status === 'success') {
    logger.success(`Sent. TX: ${hash}`)
    logger.info(`Explorer: ${chain.explorer}/tx/${hash}`)
  } else {
    logger.error('Transaction failed')
  }
}

// Faucet contract deployment is handled via the main deploy command
// Use: jeju deploy faucet --network testnet
