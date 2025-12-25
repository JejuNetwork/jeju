import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, type Dirent } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  keccak256,
  toBytes,
  type Chain,
  type Log,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { 
  daoRegistryAbi, 
  daoFundingAbi, 
  packageRegistryAbi, 
  repoRegistryAbi 
} from '@jejunetwork/contracts'
import { uploadJSONToIPFS } from '@jejunetwork/shared'
import { logger } from './logger'
import { type DAOManifest, validateDAOManifest, validateCouncilWeights } from '../schemas/dao-manifest'
import {
  type DAODeploymentResult,
  type NetworkType,
  WELL_KNOWN_KEYS,
  getDevCouncilAddresses,
  getDevCEOAddress,
  CHAIN_CONFIG,
} from '../types'

function extractDaoIdFromLogs(logs: Log[], fallbackName: string): `0x${string}` {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: daoRegistryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'DAOCreated' && 'daoId' in decoded.args) {
        return decoded.args.daoId as `0x${string}`
      }
    } catch { /* skip non-matching events */ }
  }
  logger.warn('Could not parse DAOCreated event, using fallback ID')
  return keccak256(toBytes(fallbackName))
}

function extractProjectIdFromLogs(logs: Log[], fallbackId: `0x${string}`): `0x${string}` {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: daoFundingAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'ProjectProposed' && 'projectId' in decoded.args) {
        return decoded.args.projectId as `0x${string}`
      }
    } catch { /* skip non-matching events */ }
  }
  logger.warn('Could not parse ProjectProposed event, using fallback ID')
  return fallbackId
}

function isAlreadyExistsError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return msg.includes('already exists') || msg.includes('already registered') || 
         msg.includes('duplicate') || msg.includes('already linked')
}

const CHAINS: Record<NetworkType, Chain> = {
  localnet: { ...localhost, id: CHAIN_CONFIG.localnet.chainId, name: CHAIN_CONFIG.localnet.name },
  testnet: baseSepolia,
  mainnet: base,
}

function getChainConfig(network: NetworkType) {
  return {
    chain: CHAINS[network],
    rpcUrl: network === 'localnet' ? (process.env.LOCAL_RPC_URL ?? CHAIN_CONFIG[network].rpcUrl) : CHAIN_CONFIG[network].rpcUrl,
  }
}

function loadContractAddresses(rootDir: string, network: NetworkType) {
  const path = join(rootDir, 'packages', 'config', 'deployments', `${network}.json`)
  if (!existsSync(path)) {
    throw new Error(`No deployment for ${network}. Run 'jeju deploy governance' first.`)
  }
  const deployment = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
  if (!deployment.DAORegistry || !deployment.DAOFunding) {
    throw new Error(`DAORegistry/DAOFunding not found. Run 'jeju deploy governance' first.`)
  }
  return {
    DAORegistry: deployment.DAORegistry as Address,
    DAOFunding: deployment.DAOFunding as Address,
    PackageRegistry: deployment.PackageRegistry as Address | undefined,
    RepoRegistry: deployment.RepoRegistry as Address | undefined,
    FeeConfig: deployment.FeeConfig as Address | undefined,
  }
}

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
  ipfsApiUrl?: string
}

