#!/usr/bin/env bun

/**
 * DAO Registry Deployment and Management Script
 *
 * Commands:
 *   deploy   - Deploy DAORegistry and DAOFunding contracts
 *   create   - Create a new DAO
 *   list     - List all DAOs
 *   status   - Get DAO status
 *   seed     - Seed DAO with packages/repos
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  type DAODeploymentConfig,
  DAODeploymentConfigSchema,
  expectJson,
} from '../../schemas'

interface DAOCreateParams {
  name: string
  displayName: string
  description: string
  treasuryAddress: Address
  directorName: string
  directorDescription: string
  directorPersonality: string
  directorTraits: string[]
  directorCommunicationTone: string
}

/** DAO data returned by getDAO contract call */
interface DAOData {
  name: string
  displayName: string
  description: string
  status: number
  treasury: Address
  council: Address
  directorAgent: Address
  createdAt: bigint
}

/** Director persona data returned by getDirectorPersona contract call */
interface DirectorPersonaData {
  name: string
  description: string
  personality: string
  traits: readonly string[]
}
const DAORegistryABI = [
  {
    type: 'function',
    name: 'createDAO',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'displayName', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'treasury', type: 'address' },
      { name: 'manifestCid', type: 'string' },
      {
        name: 'directorPersona',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'minQualityScore', type: 'uint256' },
          { name: 'councilVotingPeriod', type: 'uint256' },
          { name: 'gracePeriod', type: 'uint256' },
          { name: 'minProposalStake', type: 'uint256' },
          { name: 'quorumBps', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'daoId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAllDAOs',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAO',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'daoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'displayName', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'treasury', type: 'address' },
          { name: 'council', type: 'address' },
          { name: 'directorAgent', type: 'address' },
          { name: 'feeConfig', type: 'address' },
          { name: 'directorModelId', type: 'bytes32' },
          { name: 'manifestCid', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'creator', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDirectorPersona',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedPackages',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedRepos',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'DAOCreated',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'treasury', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
    ],
  },
] as const
function getChainConfig(network: string) {
  switch (network) {
    case 'mainnet':
      return {
        chain: base,
        rpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
      }
    case 'testnet':
      return {
        chain: baseSepolia,
        rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
      }
    default:
      return {
        chain: localhost,
        rpcUrl: process.env.LOCAL_RPC_URL ?? 'http://localhost:6546',
      }
  }
}

async function loadDeployment(
  network: string,
): Promise<DAODeploymentConfig | null> {
  const path = join(
    __dirname,
    '..',
    '..',
    'config',
    'deployments',
    `${network}.json`,
  )
  const content = await readFile(path, 'utf-8').catch(() => null)
  return content
    ? expectJson(
        content,
        DAODeploymentConfigSchema,
        `deployment config ${network}`,
      )
    : null
}

function printHelp(): void {
  console.log(`
DAO Registry CLI

Usage:
  bun run scripts/deploy/dao-registry.ts <command> [options]

Commands:
  deploy [network]              Deploy DAORegistry and DAOFunding contracts
  create <name> [network]       Create a new DAO
  list [network]                List all DAOs
  status <daoId> [network]      Get DAO status
  jeju [network]                Create Jeju DAO

Networks:
  localnet (default), testnet, mainnet

Environment:
  DEPLOYER_KEY or PRIVATE_KEY - Deployer private key
  *_RPC_URL - Network RPC URLs

Examples:
  bun run scripts/deploy/dao-registry.ts deploy localnet
  bun run scripts/deploy/dao-registry.ts jeju localnet
  bun run scripts/deploy/dao-registry.ts list mainnet
`)
}
async function deployContracts(network: string): Promise<void> {
  console.log(`\nDeploying DAO contracts to ${network}...`)

  const privateKey = process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_KEY or PRIVATE_KEY required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  console.log(`Deployer: ${account.address}`)

  // For localnet, we need to deploy. For other networks, check if already deployed
  const existing = await loadDeployment(network)
  if (existing?.contracts.DAORegistry) {
    console.log(
      `DAORegistry already deployed at ${existing.contracts.DAORegistry}`,
    )
    console.log(`DAOFunding at ${existing.contracts.DAOFunding}`)
    return
  }

  console.log('\nNote: Contract deployment requires forge/foundry.')
  console.log(
    'Run: forge script script/DeployDAORegistry.s.sol --rpc-url <url> --broadcast',
  )
  console.log('\nOr use the deployment info after running forge scripts.')
}

