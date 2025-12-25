/**
 * DAO Deployment Library
 *
 * Core logic for deploying DAOs from jeju-manifest.json configuration.
 * Supports multi-DAO hierarchies, council auto-generation, and fee configuration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  toBytes,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { logger } from './logger'
import {
  type DAOManifest,
  validateDAOManifest,
  validateCouncilWeights,
} from '../schemas/dao-manifest'
import {
  type DAODeploymentResult,
  type NetworkType,
  WELL_KNOWN_KEYS,
  getDevCouncilAddresses,
  getDevCEOAddress,
  CHAIN_CONFIG,
} from '../types'

// ============ Contract ABIs ============

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
        name: 'ceoPersona',
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
    name: 'addCouncilMember',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'member', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'role', type: 'string' },
      { name: 'weight', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAOFeeConfig',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'feeConfig', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkPackage',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'packageId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkRepo',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'repoId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
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

const DAOFundingABI = [
  {
    type: 'function',
    name: 'setDAOConfig',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'minStake', type: 'uint256' },
          { name: 'maxStake', type: 'uint256' },
          { name: 'epochDuration', type: 'uint256' },
          { name: 'cooldownPeriod', type: 'uint256' },
          { name: 'matchingMultiplier', type: 'uint256' },
          { name: 'quadraticEnabled', type: 'bool' },
          { name: 'ceoWeightCap', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createEpoch',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'budget', type: 'uint256' },
      { name: 'matchingPool', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'depositMatchingFunds',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'proposeProject',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'projectType', type: 'uint8' },
      { name: 'registryId', type: 'bytes32' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'primaryRecipient', type: 'address' },
      { name: 'additionalRecipients', type: 'address[]' },
      { name: 'recipientShares', type: 'uint256[]' },
    ],
    outputs: [{ name: 'projectId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'acceptProject',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCEOWeight',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'weight', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const PackageRegistryABI = [
  {
    type: 'function',
    name: 'registerPackage',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'cid', type: 'string' },
      { name: 'version', type: 'string' },
    ],
    outputs: [{ name: 'packageId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const

const RepoRegistryABI = [
  {
    type: 'function',
    name: 'registerRepository',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'url', type: 'string' },
    ],
    outputs: [{ name: 'repoId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const

// ============ Configuration ============

interface ChainConfig {
  chain: Chain
  rpcUrl: string
}

function getChainConfig(network: NetworkType): ChainConfig {
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
    case 'localnet':
    default:
      return {
        chain: localhost,
        rpcUrl: process.env.LOCAL_RPC_URL ?? `http://127.0.0.1:${CHAIN_CONFIG.localnet.rpcUrl.split(':').pop()}`,
      }
  }
}

interface ContractAddresses {
  DAORegistry: Address
  DAOFunding: Address
  PackageRegistry?: Address
  RepoRegistry?: Address
  FeeConfig?: Address
}

async function loadContractAddresses(
  rootDir: string,
  network: NetworkType,
): Promise<ContractAddresses> {
  const deploymentPath = join(
    rootDir,
    'packages',
    'config',
    'deployments',
    `${network}.json`,
  )

  if (!existsSync(deploymentPath)) {
    throw new Error(
      `No deployment found for ${network}. Run 'jeju deploy governance' first.`,
    )
  }

  const content = readFileSync(deploymentPath, 'utf-8')
  const deployment = JSON.parse(content) as Record<string, string>

  if (!deployment.DAORegistry || !deployment.DAOFunding) {
    throw new Error(
      `DAORegistry and DAOFunding not found in ${network} deployment. Run 'jeju deploy governance' first.`,
    )
  }

  return {
    DAORegistry: deployment.DAORegistry as Address,
    DAOFunding: deployment.DAOFunding as Address,
    PackageRegistry: deployment.PackageRegistry as Address | undefined,
    RepoRegistry: deployment.RepoRegistry as Address | undefined,
    FeeConfig: deployment.FeeConfig as Address | undefined,
  }
}

// ============ Deploy Options ============

export interface DAODeployOptions {
  network: NetworkType
  manifestPath: string
  rootDir: string
  seed: boolean
  fundTreasury?: string
  fundMatching?: string
  dryRun: boolean
  skipCouncil: boolean
  skipFundingConfig: boolean
  verbose: boolean
}

// ============ Main Deployment Function ============

export async function deployDAO(options: DAODeployOptions): Promise<DAODeploymentResult> {
  const {
    network,
    manifestPath,
    rootDir,
    seed,
    fundTreasury: _fundTreasury, // TODO: implement treasury funding
    fundMatching,
    dryRun,
    skipCouncil,
    skipFundingConfig,
    verbose,
  } = options

  logger.header(`DEPLOY DAO TO ${network.toUpperCase()}`)

  if (dryRun) {
    logger.warn('DRY RUN - no transactions will be submitted')
  }

  // 1. Load and validate manifest
  logger.step('Loading manifest...')
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`)
  }

  const manifestContent = readFileSync(manifestPath, 'utf-8')
  const rawManifest = JSON.parse(manifestContent) as Record<string, unknown>
  const manifest = validateDAOManifest(rawManifest)

  logger.success(`Loaded: ${manifest.displayName ?? manifest.name}`)
  if (verbose) {
    logger.keyValue('CEO', manifest.governance.ceo.name)
    logger.keyValue('Council Members', String(manifest.governance.council.members.length))
  }

  // Validate council weights
  const weightValidation = validateCouncilWeights(manifest.governance.council.members)
  if (!weightValidation.valid) {
    logger.warn(weightValidation.message)
  }

  // 2. Setup clients
  logger.step('Connecting to network...')
  const chainConfig = getChainConfig(network)
  const contracts = await loadContractAddresses(rootDir, network)

  const privateKey = process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_KEY or PRIVATE_KEY environment variable required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  logger.keyValue('Deployer', account.address)
  logger.keyValue('DAORegistry', contracts.DAORegistry)
  logger.keyValue('DAOFunding', contracts.DAOFunding)

  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  logger.keyValue('Balance', `${formatEther(balance)} ETH`)

  if (balance < BigInt('100000000000000000') && !dryRun) {
    throw new Error('Insufficient balance: need at least 0.1 ETH')
  }

  // 3. Determine treasury address
  let treasuryAddress: Address = account.address
  if (network === 'localnet') {
    treasuryAddress = WELL_KNOWN_KEYS.dev[0].address as Address
  }

  // 4. Create DAO
  logger.step(`Creating ${manifest.displayName ?? manifest.name}...`)

  let daoId: `0x${string}`

  if (dryRun) {
    daoId = keccak256(toBytes(`dao:${manifest.name}:${Date.now()}`))
    logger.info(`Would create DAO with ID: ${daoId}`)
  } else {
    const createDAOHash = await walletClient.writeContract({
      address: contracts.DAORegistry,
      abi: DAORegistryABI,
      functionName: 'createDAO',
      args: [
        manifest.name,
        manifest.displayName ?? manifest.name,
        manifest.description ?? '',
        treasuryAddress,
        '', // manifestCid - TODO: upload to IPFS in production
        {
          name: manifest.governance.ceo.name,
          pfpCid: manifest.governance.ceo.pfpCid ?? '',
          description: manifest.governance.ceo.description,
          personality: manifest.governance.ceo.personality,
          traits: manifest.governance.ceo.traits,
        },
        {
          minQualityScore: BigInt(manifest.governance.parameters.minQualityScore),
          councilVotingPeriod: BigInt(manifest.governance.parameters.councilVotingPeriod),
          gracePeriod: BigInt(manifest.governance.parameters.gracePeriod),
          minProposalStake: BigInt(manifest.governance.parameters.minProposalStake),
          quorumBps: BigInt(manifest.governance.parameters.quorumBps),
        },
      ],
    })

    logger.info(`TX: ${createDAOHash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createDAOHash })
    daoId = (receipt.logs[0]?.topics?.[1] ?? keccak256(toBytes(manifest.name))) as `0x${string}`
    logger.success(`DAO created with ID: ${daoId}`)
  }

  // 5. Configure funding
  if (!skipFundingConfig) {
    logger.step('Configuring funding parameters...')

    if (!dryRun) {
      const configHash = await walletClient.writeContract({
        address: contracts.DAOFunding,
        abi: DAOFundingABI,
        functionName: 'setDAOConfig',
        args: [
          daoId,
          {
            minStake: BigInt(manifest.funding.minStake),
            maxStake: BigInt(manifest.funding.maxStake),
            epochDuration: BigInt(manifest.funding.epochDuration),
            cooldownPeriod: BigInt(manifest.funding.cooldownPeriod),
            matchingMultiplier: BigInt(manifest.funding.matchingMultiplier),
            quadraticEnabled: manifest.funding.quadraticEnabled,
            ceoWeightCap: BigInt(manifest.funding.ceoWeightCap),
          },
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: configHash })
    }
    logger.success('Funding configured')
  }

  // 6. Setup council members
  const councilResult: DAODeploymentResult['council'] = { members: [] }

  if (!skipCouncil) {
    logger.step('Setting up council...')

    const devAddresses = network === 'localnet' ? getDevCouncilAddresses() : {}

    for (let i = 0; i < manifest.governance.council.members.length; i++) {
      const member = manifest.governance.council.members[i]
      
      // Use manifest address, or dev address for localnet, or deployer as fallback
      let memberAddress: Address = account.address
      if (member.address) {
        memberAddress = member.address as Address
      } else if (network === 'localnet' && devAddresses[member.role]) {
        memberAddress = devAddresses[member.role] as Address
      }

      const agentId = member.agentId ?? i + 1

      if (!dryRun) {
        const memberHash = await walletClient.writeContract({
          address: contracts.DAORegistry,
          abi: DAORegistryABI,
          functionName: 'addCouncilMember',
          args: [daoId, memberAddress, BigInt(agentId), member.role, BigInt(member.weight)],
        })
        await publicClient.waitForTransactionReceipt({ hash: memberHash })
      }

      councilResult.members.push({
        role: member.role,
        address: memberAddress,
        agentId,
      })

      logger.info(`  Added: ${member.role} (${memberAddress.slice(0, 10)}..., weight: ${member.weight})`)
    }

    logger.success(`Council configured with ${councilResult.members.length} members`)
  }

  // 7. Seed packages and repos
  const packageIds: string[] = []
  const repoIds: string[] = []

  const deploymentConfig = manifest.deployment?.[network]
  const shouldSeed = seed || (network === 'localnet' && deploymentConfig?.autoSeed !== false)

  if (shouldSeed) {
    // Seed packages
    if (manifest.packages?.seeded && manifest.packages.seeded.length > 0) {
      logger.step('Seeding packages...')

      for (const pkg of manifest.packages.seeded) {
        const packageId = keccak256(toBytes(`${manifest.name}:package:${pkg.name}`))
        packageIds.push(packageId)

        // Register in PackageRegistry if available
        if (contracts.PackageRegistry && !dryRun) {
          try {
            const registerHash = await walletClient.writeContract({
              address: contracts.PackageRegistry,
              abi: PackageRegistryABI,
              functionName: 'registerPackage',
              args: [pkg.name, pkg.description, '', '1.0.0'],
            })
            await publicClient.waitForTransactionReceipt({ hash: registerHash })
          } catch {
            // Package may already exist
          }
        }

        // Link to DAO
        if (!dryRun) {
          try {
            const linkHash = await walletClient.writeContract({
              address: contracts.DAORegistry,
              abi: DAORegistryABI,
              functionName: 'linkPackage',
              args: [daoId, packageId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: linkHash })
          } catch {
            // Link may already exist
          }
        }

        // Create funding project and set weight
        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'proposeProject',
              args: [
                daoId,
                0, // projectType: package
                packageId as `0x${string}`,
                pkg.name,
                pkg.description,
                account.address,
                [],
                [],
              ],
            })
            const receipt = await publicClient.waitForTransactionReceipt({ hash: proposeHash })
            const projectId = receipt.logs[0]?.topics?.[1] ?? packageId

            // Accept and set weight
            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'acceptProject',
              args: [projectId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

            const weightHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'setCEOWeight',
              args: [projectId as `0x${string}`, BigInt(pkg.fundingWeight)],
            })
            await publicClient.waitForTransactionReceipt({ hash: weightHash })
          } catch {
            // Project may already exist
          }
        }

        logger.info(`  ${pkg.name} (weight: ${pkg.fundingWeight / 100}%)`)
      }

      logger.success(`Seeded ${packageIds.length} packages`)
    }

    // Seed repos
    if (manifest.repos?.seeded && manifest.repos.seeded.length > 0) {
      logger.step('Seeding repositories...')

      for (const repo of manifest.repos.seeded) {
        const repoId = keccak256(toBytes(`${manifest.name}:repo:${repo.name}`))
        repoIds.push(repoId)

        // Register in RepoRegistry if available
        if (contracts.RepoRegistry && !dryRun) {
          try {
            const registerHash = await walletClient.writeContract({
              address: contracts.RepoRegistry,
              abi: RepoRegistryABI,
              functionName: 'registerRepository',
              args: [repo.name, repo.description, repo.url],
            })
            await publicClient.waitForTransactionReceipt({ hash: registerHash })
          } catch {
            // Repo may already exist
          }
        }

        // Link to DAO
        if (!dryRun) {
          try {
            const linkHash = await walletClient.writeContract({
              address: contracts.DAORegistry,
              abi: DAORegistryABI,
              functionName: 'linkRepo',
              args: [daoId, repoId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: linkHash })
          } catch {
            // Link may already exist
          }
        }

        // Create funding project and set weight
        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'proposeProject',
              args: [
                daoId,
                1, // projectType: repo
                repoId as `0x${string}`,
                repo.name,
                repo.description,
                account.address,
                [],
                [],
              ],
            })
            const receipt = await publicClient.waitForTransactionReceipt({ hash: proposeHash })
            const projectId = receipt.logs[0]?.topics?.[1] ?? repoId

            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'acceptProject',
              args: [projectId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

            const weightHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: DAOFundingABI,
              functionName: 'setCEOWeight',
              args: [projectId as `0x${string}`, BigInt(repo.fundingWeight)],
            })
            await publicClient.waitForTransactionReceipt({ hash: weightHash })
          } catch {
            // Project may already exist
          }
        }

        logger.info(`  ${repo.name} (weight: ${repo.fundingWeight / 100}%)`)
      }

      logger.success(`Seeded ${repoIds.length} repositories`)
    }
  }

  // 8. Fund treasury and matching pool
  // Treasury funding: fundTreasury ?? deploymentConfig?.fundTreasury (TODO: implement)
  const actualFundMatching = fundMatching ?? deploymentConfig?.fundMatching

  if (actualFundMatching && !dryRun) {
    logger.step('Funding matching pool...')

    const matchingAmount = BigInt(actualFundMatching)

    // Create epoch first
    const epochHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: DAOFundingABI,
      functionName: 'createEpoch',
      args: [daoId, BigInt(0), BigInt(0)],
    })
    await publicClient.waitForTransactionReceipt({ hash: epochHash })

    // Deposit matching funds
    const depositHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: DAOFundingABI,
      functionName: 'depositMatchingFunds',
      args: [daoId, matchingAmount],
      value: matchingAmount,
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })

    logger.success(`Deposited ${formatEther(matchingAmount)} ETH to matching pool`)
  }

  // 9. Build and save result
  const result: DAODeploymentResult = {
    network,
    daoId,
    name: manifest.name,
    contracts: {
      daoRegistry: contracts.DAORegistry,
      daoFunding: contracts.DAOFunding,
      council: account.address, // Placeholder - would be deployed council contract
      ceoAgent: network === 'localnet' ? getDevCEOAddress() : account.address,
      treasury: treasuryAddress,
      feeConfig: contracts.FeeConfig,
    },
    council: councilResult,
    packageIds,
    repoIds,
    timestamp: Date.now(),
    deployer: account.address,
  }

  // Save deployment to manifest directory
  const deploymentDir = join(dirname(manifestPath), 'deployments')
  mkdirSync(deploymentDir, { recursive: true })
  const outputPath = join(deploymentDir, `${network}.json`)
  writeFileSync(outputPath, JSON.stringify(result, null, 2))
  logger.success(`Deployment saved to: ${outputPath}`)

  // Summary
  logger.newline()
  logger.header('DEPLOYMENT COMPLETE')
  logger.keyValue('DAO', manifest.displayName ?? manifest.name)
  logger.keyValue('CEO', manifest.governance.ceo.name)
  logger.keyValue('DAO ID', daoId)
  logger.keyValue('Network', network)
  logger.keyValue('Council Members', String(councilResult.members.length))
  logger.keyValue('Packages Seeded', String(packageIds.length))
  logger.keyValue('Repos Seeded', String(repoIds.length))

  return result
}

/**
 * List all DAOs from a directory containing multiple manifests
 */
