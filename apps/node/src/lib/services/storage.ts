/**
 * Storage service - Real contract integration with torrent seeding
 */

import type { Address } from 'viem'
import { z } from 'zod'
import { STORAGE_MARKET_ABI } from '../abis'
import { getChain, type NodeClient } from '../contracts'
import {
  getHybridTorrentService,
  type HybridTorrentService,
} from './hybrid-torrent'

const StorageServiceConfigSchema = z.object({
  endpoint: z.string().url(),
  capacityGB: z.number().positive(),
  pricePerGBMonth: z.bigint(),
  stakeAmount: z.bigint(),
})

export interface StorageServiceConfig {
  endpoint: string
  capacityGB: number
  pricePerGBMonth: bigint
  stakeAmount: bigint
}

const StorageServiceStateSchema = z
  .object({
    isRegistered: z.boolean(),
    endpoint: z.string().url(),
    capacityGB: z.number().positive(),
    usedGB: z.number().nonnegative(),
    pricePerGBMonth: z.bigint(),
  })
  .refine((data) => data.usedGB <= data.capacityGB, {
    message: 'Used GB cannot exceed capacity GB',
  })

export interface StorageServiceState {
  isRegistered: boolean
  endpoint: string
  capacityGB: number
  usedGB: number
  pricePerGBMonth: bigint
}

const SeedingStatsSchema = z.object({
  torrentsSeeding: z.number().int().nonnegative(),
  totalBytesUploaded: z.number().int().nonnegative(),
  totalPeersServed: z.number().int().nonnegative(),
  uptime: z.number().nonnegative(),
})

export interface SeedingStats {
  torrentsSeeding: number
  totalBytesUploaded: number
  totalPeersServed: number
  uptime: number
}

export function validateStorageServiceConfig(
  data: unknown,
): StorageServiceConfig {
  return StorageServiceConfigSchema.parse(data)
}

export function validateStorageServiceState(
  data: unknown,
): StorageServiceState {
  return StorageServiceStateSchema.parse(data)
}

export function validateSeedingStats(data: unknown): SeedingStats {
  return SeedingStatsSchema.parse(data)
}

export class StorageService {
  private client: NodeClient
  private torrent: HybridTorrentService | null = null

  constructor(client: NodeClient) {
    this.client = client
  }

  async getState(address: Address): Promise<StorageServiceState> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid address: ${address}`)
    }

    const provider = await this.client.publicClient.readContract({
      address: this.client.addresses.storageMarket,
      abi: STORAGE_MARKET_ABI,
      functionName: 'getProvider',
      args: [address],
    })

    const rawState = {
      isRegistered: provider[4], // isActive
      endpoint: provider[0],
      capacityGB: Number(provider[1] / (1024n * 1024n * 1024n)), // bytes to GB
      usedGB: Number(provider[2] / (1024n * 1024n * 1024n)),
      pricePerGBMonth: provider[3],
    }

    return validateStorageServiceState(rawState)
  }

  async register(config: StorageServiceConfig): Promise<string> {
    const validatedConfig = validateStorageServiceConfig(config)

    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const capacityBytes =
      BigInt(validatedConfig.capacityGB) * 1024n * 1024n * 1024n

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.storageMarket,
      abi: STORAGE_MARKET_ABI,
      functionName: 'registerProvider',
      args: [
        validatedConfig.endpoint,
        capacityBytes,
        validatedConfig.pricePerGBMonth,
      ],
      value: validatedConfig.stakeAmount,
    })

    return hash
  }

  // ============ Torrent Seeding ============

  async startSeeding(
    privateKey: string,
    contentRegistryAddress: Address,
  ): Promise<void> {
    if (this.torrent) return

    this.torrent = getHybridTorrentService({
      rpcUrl: this.client.publicClient.transport.url ?? 'http://127.0.0.1:6546',
      privateKey,
      contentRegistryAddress,
    })

    await this.torrent.start()
  }

  async stopSeeding(): Promise<void> {
    if (!this.torrent) return
    await this.torrent.stop()
    this.torrent = null
  }

  async addTorrent(magnetUri: string): Promise<string> {
    if (!this.torrent) {
      throw new Error('Torrent service not started')
    }
    const stats = await this.torrent.addTorrent(magnetUri)
    return stats.infohash
  }

  removeTorrent(infohash: string): void {
    if (!this.torrent) return
    this.torrent.removeTorrent(infohash)
  }

  getSeedingStats(): SeedingStats | null {
    if (!this.torrent) return null
    const stats = this.torrent.getGlobalStats()
    return {
      torrentsSeeding: stats.torrentsActive,
      totalBytesUploaded: stats.totalUpload,
      totalPeersServed: stats.peers,
      uptime: stats.uptime,
    }
  }

  getTorrentList(): Array<{
    infohash: string
    bytesUploaded: number
    peersServed: number
    startedAt: number
  }> {
    if (!this.torrent) return []
    return this.torrent.getAllStats().map((s) => ({
      infohash: s.infohash,
      bytesUploaded: s.uploaded,
      peersServed: s.peers,
      startedAt: 0, // Not tracked in new service
    }))
  }

  isSeeding(): boolean {
    return this.torrent !== null
  }
}

export function createStorageService(client: NodeClient): StorageService {
  return new StorageService(client)
}
