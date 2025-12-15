/**
 * Network Node Services
 */

export * from './compute';
export * from './oracle';
export * from './storage';
export * from './cron';
export * from './cdn';
export * from './bridge';

import { type NodeClient } from '../contracts';
import { createComputeService, type ComputeService } from './compute';
import { createOracleService, type OracleService } from './oracle';
import { createStorageService, type StorageService } from './storage';
import { createCronService, type CronService } from './cron';
import { createCDNService, type CDNService } from './cdn';
import { createBridgeService, getDefaultBridgeConfig, type BridgeService, type BridgeServiceConfig } from './bridge';

export interface NodeServices {
  compute: ComputeService;
  oracle: OracleService;
  storage: StorageService;
  cron: CronService;
  cdn: CDNService;
  bridge: BridgeService;
}

export function createNodeServices(client: NodeClient, bridgeConfig?: Partial<BridgeServiceConfig>): NodeServices {
  // Get operator address from config or use a placeholder for bridge
  const operatorAddress = bridgeConfig?.operatorAddress ?? '0x0000000000000000000000000000000000000000' as `0x${string}`;

  const fullBridgeConfig: BridgeServiceConfig = {
    ...getDefaultBridgeConfig(operatorAddress),
    operatorAddress,
    enableRelayer: bridgeConfig?.enableRelayer ?? true,
    enableXLP: bridgeConfig?.enableXLP ?? true,
    enableSolver: bridgeConfig?.enableSolver ?? true,
    enableMEV: bridgeConfig?.enableMEV ?? false,
    evmRpcUrls: bridgeConfig?.evmRpcUrls ?? {},
    contracts: bridgeConfig?.contracts ?? {},
    ...bridgeConfig,
  };

  return {
    compute: createComputeService(client),
    oracle: createOracleService(client),
    storage: createStorageService(client),
    cron: createCronService(client),
    cdn: createCDNService(client),
    bridge: createBridgeService(fullBridgeConfig),
  };
}

