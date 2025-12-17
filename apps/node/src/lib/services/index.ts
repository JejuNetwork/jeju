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

export * from './compute';
export * from './oracle';
export * from './storage';
export * from './cron';
export * from './cdn';
export * from './bridge';
export * from './residential-proxy';
export * from './edge-coordinator';
export * from './hybrid-torrent';
export * from './updater';
export * from './vpn-exit';
export * from './static-assets';

import { type NodeClient } from '../contracts';
import { createComputeService, type ComputeService } from './compute';
import { createOracleService, type OracleService } from './oracle';
import { createStorageService, type StorageService } from './storage';
import { createCronService, type CronService } from './cron';
import { createCDNService, type CDNService } from './cdn';
import { createBridgeService, getDefaultBridgeConfig, type BridgeService, type BridgeServiceConfig } from './bridge';
import { createResidentialProxyService, type ResidentialProxyService } from './residential-proxy';
import { createEdgeCoordinator, type EdgeCoordinator, type EdgeCoordinatorConfig } from './edge-coordinator';
import { getHybridTorrentService, type HybridTorrentService } from './hybrid-torrent';
import { createVPNExitService, type VPNExitService, type VPNExitConfig } from './vpn-exit';
import { createStaticAssetService, type StaticAssetService, type StaticAssetConfig } from './static-assets';

export interface NodeServices {
  compute: ComputeService;
  oracle: OracleService;
  storage: StorageService;
  cron: CronService;
  cdn: CDNService;
  bridge: BridgeService;
  proxy: ResidentialProxyService;
  edgeCoordinator: EdgeCoordinator;
  torrent: HybridTorrentService;
  vpn: VPNExitService;
  staticAssets: StaticAssetService;
}

export interface NodeServicesConfig {
  bridge?: Partial<BridgeServiceConfig>;
  edge?: Partial<EdgeCoordinatorConfig>;
  vpn?: Partial<VPNExitConfig>;
  staticAssets?: Partial<StaticAssetConfig>;
}

export function createNodeServices(
  client: NodeClient,
  config: NodeServicesConfig = {}
): NodeServices {
  const { bridge: bridgeConfig, edge: edgeConfig, vpn: vpnConfig, staticAssets: staticConfig } = config;

  // Get operator address from config or use a placeholder for bridge
  const operatorAddress = bridgeConfig?.operatorAddress ?? '0x0000000000000000000000000000000000000000' as `0x${string}`;

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
  };

  const fullEdgeConfig: EdgeCoordinatorConfig = {
    nodeId: edgeConfig?.nodeId ?? crypto.randomUUID(),
    operator: operatorAddress,
    privateKey: edgeConfig?.privateKey ?? process.env.PRIVATE_KEY ?? '0x' + '00'.repeat(32),
    listenPort: edgeConfig?.listenPort ?? 4020,
    gossipInterval: edgeConfig?.gossipInterval ?? 30000,
    gossipFanout: edgeConfig?.gossipFanout ?? 6,
    maxPeers: edgeConfig?.maxPeers ?? 50,
    bootstrapNodes: edgeConfig?.bootstrapNodes ?? [],
    region: edgeConfig?.region ?? 'global',
    staleThresholdMs: edgeConfig?.staleThresholdMs ?? 300000,
    requireOnChainRegistration: edgeConfig?.requireOnChainRegistration ?? false,
    ...edgeConfig,
  };

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
  };
}
