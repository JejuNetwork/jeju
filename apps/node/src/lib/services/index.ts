/**
 * Network Node Services
 *
 * All services for running a Jeju network node:
 * - Compute: GPU/CPU inference serving
 * - Oracle: Price feeds and data oracles
 * - Storage: Decentralized file storage
 * - CDN: Content delivery network
 * - VPN: WireGuard VPN exit node
 * - Proxy: Residential proxy service
 * - Torrent: P2P content distribution
 * - Static Assets: Network default assets (UI, code)
 * - Edge Coordinator: P2P node coordination
 */

export * from './bridge'
export * from './cdn'
export * from './compute'
export * from './cron'
export * from './edge-coordinator'
export * from './hybrid-torrent'
export * from './oracle'
export * from './residential-proxy'
export * from './static-assets'
export * from './storage'
export * from './updater'
export * from './vpn-exit'

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
}

export interface NodeServicesConfig {
  bridge?: Partial<BridgeServiceConfig>
  edge?: Partial<EdgeCoordinatorConfig>
  vpn?: Partial<VPNExitConfig>
  staticAssets?: Partial<StaticAssetConfig>
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
  } = config

  // Get operator address from config or use a placeholder for bridge
  const operatorAddress =
    bridgeConfig?.operatorAddress ??
    ('0x0000000000000000000000000000000000000000' as `0x${string}`)

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
  }
}
