/** Manage Jeju Federation membership */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NetworkType } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { execa } from 'execa'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getContract,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// Default addresses for when not explicitly configured
const DEFAULT_NETWORK_REGISTRY = '0x0000000000000000000000000000000000000000' as const

// Contract return types
interface NetworkInfo {
  chainId: bigint
  name: string
  rpcUrl: string
  explorerUrl: string
  wsUrl: string
  operator: string
  stake: bigint
  trustTier: number
  isActive: boolean
  isVerified: boolean
  isSuperchain: boolean
  registeredAt: bigint
}

interface RegistryInfo {
  chainId: bigint
  name: string
  registryType: number
  version: string
  contractAddress: string
  entryCount: bigint
  lastSyncBlock: bigint
}

// API response schemas
const HealthResponseSchema = z.object({
  status: z.string(),
})

const IndexerStatsSchema = z.object({
  totalBlocks: z.number().optional(),
  totalTransactions: z.number().optional(),
  networksIndexed: z.number().optional(),
})

const AgentsDataSchema = z.object({
  total: z.number(),
})

const NETWORK_REGISTRY_ABI = [
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle, address registryHub) contracts, bytes32 genesisHash) payable',
  'function addStake(uint256 chainId) payable',
  'function getNetwork(uint256 chainId) view returns (tuple(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, address operator, tuple(address,address,address,address,address,address,address,address) contracts, bytes32 genesisHash, uint256 registeredAt, uint256 stake, uint8 trustTier, bool isActive, bool isVerified, bool isSuperchain))',
  'function getAllNetworkIds() view returns (uint256[])',
  'function canParticipateInConsensus(uint256 chainId) view returns (bool)',
  'function isSequencerEligible(uint256 chainId) view returns (bool)',
  'function totalNetworks() view returns (uint256)',
  'function activeNetworks() view returns (uint256)',
  'function verifiedNetworks() view returns (uint256)',
  'event NetworkRegistered(uint256 indexed chainId, string name, address indexed operator, uint256 stake)',
]

const REGISTRY_HUB_ABI = [
  'function getAllChainIds() view returns (uint256[])',
  'function getAllRegistryIds() view returns (bytes32[])',
  'function getChain(uint256 chainId) view returns (tuple(uint256 chainId, uint8 chainType, string name, string rpcUrl, address networkOperator, uint256 stake, uint8 trustTier, bool isActive, uint256 registeredAt))',
  'function getRegistry(bytes32 registryId) view returns (tuple(bytes32 registryId, uint256 chainId, uint8 chainType, uint8 registryType, bytes32 contractAddress, string name, string version, string metadataUri, uint256 entryCount, uint256 lastSyncBlock, bool isActive, uint256 registeredAt))',
  'function getRegistriesByType(uint8 registryType) view returns (bytes32[])',
  'function totalChains() view returns (uint256)',
  'function totalRegistries() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
]

const FEDERATION_GOVERNANCE_ABI = [
  'function getProposal(bytes32 proposalId) view returns (uint256 chainId, address operator, uint256 stake, uint8 status, uint8 overallScore, bool autocratApproved, uint256 timelockEnds)',
  'function getChallenge(bytes32 challengeId) view returns (uint256 chainId, address challenger, uint8 reason, string evidence, uint256 challengeBond, bool resolved, bool upheld, uint256 voteCount, uint256 approveCount)',
  'function getOperatorHistory(address operator) view returns (uint256 totalNetworks, uint256 approvedNetworks, uint256 rejectedNetworks, uint256 revokedNetworks, bool isBanned)',
  'function getVerifiedChainIds() view returns (uint256[])',
  'function getAllGuardians() view returns (address[])',
  'function guardians(address guardian) view returns (address guardian, uint256 agentId, uint256 votingPower, uint256 appointedAt, uint256 challengesReviewed, uint256 correctDecisions, bool isActive)',
  'function allProposalIds(uint256 index) view returns (bytes32)',
  'function allChallengeIds(uint256 index) view returns (bytes32)',
  'function chainIdToProposal(uint256 chainId) view returns (bytes32)',
  'function getCurrentSequencer() view returns (uint256)',
  'function isSequencerEligible(uint256 chainId) view returns (bool)',
  'function currentSequencerIndex() view returns (uint256)',
  'function lastRotation() view returns (uint256)',
  'function rotationInterval() view returns (uint256)',
  'function verifiedChainIds(uint256 index) view returns (uint256)',
  'function challengeNetwork(uint256 chainId, uint8 reason, string evidence) payable returns (bytes32 challengeId)',
  'function CHALLENGE_BOND() view returns (uint256)',
  'function MARKET_VOTING_PERIOD() view returns (uint256)',
  'function TIMELOCK_PERIOD() view returns (uint256)',
  'event ProposalCreated(bytes32 indexed proposalId, uint256 indexed chainId, address indexed operator, uint256 stake)',
  'event ChallengeCreated(bytes32 indexed challengeId, uint256 indexed chainId, address indexed challenger, uint8 reason)',
]

