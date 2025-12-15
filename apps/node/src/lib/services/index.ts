/**
 * Network Node Services
 */

export * from './compute';
export * from './oracle';
export * from './storage';
export * from './cron';
export * from './cdn';

import { type NodeClient } from '../contracts';
import { createComputeService, ComputeService } from './compute';
import { createOracleService, OracleService } from './oracle';
import { createStorageService, StorageService } from './storage';
import { createCronService, CronService } from './cron';
import { createCDNService, CDNService } from './cdn';

export interface NodeServices {
  compute: ComputeService;
  oracle: OracleService;
  storage: StorageService;
  cron: CronService;
  cdn: CDNService;
}

export function createNodeServices(client: NodeClient): NodeServices {
  return {
    compute: createComputeService(client),
    oracle: createOracleService(client),
    storage: createStorageService(client),
    cron: createCronService(client),
    cdn: createCDNService(client),
  };
}

