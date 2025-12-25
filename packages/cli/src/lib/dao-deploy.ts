/**
 * DAO Deployment Library
 *
 * Core logic for deploying DAOs from jeju-manifest.json configuration.
 * Supports multi-DAO hierarchies, council auto-generation, and fee configuration.
 */

import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  daoFundingAbi,
  daoRegistryAbi,
  packageRegistryAbi,
  repoRegistryAbi,
} from '@jejunetwork/contracts'
import { uploadJSONToIPFS } from '@jejunetwork/shared'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  http,
  isAddress,
  keccak256,
  type Log,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'
import {
  type DAOManifest,
  validateCouncilWeights,
  validateDAOManifest,
} from '../schemas/dao-manifest'
import {
  CHAIN_CONFIG,
  type DAODeploymentResult,
  getDevCEOAddress,
  getDevCouncilAddresses,
  type NetworkType,
  WELL_KNOWN_KEYS,
} from '../types'
import { logger } from './logger'

const AddressSchema = z
  .string()
  .refine(isAddress, { message: 'Invalid address' })

const GovernanceDeploymentSchema = z
  .object({
    DAORegistry: AddressSchema,
    DAOFunding: AddressSchema,
  })
  .passthrough()

function extractDaoIdFromLogs(
  logs: Log[],
  fallbackName: string,
): `0x${string}` {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: daoRegistryAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'DAOCreated' && 'daoId' in decoded.args) {
        return decoded.args.daoId as `0x${string}`
      }
    } catch {
      /* skip non-matching events */
    }
  }
  logger.warn('Could not parse DAOCreated event, using fallback ID')
  return keccak256(toBytes(fallbackName))
}

function extractProjectIdFromLogs(
  logs: Log[],
  fallbackId: `0x${string}`,
): `0x${string}` {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: daoFundingAbi,
        data: log.data,
        topics: log.topics,
      })
      if (
        decoded.eventName === 'ProjectProposed' &&
        'projectId' in decoded.args
      ) {
        return decoded.args.projectId as `0x${string}`
      }
    } catch {
      /* skip non-matching events */
    }
  }
  logger.warn('Could not parse ProjectProposed event, using fallback ID')
  return fallbackId
}

function isAlreadyExistsError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('already exists') ||
    msg.includes('already registered') ||
    msg.includes('duplicate') ||
    msg.includes('already linked')
  )
}

const CHAINS: Record<NetworkType, Chain> = {
  localnet: {
    ...localhost,
    id: CHAIN_CONFIG.localnet.chainId,
    name: CHAIN_CONFIG.localnet.name,
  },
  testnet: baseSepolia,
  mainnet: base,
}

function getChainConfig(network: NetworkType) {
  return {
    chain: CHAINS[network],
    rpcUrl:
      network === 'localnet'
        ? (process.env.LOCAL_RPC_URL ?? CHAIN_CONFIG[network].rpcUrl)
        : CHAIN_CONFIG[network].rpcUrl,
  }
}