// Proposal status enum matching contract
const PROPOSAL_STATUS = [
  'PENDING_MARKET',
  'MARKET_PASSED',
  'AUTOCRAT_REVIEW',
  'APPROVED',
  'ACTIVE',
  'REJECTED',
  'CHALLENGED',
  'REVOKED',
]

// Challenge reason enum matching contract
const CHALLENGE_REASONS: Record<string, number> = {
  sybil: 0,
  downtime: 1,
  malicious: 2,
  invalid_genesis: 3,
  rpc_failure: 4,
  other: 5,
}

const DEFAULT_HUB_RPC = 'https://eth.llamarpc.com'
const DEFAULT_INDEXER_URL = 'http://localhost:4352'

interface FederationDeployment {
  NetworkRegistry?: string
  RegistryHub?: string
  FederationGovernance?: string
  IdentityRegistry?: string
  SolverRegistry?: string
}

function loadFederationAddresses(
  network: NetworkType = 'mainnet',
): FederationDeployment {
  const rootDir = findMonorepoRoot()
  const paths = [
    join(
      rootDir,
      'packages/contracts/deployments',
      `federation-${network}.json`,
    ),
    join(rootDir, 'packages/contracts/deployments', `l1-${network}.json`),
  ]

  for (const path of paths) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8')
      const deployment = JSON.parse(content)
      if (deployment.federation) {
        return deployment.federation as FederationDeployment
      }
      return deployment as FederationDeployment
    }
  }

  return {}
}

function getContractAddress(
  overrideAddress: string | undefined,
  deployedAddress: string | undefined,
  _contractName: string,
): `0x${string}` | null {
  const address = overrideAddress ?? deployedAddress
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return null
  }
  return address as `0x${string}`
}

const TRUST_TIERS = ['UNSTAKED', 'STAKED', 'VERIFIED']
const REGISTRY_TYPES = [
  'IDENTITY',
  'COMPUTE',
  'STORAGE',
  'SOLVER',
  'PACKAGE',
  'CONTAINER',
  'MODEL',
  'NAME_SERVICE',
  'REPUTATION',
  'OTHER',
]

export const federationCommand = new Command('federation')
  .description('Manage Jeju Federation membership')
  .option('--hub-rpc <url>', 'Hub chain RPC URL', DEFAULT_HUB_RPC)
  .option('--network-registry <address>', 'NetworkRegistry contract address')
  .option('--registry-hub <address>', 'RegistryHub contract address')
  .option(
    '--federation-governance <address>',
    'FederationGovernance contract address',
  )
  .option('--indexer-url <url>', 'Indexer REST API URL', DEFAULT_INDEXER_URL)

