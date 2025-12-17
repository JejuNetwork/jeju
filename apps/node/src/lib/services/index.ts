/**
 * Network Node Services
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
}

export function createNodeServices(
  client: NodeClient,
  bridgeConfig?: Partial<BridgeServiceConfig>,
  edgeConfig?: Partial<EdgeCoordinatorConfig>
): NodeServices {
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
    listenPort: edgeConfig?.listenPort ?? 4020,
    gossipInterval: edgeConfig?.gossipInterval ?? 30000,
    maxPeers: edgeConfig?.maxPeers ?? 50,
    bootstrapNodes: edgeConfig?.bootstrapNodes ?? [],
    region: edgeConfig?.region ?? 'global',
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
  };
}