async function createDAO(
  name: string,
  network: string,
  params: Partial<DAOCreateParams> = {},
): Promise<void> {
  console.log(`\nCreating DAO "${name}" on ${network}...`)

  const deployment = await loadDeployment(network)
  if (!deployment?.contracts.DAORegistry) {
    throw new Error(`DAORegistry not deployed on ${network}. Run deploy first.`)
  }

  const chainConfig = getChainConfig(network)
  const privateKey = process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_KEY or PRIVATE_KEY required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  const displayName =
    params.displayName ?? `${name.charAt(0).toUpperCase() + name.slice(1)} DAO`
  const description = params.description ?? `${displayName} governance`

  const hash = await walletClient.writeContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'createDAO',
    args: [
      name,
      displayName,
      description,
      params.treasuryAddress ?? account.address,
      '',
      {
        name: params.directorName ?? 'Director',
        pfpCid: '',
        description: params.directorDescription ?? 'AI governance leader',
        personality:
          params.directorPersonality ?? 'Professional and analytical',
        traits: params.directorTraits ?? ['decisive', 'fair', 'strategic'],
      },
      {
        minQualityScore: BigInt(70),
        councilVotingPeriod: BigInt(259200),
        gracePeriod: BigInt(86400),
        minProposalStake: parseEther('0.01'),
        quorumBps: BigInt(5000),
      },
    ],
  })

  console.log(`TX: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`DAO created in block ${receipt.blockNumber}`)

  // Extract DAO ID from logs
  const firstLog = receipt.logs[0]
  const daoId = firstLog.topics[1] ?? 'unknown'
  console.log(`DAO ID: ${daoId}`)
}

async function createJejuDAO(network: string): Promise<void> {
  await createDAO('jeju', network, {
    displayName: 'Jeju DAO',
    description:
      'Jeju Network governance - controls chain-level fees, treasury, and overall protocol direction',
    directorName: 'Jeju Director',
    directorDescription:
      'The AI governance leader of Jeju Network, responsible for strategic decisions and protocol stewardship',
    directorPersonality:
      'Analytical, strategic, and community-focused. Makes decisions based on data and long-term network health.',
    directorTraits: [
      'strategic',
      'analytical',
      'fair',
      'transparent',
      'community-focused',
    ],
    directorCommunicationTone: 'professional',
  })
}

async function listDAOs(network: string): Promise<void> {
  console.log(`\nListing DAOs on ${network}...`)

  const deployment = await loadDeployment(network)
  if (!deployment?.contracts.DAORegistry) {
    throw new Error(`DAORegistry not deployed on ${network}`)
  }

  const chainConfig = getChainConfig(network)
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  const daoIds = (await publicClient.readContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'getAllDAOs',
  })) as readonly `0x${string}`[]

  console.log(`\nFound ${daoIds.length} DAOs:\n`)

  for (const daoId of daoIds) {
    const dao = (await publicClient.readContract({
      address: deployment.contracts.DAORegistry as `0x${string}`,
      abi: DAORegistryABI,
      functionName: 'getDAO',
      args: [daoId],
    })) as DAOData

    const persona = (await publicClient.readContract({
      address: deployment.contracts.DAORegistry as `0x${string}`,
      abi: DAORegistryABI,
      functionName: 'getDirectorPersona',
      args: [daoId],
    })) as DirectorPersonaData

    const statusMap = ['Pending', 'Active', 'Paused', 'Archived']
    console.log(`  ${dao.displayName} (${dao.name})`)
    console.log(`    ID: ${daoId}`)
    console.log(`    Director: ${persona.name}`)
    console.log(`    Status: ${statusMap[dao.status] ?? 'Unknown'}`)
    console.log(`    Treasury: ${dao.treasury}`)
    console.log('')
  }
}

async function getDAOStatus(daoId: string, network: string): Promise<void> {
  console.log(`\nGetting status for DAO ${daoId} on ${network}...`)

  const deployment = await loadDeployment(network)
  if (!deployment?.contracts.DAORegistry) {
    throw new Error(`DAORegistry not deployed on ${network}`)
  }

  const chainConfig = getChainConfig(network)
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  const dao = (await publicClient.readContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'getDAO',
    args: [daoId as `0x${string}`],
  })) as DAOData

  const persona = (await publicClient.readContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'getDirectorPersona',
    args: [daoId as `0x${string}`],
  })) as DirectorPersonaData

  const packages = (await publicClient.readContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'getLinkedPackages',
    args: [daoId as `0x${string}`],
  })) as readonly `0x${string}`[]

  const repos = (await publicClient.readContract({
    address: deployment.contracts.DAORegistry as `0x${string}`,
    abi: DAORegistryABI,
    functionName: 'getLinkedRepos',
    args: [daoId as `0x${string}`],
  })) as readonly `0x${string}`[]

  const statusMap = ['Pending', 'Active', 'Paused', 'Archived']

  console.log(`
${'='.repeat(60)}
${dao.displayName}
${'='.repeat(60)}

Basic Info:
  Name: ${dao.name}
  Description: ${dao.description}
  Status: ${statusMap[dao.status] ?? 'Unknown'}
  Created: ${new Date(Number(dao.createdAt) * 1000).toISOString()}

Director Persona:
  Name: ${persona.name}
  Description: ${persona.description}
  Personality: ${persona.personality}
  Traits: ${[...persona.traits].join(', ')}

Contracts:
  Treasury: ${dao.treasury}
  Council: ${dao.council}
  Director Agent: ${dao.directorAgent}

Linked Resources:
  Packages: ${packages.length}
  Repos: ${repos.length}
`)
}
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    printHelp()
    return
  }

  switch (command) {
    case 'deploy':
      await deployContracts(args[1] ?? 'localnet')
      break

    case 'create':
      if (!args[1]) {
        console.error('DAO name required')
        process.exit(1)
      }
      await createDAO(args[1], args[2] ?? 'localnet')
      break

    case 'jeju':
      await createJejuDAO(args[1] ?? 'localnet')
      break

    case 'list':
      await listDAOs(args[1] ?? 'localnet')
      break

    case 'status':
      if (!args[1]) {
        console.error('DAO ID required')
        process.exit(1)
      }
      await getDAOStatus(args[1], args[2] ?? 'localnet')
      break

    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
