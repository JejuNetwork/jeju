export * from './bridge'
export * from './cdn'
export * from './compute'
export * from './cron'
export * from './hybrid-torrent'
export * from './oracle'
export * from './sequencer'
export * from './staking-manager'
export * from './static-assets'
export * from './storage'
export * from './updater'

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { NodeClient, SecureNodeClient } from '../contracts'
import {
  type BridgeService,
  type BridgeServiceConfig,
  createBridgeService,
  getDefaultBridgeConfig,
} from './bridge'
import { type CDNService, createCDNService } from './cdn'
import { type ComputeService, createComputeService } from './compute'
import { type CronService, createCronService } from './cron'
import { createDatabaseService, type DatabaseService } from './database'
import {
  getHybridTorrentService,
  type HybridTorrentService,
} from './hybrid-torrent'
import { createOracleService, type OracleService } from './oracle'
import {
  createSequencerService,
  type SequencerConfig,
  type SequencerService,
} from './sequencer'
import {
  createStakingManagerService,
  type StakingConfig,
  type StakingManagerService,
} from './staking-manager'
import {
  createStaticAssetService,
  type StaticAssetConfig,
  type StaticAssetService,
} from './static-assets'
import { createStorageService, type StorageService } from './storage'

interface EdgeCoordinatorConfig {
  nodeId: string
  operator: `0x${string}`
  keyId: string
  listenPort: number
  gossipInterval: number
  gossipFanout: number
  maxPeers: number
  bootstrapNodes: string[]
  region: string
  staleThresholdMs: number
  requireOnChainRegistration: boolean
  maxMessageSizeBytes: number
  allowedOrigins: string[]
}

interface EdgeCoordinator {
  start: () => Promise<void>
  stop: () => Promise<void>
}

function createEdgeCoordinator(_config: EdgeCoordinatorConfig): EdgeCoordinator {
  return { start: async () => {}, stop: async () => {} }
}

interface ResidentialProxyService {
  start: () => Promise<void>
  stop: () => Promise<void>
}

function createResidentialProxyService(_client: NodeClient): ResidentialProxyService {
  return { start: async () => {}, stop: async () => {} }
}

type VPNExitConfig = Record<string, never>

interface VPNExitService {
  start: () => Promise<void>
  stop: () => Promise<void>
}

function createVPNExitService(_client: NodeClient, _config?: Partial<VPNExitConfig>): VPNExitService {
  return { start: async () => {}, stop: async () => {} }
}

export interface NodeServices {
  compute: ComputeService
  oracle: OracleService
  storage: StorageService
  cron: CronService
  cdn: CDNService
  bridge: BridgeService
  proxy: ResidentialProxyService
  edgeCoordinator: EdgeCoordinator
  torrent: HybridTorrentService
  vpn: VPNExitService
  staticAssets: StaticAssetService
  sequencer: SequencerService
  staking: StakingManagerService
  database: DatabaseService
}

export interface NodeServicesConfig {
  /** KMS key ID for secure signing across all services */
  keyId?: string
  bridge?: Partial<BridgeServiceConfig>
  edge?: Partial<EdgeCoordinatorConfig>
  vpn?: Partial<VPNExitConfig>
  staticAssets?: Partial<StaticAssetConfig>
  sequencer?: Partial<SequencerConfig>
  staking?: Partial<StakingConfig>
}

export function createNodeServices(
  client: NodeClient | SecureNodeClient,
  config: NodeServicesConfig = {},
): NodeServices {
  const {
    keyId,
    bridge: bridgeConfig,
    edge: edgeConfig,
    vpn: vpnConfig,
    staticAssets: staticConfig,
    sequencer: sequencerConfig,
    staking: stakingConfig,
  } = config

  const operatorAddress = bridgeConfig?.operatorAddress ?? ZERO_ADDRESS

  const fullBridgeConfig: BridgeServiceConfig = {
    ...getDefaultBridgeConfig(operatorAddress),
    operatorAddress,
    enableRelayer: bridgeConfig?.enableRelayer ?? true,
    enableXLP: bridgeConfig?.enableXLP ?? true,
    enableSolver: bridgeConfig?.enableSolver ?? true,
    enableMEV: bridgeConfig?.enableMEV ?? false,
    enableArbitrage: bridgeConfig?.enableArbitrage ?? false,
    evmRpcUrls: bridgeConfig?.evmRpcUrls ?? {},
    contracts: bridgeConfig?.contracts ?? {},
    ...bridgeConfig,
  }

  const resolvedKeyId =
    keyId ?? ('keyId' in client ? client.keyId : undefined) ?? ''

  if (!resolvedKeyId) {
    console.warn(
      '[NodeServices] No KMS keyId provided - services requiring signing will fail',
    )
  }

  const fullEdgeConfig: EdgeCoordinatorConfig = {
    nodeId: edgeConfig?.nodeId ?? crypto.randomUUID(),
    operator: operatorAddress,
    keyId: edgeConfig?.keyId ?? resolvedKeyId,
    listenPort: edgeConfig?.listenPort ?? 4020,
    gossipInterval: edgeConfig?.gossipInterval ?? 30000,
    gossipFanout: edgeConfig?.gossipFanout ?? 6,
    maxPeers: edgeConfig?.maxPeers ?? 50,
    bootstrapNodes: edgeConfig?.bootstrapNodes ?? [],
    region: edgeConfig?.region ?? 'global',
    staleThresholdMs: edgeConfig?.staleThresholdMs ?? 300000,
    requireOnChainRegistration: edgeConfig?.requireOnChainRegistration ?? false,
    maxMessageSizeBytes: edgeConfig?.maxMessageSizeBytes ?? 1024 * 1024,
    allowedOrigins: edgeConfig?.allowedOrigins ?? [],
    ...edgeConfig,
  }

  const legacyClient = client as NodeClient

  return {
    compute: createComputeService(legacyClient),
    oracle: createOracleService(legacyClient),
    storage: createStorageService(legacyClient),
    cron: createCronService(legacyClient),
    cdn: createCDNService(legacyClient),
    bridge: createBridgeService(fullBridgeConfig),
    proxy: createResidentialProxyService(legacyClient),
    edgeCoordinator: createEdgeCoordinator(fullEdgeConfig),
    torrent: getHybridTorrentService(),
    vpn: createVPNExitService(legacyClient, vpnConfig),
    staticAssets: createStaticAssetService(legacyClient, staticConfig),
    sequencer: createSequencerService(legacyClient, sequencerConfig),
    staking: createStakingManagerService(legacyClient, stakingConfig),
    database: createDatabaseService(legacyClient),
  }
}
