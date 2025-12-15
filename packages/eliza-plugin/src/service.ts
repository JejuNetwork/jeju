/**
 * Network Service - Manages SDK lifecycle
 */

import { type IAgentRuntime, Service, logger } from "@elizaos/core";
import {
  createJejuClient,
  type JejuClient,
  type JejuClientConfig,
} from "@jejunetwork/sdk";
import type { NetworkType } from "@jejunetwork/types";
import type { Hex } from "viem";
import { getNetworkName } from "@jejunetwork/config";

const networkName = getNetworkName();
const networkNameLower = networkName.toLowerCase();

export const JEJU_SERVICE_NAME = networkNameLower;
export const JEJU_CACHE_KEY = `${networkNameLower}/wallet`;

export interface JejuWalletData {
  address: string;
  network: string;
  chainId: number;
  isSmartAccount: boolean;
  balance: string;
  timestamp: number;
}

export class JejuService extends Service {
  static serviceType: string = JEJU_SERVICE_NAME;
  capabilityDescription = `${networkName} access - compute, storage, DeFi, governance, cross-chain`;

  private client: JejuClient | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(protected runtime: IAgentRuntime) {
    super();
  }

  static async start(runtime: IAgentRuntime): Promise<JejuService> {
    logger.log(`Initializing ${networkName}Service`);

    const service = new JejuService(runtime);

    // Get configuration - support both JEJU_ and NETWORK_ prefixes
    const privateKey = (runtime.getSetting("NETWORK_PRIVATE_KEY") ||
      runtime.getSetting("JEJU_PRIVATE_KEY")) as Hex | undefined;
    const mnemonic = (runtime.getSetting("NETWORK_MNEMONIC") ||
      runtime.getSetting("JEJU_MNEMONIC")) as string | undefined;
    const network =
      runtime.getSetting("NETWORK_TYPE") ||
      (runtime.getSetting("JEJU_NETWORK") as NetworkType) ||
      "testnet";
    const smartAccount =
      (runtime.getSetting("NETWORK_SMART_ACCOUNT") ||
        runtime.getSetting("JEJU_SMART_ACCOUNT")) !== "false";

    if (!privateKey && !mnemonic) {
      throw new Error("NETWORK_PRIVATE_KEY or NETWORK_MNEMONIC required");
    }

    const config: JejuClientConfig = {
      network,
      privateKey,
      mnemonic,
      smartAccount,
    };

    service.client = await createJejuClient(config);

    // Cache initial wallet data
    await service.refreshWalletData();

    // Set up refresh interval (every 60 seconds)
    service.refreshInterval = setInterval(
      () => service.refreshWalletData(),
      60000,
    );

    logger.log(`${networkName} service initialized on ${network}`);
    logger.log(`Address: ${service.client.address}`);
    logger.log(`Smart Account: ${service.client.isSmartAccount}`);

    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService(JEJU_SERVICE_NAME) as
      | JejuService
      | undefined;
    if (service) {
      await service.stop();
    }
  }

  async stop(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    logger.log(`${networkName} service stopped`);
  }

  getClient(): JejuClient {
    if (!this.client) {
      throw new Error(`${networkName} client not initialized`);
    }
    return this.client;
  }

  async refreshWalletData(): Promise<void> {
    if (!this.client) return;

    const balance = await this.client.getBalance();

    const walletData: JejuWalletData = {
      address: this.client.address,
      network: this.client.network,
      chainId: this.client.chainId,
      isSmartAccount: this.client.isSmartAccount,
      balance: balance.toString(),
      timestamp: Date.now(),
    };

    await this.runtime.setCache(JEJU_CACHE_KEY, walletData);
    logger.log(`${networkName} wallet data refreshed`);
  }

  async getCachedData(): Promise<JejuWalletData | undefined> {
    const cached = await this.runtime.getCache<JejuWalletData>(JEJU_CACHE_KEY);

    // Refresh if stale (> 60 seconds)
    if (!cached || Date.now() - cached.timestamp > 60000) {
      await this.refreshWalletData();
      return this.runtime.getCache<JejuWalletData>(JEJU_CACHE_KEY);
    }

    return cached;
  }
}