export async function discoverDAOManifests(rootDir: string): Promise<DAOManifest[]> {
  const manifests: DAOManifest[] = []
  const fs = require('fs')

  // Check vendor directory
  const vendorDir = join(rootDir, 'vendor')
  if (existsSync(vendorDir)) {
    const vendorEntries = fs.readdirSync(vendorDir, { withFileTypes: true })
    for (const entry of vendorEntries) {
      if (entry.isDirectory()) {
        const daoManifestPath = join(vendorDir, entry.name, 'dao', 'jeju-manifest.json')
        if (existsSync(daoManifestPath)) {
          const content = readFileSync(daoManifestPath, 'utf-8')
          try {
            const manifest = validateDAOManifest(JSON.parse(content))
            manifests.push(manifest)
          } catch {
            // Not a valid DAO manifest
          }
        }
      }
    }
  }

  // Check apps directory
  const appsDir = join(rootDir, 'apps')
  if (existsSync(appsDir)) {
    const appEntries = fs.readdirSync(appsDir, { withFileTypes: true })
    for (const entry of appEntries) {
      if (entry.isDirectory()) {
        const manifestPath = join(appsDir, entry.name, 'jeju-manifest.json')
        if (existsSync(manifestPath)) {
          const content = readFileSync(manifestPath, 'utf-8')
          try {
            const parsed = JSON.parse(content)
            // Check if it's a DAO manifest (has governance section)
            if (parsed.governance && parsed.funding) {
              const manifest = validateDAOManifest(parsed)
              manifests.push(manifest)
            }
          } catch {
            // Not a valid DAO manifest
          }
        }
      }
    }
  }

  return manifests
}

