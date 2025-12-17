/**
 * Storage service - Real contract integration with torrent seeding
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { STORAGE_MARKET_ABI } from '../abis';
import { HybridTorrentService, getHybridTorrentService } from './hybrid-torrent';

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

export interface SeedingStats {
  torrentsSeeding: number;
  totalBytesUploaded: number;
  totalPeersServed: number;
  pendingRewards: bigint;
  uptime: number;
}

export class StorageService {
  private client: NodeClient;
  private torrent: HybridTorrentService | null = null;

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

  // ============ Torrent Seeding ============

  async startSeeding(
    privateKey: string,
    contentRegistryAddress: Address
  ): Promise<void> {
    if (this.torrent) return;

    this.torrent = getHybridTorrentService({
      rpcUrl: this.client.publicClient.transport.url ?? 'http://127.0.0.1:9545',
      privateKey,
      contentRegistryAddress,
    });

    await this.torrent.start();
  }

  async stopSeeding(): Promise<void> {
    if (!this.torrent) return;
    await this.torrent.stop();
    this.torrent = null;
  }

  async addTorrent(magnetUri: string): Promise<string> {
    if (!this.torrent) {
      throw new Error('Torrent service not started');
    }
    const stats = await this.torrent.addTorrent(magnetUri);
    return stats.infohash;
  }

  removeTorrent(infohash: string): void {
    if (!this.torrent) return;
    this.torrent.removeTorrent(infohash);
  }

  getSeedingStats(): SeedingStats | null {
    if (!this.torrent) return null;
    const stats = this.torrent.getGlobalStats();
    return {
      torrentsSeeding: stats.torrentsActive,
      totalBytesUploaded: stats.totalUpload,
      totalPeersServed: stats.peers,
      pendingRewards: stats.pendingRewards,
      uptime: stats.uptime,
    };
  }

  getTorrentList(): Array<{
    infohash: string;
    bytesUploaded: number;
    peersServed: number;
    startedAt: number;
  }> {
    if (!this.torrent) return [];
    return this.torrent.getAllStats().map((s) => ({
      infohash: s.infohash,
      bytesUploaded: s.uploaded,
      peersServed: s.peers,
      startedAt: 0, // Not tracked in new service
    }));
  }

  isSeeding(): boolean {
    return this.torrent !== null;
  }
}

export function createStorageService(client: NodeClient): StorageService {
  return new StorageService(client);
}