export async function deployDAO(options: DAODeployOptions): Promise<DAODeploymentResult> {
  const {
    network,
    manifestPath,
    rootDir,
    seed,
    fundTreasury,
    fundMatching,
    dryRun,
    skipCouncil,
    skipFundingConfig,
    verbose,
    ipfsApiUrl,
  } = options

  logger.header(`DEPLOY DAO TO ${network.toUpperCase()}`)

  if (dryRun) logger.warn('DRY RUN - no transactions will be submitted')

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

  const weightValidation = validateCouncilWeights(manifest.governance.council.members)
  if (!weightValidation.valid) logger.warn(weightValidation.message)

  logger.step('Connecting to network...')
  const chainConfig = getChainConfig(network)
  const contracts = loadContractAddresses(rootDir, network)

  const privateKey = process.env.DEPLOYER_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY or PRIVATE_KEY required')

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

  const balance = await publicClient.getBalance({ address: account.address })
  logger.keyValue('Balance', `${formatEther(balance)} ETH`)
  if (balance < BigInt('100000000000000000') && !dryRun) {
    throw new Error('Insufficient balance: need at least 0.1 ETH')
  }

  const treasuryAddress: Address = network === 'localnet' 
    ? WELL_KNOWN_KEYS.dev[0].address as Address 
    : account.address

  let manifestCid = ''
  if (ipfsApiUrl && !dryRun) {
    logger.step('Uploading manifest to IPFS...')
    try {
      manifestCid = await uploadJSONToIPFS(ipfsApiUrl, rawManifest, `${manifest.name}-manifest.json`)
      logger.success(`Manifest uploaded: ${manifestCid}`)
    } catch (err) {
      logger.warn(`IPFS upload failed: ${(err as Error).message}`)
    }
  } else if (!ipfsApiUrl && network !== 'localnet') {
    logger.warn('No IPFS API - manifest not stored on-chain')
  }
  logger.step(`Creating ${manifest.displayName ?? manifest.name}...`)

  let daoId: `0x${string}`

  if (dryRun) {
    daoId = keccak256(toBytes(`dao:${manifest.name}:${Date.now()}`))
    logger.info(`Would create DAO with ID: ${daoId}`)
  } else {
    const createDAOHash = await walletClient.writeContract({
      address: contracts.DAORegistry,
      abi: daoRegistryAbi,
      functionName: 'createDAO',
      args: [
        manifest.name,
        manifest.displayName ?? manifest.name,
        manifest.description ?? '',
        treasuryAddress,
        manifestCid,
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
    daoId = extractDaoIdFromLogs(receipt.logs, manifest.name)
    logger.success(`DAO created with ID: ${daoId}`)
  }

  if (!skipFundingConfig) {
    logger.step('Configuring funding parameters...')

    if (!dryRun) {
      const configHash = await walletClient.writeContract({
        address: contracts.DAOFunding,
        abi: daoFundingAbi,
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
            minStakePerParticipant: BigInt(manifest.funding.minStake),
          },
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash: configHash })
    }
    logger.success('Funding configured')
  }

  const councilResult: DAODeploymentResult['council'] = { members: [] }

  if (!skipCouncil) {
    logger.step('Setting up council...')
    const devAddresses = network === 'localnet' ? getDevCouncilAddresses() : {}

    for (let i = 0; i < manifest.governance.council.members.length; i++) {
      const member = manifest.governance.council.members[i]
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
          abi: daoRegistryAbi,
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

  const packageIds: string[] = []
  const repoIds: string[] = []

  const deploymentConfig = manifest.deployment?.[network]
  const shouldSeed = seed || (network === 'localnet' && deploymentConfig?.autoSeed !== false)

  if (shouldSeed) {
    if (manifest.packages?.seeded && manifest.packages.seeded.length > 0) {
      logger.step('Seeding packages...')

      for (const pkg of manifest.packages.seeded) {
        const packageId = keccak256(toBytes(`${manifest.name}:package:${pkg.name}`))
        packageIds.push(packageId)

        if (contracts.PackageRegistry && !dryRun) {
          try {
            const registerHash = await walletClient.writeContract({
              address: contracts.PackageRegistry,
              abi: packageRegistryAbi,
              functionName: 'createPackage',
              args: [pkg.name, '', pkg.description, 'MIT', BigInt(0)],
            })
            await publicClient.waitForTransactionReceipt({ hash: registerHash })
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Package ${pkg.name} already registered`)
            } else {
              throw error
            }
          }
        }

        // Link to DAO
        if (!dryRun) {
          try {
            const linkHash = await walletClient.writeContract({
              address: contracts.DAORegistry,
              abi: daoRegistryAbi,
              functionName: 'linkPackage',
              args: [daoId, packageId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: linkHash })
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Package ${pkg.name} already linked`)
            } else {
              throw error
            }
          }
        }

        // Create funding project and set weight
        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
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
            const projectId = extractProjectIdFromLogs(receipt.logs, packageId as `0x${string}`)

            // Accept project
            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'acceptProject',
              args: [projectId],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

            // Propose CEO weight (subject to 48-hour timelock)
            // Weight will take effect after timelock expires
            if (pkg.fundingWeight > 0) {
              const weightHash = await walletClient.writeContract({
                address: contracts.DAOFunding,
                abi: daoFundingAbi,
                functionName: 'proposeCEOWeight',
                args: [projectId, BigInt(pkg.fundingWeight)],
              })
              await publicClient.waitForTransactionReceipt({ hash: weightHash })
            }
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Project ${pkg.name} already exists`)
            } else {
              throw error
            }
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
              abi: repoRegistryAbi,
              functionName: 'createRepository',
              args: [
                repo.name,
                repo.description,
                keccak256(toBytes(repo.url)) as `0x${string}`, // jnsNode (hash of URL)
                BigInt(0), // agentId (0 for no associated agent)
                0, // visibility: PUBLIC
              ],
            })
            await publicClient.waitForTransactionReceipt({ hash: registerHash })
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Repo ${repo.name} already registered`)
            } else {
              throw error
            }
          }
        }

        // Link to DAO
        if (!dryRun) {
          try {
            const linkHash = await walletClient.writeContract({
              address: contracts.DAORegistry,
              abi: daoRegistryAbi,
              functionName: 'linkRepo',
              args: [daoId, repoId as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash: linkHash })
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Repo ${repo.name} already linked`)
            } else {
              throw error
            }
          }
        }

        // Create funding project and set weight
        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
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
            const projectId = extractProjectIdFromLogs(receipt.logs, repoId as `0x${string}`)

            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'acceptProject',
              args: [projectId],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

            // Propose CEO weight (subject to 48-hour timelock)
            if (repo.fundingWeight > 0) {
              const weightHash = await walletClient.writeContract({
                address: contracts.DAOFunding,
                abi: daoFundingAbi,
                functionName: 'proposeCEOWeight',
                args: [projectId, BigInt(repo.fundingWeight)],
              })
              await publicClient.waitForTransactionReceipt({ hash: weightHash })
            }
          } catch (err) {
            const error = err as Error
            if (isAlreadyExistsError(error)) {
              if (verbose) logger.info(`  Project ${repo.name} already exists`)
            } else {
              throw error
            }
          }
        }

        logger.info(`  ${repo.name} (weight: ${repo.fundingWeight / 100}%)`)
      }

      logger.success(`Seeded ${repoIds.length} repositories`)
    }
  }

  // 9. Fund treasury and matching pool
  const actualFundTreasury = fundTreasury ?? deploymentConfig?.fundTreasury
  const actualFundMatching = fundMatching ?? deploymentConfig?.fundMatching

  if (actualFundTreasury && !dryRun) {
    logger.step('Funding treasury...')
    const treasuryAmount = BigInt(actualFundTreasury)
    const treasuryHash = await walletClient.sendTransaction({
      to: treasuryAddress,
      value: treasuryAmount,
    })
    await publicClient.waitForTransactionReceipt({ hash: treasuryHash })
    logger.success(`Sent ${formatEther(treasuryAmount)} ETH to treasury`)
  }

  if (actualFundMatching && !dryRun) {
    logger.step('Funding matching pool...')
    const matchingAmount = BigInt(actualFundMatching)

    // Create epoch first
    const epochHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: daoFundingAbi,
      functionName: 'createEpoch',
      args: [daoId, BigInt(0), BigInt(0)],
    })
    await publicClient.waitForTransactionReceipt({ hash: epochHash })

    // Deposit matching funds
    const depositHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: daoFundingAbi,
      functionName: 'depositMatchingFunds',
      args: [daoId, matchingAmount],
      value: matchingAmount,
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })

    logger.success(`Deposited ${formatEther(matchingAmount)} ETH to matching pool`)
  }

  // 10. Build and save result
  const result: DAODeploymentResult = {
    network,
    daoId,
    name: manifest.name,
    contracts: {
      daoRegistry: contracts.DAORegistry,
      daoFunding: contracts.DAOFunding,
      // NOTE: Council contract deployment not yet implemented
      // For now, council members are registered in DAORegistry directly
      // A dedicated Council contract will be deployed via TEE/MPC in production
      council: null,
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
export function discoverDAOManifests(rootDir: string): DAOManifest[] {
  const manifests: DAOManifest[] = []

  const tryLoadManifest = (manifestPath: string, requireGovernance = false): DAOManifest | null => {
    if (!existsSync(manifestPath)) return null
    try {
      const content = readFileSync(manifestPath, 'utf-8')
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (requireGovernance && (!parsed.governance || !parsed.funding)) return null
      return validateDAOManifest(parsed)
    } catch {
      return null // Invalid JSON or validation error - skip
    }
  }

  // Check vendor directory for DAO subdirectories
  const vendorDir = join(rootDir, 'vendor')
  if (existsSync(vendorDir)) {
    const entries = readdirSync(vendorDir, { withFileTypes: true }) as Dirent[]
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = tryLoadManifest(join(vendorDir, entry.name, 'dao', 'jeju-manifest.json'))
      if (manifest) manifests.push(manifest)
    }
  }

  // Check apps directory for DAO manifests
  const appsDir = join(rootDir, 'apps')
  if (existsSync(appsDir)) {
    const entries = readdirSync(appsDir, { withFileTypes: true }) as Dirent[]
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = tryLoadManifest(join(appsDir, entry.name, 'jeju-manifest.json'), true)
      if (manifest) manifests.push(manifest)
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
  const manifests = discoverDAOManifests(rootDir)
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
        const hash = await walletClient.writeContract({
          address: contracts.DAORegistry,
          abi: DAOAllocationRegistryABI,
          functionName: 'setParentDAO',
          args: [sourceDaoId, parentDaoId],
        }).catch((e: Error) => { logger.warn(`  Failed to set parent DAO: ${e.message}`); return null })
        if (hash) await publicClient.waitForTransactionReceipt({ hash })
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
        logger.info(`  Creating ${allocation.type} allocation: ${manifest.name} -> ${allocation.targetDao}`)

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
        }).catch((e: Error) => { logger.warn(`  Failed to create allocation: ${e.message}`); return null })
        if (hash) await publicClient.waitForTransactionReceipt({ hash })
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