// ============ Multi-DAO Support ============

const DAOAllocationRegistryABI = [
  {
    type: 'function',
    name: 'createAllocation',
    inputs: [
      { name: 'sourceDaoId', type: 'bytes32' },
      { name: 'targetDaoId', type: 'bytes32' },
      { name: 'allocationType', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: 'allocationId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setParentDAO',
    inputs: [
      { name: 'childDaoId', type: 'bytes32' },
      { name: 'parentDaoId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** Allocation type enum matching contract */
const ALLOCATION_TYPES = {
  'deep-funding': 0,
  'fee-share': 1,
  'recurring': 2,
  'one-time': 3,
} as const

export interface MultiDAODeployOptions extends DAODeployOptions {
  /** Deploy all discovered DAOs */
  all?: boolean
  /** Establish allocations between DAOs after deployment */
  setupAllocations?: boolean
}

/**
 * Deploy multiple DAOs and establish relationships between them
 */
export async function deployMultipleDAOs(
  options: MultiDAODeployOptions,
): Promise<DAODeploymentResult[]> {
  const { rootDir, network, setupAllocations } = options
  const results: DAODeploymentResult[] = []

  logger.header(`MULTI-DAO DEPLOYMENT TO ${network.toUpperCase()}`)

  // Discover all DAO manifests
  const manifests = await discoverDAOManifests(rootDir)
  if (manifests.length === 0) {
    logger.warn('No DAO manifests found')
    return results
  }

  logger.info(`Found ${manifests.length} DAO manifest(s)`)
  for (const m of manifests) {
    logger.info(`  - ${m.displayName ?? m.name} (CEO: ${m.governance.ceo.name})`)
  }
  logger.newline()

  // Deploy each DAO
  for (const manifest of manifests) {
    const manifestPath = findManifestPath(rootDir, manifest.name)
    if (!manifestPath) {
      logger.warn(`Could not find manifest path for ${manifest.name}, skipping`)
      continue
    }

    logger.subheader(`Deploying ${manifest.displayName ?? manifest.name}`)

    const result = await deployDAO({
      ...options,
      manifestPath,
    })

    results.push(result)
  }

  // Setup allocations between DAOs
  if (setupAllocations && results.length > 1) {
    await setupDAOAllocations(rootDir, network, results, manifests)
  }

  // Summary
  logger.newline()
  logger.header('MULTI-DAO DEPLOYMENT COMPLETE')
  logger.keyValue('DAOs Deployed', String(results.length))
  for (const r of results) {
    logger.info(`  ${r.name}: ${r.daoId}`)
  }

  return results
}

/**
 * Setup allocations between DAOs based on manifest configuration
 */
async function setupDAOAllocations(
  rootDir: string,
  network: NetworkType,
  deployments: DAODeploymentResult[],
  manifests: DAOManifest[],
): Promise<void> {
  logger.step('Setting up DAO allocations...')

  const chainConfig = getChainConfig(network)
  const contracts = await loadContractAddresses(rootDir, network)

  const privateKey = process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_KEY or PRIVATE_KEY required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  })

  // Build lookup map from name to daoId
  const daoIdMap = new Map<string, `0x${string}`>()
  for (const d of deployments) {
    daoIdMap.set(d.name, d.daoId as `0x${string}`)
  }

  // Process each manifest's allocations
  for (let i = 0; i < manifests.length; i++) {
    const manifest = manifests[i]
    const deployment = deployments[i]
    const networkConfig = manifest.deployment?.[network]

    if (!networkConfig) continue

    const sourceDaoId = deployment.daoId as `0x${string}`

    // Setup parent DAO relationship
    if (networkConfig.parentDao) {
      const parentDaoId = daoIdMap.get(networkConfig.parentDao)
      if (parentDaoId) {
        logger.info(`  Setting ${manifest.name} parent to ${networkConfig.parentDao}`)
        try {
          const hash = await walletClient.writeContract({
            address: contracts.DAORegistry,
            abi: DAOAllocationRegistryABI,
            functionName: 'setParentDAO',
            args: [sourceDaoId, parentDaoId],
          })
          await publicClient.waitForTransactionReceipt({ hash })
        } catch (error) {
          logger.warn(`  Failed to set parent DAO: ${error}`)
        }
      } else {
        logger.warn(`  Parent DAO not found: ${networkConfig.parentDao}`)
      }
    }

    // Setup peer allocations
    if (networkConfig.peerAllocations) {
      for (const allocation of networkConfig.peerAllocations) {
        const targetDaoId = daoIdMap.get(allocation.targetDao)
        if (!targetDaoId) {
          logger.warn(`  Target DAO not found: ${allocation.targetDao}`)
          continue
        }

        const allocationType = ALLOCATION_TYPES[allocation.type]
        logger.info(
          `  Creating ${allocation.type} allocation: ${manifest.name} -> ${allocation.targetDao}`,
        )

        try {
          const hash = await walletClient.writeContract({
            address: contracts.DAORegistry,
            abi: DAOAllocationRegistryABI,
            functionName: 'createAllocation',
            args: [
              sourceDaoId,
              targetDaoId,
              allocationType,
              BigInt(allocation.amount),
              allocation.description ?? '',
            ],
          })
          await publicClient.waitForTransactionReceipt({ hash })
        } catch (error) {
          logger.warn(`  Failed to create allocation: ${error}`)
        }
      }
    }
  }

  logger.success('DAO allocations configured')
}

/**
 * Find the path to a DAO's manifest file
 */
function findManifestPath(rootDir: string, daoName: string): string | null {
  const candidates = [
    join(rootDir, 'vendor', daoName, 'dao', 'jeju-manifest.json'),
    join(rootDir, 'vendor', daoName, 'jeju-manifest.json'),
    join(rootDir, 'apps', daoName, 'jeju-manifest.json'),
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}