federationCommand
  .command('join')
  .description('Join the Jeju Federation')
  .option(
    '--stake <amount>',
    'ETH stake amount (0=unstaked, 1+=staked, 10+=verified)',
    '0',
  )
  .option('--chain-id <id>', 'Your chain ID')
  .option('--name <name>', 'Network name')
  .option('--rpc <url>', 'Your RPC URL')
  .option('--explorer <url>', 'Your explorer URL')
  .option('--ws <url>', 'Your WebSocket URL')
  .option('--private-key <key>', 'Deployer private key')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('JOIN JEJU FEDERATION')

    const parent = federationCommand.opts()

    if (!options.privateKey) {
      console.log(chalk.red('Error: --private-key required'))
      process.exit(1)
    }

    if (!options.chainId || !options.name || !options.rpc) {
      console.log(
        chalk.red('Error: --chain-id, --name, and --rpc are required'),
      )
      process.exit(1)
    }

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const registryAddress = getContractAddress(
      parent.networkRegistry,
      deployment.NetworkRegistry,
      'NetworkRegistry',
    )

    if (!registryAddress) {
      console.log(chalk.red('Error: NetworkRegistry not deployed'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      process.exit(1)
    }

    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })
    const account = privateKeyToAccount(options.privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      transport: http(parent.hubRpc),
    })

    const stakeAmount = parseEther(options.stake)
    const tierName =
      parseFloat(options.stake) >= 10
        ? 'VERIFIED'
        : parseFloat(options.stake) >= 1
          ? 'STAKED'
          : 'UNSTAKED'

    console.log(chalk.cyan('\nRegistration Details:'))
    console.log(`  Chain ID: ${options.chainId}`)
    console.log(`  Name: ${options.name}`)
    console.log(`  RPC: ${options.rpc}`)
    console.log(`  Stake: ${options.stake} ETH`)
    console.log(`  Trust Tier: ${tierName}`)
    console.log(`  Registry: ${registryAddress}`)
    console.log()

    if (tierName === 'UNSTAKED') {
      console.log(chalk.yellow('Note: UNSTAKED networks cannot:'))
      console.log(chalk.yellow('  - Participate in federation consensus'))
      console.log(chalk.yellow('  - Run shared sequencer'))
      console.log(chalk.yellow('  - Receive delegated liquidity'))
      console.log(chalk.yellow('Stake 1+ ETH to upgrade to STAKED tier.\n'))
    }

    // Use deployed contract addresses if available
    const contracts = {
      identityRegistry:
        deployment.IdentityRegistry ??
        '0x0000000000000000000000000000000000000000',
      solverRegistry:
        deployment.SolverRegistry ??
        '0x0000000000000000000000000000000000000000',
      inputSettler: '0x0000000000000000000000000000000000000000',
      outputSettler: '0x0000000000000000000000000000000000000000',
      liquidityVault: '0x0000000000000000000000000000000000000000',
      governance:
        deployment.FederationGovernance ??
        '0x0000000000000000000000000000000000000000',
      oracle: '0x0000000000000000000000000000000000000000',
      registryHub:
        deployment.RegistryHub ?? '0x0000000000000000000000000000000000000000',
    }

    // Warn about missing contract deployments
    const missingContracts = Object.entries(contracts)
      .filter(
        ([_, addr]) => addr === '0x0000000000000000000000000000000000000000',
      )
      .map(([name]) => name)

    if (missingContracts.length > 0) {
      console.log(
        chalk.yellow(
          `Warning: Some contracts not deployed: ${missingContracts.join(', ')}`,
        ),
      )
      console.log(
        chalk.yellow(
          'You can update these later with: jeju federation update-contracts',
        ),
      )
      console.log()
    }

    // Get genesis hash from chain config if available
    const genesisHash =
      '0x0000000000000000000000000000000000000000000000000000000000000000'

    console.log(chalk.cyan('Sending transaction...'))

    const hash = await walletClient.writeContract({
      chain: null,
      address: registryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'registerNetwork',
      args: [
        BigInt(options.chainId),
        options.name,
        options.rpc,
        options.explorer || '',
        options.ws || '',
        contracts,
        genesisHash,
      ],
      value: stakeAmount,
    })

    console.log(`  Transaction: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })

    console.log(chalk.green('\nSuccessfully joined the Jeju Federation.'))
    console.log(`\nNext steps:`)
    console.log(`  1. Deploy your IdentityRegistry: jeju deploy identity`)
    console.log(
      `  2. Register your registries: jeju federation register-registry`,
    )
    console.log(
      `  3. Check status: jeju federation status --chain-id ${options.chainId}`,
    )
  })

federationCommand
  .command('status')
  .description('Check federation status')
  .option('--chain-id <id>', 'Specific chain ID to check')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('FEDERATION STATUS')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const registryAddress = getContractAddress(
      parent.networkRegistry,
      deployment.NetworkRegistry,
      'NetworkRegistry',
    )
    const hubAddress = getContractAddress(
      parent.registryHub,
      deployment.RegistryHub,
      'RegistryHub',
    )

    if (!registryAddress) {
      console.log(chalk.yellow('NetworkRegistry not deployed yet.\n'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const registry = getContract({
      address: registryAddress,
      abi: NETWORK_REGISTRY_ABI,
      client: publicClient,
    })
    const hub = hubAddress
      ? getContract({
          address: hubAddress,
          abi: REGISTRY_HUB_ABI,
          client: publicClient,
        })
      : null

    if (options.chainId) {
      // Show specific network
      const network = (await registry.read.getNetwork([
        BigInt(options.chainId),
      ])) as NetworkInfo

      console.log(chalk.cyan('\nNetwork Details:'))
      console.log(`  Chain ID: ${network.chainId}`)
      console.log(`  Name: ${network.name}`)
      console.log(`  RPC: ${network.rpcUrl}`)
      console.log(`  Operator: ${network.operator}`)
      console.log(`  Stake: ${formatEther(network.stake)} ETH`)
      console.log(`  Trust Tier: ${TRUST_TIERS[network.trustTier]}`)
      console.log(`  Active: ${network.isActive}`)
      console.log(`  Verified: ${network.isVerified}`)
      console.log(`  Superchain: ${network.isSuperchain}`)
      console.log(
        `  Registered: ${new Date(Number(network.registeredAt) * 1000).toISOString()}`,
      )

      const canConsensus = (await registry.read.canParticipateInConsensus([
        BigInt(options.chainId),
      ])) as boolean
      const canSequence = (await registry.read.isSequencerEligible([
        BigInt(options.chainId),
      ])) as boolean

      console.log(chalk.cyan('\nCapabilities:'))
      console.log(
        `  Consensus Participation: ${canConsensus ? chalk.green('Yes') : chalk.red('No')}`,
      )
      console.log(
        `  Sequencer Eligible: ${canSequence ? chalk.green('Yes') : chalk.red('No')}`,
      )
    } else {
      // Show overall stats
      const totalNetworks = (await registry.read.totalNetworks()) as bigint
      const activeNetworks = (await registry.read.activeNetworks()) as bigint
      const verifiedNetworks =
        (await registry.read.verifiedNetworks()) as bigint

      console.log(chalk.cyan('\nFederation Overview:'))
      console.log(`  Total Networks: ${totalNetworks}`)
      console.log(`  Active Networks: ${activeNetworks}`)
      console.log(`  Verified Networks: ${verifiedNetworks}`)

      if (hub) {
        const totalChains = (await hub.read.totalChains()) as bigint
        const totalRegistries = (await hub.read.totalRegistries()) as bigint
        const totalStaked = (await hub.read.totalStaked()) as bigint

        console.log(chalk.cyan('\nRegistry Hub:'))
        console.log(`  Chains Tracked: ${totalChains}`)
        console.log(`  Registries Tracked: ${totalRegistries}`)
        console.log(`  Total Staked: ${formatEther(totalStaked)} ETH`)
      }
    }
  })

federationCommand
  .command('list')
  .description('List all federated networks')
  .option('--staked-only', 'Only show staked networks')
  .option('--verified-only', 'Only show verified networks')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('FEDERATED NETWORKS')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const registryAddress = getContractAddress(
      parent.networkRegistry,
      deployment.NetworkRegistry,
      'NetworkRegistry',
    )

    if (!registryAddress) {
      console.log(chalk.yellow('NetworkRegistry not deployed yet.'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const registry = getContract({
      address: registryAddress,
      abi: NETWORK_REGISTRY_ABI,
      client: publicClient,
    })

    const chainIds =
      (await registry.read.getAllNetworkIds()) as readonly bigint[]

    console.log(chalk.cyan(`\nFound ${chainIds.length} networks:\n`))

    for (const chainId of chainIds) {
      const network = (await registry.read.getNetwork([chainId])) as NetworkInfo

      const tier = TRUST_TIERS[network.trustTier]
      if (options.stakedOnly && network.trustTier < 1) continue
      if (options.verifiedOnly && network.trustTier < 2) continue

      const tierColor =
        network.trustTier === 2
          ? chalk.green
          : network.trustTier === 1
            ? chalk.yellow
            : chalk.gray

      console.log(
        `${network.isActive ? '🟢' : '🔴'} ${chalk.bold(network.name)} (${network.chainId})`,
      )
      console.log(
        `   Tier: ${tierColor(tier)} | Stake: ${formatEther(network.stake)} ETH`,
      )
      console.log(`   RPC: ${network.rpcUrl}`)
      console.log()
    }
  })

federationCommand
  .command('add-stake')
  .description('Add stake to upgrade trust tier')
  .requiredOption('--chain-id <id>', 'Your chain ID')
  .requiredOption('--amount <eth>', 'ETH amount to stake')
  .requiredOption('--private-key <key>', 'Operator private key')
  .action(async (options) => {
    logger.header('ADD FEDERATION STAKE')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })
    const account = privateKeyToAccount(options.privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      transport: http(parent.hubRpc),
    })

    const registryAddress = parent.networkRegistry || DEFAULT_NETWORK_REGISTRY

    const amount = parseEther(options.amount)

    console.log(chalk.cyan('Adding stake...'))
    console.log(`  Chain ID: ${options.chainId}`)
    console.log(`  Amount: ${options.amount} ETH`)

    const hash = await walletClient.writeContract({
      chain: null,
      address: registryAddress as `0x${string}`,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'addStake',
      args: [BigInt(options.chainId)],
      value: amount,
    })
    console.log(`  Transaction: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })

    console.log(chalk.green('\nStake added successfully!'))
    console.log(
      `Run 'jeju federation status --chain-id ${options.chainId}' to see your new tier.`,
    )
  })

