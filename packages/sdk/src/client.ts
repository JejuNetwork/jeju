/**
 * NetworkClient - Main SDK entry point
 *
 * The client name (JejuClient, etc.) comes from branding config.
 */

import { getNetworkName } from '@jejunetwork/config'
import type { NetworkType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { type A2AModule, createA2AModule } from './a2a'
import { type AgentsModule, createAgentsModule } from './agents'
import { type AMMModule, createAMMModule } from './amm'
import { type BridgeModule, createBridgeModule } from './bridge'
import { type CDNModule, createCDNModule } from './cdn'
import { type CICDModule, createCICDModule } from './cicd'
import { type ComputeModule, createComputeModule } from './compute'
import {
  getChainConfig,
  getContractAddresses,
  getServicesConfig,
} from './config'
import { type ContainersModule, createContainersModule } from './containers'
import { type CrossChainModule, createCrossChainModule } from './crosschain'
import { createDatasetsModule, type DatasetsModule } from './datasets'
import { createDefiModule, type DefiModule } from './defi'
import { createDistributorModule, type DistributorModule } from './distributor'
import { createDWSModule, type DWSModule } from './dws'
import {
  createFederationClient as createFedClient,
  type FederationClient,
  type FederationClientConfig,
} from './federation'
import { createFeedModule, type FeedModule } from './feed'
import { createGovernanceModule, type GovernanceModule } from './governance'
import { createIdentityModule, type IdentityModule } from './identity'
import { createKMSWallet, type KMSWallet } from './kms-wallet'
import { createLaunchpadModule, type LaunchpadModule } from './launchpad'
import { createMCPModule, type MCPModule } from './mcp'
import { createMessagingModule, type MessagingModule } from './messaging'
import { createModelsModule, type ModelsModule } from './models'
import { createModerationModule, type ModerationModule } from './moderation'
import { createNamesModule, type NamesModule } from './names'
import { createNFTModule, type NFTModule } from './nfts'
import { createOracleModule, type OracleModule } from './oracle'
import { createOTCModule, type OTCModule } from './otc'
import { createPaymentsModule, type PaymentsModule } from './payments'
import { createPerpsModule, type PerpsModule } from './perps'
import { createPredictionModule, type PredictionModule } from './prediction'
import { createSequencerModule, type SequencerModule } from './sequencer'
import { createStakingModule, type StakingModule } from './staking'
import { createStorageModule, type StorageModule } from './storage'
import { createTrainingModule, type TrainingModule } from './training'
import { createValidationModule, type ValidationModule } from './validation'
import { createVPNModule, type VPNModule } from './vpn-module'
import { type BaseWallet, createWallet, type JejuWallet } from './wallet'
import { createWorkModule, type WorkModule } from './work'

export interface JejuClientConfig {
  /** Network to connect to */
  network: NetworkType
  /** Pre-configured local account (from viem/accounts) */
  account?: LocalAccount
  /** Enable ERC-4337 smart account (default: true) */
  smartAccount?: boolean
  /** Custom RPC URL override */
  rpcUrl?: string
  /** Custom bundler URL override */
  bundlerUrl?: string

  // ═══════════════════════════════════════════════════════════════════════════
  // KMS Configuration (Recommended for Production/TEE environments)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * KMS endpoint URL for secure signing
   * When provided, private key signing is delegated to KMS (MPC-backed)
   */
  kmsEndpoint?: string
  /**
   * KMS key ID for this wallet
   * Required when using KMS mode
   */
  kmsKeyId?: string
  /**
   * Wallet address (required for KMS mode since we can't derive from key)
   */
  kmsAddress?: Address
  /**
   * KMS authentication token
   */
  kmsAuthToken?: string
}

export interface JejuClient {
  /** Current network */
  readonly network: NetworkType
  /** Chain ID */
  readonly chainId: number
  /** Wallet address */
  readonly address: Address
  /** Whether using smart account */
  readonly isSmartAccount: boolean
  /** Wallet instance (BaseWallet - works with both JejuWallet and KMSWallet) */
  readonly wallet: BaseWallet

  /** Compute marketplace - GPU/CPU rentals, inference, triggers */
  readonly compute: ComputeModule
  /** Storage marketplace - IPFS, multi-provider */
  readonly storage: StorageModule
  /** DeFi - Swaps, liquidity, launchpad */
  readonly defi: DefiModule
  /** Governance - Proposals, voting, delegation */
  readonly governance: GovernanceModule
  /** JNS - Name registration and resolution */
  readonly names: NamesModule
  /** Identity - ERC-8004, reputation, moderation */
  readonly identity: IdentityModule
  /** Validation - ERC-8004 validation registry */
  readonly validation: ValidationModule
  /** Cross-chain - EIL + OIF transfers and intents */
  readonly crosschain: CrossChainModule
  /** NFTs - Cross-chain NFT bridging via Hyperlane/EIL/OIF */
  readonly nfts: NFTModule
  /** Payments - Paymasters, x402, credits */
  readonly payments: PaymentsModule
  /** A2A - Agent protocol client */
  readonly a2a: A2AModule
  /** Containers - OCI container registry */
  readonly containers: ContainersModule
  /** Launchpad - Token and NFT launches */
  readonly launchpad: LaunchpadModule
  /** Moderation - Evidence registry, cases, reputation labels */
  readonly moderation: ModerationModule
  /** Work - Bounties, projects, guardians */
  readonly work: WorkModule
  /** Staking - JEJU staking, node staking, RPC provider staking */
  readonly staking: StakingModule
  /** DWS - Distributed Workflow System, triggers, jobs */
  readonly dws: DWSModule
  /** Federation - Cross-chain network federation */
  readonly federation: FederationClient
  /** OTC - Over-the-counter token trading */
  readonly otc: OTCModule
  /** Messaging - Decentralized messaging relay */
  readonly messaging: MessagingModule
  /** Distributor - Airdrops, vesting, fees */
  readonly distributor: DistributorModule
  /** Training - Decentralized AI training coordination */
  readonly training: TrainingModule
  /** Perps - Perpetual futures trading */
  readonly perps: PerpsModule
  /** AMM - Automated market maker / DEX */
  readonly amm: AMMModule
  /** Agents - AI agent vault management */
  readonly agents: AgentsModule
  /** Bridge - Cross-chain bridging */
  readonly bridge: BridgeModule
  /** Oracle - Price feeds and data oracles */
  readonly oracle: OracleModule
  /** Sequencer - L2 sequencer management */
  readonly sequencer: SequencerModule
  /** CDN - Content delivery network */
  readonly cdn: CDNModule
  /** VPN - Decentralized VPN network */
  readonly vpn: VPNModule
  /** Models - HuggingFace-like model registry */
  readonly models: ModelsModule
  /** Datasets - Training data registry */
  readonly datasets: DatasetsModule
  /** CI/CD - Continuous integration and deployment */
  readonly cicd: CICDModule
  /** Feed - Social feed (Farcaster) integration */
  readonly feed: FeedModule
  /** MCP - Model Context Protocol client */
  readonly mcp: MCPModule
  /** Prediction - Prediction markets */
  readonly prediction: PredictionModule

  /** Get native balance */
  getBalance(): Promise<bigint>
  /** Send transaction */
  sendTransaction(params: {
    to: Address
    value?: bigint
    data?: Hex
  }): Promise<Hex>
}

export async function createJejuClient(
  config: JejuClientConfig,
): Promise<JejuClient> {
  // Check for KMS mode first (recommended for production)
  const hasKMSConfig =
    config.kmsEndpoint !== undefined &&
    config.kmsKeyId !== undefined &&
    config.kmsAddress !== undefined
  const hasAccountConfig = config.account !== undefined

  if (!hasKMSConfig && !hasAccountConfig) {
    throw new Error(
      `${getNetworkName()}Client requires either:\n` +
        '  - KMS configuration (kmsEndpoint, kmsKeyId, kmsAddress) for secure signing, or\n' +
        '  - Pre-configured account for development',
    )
  }

  const network = config.network
  const chainConfig = getChainConfig(network)
  const servicesConfig = getServicesConfig(network)

  // Create wallet (KMS-backed or local)
  let wallet: JejuWallet | KMSWallet

  if (hasKMSConfig) {
    // Validate KMS config - all fields are required
    if (!config.kmsAddress) {
      throw new Error('KMS mode requires kmsAddress')
    }
    if (!config.kmsEndpoint) {
      throw new Error('KMS mode requires kmsEndpoint')
    }
    if (!config.kmsKeyId) {
      throw new Error('KMS mode requires kmsKeyId')
    }

    // Use KMS-backed wallet (recommended for production/TEE)
    wallet = await createKMSWallet({
      address: config.kmsAddress,
      kmsEndpoint: config.kmsEndpoint,
      keyId: config.kmsKeyId,
      network,
      smartAccount: config.smartAccount,
      authToken: config.kmsAuthToken,
    })
  } else if (config.account) {
    // Use local account wallet (development only)
    wallet = await createWallet({
      account: config.account,
      smartAccount: config.smartAccount,
      network,
    })
  } else {
    throw new Error('No valid wallet configuration provided')
  }

  // Get contract addresses for modules that need them
  const contractAddresses = getContractAddresses(network)

  // Create modules
  const compute = createComputeModule(wallet, network)
  const storage = createStorageModule(wallet, network)
  const defi = createDefiModule(wallet, network)
  // Governance module - always create, throws on method call if contracts missing
  const governance = createGovernanceModule(wallet, network)
  const names = createNamesModule(wallet, network)
  const identity = createIdentityModule(wallet, network)
  const validation = createValidationModule(
    wallet,
    network,
    wallet.publicClient,
  )
  const crosschain = createCrossChainModule(wallet, network)
  const nfts = createNFTModule(wallet, network)
  const payments = createPaymentsModule(wallet, network)
  const a2a = createA2AModule(wallet, network, servicesConfig)

  // Create extended modules - always create, throws on method call if contracts missing
  const containers = createContainersModule(wallet, network)
  const launchpad = createLaunchpadModule(wallet, network)
  const moderation = createModerationModule(wallet, network)
  const work = createWorkModule(wallet, network)
  const staking = createStakingModule(wallet, network)
  const dws = createDWSModule(wallet, network)

  // Create federation client from config - always create, throws on method call if contracts missing
  const federationConfig: FederationClientConfig = {
    hubRpc: chainConfig.rpcUrl,
    networkRegistry:
      contractAddresses.networkRegistry ??
      '0x0000000000000000000000000000000000000000',
    registryHub:
      contractAddresses.registryHub ??
      '0x0000000000000000000000000000000000000000',
  }
  const federation = await createFedClient(federationConfig)
  const otc = createOTCModule(wallet, network)
  const messaging = createMessagingModule(wallet, network)
  const distributor = createDistributorModule(wallet, network)
  const training = createTrainingModule(wallet, network)
  const perps = createPerpsModule(wallet, network)
  const amm = createAMMModule(wallet, network)
  const agents = createAgentsModule(wallet, network)
  const bridge = createBridgeModule(wallet, network)
  const oracle = createOracleModule(wallet, network)
  const sequencer = createSequencerModule(wallet, network)
  const cdn = createCDNModule(wallet, network)
  const vpn = createVPNModule(wallet, network)
  const models = createModelsModule(wallet, network)
  const datasets = createDatasetsModule(wallet, network)
  const cicd = createCICDModule(wallet, network)
  const feed = createFeedModule(wallet, network)
  const mcp = createMCPModule(wallet, network)
  const prediction = createPredictionModule(wallet, network)

  const client: JejuClient = {
    network,
    chainId: chainConfig.chainId,
    address: wallet.address,
    isSmartAccount: wallet.isSmartAccount,
    wallet,

    compute,
    storage,
    defi,
    governance,
    names,
    identity,
    validation,
    crosschain,
    nfts,
    payments,
    a2a,
    containers,
    launchpad,
    moderation,
    work,
    staking,
    dws,
    federation,
    otc,
    messaging,
    distributor,
    training,
    perps,
    amm,
    agents,
    bridge,
    oracle,
    sequencer,
    cdn,
    vpn,
    models,
    datasets,
    cicd,
    feed,
    mcp,
    prediction,

    getBalance: () => wallet.getBalance(),
    sendTransaction: (params) => wallet.sendTransaction(params),
  }

  return client
}
