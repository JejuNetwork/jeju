/**
 * JNS (Jeju Name Service) CLI Commands
 *
 * Manage JNS names and records for decentralized app routing.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  namehash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import type { NetworkType } from '../types'

// JNS Resolver ABI
const JNS_RESOLVER_ABI = [
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
] as const

function getNetworkConfig(network: NetworkType): {
  rpcUrl: string
  chainId: number
} {
  switch (network) {
    case 'localnet':
      return { rpcUrl: 'http://localhost:6546', chainId: 31337 }
    case 'testnet':
      return {
        rpcUrl: 'https://testnet-rpc.jejunetwork.org',
        chainId: 420690,
      }
    case 'mainnet':
      return { rpcUrl: 'https://rpc.jejunetwork.org', chainId: 420691 }
  }
}

function loadContracts(network: NetworkType): { jnsResolver: Address } | null {
  const rootDir = findMonorepoRoot()
  const deploymentFile = join(
    rootDir,
    `packages/contracts/deployments/dws-${network}.json`,
  )

  if (!existsSync(deploymentFile)) {
    return null
  }

  const data = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
  return { jnsResolver: data.jnsResolver as Address }
}

export const jnsCommand = new Command('jns').description(
  'JNS (Jeju Name Service) management',
)

jnsCommand
  .command('lookup')
  .description('Look up JNS records for a name')
  .argument('<name>', 'JNS name (e.g., autocrat or autocrat.jeju)')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'testnet',
  )
  .action(async (name: string, options) => {
    const network = options.network as NetworkType
    const jnsName = name.endsWith('.jeju') ? name : `${name}.jeju`

    logger.header(`JNS LOOKUP: ${jnsName}`)

    const contracts = loadContracts(network)
    if (!contracts) {
      logger.error(`DWS contracts not deployed on ${network}`)
      return
    }

    const config = getNetworkConfig(network)
    const client = createPublicClient({
      transport: http(config.rpcUrl),
    })

    const node = namehash(jnsName)
    logger.keyValue('Name', jnsName)
    logger.keyValue('Node', node)
    logger.keyValue('Resolver', contracts.jnsResolver)
    logger.newline()

    // Read text records
    const textKeys = [
      'dws.worker',
      'dws.workerId',
      'dws.databaseId',
      'dws.endpoint',
      'url',
      'description',
    ]

    logger.info('Text Records:')
    for (const key of textKeys) {
      try {
        const value = await client.readContract({
          address: contracts.jnsResolver,
          abi: JNS_RESOLVER_ABI,
          functionName: 'text',
          args: [node, key],
        })
        if (value) {
          logger.keyValue(`  ${key}`, value)
        }
      } catch {
        // No record
      }
    }

    // Read contenthash
    try {
      const contenthash = await client.readContract({
        address: contracts.jnsResolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })
      if (contenthash && contenthash !== '0x') {
        logger.keyValue('Contenthash', contenthash)
      }
    } catch {
      // No contenthash
    }
  })

jnsCommand
  .command('set-worker')
  .description('Set the dws.worker text record for an app')
  .argument('<name>', 'JNS name (e.g., autocrat)')
  .argument('<worker>', 'Worker CID or ID (e.g., bun:Qm... or workerd:uuid)')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'testnet',
  )
  .option(
    '--private-key <key>',
    'Private key (or set DEPLOYER_PRIVATE_KEY env)',
  )
  .action(async (name: string, worker: string, options) => {
    const network = options.network as NetworkType
    const jnsName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const privateKey = options.privateKey ?? process.env.DEPLOYER_PRIVATE_KEY

    if (!privateKey) {
      logger.error(
        'Private key required. Set --private-key or DEPLOYER_PRIVATE_KEY',
      )
      process.exit(1)
    }

    logger.header(`SET DWS.WORKER: ${jnsName}`)

    const contracts = loadContracts(network)
    if (!contracts) {
      logger.error(`DWS contracts not deployed on ${network}`)
      return
    }

    const config = getNetworkConfig(network)
    const account = privateKeyToAccount(privateKey as `0x${string}`)

    const client = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    })

    const publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })

    const node = namehash(jnsName)

    logger.keyValue('Name', jnsName)
    logger.keyValue('Worker', worker)
    logger.keyValue('Account', account.address)
    logger.newline()

    logger.step('Setting dws.worker text record...')

    const hash = await client.writeContract({
      address: contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, 'dws.worker', worker],
      chain: null,
    })

    logger.info(`Transaction: ${hash}`)

    await publicClient.waitForTransactionReceipt({ hash })

    logger.success('dws.worker record set')
    logger.info(`\nVerify with: jeju jns lookup ${name} --network ${network}`)
  })

jnsCommand
  .command('set-text')
  .description('Set any text record for a JNS name')
  .argument('<name>', 'JNS name (e.g., autocrat)')
  .argument('<key>', 'Text record key (e.g., dws.databaseId)')
  .argument('<value>', 'Text record value')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'testnet',
  )
  .option(
    '--private-key <key>',
    'Private key (or set DEPLOYER_PRIVATE_KEY env)',
  )
  .action(async (name: string, key: string, value: string, options) => {
    const network = options.network as NetworkType
    const jnsName = name.endsWith('.jeju') ? name : `${name}.jeju`
    const privateKey = options.privateKey ?? process.env.DEPLOYER_PRIVATE_KEY

    if (!privateKey) {
      logger.error(
        'Private key required. Set --private-key or DEPLOYER_PRIVATE_KEY',
      )
      process.exit(1)
    }

    logger.header(`SET TEXT RECORD: ${jnsName}`)

    const contracts = loadContracts(network)
    if (!contracts) {
      logger.error(`DWS contracts not deployed on ${network}`)
      return
    }

    const config = getNetworkConfig(network)
    const account = privateKeyToAccount(privateKey as `0x${string}`)

    const client = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    })

    const publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })

    const node = namehash(jnsName)

    logger.keyValue('Name', jnsName)
    logger.keyValue('Key', key)
    logger.keyValue('Value', value)
    logger.newline()

    logger.step('Setting text record...')

    const hash = await client.writeContract({
      address: contracts.jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, value],
      chain: null,
    })

    logger.info(`Transaction: ${hash}`)

    await publicClient.waitForTransactionReceipt({ hash })

    logger.success(`${key} record set`)
  })
