#!/usr/bin/env bun

/**
 * Sync Localnet Config
 *
 * Syncs deployed contract addresses from localnet-complete.json to contracts.json
 * This ensures the SDK and apps use the same contract addresses as the bootstrap.
 *
 * Usage:
 *   bun run scripts/sync-localnet-config.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT_DIR = join(import.meta.dir, '../../..')
const DEPLOYMENT_FILE = join(
  ROOT_DIR,
  'packages/contracts/deployments/localnet-complete.json',
)
const CONFIG_FILE = join(ROOT_DIR, 'packages/config/contracts.json')

interface DeploymentContracts {
  // Tokens
  jeju?: string
  usdc?: string
  weth?: string
  // Core Infrastructure
  creditManager?: string
  universalPaymaster?: string
  serviceRegistry?: string
  priceOracle?: string
  // Paymaster System
  tokenRegistry?: string
  paymasterFactory?: string
  entryPoint?: string
  // Registry System
  identityRegistry?: string
  reputationRegistry?: string
  validationRegistry?: string
  // ZK Bridge
  zkVerifier?: string
  zkBridge?: string
  solanaLightClient?: string
  // Node Staking
  nodeStakingManager?: string
  nodePerformanceOracle?: string
  // Uniswap V4
  poolManager?: string
  swapRouter?: string
  positionManager?: string
  quoterV4?: string
  stateView?: string
  // Governance
  futarchyGovernor?: string
  // Storage
  fileStorageManager?: string
  // Moderation
  banManager?: string
  reputationLabelManager?: string
  evidenceRegistry?: string
  moderationMarketplace?: string
  reportingSystem?: string
  // Compute Marketplace
  computeRegistry?: string
  ledgerManager?: string
  inferenceServing?: string
  computeStaking?: string
  // Liquidity System
  riskSleeve?: string
  liquidityRouter?: string
  multiServiceStakeManager?: string
  liquidityVault?: string
  // Security
  securityBountyRegistry?: string
  // DWS
  jnsRegistry?: string
  jnsResolver?: string
  storageManager?: string
  workerRegistry?: string
  cdnRegistry?: string
  // OAuth3
  oauth3TeeVerifier?: string
  oauth3IdentityRegistry?: string
  oauth3AppRegistry?: string
  oauth3Staking?: string
  // Bazaar
  nftMarketplace?: string
  simpleCollectible?: string
  // EIL
  l1StakeManager?: string
  crossChainPaymaster?: string
  l1L2Messenger?: string
  // VPN
  vpnRegistry?: string
  // Agents
  agentVault?: string
  roomRegistry?: string
  // OTC
  otc?: string
  // Staking (additional)
  rpcProviderRegistry?: string
  staking?: string
  // Perps
  perpetualMarket?: string
  insuranceFund?: string
  marginManager?: string
  // Training
  trainingCoordinator?: string
  trainingRewards?: string
  // Distributor
  airdropManager?: string
  tokenVesting?: string
  feeDistributor?: string
  stakingRewardDistributor?: string
  // Sequencer
  sequencerRegistry?: string
  forcedInclusion?: string
  slashingContract?: string
  // AMM
  xlpRouter?: string
  xlpV2Factory?: string
  // Oracle (additional)
  oracleRegistry?: string
  // Messaging
  messageNodeRegistry?: string
  messagingKeyRegistry?: string
  // Hyperlane Bridge
  hyperlaneMailbox?: string
  hyperlaneISM?: string
}

interface DeploymentResult {
  network: string
  rpcUrl: string
  contracts: DeploymentContracts
}

interface ContractsConfig {
  localnet: {
    chainId: number
    tokens: {
      jeju?: string
      usdc?: string
      weth?: string
    }
    registry: {
      identity?: string
      reputation?: string
      validation?: string
      token?: string
      app?: string
      node?: string
    }
    rpc: {
      staking?: string
    }
    moderation: {
      banManager?: string
      reportingSystem?: string
      reputationLabelManager?: string
      moderationMarketplace?: string
      evidenceRegistry?: string
    }
    bazaar: {
      marketplace?: string
      simpleCollectible?: string
      predictionMarket?: string
      tokenFactory?: string
    }
    oauth3: {
      teeVerifier?: string
      identityRegistry?: string
      appRegistry?: string
      staking?: string
    }
    dws: {
      storageManager?: string
      workerRegistry?: string
      cdnRegistry?: string
    }
    payments: {
      creditManager?: string
      universalPaymaster?: string
      paymasterFactory?: string
    }
    defi: {
      poolManager?: string
      positionManager?: string
      swapRouter?: string
      quoterV4?: string
      stateView?: string
    }
    compute: {
      registry?: string
      ledgerManager?: string
      inferenceServing?: string
      staking?: string
    }
    nodeStaking: {
      manager?: string
      performanceOracle?: string
    }
    jns: {
      registry?: string
      resolver?: string
    }
    governance: {
      governor?: string
      timelock?: string
      futarchyGovernor?: string
    }
    liquidity: {
      riskSleeve?: string
      liquidityRouter?: string
      multiServiceStakeManager?: string
      liquidityVault?: string
    }
    security: {
      bountyRegistry?: string
    }
    eil: {
      l1StakeManager?: string
      crossChainPaymaster?: string
    }
    federation: {
      registryHub?: string
      networkRegistry?: string
    }
    vpn: {
      registry?: string
    }
    agents: {
      vault?: string
      roomRegistry?: string
    }
    otc: {
      contract?: string
    }
    staking: {
      contract?: string
      rpcProviderRegistry?: string
    }
    perps: {
      market?: string
      insuranceFund?: string
      marginManager?: string
    }
    training: {
      coordinator?: string
      rewards?: string
    }
    distributor: {
      airdropManager?: string
      tokenVesting?: string
      feeDistributor?: string
      stakingRewardDistributor?: string
    }
    sequencer: {
      registry?: string
      forcedInclusion?: string
      slashing?: string
    }
    amm: {
      router?: string
      factory?: string
    }
    oracle: {
      registry?: string
    }
    messaging: {
      nodeRegistry?: string
      keyRegistry?: string
    }
    bridge: {
      hyperlaneMailbox?: string
      hyperlaneISM?: string
      optimismPortal?: string
      l1StandardBridge?: string
      nftBridge?: string
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

function isValidAddress(addr: string | undefined): boolean {
  return (
    !!addr &&
    addr !== '0x0000000000000000000000000000000000000000' &&
    addr.startsWith('0x')
  )
}

function syncConfig(): void {
  console.log('🔄 Syncing localnet config...')
  console.log('')

  if (!existsSync(DEPLOYMENT_FILE)) {
    console.error('❌ Deployment file not found:', DEPLOYMENT_FILE)
    console.error(
      '   Run bootstrap first: bun run scripts/bootstrap-localnet-complete.ts',
    )
    process.exit(1)
  }

  if (!existsSync(CONFIG_FILE)) {
    console.error('❌ Config file not found:', CONFIG_FILE)
    process.exit(1)
  }

  const deployment: DeploymentResult = JSON.parse(
    readFileSync(DEPLOYMENT_FILE, 'utf-8'),
  )
  const config: ContractsConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  const contracts = deployment.contracts

  console.log('📦 Syncing contract addresses...')
  let synced = 0

  // Tokens
  if (isValidAddress(contracts.jeju)) {
    config.localnet.tokens.jeju = contracts.jeju
    synced++
  }
  if (isValidAddress(contracts.usdc)) {
    config.localnet.tokens.usdc = contracts.usdc
    synced++
  }
  if (isValidAddress(contracts.weth)) {
    config.localnet.tokens.weth = contracts.weth
    synced++
  }

  // Registry
  if (isValidAddress(contracts.identityRegistry)) {
    config.localnet.registry.identity = contracts.identityRegistry
    synced++
  }
  if (isValidAddress(contracts.reputationRegistry)) {
    config.localnet.registry.reputation = contracts.reputationRegistry
    synced++
  }
  if (isValidAddress(contracts.validationRegistry)) {
    config.localnet.registry.validation = contracts.validationRegistry
    synced++
  }

  // Moderation
  if (isValidAddress(contracts.banManager)) {
    config.localnet.moderation.banManager = contracts.banManager
    synced++
  }
  if (isValidAddress(contracts.reputationLabelManager)) {
    config.localnet.moderation.reputationLabelManager =
      contracts.reputationLabelManager
    synced++
  }
  if (isValidAddress(contracts.evidenceRegistry)) {
    config.localnet.moderation.evidenceRegistry = contracts.evidenceRegistry
    synced++
  }
  if (isValidAddress(contracts.moderationMarketplace)) {
    config.localnet.moderation.moderationMarketplace =
      contracts.moderationMarketplace
    synced++
  }
  if (isValidAddress(contracts.reportingSystem)) {
    config.localnet.moderation.reportingSystem = contracts.reportingSystem
    synced++
  }

  // OAuth3
  if (isValidAddress(contracts.oauth3TeeVerifier)) {
    config.localnet.oauth3.teeVerifier = contracts.oauth3TeeVerifier
    synced++
  }
  if (isValidAddress(contracts.oauth3IdentityRegistry)) {
    config.localnet.oauth3.identityRegistry = contracts.oauth3IdentityRegistry
    synced++
  }
  if (isValidAddress(contracts.oauth3AppRegistry)) {
    config.localnet.oauth3.appRegistry = contracts.oauth3AppRegistry
    synced++
  }
  if (isValidAddress(contracts.oauth3Staking)) {
    config.localnet.oauth3.staking = contracts.oauth3Staking
    synced++
  }

  // Bazaar
  if (isValidAddress(contracts.nftMarketplace)) {
    config.localnet.bazaar.marketplace = contracts.nftMarketplace
    synced++
  }
  if (isValidAddress(contracts.simpleCollectible)) {
    config.localnet.bazaar.simpleCollectible = contracts.simpleCollectible
    synced++
  }

  // DWS
  if (isValidAddress(contracts.storageManager)) {
    config.localnet.dws.storageManager = contracts.storageManager
    synced++
  }
  if (isValidAddress(contracts.workerRegistry)) {
    config.localnet.dws.workerRegistry = contracts.workerRegistry
    synced++
  }
  if (isValidAddress(contracts.cdnRegistry)) {
    config.localnet.dws.cdnRegistry = contracts.cdnRegistry
    synced++
  }

  // JNS
  if (isValidAddress(contracts.jnsRegistry)) {
    config.localnet.jns.registry = contracts.jnsRegistry
    synced++
  }
  if (isValidAddress(contracts.jnsResolver)) {
    config.localnet.jns.resolver = contracts.jnsResolver
    synced++
  }

  // Payments
  if (isValidAddress(contracts.creditManager)) {
    config.localnet.payments.creditManager = contracts.creditManager
    synced++
  }
  if (isValidAddress(contracts.universalPaymaster)) {
    config.localnet.payments.universalPaymaster = contracts.universalPaymaster
    synced++
  }
  if (isValidAddress(contracts.paymasterFactory)) {
    config.localnet.payments.paymasterFactory = contracts.paymasterFactory
    synced++
  }

  // DeFi
  if (isValidAddress(contracts.poolManager)) {
    config.localnet.defi.poolManager = contracts.poolManager
    synced++
  }
  if (isValidAddress(contracts.swapRouter)) {
    config.localnet.defi.swapRouter = contracts.swapRouter
    synced++
  }
  if (isValidAddress(contracts.positionManager)) {
    config.localnet.defi.positionManager = contracts.positionManager
    synced++
  }
  if (isValidAddress(contracts.quoterV4)) {
    config.localnet.defi.quoterV4 = contracts.quoterV4
    synced++
  }
  if (isValidAddress(contracts.stateView)) {
    config.localnet.defi.stateView = contracts.stateView
    synced++
  }

  // Compute
  if (isValidAddress(contracts.computeRegistry)) {
    config.localnet.compute.registry = contracts.computeRegistry
    synced++
  }
  if (isValidAddress(contracts.ledgerManager)) {
    config.localnet.compute.ledgerManager = contracts.ledgerManager
    synced++
  }
  if (isValidAddress(contracts.inferenceServing)) {
    config.localnet.compute.inferenceServing = contracts.inferenceServing
    synced++
  }
  if (isValidAddress(contracts.computeStaking)) {
    config.localnet.compute.staking = contracts.computeStaking
    synced++
  }

  // Node Staking
  if (isValidAddress(contracts.nodeStakingManager)) {
    config.localnet.nodeStaking.manager = contracts.nodeStakingManager
    synced++
  }
  if (isValidAddress(contracts.nodePerformanceOracle)) {
    config.localnet.nodeStaking.performanceOracle =
      contracts.nodePerformanceOracle
    synced++
  }

  // Governance
  if (isValidAddress(contracts.futarchyGovernor)) {
    config.localnet.governance.futarchyGovernor = contracts.futarchyGovernor
    synced++
  }

  // Liquidity
  if (isValidAddress(contracts.riskSleeve)) {
    config.localnet.liquidity.riskSleeve = contracts.riskSleeve
    synced++
  }
  if (isValidAddress(contracts.liquidityRouter)) {
    config.localnet.liquidity.liquidityRouter = contracts.liquidityRouter
    synced++
  }
  if (isValidAddress(contracts.multiServiceStakeManager)) {
    config.localnet.liquidity.multiServiceStakeManager =
      contracts.multiServiceStakeManager
    synced++
  }
  if (isValidAddress(contracts.liquidityVault)) {
    config.localnet.liquidity.liquidityVault = contracts.liquidityVault
    synced++
  }

  // Security
  if (isValidAddress(contracts.securityBountyRegistry)) {
    config.localnet.security.bountyRegistry = contracts.securityBountyRegistry
    synced++
  }

  // EIL
  if (isValidAddress(contracts.l1StakeManager)) {
    config.localnet.eil.l1StakeManager = contracts.l1StakeManager
    synced++
  }
  if (isValidAddress(contracts.crossChainPaymaster)) {
    config.localnet.eil.crossChainPaymaster = contracts.crossChainPaymaster
    synced++
  }

  // VPN
  if (!config.localnet.vpn) config.localnet.vpn = {}
  if (isValidAddress(contracts.vpnRegistry)) {
    config.localnet.vpn.registry = contracts.vpnRegistry
    synced++
  }

  // Agents
  if (!config.localnet.agents) config.localnet.agents = {}
  if (isValidAddress(contracts.agentVault)) {
    config.localnet.agents.vault = contracts.agentVault
    synced++
  }
  if (isValidAddress(contracts.roomRegistry)) {
    config.localnet.agents.roomRegistry = contracts.roomRegistry
    synced++
  }

  // OTC
  if (!config.localnet.otc) config.localnet.otc = {}
  if (isValidAddress(contracts.otc)) {
    config.localnet.otc.contract = contracts.otc
    synced++
  }

  // Staking (additional)
  if (!config.localnet.staking) config.localnet.staking = {}
  if (isValidAddress(contracts.staking)) {
    config.localnet.staking.contract = contracts.staking
    synced++
  }
  if (isValidAddress(contracts.rpcProviderRegistry)) {
    config.localnet.staking.rpcProviderRegistry = contracts.rpcProviderRegistry
    synced++
  }

  // Perps
  if (!config.localnet.perps) config.localnet.perps = {}
  if (isValidAddress(contracts.perpetualMarket)) {
    config.localnet.perps.market = contracts.perpetualMarket
    synced++
  }
  if (isValidAddress(contracts.insuranceFund)) {
    config.localnet.perps.insuranceFund = contracts.insuranceFund
    synced++
  }
  if (isValidAddress(contracts.marginManager)) {
    config.localnet.perps.marginManager = contracts.marginManager
    synced++
  }

  // Training
  if (!config.localnet.training) config.localnet.training = {}
  if (isValidAddress(contracts.trainingCoordinator)) {
    config.localnet.training.coordinator = contracts.trainingCoordinator
    synced++
  }
  if (isValidAddress(contracts.trainingRewards)) {
    config.localnet.training.rewards = contracts.trainingRewards
    synced++
  }

  // Distributor
  if (!config.localnet.distributor) config.localnet.distributor = {}
  if (isValidAddress(contracts.airdropManager)) {
    config.localnet.distributor.airdropManager = contracts.airdropManager
    synced++
  }
  if (isValidAddress(contracts.tokenVesting)) {
    config.localnet.distributor.tokenVesting = contracts.tokenVesting
    synced++
  }
  if (isValidAddress(contracts.feeDistributor)) {
    config.localnet.distributor.feeDistributor = contracts.feeDistributor
    synced++
  }
  if (isValidAddress(contracts.stakingRewardDistributor)) {
    config.localnet.distributor.stakingRewardDistributor = contracts.stakingRewardDistributor
    synced++
  }

  // Sequencer
  if (!config.localnet.sequencer) config.localnet.sequencer = {}
  if (isValidAddress(contracts.sequencerRegistry)) {
    config.localnet.sequencer.registry = contracts.sequencerRegistry
    synced++
  }
  if (isValidAddress(contracts.forcedInclusion)) {
    config.localnet.sequencer.forcedInclusion = contracts.forcedInclusion
    synced++
  }
  if (isValidAddress(contracts.slashingContract)) {
    config.localnet.sequencer.slashing = contracts.slashingContract
    synced++
  }

  // AMM
  if (!config.localnet.amm) config.localnet.amm = {}
  if (isValidAddress(contracts.xlpRouter)) {
    config.localnet.amm.router = contracts.xlpRouter
    synced++
  }
  if (isValidAddress(contracts.xlpV2Factory)) {
    config.localnet.amm.factory = contracts.xlpV2Factory
    synced++
  }

  // Oracle
  if (!config.localnet.oracle) config.localnet.oracle = {}
  if (isValidAddress(contracts.oracleRegistry)) {
    config.localnet.oracle.registry = contracts.oracleRegistry
    synced++
  }

  // Messaging
  if (!config.localnet.messaging) config.localnet.messaging = {}
  if (isValidAddress(contracts.messageNodeRegistry)) {
    config.localnet.messaging.nodeRegistry = contracts.messageNodeRegistry
    synced++
  }
  if (isValidAddress(contracts.messagingKeyRegistry)) {
    config.localnet.messaging.keyRegistry = contracts.messagingKeyRegistry
    synced++
  }

  // Bridge (Hyperlane)
  if (!config.localnet.bridge) config.localnet.bridge = {}
  if (isValidAddress(contracts.hyperlaneMailbox)) {
    config.localnet.bridge.hyperlaneMailbox = contracts.hyperlaneMailbox
    synced++
  }
  if (isValidAddress(contracts.hyperlaneISM)) {
    config.localnet.bridge.hyperlaneISM = contracts.hyperlaneISM
    synced++
  }

  // Write updated config
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`)

  console.log(`✅ Synced ${synced} contract addresses to contracts.json`)
  console.log('')
  console.log('📁 Updated:', CONFIG_FILE)
}

// Run
syncConfig()
