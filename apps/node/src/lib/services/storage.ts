/**
 * Storage service - Real contract integration
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { STORAGE_MARKET_ABI } from '../abis';

export interface StorageServiceConfig {
  endpoint: string;
  capacityGB: number;
  pricePerGBMonth: bigint;
  stakeAmount: bigint;
}

export interface StorageServiceState {
  isRegistered: boolean;
  endpoint: string;
  capacityGB: number;
  usedGB: number;
  pricePerGBMonth: bigint;
}

export class StorageService {
  private client: NodeClient;

  constructor(client: NodeClient) {
    this.client = client;
  }

  async getState(address: Address): Promise<StorageServiceState> {
    const provider = await this.client.publicClient.readContract({
      address: this.client.addresses.storageMarket,
      abi: STORAGE_MARKET_ABI,
      functionName: 'getProvider',
      args: [address],
    });

    return {
      isRegistered: provider[4], // isActive
      endpoint: provider[0],
      capacityGB: Number(provider[1] / (1024n * 1024n * 1024n)), // bytes to GB
      usedGB: Number(provider[2] / (1024n * 1024n * 1024n)),
      pricePerGBMonth: provider[3],
    };
  }

  async register(config: StorageServiceConfig): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const capacityBytes = BigInt(config.capacityGB) * 1024n * 1024n * 1024n;

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.storageMarket,
      abi: STORAGE_MARKET_ABI,
      functionName: 'registerProvider',
      args: [config.endpoint, capacityBytes, config.pricePerGBMonth],
      value: config.stakeAmount,
    });

    return hash;
  }
}

export function createStorageService(client: NodeClient): StorageService {
  return new StorageService(client);
}

