/**
 * Storage service - Real contract integration with torrent seeding
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { STORAGE_MARKET_ABI } from '../abis';

// Lazy import to avoid native module issues
type TorrentSeederServiceType = Awaited<ReturnType<typeof importTorrentSeeder>>;
async function importTorrentSeeder() {
  const mod = await import('./torrent-seeder');
  return mod.TorrentSeederService;
}

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
  private seeder: InstanceType<TorrentSeederServiceType> | null = null;

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
    if (this.seeder) return;

    const TorrentSeederService = await importTorrentSeeder();
    this.seeder = new TorrentSeederService({
      rpcUrl: this.client.publicClient.transport.url ?? 'http://127.0.0.1:9545',
      privateKey,
      contentRegistryAddress,
      maxTorrents: 100,
      maxUploadRate: -1,
      reportIntervalMs: 3600000,
      blocklistSyncIntervalMs: 300000,
    });

    await this.seeder.start();
  }

  async stopSeeding(): Promise<void> {
    if (!this.seeder) return;
    await this.seeder.stop();
    this.seeder = null;
  }

  async addTorrent(magnetUri: string): Promise<string> {
    if (!this.seeder) {
      throw new Error('Seeder not started');
    }
    return this.seeder.addTorrent(magnetUri);
  }

  removeTorrent(infohash: string): void {
    if (!this.seeder) return;
    this.seeder.removeTorrent(infohash);
  }

  getSeedingStats(): SeedingStats | null {
    if (!this.seeder) return null;
    return this.seeder.getStats();
  }

  getTorrentList(): Array<{
    infohash: string;
    bytesUploaded: number;
    peersServed: number;
    startedAt: number;
  }> {
    if (!this.seeder) return [];
    return this.seeder.getTorrentList();
  }

  isSeeding(): boolean {
    return this.seeder !== null;
  }
}

export function createStorageService(client: NodeClient): StorageService {
  return new StorageService(client);
}

