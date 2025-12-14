/**
 * Storage Module - IPFS, multi-provider storage
 */

import type { Address, Hex } from 'viem';
import { formatEther, parseEther } from 'viem';
import type { NetworkType } from '@jejunetwork/types';
import type { JejuWallet } from '../wallet';
import { getServicesConfig } from '../config';

export type StorageTier = 'hot' | 'warm' | 'cold' | 'permanent';

export interface StorageStats {
  totalPins: number;
  totalSizeBytes: number;
  totalSizeGB: number;
}

export interface PinInfo {
  cid: string;
  name: string;
  status: 'queued' | 'pinning' | 'pinned' | 'failed';
  sizeBytes: number;
  createdAt: number;
  tier: StorageTier;
}

export interface UploadOptions {
  name?: string;
  tier?: StorageTier;
  durationMonths?: number;
}

export interface UploadResult {
  cid: string;
  size: number;
  gatewayUrl: string;
}

export interface StorageModule {
  // Stats
  getStats(): Promise<StorageStats>;

  // Upload
  upload(data: Uint8Array | Blob | File, options?: UploadOptions): Promise<UploadResult>;
  uploadJson(data: object, options?: UploadOptions): Promise<UploadResult>;

  // Pin management
  pin(cid: string, options?: UploadOptions): Promise<void>;
  unpin(cid: string): Promise<void>;
  listPins(): Promise<PinInfo[]>;
  getPinStatus(cid: string): Promise<PinInfo>;

  // Retrieval
  retrieve(cid: string): Promise<Uint8Array>;
  retrieveJson<T = unknown>(cid: string): Promise<T>;
  getGatewayUrl(cid: string): string;

  // Cost estimation
  estimateCost(sizeBytes: number, durationMonths: number, tier: StorageTier): bigint;
}

const STORAGE_PRICING = {
  hot: parseEther('0.0001'), // per GB per month
  warm: parseEther('0.00005'),
  cold: parseEther('0.00001'),
  permanent: parseEther('0.01'), // one-time per GB
};

export function createStorageModule(wallet: JejuWallet, network: NetworkType): StorageModule {
  const services = getServicesConfig(network);
  const apiUrl = services.storage.api;
  const gatewayUrl = services.storage.ipfsGateway;

  async function authHeaders(): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = `jeju-storage:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      'Content-Type': 'application/json',
      'x-jeju-address': wallet.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-signature': signature,
    };
  }

  async function getStats(): Promise<StorageStats> {
    const response = await fetch(`${apiUrl}/stats`, {
      headers: await authHeaders(),
    });

    if (!response.ok) throw new Error(`Failed to get stats: ${response.statusText}`);

    const data = (await response.json()) as {
      totalPins: number;
      totalSizeBytes: number;
      totalSizeGB: number;
    };

    return data;
  }

  async function upload(
    data: Uint8Array | Blob | File,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const formData = new FormData();
    const blob = data instanceof Uint8Array ? new Blob([data]) : data;
    formData.append('file', blob, options?.name ?? 'file');

    if (options?.tier) formData.append('tier', options.tier);
    if (options?.durationMonths) formData.append('durationMonths', options.durationMonths.toString());

    const headers = await authHeaders();
    delete headers['Content-Type']; // Let browser set multipart boundary

    const response = await fetch(`${apiUrl}/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);

    const result = (await response.json()) as { cid: string; size: number };

    return {
      cid: result.cid,
      size: result.size,
      gatewayUrl: getGatewayUrl(result.cid),
    };
  }

  async function uploadJson(data: object, options?: UploadOptions): Promise<UploadResult> {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    return upload(bytes, { ...options, name: options?.name ?? 'data.json' });
  }

  async function pin(cid: string, options?: UploadOptions): Promise<void> {
    const response = await fetch(`${apiUrl}/pins`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        cid,
        name: options?.name ?? cid,
        tier: options?.tier ?? 'warm',
        durationMonths: options?.durationMonths ?? 1,
      }),
    });

    if (!response.ok) throw new Error(`Pin failed: ${response.statusText}`);
  }

  async function unpin(cid: string): Promise<void> {
    const response = await fetch(`${apiUrl}/pins/${cid}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });

    if (!response.ok) throw new Error(`Unpin failed: ${response.statusText}`);
  }

  async function listPins(): Promise<PinInfo[]> {
    const response = await fetch(`${apiUrl}/pins`, {
      headers: await authHeaders(),
    });

    if (!response.ok) throw new Error(`List pins failed: ${response.statusText}`);

    const data = (await response.json()) as { results: PinInfo[] };
    return data.results;
  }

  async function getPinStatus(cid: string): Promise<PinInfo> {
    const response = await fetch(`${apiUrl}/pins/${cid}`, {
      headers: await authHeaders(),
    });

    if (!response.ok) throw new Error(`Get pin status failed: ${response.statusText}`);

    return (await response.json()) as PinInfo;
  }

  async function retrieve(cid: string): Promise<Uint8Array> {
    const response = await fetch(`${gatewayUrl}/ipfs/${cid}`);
    if (!response.ok) throw new Error(`Retrieve failed: ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function retrieveJson<T = unknown>(cid: string): Promise<T> {
    const response = await fetch(`${gatewayUrl}/ipfs/${cid}`);
    if (!response.ok) throw new Error(`Retrieve failed: ${response.statusText}`);
    return (await response.json()) as T;
  }

  function getGatewayUrl(cid: string): string {
    return `${gatewayUrl}/ipfs/${cid}`;
  }

  function estimateCost(sizeBytes: number, durationMonths: number, tier: StorageTier): bigint {
    const sizeGB = sizeBytes / (1024 * 1024 * 1024);
    const pricePerGbMonth = STORAGE_PRICING[tier];

    if (tier === 'permanent') {
      return BigInt(Math.ceil(sizeGB)) * pricePerGbMonth;
    }

    return BigInt(Math.ceil(sizeGB * durationMonths)) * pricePerGbMonth;
  }

  return {
    getStats,
    upload,
    uploadJson,
    pin,
    unpin,
    listPins,
    getPinStatus,
    retrieve,
    retrieveJson,
    getGatewayUrl,
    estimateCost,
  };
}