function loadContractAddresses(rootDir: string, network: NetworkType) {
  const deploymentPath = join(
    rootDir,
    'packages',
    'config',
    'deployments',
    `${network}.json`,
  )
  if (!existsSync(deploymentPath)) {
    throw new Error(
      `No deployment for ${network}. Run 'jeju deploy governance' first.`,
    )
  }

  const content = readFileSync(deploymentPath, 'utf-8')
  const parsed: unknown = JSON.parse(content)
  const deployment = GovernanceDeploymentSchema.parse(parsed)

  return {
    DAORegistry: deployment.DAORegistry as Address,
    DAOFunding: deployment.DAOFunding as Address,
    PackageRegistry: (deployment as Record<string, string>).PackageRegistry as
      | Address
      | undefined,
    RepoRegistry: (deployment as Record<string, string>).RepoRegistry as
      | Address
      | undefined,
    FeeConfig: (deployment as Record<string, string>).FeeConfig as
      | Address
      | undefined,
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

export async function deployDAO(
  options: DAODeployOptions,
): Promise<DAODeploymentResult> {
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
  const rawManifest: unknown = JSON.parse(manifestContent)
  const manifest = validateDAOManifest(rawManifest)

  logger.success(`Loaded: ${manifest.displayName ?? manifest.name}`)
  if (verbose) {
    logger.keyValue('CEO', manifest.governance.ceo.name)
    logger.keyValue(
      'Council Members',
      String(manifest.governance.council.members.length),
    )
  }

  const weightValidation = validateCouncilWeights(
    manifest.governance.council.members,
  )
  if (!weightValidation.valid) {
    logger.warn(weightValidation.message)
  }

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

  const treasuryAddress: Address =
    network === 'localnet'
      ? (WELL_KNOWN_KEYS.dev[0].address as Address)
      : account.address

  let manifestCid = ''
  if (ipfsApiUrl && !dryRun) {
    logger.step('Uploading manifest to IPFS...')
    try {
      manifestCid = await uploadJSONToIPFS(
        ipfsApiUrl,
        rawManifest,
        `${manifest.name}-manifest.json`,
      )
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
          minQualityScore: BigInt(
            manifest.governance.parameters.minQualityScore,
          ),
          councilVotingPeriod: BigInt(
            manifest.governance.parameters.councilVotingPeriod,
          ),
          gracePeriod: BigInt(manifest.governance.parameters.gracePeriod),
          minProposalStake: BigInt(
            manifest.governance.parameters.minProposalStake,
          ),
          quorumBps: BigInt(manifest.governance.parameters.quorumBps),
        },
      ],
    })

    logger.info(`TX: ${createDAOHash}`)
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: createDAOHash,
    })
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
          args: [
            daoId,
            memberAddress,
            BigInt(agentId),
            member.role,
            BigInt(member.weight),
          ],
        })
        await publicClient.waitForTransactionReceipt({ hash: memberHash })
      }

      councilResult.members.push({
        role: member.role,
        address: memberAddress,
        agentId,
      })

      logger.info(
        `  Added: ${member.role} (${memberAddress.slice(0, 10)}..., weight: ${member.weight})`,
      )
    }

    // Warn if all council members have the same address (likely misconfiguration)
    const uniqueAddresses = new Set(councilResult.members.map((m) => m.address))
    if (uniqueAddresses.size === 1 && councilResult.members.length > 1) {
      logger.warn(
        `All ${councilResult.members.length} council members have the same address. ` +
          `For production, set unique addresses in manifest or use TEE/MPC deployment.`,
      )
    }

    logger.success(
      `Council configured with ${councilResult.members.length} members`,
    )
  }

  const packageIds: string[] = []
  const repoIds: string[] = []

  const deploymentConfig = manifest.deployment?.[network]
  const shouldSeed =
    seed || (network === 'localnet' && deploymentConfig?.autoSeed !== false)

  if (shouldSeed) {
    if (manifest.packages?.seeded && manifest.packages.seeded.length > 0) {
      logger.step('Seeding packages...')

      for (const pkg of manifest.packages.seeded) {
        const packageId = keccak256(
          toBytes(`${manifest.name}:package:${pkg.name}`),
        )
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
              if (verbose)
                logger.info(`  Package ${pkg.name} already registered`)
            } else {
              throw error
            }
          }
        }

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

        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'proposeProject',
              args: [
                daoId,
                0,
                packageId as `0x${string}`,
                pkg.name,
                pkg.description,
                account.address,
                [],
                [],
              ],
            })

            const receipt = await publicClient.waitForTransactionReceipt({
              hash: proposeHash,
            })
            const projectId = extractProjectIdFromLogs(
              receipt.logs,
              packageId as `0x${string}`,
            )

            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'acceptProject',
              args: [projectId],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

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

    if (manifest.repos?.seeded && manifest.repos.seeded.length > 0) {
      logger.step('Seeding repositories...')

      for (const repo of manifest.repos.seeded) {
        const repoId = keccak256(toBytes(`${manifest.name}:repo:${repo.name}`))
        repoIds.push(repoId)

        if (contracts.RepoRegistry && !dryRun) {
          try {
            const registerHash = await walletClient.writeContract({
              address: contracts.RepoRegistry,
              abi: repoRegistryAbi,
              functionName: 'createRepository',
              args: [
                repo.name,
                repo.description,
                keccak256(toBytes(repo.url)) as `0x${string}`,
                BigInt(0),
                0,
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

        if (!dryRun) {
          try {
            const proposeHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'proposeProject',
              args: [
                daoId,
                1,
                repoId as `0x${string}`,
                repo.name,
                repo.description,
                account.address,
                [],
                [],
              ],
            })

            const receipt = await publicClient.waitForTransactionReceipt({
              hash: proposeHash,
            })
            const projectId = extractProjectIdFromLogs(
              receipt.logs,
              repoId as `0x${string}`,
            )

            const acceptHash = await walletClient.writeContract({
              address: contracts.DAOFunding,
              abi: daoFundingAbi,
              functionName: 'acceptProject',
              args: [projectId],
            })
            await publicClient.waitForTransactionReceipt({ hash: acceptHash })

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

  const actualFundTreasury = fundTreasury ?? deploymentConfig?.fundTreasury
  const actualFundMatching = fundMatching ?? deploymentConfig?.fundMatching

  if (actualFundTreasury && !dryRun) {
    logger.step('Funding treasury...')
    const amt = BigInt(actualFundTreasury)
    const hash = await walletClient.sendTransaction({
      to: treasuryAddress,
      value: amt,
    })
    await publicClient.waitForTransactionReceipt({ hash })
    logger.success(`Sent ${formatEther(amt)} ETH to treasury`)
  }

  if (actualFundMatching && !dryRun) {
    logger.step('Funding matching pool...')
    const amt = BigInt(actualFundMatching)
    const epochHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: daoFundingAbi,
      functionName: 'createEpoch',
      args: [daoId, BigInt(0), BigInt(0)],
    })
    await publicClient.waitForTransactionReceipt({ hash: epochHash })
    const depositHash = await walletClient.writeContract({
      address: contracts.DAOFunding,
      abi: daoFundingAbi,
      functionName: 'depositMatchingFunds',
      args: [daoId, amt],
      value: amt,
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    logger.success(`Deposited ${formatEther(amt)} ETH to matching pool`)
  }

  const result: DAODeploymentResult = {
    network,
    daoId,
    name: manifest.name,
    manifestCid,
    contracts: {
      daoRegistry: contracts.DAORegistry,
      daoFunding: contracts.DAOFunding,
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

  const deploymentDir = join(dirname(manifestPath), 'deployments')
  mkdirSync(deploymentDir, { recursive: true })
  const outputPath = join(deploymentDir, `${network}.json`)
  writeFileSync(outputPath, JSON.stringify(result, null, 2))
  logger.success(`Deployment saved to: ${outputPath}`)

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

  const tryLoadManifest = (
    manifestPath: string,
    requireGovernance = false,
  ): DAOManifest | null => {
    if (!existsSync(manifestPath)) return null
    try {
      const content = readFileSync(manifestPath, 'utf-8')
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (requireGovernance && (!parsed.governance || !parsed.funding))
        return null
      return validateDAOManifest(parsed)
    } catch {
      return null
    }
  }

  const vendorDir = join(rootDir, 'vendor')
  if (existsSync(vendorDir)) {
    const entries = readdirSync(vendorDir, { withFileTypes: true }) as Dirent[]
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = tryLoadManifest(
        join(vendorDir, entry.name, 'dao', 'jeju-manifest.json'),
      )
      if (manifest) manifests.push(manifest)
    }
  }

  const appsDir = join(rootDir, 'apps')
  if (existsSync(appsDir)) {
    const entries = readdirSync(appsDir, { withFileTypes: true }) as Dirent[]
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = tryLoadManifest(
        join(appsDir, entry.name, 'jeju-manifest.json'),
        true,
      )
      if (manifest) manifests.push(manifest)
    }
  }

  return manifests
}

// NOTE: DAOAllocationRegistry contract not yet deployed
// These allocation types are for future use when inter-DAO allocations are supported
const _ALLOCATION_TYPES = {
  'deep-funding': 0,
  'fee-share': 1,
  recurring: 2,
  'one-time': 3,
} as const
void _ALLOCATION_TYPES

export interface MultiDAODeployOptions extends DAODeployOptions {
  all?: boolean
  setupAllocations?: boolean
}

export async function deployMultipleDAOs(
  options: MultiDAODeployOptions,
): Promise<DAODeploymentResult[]> {
  const { rootDir, network, setupAllocations } = options
  const results: DAODeploymentResult[] = []

  logger.header(`MULTI-DAO DEPLOYMENT TO ${network.toUpperCase()}`)

  const manifests = discoverDAOManifests(rootDir)
  if (manifests.length === 0) {
    logger.warn('No DAO manifests found')
    return results
  }

  logger.info(`Found ${manifests.length} DAO manifest(s)`)
  for (const m of manifests) {
    logger.info(
      `  - ${m.displayName ?? m.name} (CEO: ${m.governance.ceo.name})`,
    )
  }
  logger.newline()

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

  if (setupAllocations && results.length > 1) {
    await setupDAOAllocations(rootDir, network, results, manifests)
  }

  logger.newline()
  logger.header('MULTI-DAO DEPLOYMENT COMPLETE')
  logger.keyValue('DAOs Deployed', String(results.length))
  for (const r of results) {
    logger.info(`  ${r.name}: ${r.daoId}`)
  }

  return results
}

/**
 * Log planned DAO allocations.
 * NOTE: DAOAllocationRegistry contract not yet deployed - this only logs what would be configured.
 */
function setupDAOAllocations(
  _rootDir: string,
  network: NetworkType,
  deployments: DAODeploymentResult[],
  manifests: DAOManifest[],
): void {
  logger.step('Planning DAO allocations...')
  logger.warn(
    'DAOAllocationRegistry not deployed - logging planned allocations only',
  )

  const daoIdMap = new Map(deployments.map((d) => [d.name, d.daoId]))

  for (let i = 0; i < manifests.length; i++) {
    const manifest = manifests[i]
    const networkConfig = manifest.deployment?.[network]
    if (!networkConfig) continue

    if (networkConfig.parentDao) {
      if (daoIdMap.has(networkConfig.parentDao)) {
        logger.info(
          `  [PLANNED] ${manifest.name} parent -> ${networkConfig.parentDao}`,
        )
      } else {
        logger.warn(`  Parent DAO not found: ${networkConfig.parentDao}`)
      }
    }

    if (networkConfig.peerAllocations) {
      for (const allocation of networkConfig.peerAllocations) {
        if (!daoIdMap.has(allocation.targetDao)) {
          logger.warn(`  Target DAO not found: ${allocation.targetDao}`)
          continue
        }
        logger.info(
          `  [PLANNED] ${allocation.type}: ${manifest.name} -> ${allocation.targetDao} (${allocation.amount})`,
        )
      }
    }
  }

  logger.info(
    'Allocations will be configured when DAOAllocationRegistry is deployed',
  )
}

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