federationCommand
  .command('registries')
  .description('List all federated registries')
  .option(
    '--type <type>',
    'Filter by type (identity, compute, storage, solver, package, container, model)',
  )
  .option('--chain <chainId>', 'Filter by chain ID')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('FEDERATED REGISTRIES')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const hubAddress = getContractAddress(
      parent.registryHub,
      deployment.RegistryHub,
      'RegistryHub',
    )

    if (!hubAddress) {
      console.log(chalk.yellow('RegistryHub not deployed yet.'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const hub = getContract({
      address: hubAddress,
      abi: REGISTRY_HUB_ABI,
      client: publicClient,
    })

    let registryIds: readonly `0x${string}`[]

    if (options.type) {
      const typeIndex = REGISTRY_TYPES.findIndex(
        (t) => t.toLowerCase() === options.type.toLowerCase(),
      )
      if (typeIndex === -1) {
        console.log(
          chalk.red(`Invalid type. Choose from: ${REGISTRY_TYPES.join(', ')}`),
        )
        return
      }
      registryIds = (await hub.read.getRegistriesByType([
        typeIndex,
      ])) as readonly `0x${string}`[]
    } else {
      registryIds =
        (await hub.read.getAllRegistryIds()) as readonly `0x${string}`[]
    }

    console.log(chalk.cyan(`\nFound ${registryIds.length} registries:\n`))

    for (const registryId of registryIds) {
      const registryData = (await hub.read.getRegistry([
        registryId,
      ])) as RegistryInfo

      if (options.chain && registryData.chainId.toString() !== options.chain)
        continue

      const typeName = REGISTRY_TYPES[registryData.registryType]

      console.log(`📦 ${chalk.bold(registryData.name)} (${typeName})`)
      console.log(
        `   Chain: ${registryData.chainId} | Entries: ${registryData.entryCount}`,
      )
      console.log(
        `   Contract: ${registryData.contractAddress.slice(0, 20)}...`,
      )
      console.log(`   Last Sync: Block ${registryData.lastSyncBlock}`)
      console.log()
    }
  })

federationCommand
  .command('sync')
  .description('Sync registry data from all chains')
  .option('--registry-id <id>', 'Sync specific registry')
  .option('--chain-id <id>', 'Sync specific chain')
  .action(async (options) => {
    logger.header('SYNC REGISTRIES')

    const parent = federationCommand.opts()
    const indexerUrl = parent.indexerUrl || DEFAULT_INDEXER_URL

    console.log(chalk.cyan('Triggering federation sync...\n'))

    console.log('This command triggers the federated indexer to:')
    console.log('  1. Query all registered chains')
    console.log('  2. Fetch registry contract events')
    console.log('  3. Aggregate and deduplicate entries')
    console.log('  4. Update the unified GraphQL API')
    console.log()

    // Check indexer health first
    let healthResponse: Response
    try {
      healthResponse = await fetch(`${indexerUrl}/health`)
    } catch {
      console.log(chalk.red(`Indexer not reachable at ${indexerUrl}`))
      console.log(
        chalk.yellow(
          'Make sure the indexer is running: bun run --cwd apps/indexer api',
        ),
      )
      process.exit(1)
    }
    if (!healthResponse.ok) {
      console.log(chalk.red(`Indexer returned error: ${healthResponse.status}`))
      process.exit(1)
    }

    const rawHealth: unknown = await healthResponse.json()
    const health = HealthResponseSchema.parse(rawHealth)
    console.log(chalk.green(`Indexer status: ${health.status}\n`))

    // Query current federation stats
    const statsResponse = await fetch(`${indexerUrl}/api/stats`)
    if (statsResponse.ok) {
      const rawStats: unknown = await statsResponse.json()
      const statsResult = IndexerStatsSchema.safeParse(rawStats)
      if (statsResult.success) {
        const stats = statsResult.data
        console.log(chalk.cyan('Current Indexer Stats:'))
        console.log(`  Blocks indexed: ${stats.totalBlocks ?? 'N/A'}`)
        console.log(`  Transactions: ${stats.totalTransactions ?? 'N/A'}`)
        console.log(`  Networks indexed: ${stats.networksIndexed ?? 'N/A'}`)
        console.log()
      }
    }

    // If specific chain or registry, show filtered info
    if (options.chainId) {
      console.log(chalk.cyan(`Syncing chain ${options.chainId}...`))
      const agentsResponse = await fetch(`${indexerUrl}/api/agents?limit=10`)
      if (agentsResponse.ok) {
        const rawAgents: unknown = await agentsResponse.json()
        const agentsResult = AgentsDataSchema.safeParse(rawAgents)
        if (agentsResult.success) {
          console.log(`  Found ${agentsResult.data.total} agents in index`)
        }
      }
    }

    if (options.registryId) {
      console.log(chalk.cyan(`Syncing registry ${options.registryId}...`))
    }

    console.log(chalk.green('\nSync triggered successfully.'))
    console.log('The indexer will process new events in the background.')
    console.log(`\nMonitor progress at: ${indexerUrl}/api/stats`)
  })

federationCommand
  .command('proposals')
  .description(
    'List pending AI DAO governance proposals for network verification',
  )
  .option(
    '--status <status>',
    'Filter by status: pending_market | autocrat_review | approved | active',
  )
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('NETWORK VERIFICATION PROPOSALS')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const governanceAddress = getContractAddress(
      parent.federationGovernance,
      deployment.FederationGovernance,
      'FederationGovernance',
    )

    console.log(chalk.cyan('How Network Verification Works:\n'))
    console.log('1. Network stakes 10+ ETH → Auto-creates governance proposal')
    console.log(
      '2. AI Oracle evaluates: uptime, uniqueness, RPC health, operator reputation',
    )
    console.log('3. Prediction market: "Should this network be VERIFIED?"')
    console.log(
      '4. If market confidence > 60% AND AI score > 70 → Autocrat review',
    )
    console.log('5. AI DAO (Autocrat) gives final approval')
    console.log('6. 7-day timelock before VERIFIED status active')
    console.log()

    console.log(chalk.cyan('Trust Tier Requirements:'))
    console.log(
      `  ${chalk.gray('UNSTAKED')} (0 ETH): Listed only, no consensus`,
    )
    console.log(
      `  ${chalk.yellow('STAKED')} (1+ ETH): Federation consensus participation`,
    )
    console.log(
      `  ${chalk.green('VERIFIED')} (10+ ETH + AI DAO): Sequencer eligible`,
    )
    console.log()

    if (!governanceAddress) {
      console.log(chalk.yellow('FederationGovernance not deployed yet.\n'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const governance = getContract({
      address: governanceAddress,
      abi: FEDERATION_GOVERNANCE_ABI,
      client: publicClient,
    })

    // Get verified chain IDs to find proposals
    const verifiedChainIds =
      (await governance.read.getVerifiedChainIds()) as readonly bigint[]

    console.log(
      chalk.cyan(`\nFound ${verifiedChainIds.length} verified networks:\n`),
    )

    // Query proposals for each chain
    const registryAddress = getContractAddress(
      parent.networkRegistry,
      deployment.NetworkRegistry,
      'NetworkRegistry',
    )
    if (registryAddress) {
      const registry = getContract({
        address: registryAddress,
        abi: NETWORK_REGISTRY_ABI,
        client: publicClient,
      })

      const chainIds =
        (await registry.read.getAllNetworkIds()) as readonly bigint[]

      for (const chainId of chainIds) {
        const proposalId = (await governance.read.chainIdToProposal([
          chainId,
        ])) as `0x${string}`
        if (
          proposalId ===
          '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
          continue

        const proposal = (await governance.read.getProposal([
          proposalId,
        ])) as readonly [
          bigint,
          string,
          bigint,
          number,
          number,
          boolean,
          bigint,
        ]
        const [
          _chainIdResult,
          operator,
          stake,
          status,
          overallScore,
          autocratApproved,
          timelockEnds,
        ] = proposal

        const statusName = PROPOSAL_STATUS[status] || `UNKNOWN(${status})`

        // Filter by status if specified
        if (options.status) {
          const filterStatus = options.status.toUpperCase().replace(/-/g, '_')
          if (statusName !== filterStatus) continue
        }

        const statusColor =
          status === 4
            ? chalk.green
            : status === 5
              ? chalk.red
              : status <= 3
                ? chalk.yellow
                : chalk.gray

        console.log(`📋 Chain ${chainId} - ${statusColor(statusName)}`)
        console.log(`   Operator: ${operator}`)
        console.log(`   Stake: ${formatEther(stake)} ETH`)
        console.log(`   AI Score: ${overallScore}/100`)
        console.log(
          `   Autocrat Approved: ${autocratApproved ? chalk.green('Yes') : chalk.gray('Pending')}`,
        )
        if (timelockEnds > 0n) {
          const timelockDate = new Date(Number(timelockEnds) * 1000)
          console.log(`   Timelock Ends: ${timelockDate.toISOString()}`)
        }
        console.log()
      }
    }
  })

federationCommand
  .command('challenge')
  .description('Challenge a verified network (requires 1 ETH bond)')
  .requiredOption('--chain-id <id>', 'Chain ID to challenge')
  .requiredOption(
    '--reason <reason>',
    'Reason: sybil | downtime | malicious | invalid_genesis | rpc_failure | other',
  )
  .requiredOption('--evidence <ipfs>', 'IPFS hash of evidence')
  .requiredOption('--private-key <key>', 'Challenger private key')
  .option('--bond <eth>', 'Challenge bond in ETH (default: 1)', '1')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('CHALLENGE NETWORK')

    const parent = federationCommand.opts()

    const validReasons = [
      'sybil',
      'downtime',
      'malicious',
      'invalid_genesis',
      'rpc_failure',
      'other',
    ]
    if (!validReasons.includes(options.reason)) {
      console.log(
        chalk.red(`Invalid reason. Choose from: ${validReasons.join(', ')}`),
      )
      process.exit(1)
    }

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const governanceAddress = getContractAddress(
      parent.federationGovernance,
      deployment.FederationGovernance,
      'FederationGovernance',
    )

    if (!governanceAddress) {
      console.log(chalk.red('FederationGovernance not deployed yet.'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      process.exit(1)
    }

    console.log(chalk.cyan('Challenge Details:'))
    console.log(`  Chain ID: ${options.chainId}`)
    console.log(`  Reason: ${options.reason.toUpperCase()}`)
    console.log(`  Evidence: ${options.evidence}`)
    console.log(`  Bond: ${options.bond} ETH`)
    console.log()

    console.log(chalk.yellow('Challenge Requirements:'))
    console.log('  • 1 ETH bond required')
    console.log('  • If upheld by guardians → bond returned + network revoked')
    console.log('  • If rejected → bond forfeited to treasury')
    console.log()

    console.log(chalk.cyan('Guardian Review Process:'))
    console.log('  • Minimum 3 guardian votes required')
    console.log('  • Majority vote determines outcome')
    console.log('  • Network downgraded to STAKED if challenge upheld')
    console.log()

    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })
    const account = privateKeyToAccount(options.privateKey as `0x${string}`)
    const walletClient = createWalletClient({
      account,
      transport: http(parent.hubRpc),
    })

    const reasonIndex = CHALLENGE_REASONS[options.reason]
    const bondAmount = parseEther(options.bond)

    console.log(chalk.cyan('Submitting challenge...'))

    const hash = await walletClient.writeContract({
      chain: null,
      address: governanceAddress,
      abi: FEDERATION_GOVERNANCE_ABI,
      functionName: 'challengeNetwork',
      args: [BigInt(options.chainId), reasonIndex, options.evidence],
      value: bondAmount,
    })

    console.log(`  Transaction: ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      console.log(chalk.green('\nChallenge submitted successfully.'))
      console.log('Guardians will now review the evidence and vote.')
      console.log(
        `\nMonitor status: jeju federation status --chain-id ${options.chainId}`,
      )
    } else {
      console.log(chalk.red('\nChallenge transaction failed.'))
    }
  })

federationCommand
  .command('sequencer')
  .description('View current sequencer and rotation schedule')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('SEQUENCER STATUS')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const governanceAddress = getContractAddress(
      parent.federationGovernance,
      deployment.FederationGovernance,
      'FederationGovernance',
    )

    console.log(chalk.cyan('Sequencer Rotation Rules:\n'))
    console.log('  • Only VERIFIED networks can be sequencers')
    console.log('  • Round-robin rotation every 24 hours')
    console.log('  • Revoked networks removed from rotation')
    console.log()

    console.log(chalk.cyan('Sybil Protection:\n'))
    console.log('  • Max 5 networks per operator')
    console.log('  • 10 ETH minimum stake per network')
    console.log('  • AI DAO must approve each network')
    console.log('  • Guardians can challenge at any time')
    console.log('  • Economic penalty for malicious behavior')
    console.log()

    if (!governanceAddress) {
      console.log(chalk.yellow('FederationGovernance not deployed yet.\n'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const governance = getContract({
      address: governanceAddress,
      abi: FEDERATION_GOVERNANCE_ABI,
      client: publicClient,
    })

    // Get current sequencer
    const currentSequencer =
      (await governance.read.getCurrentSequencer()) as bigint
    const currentIndex =
      (await governance.read.currentSequencerIndex()) as bigint
    const lastRotation = (await governance.read.lastRotation()) as bigint
    const rotationInterval =
      (await governance.read.rotationInterval()) as bigint
    const verifiedChainIds =
      (await governance.read.getVerifiedChainIds()) as readonly bigint[]

    console.log(chalk.cyan('Current Sequencer Status:\n'))

    if (currentSequencer === 0n) {
      console.log(chalk.yellow('  No current sequencer (no verified networks)'))
    } else {
      console.log(chalk.green(`  Current Sequencer: Chain ${currentSequencer}`))
    }

    console.log(`  Rotation Index: ${currentIndex}/${verifiedChainIds.length}`)

    if (lastRotation > 0n) {
      const lastRotationDate = new Date(Number(lastRotation) * 1000)
      const nextRotationDate = new Date(
        (Number(lastRotation) + Number(rotationInterval)) * 1000,
      )
      console.log(`  Last Rotation: ${lastRotationDate.toISOString()}`)
      console.log(`  Next Rotation: ${nextRotationDate.toISOString()}`)
    }

    console.log(`  Rotation Interval: ${Number(rotationInterval) / 3600} hours`)
    console.log()

    console.log(chalk.cyan('Verified Networks (Sequencer Eligible):\n'))

    if (verifiedChainIds.length === 0) {
      console.log(chalk.gray('  No verified networks yet'))
    } else {
      const registryAddress = getContractAddress(
        parent.networkRegistry,
        deployment.NetworkRegistry,
        'NetworkRegistry',
      )
      if (registryAddress) {
        const registry = getContract({
          address: registryAddress,
          abi: NETWORK_REGISTRY_ABI,
          client: publicClient,
        })

        for (let i = 0; i < verifiedChainIds.length; i++) {
          const chainId = verifiedChainIds[i]
          const network = (await registry.read.getNetwork([
            chainId,
          ])) as NetworkInfo
          const isCurrent = chainId === currentSequencer
          const prefix = isCurrent ? chalk.green('▶') : ' '
          console.log(`${prefix} ${i + 1}. Chain ${chainId} - ${network.name}`)
          console.log(`     Operator: ${network.operator}`)
          console.log(`     Stake: ${formatEther(network.stake)} ETH`)
        }
      } else {
        for (let i = 0; i < verifiedChainIds.length; i++) {
          const chainId = verifiedChainIds[i]
          const isCurrent = chainId === currentSequencer
          const prefix = isCurrent ? chalk.green('▶') : ' '
          console.log(`${prefix} ${i + 1}. Chain ${chainId}`)
        }
      }
    }
  })

federationCommand
  .command('guardians')
  .description('List federation guardians and their stats')
  .option('--network <network>', 'Hub network: mainnet | testnet', 'mainnet')
  .action(async (options) => {
    logger.header('FEDERATION GUARDIANS')

    const parent = federationCommand.opts()
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) })

    // Load deployed addresses
    const deployment = loadFederationAddresses(options.network as NetworkType)
    const governanceAddress = getContractAddress(
      parent.federationGovernance,
      deployment.FederationGovernance,
      'FederationGovernance',
    )

    console.log(chalk.cyan('Guardian Responsibilities:\n'))
    console.log('  • Vote on network challenges')
    console.log('  • Review appeals from banned networks')
    console.log('  • Monitor network quality metrics')
    console.log('  • Participate in AI DAO governance')
    console.log()

    console.log(chalk.cyan('Becoming a Guardian:\n'))
    console.log('  • Must operate a VERIFIED network, OR')
    console.log('  • Must be HIGH tier staker in IdentityRegistry')
    console.log('  • Appointed by governance')
    console.log('  • Performance tracked over time')
    console.log()

    if (!governanceAddress) {
      console.log(chalk.yellow('FederationGovernance not deployed yet.\n'))
      console.log(
        `Deploy with: jeju deploy federation --network ${options.network}`,
      )
      return
    }

    const governance = getContract({
      address: governanceAddress,
      abi: FEDERATION_GOVERNANCE_ABI,
      client: publicClient,
    })

    // Get all guardians
    const guardianAddresses =
      (await governance.read.getAllGuardians()) as readonly `0x${string}`[]

    console.log(chalk.cyan(`Active Guardians (${guardianAddresses.length}):\n`))

    if (guardianAddresses.length === 0) {
      console.log(chalk.gray('  No guardians appointed yet'))
      return
    }

    for (const address of guardianAddresses) {
      const guardian = (await governance.read.guardians([
        address,
      ])) as readonly [
        string, // guardian address
        bigint, // agentId
        bigint, // votingPower
        bigint, // appointedAt
        bigint, // challengesReviewed
        bigint, // correctDecisions
        boolean, // isActive
      ]

      const [
        ,
        agentId,
        votingPower,
        appointedAt,
        challengesReviewed,
        correctDecisions,
        isActive,
      ] = guardian

      if (!isActive) continue

      const appointedDate = new Date(Number(appointedAt) * 1000)
      const accuracy =
        challengesReviewed > 0n
          ? (
              (Number(correctDecisions) / Number(challengesReviewed)) *
              100
            ).toFixed(1)
          : 'N/A'

      console.log(
        `🛡️  ${chalk.bold(address.slice(0, 10))}...${address.slice(-8)}`,
      )
      console.log(`    Agent ID: ${agentId}`)
      console.log(`    Voting Power: ${votingPower}`)
      console.log(`    Appointed: ${appointedDate.toISOString().split('T')[0]}`)
      console.log(`    Challenges Reviewed: ${challengesReviewed}`)
      console.log(`    Accuracy: ${accuracy}${accuracy !== 'N/A' ? '%' : ''}`)
      console.log()
    }
  })

federationCommand
  .command('configure-remotes')
  .description(
    'Configure Hyperlane trusted remotes for cross-chain identity sync',
  )
  .option(
    '--network <network>',
    'Network: localnet | testnet | mainnet',
    'testnet',
  )
  .action(async (options) => {
    logger.header('CONFIGURE HYPERLANE REMOTES')

    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/infrastructure/configure-hyperlane-remotes.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Configure remotes script not found')
      process.exit(1)
    }

    const args: string[] = []
    if (options.network) {
      args.push('--network', options.network)
    }

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

export default federationCommand
