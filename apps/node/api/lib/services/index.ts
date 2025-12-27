export * from './bridge'
export * from './cdn'
export * from './compute'
export * from './cron'
export * from './database'
export * from './edge-coordinator'
export * from './hybrid-torrent'
export * from './oracle'
export * from './residential-proxy'
export * from './sequencer'
export * from './staking-manager'
export * from './static-assets'
export * from './storage'
export * from './updater'
export * from './vpn-exit'

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { NodeClient } from '../contracts'
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
  createEdgeCoordinator,
  type EdgeCoordinator,
  type EdgeCoordinatorConfig,
} from './edge-coordinator'
import {
  getHybridTorrentService,
  type HybridTorrentService,
} from './hybrid-torrent'
import { createOracleService, type OracleService } from './oracle'
import {
  createResidentialProxyService,
  type ResidentialProxyService,
} from './residential-proxy'
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
import {
  createVPNExitService,
  type VPNExitConfig,
  type VPNExitService,
} from './vpn-exit'

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
  bridge?: Partial<BridgeServiceConfig>
  edge?: Partial<EdgeCoordinatorConfig>
  vpn?: Partial<VPNExitConfig>
  staticAssets?: Partial<StaticAssetConfig>
  sequencer?: Partial<SequencerConfig>
  staking?: Partial<StakingConfig>
}

export function createNodeServices(
  client: NodeClient,
  config: NodeServicesConfig = {},
): NodeServices {
  const {
    bridge: bridgeConfig,
    edge: edgeConfig,
    vpn: vpnConfig,
    staticAssets: staticConfig,
    sequencer: sequencerConfig,
    staking: stakingConfig,
  } = config

  // Bridge service requires operator address - defaults to ZERO_ADDRESS when not provided
  // Services will validate and error if operator address is required for specific operations
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

  // Generate a valid random private key if none provided
  const getDefaultPrivateKey = (): string => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return (
      '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    )
  }

  const fullEdgeConfig: EdgeCoordinatorConfig = {
    nodeId: edgeConfig?.nodeId ?? crypto.randomUUID(),
    operator: operatorAddress,
    privateKey:
      edgeConfig?.privateKey ??
      process.env.PRIVATE_KEY ??
      getDefaultPrivateKey(),
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

  return {
    compute: createComputeService(client),
    oracle: createOracleService(client),
    storage: createStorageService(client),
    cron: createCronService(client),
    cdn: createCDNService(client),
    bridge: createBridgeService(fullBridgeConfig),
    proxy: createResidentialProxyService(client),
    edgeCoordinator: createEdgeCoordinator(fullEdgeConfig),
    torrent: getHybridTorrentService(),
    vpn: createVPNExitService(client, vpnConfig),
    staticAssets: createStaticAssetService(client, staticConfig),
    sequencer: createSequencerService(client, sequencerConfig),
    staking: createStakingManagerService(client, stakingConfig),
    database: createDatabaseService(client),
  }
}
