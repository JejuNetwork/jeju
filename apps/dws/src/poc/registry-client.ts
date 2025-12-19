/**
 * Proof-of-Cloud Registry Client
 */

import type { Hex } from 'viem';
import {
  type PoCRegistryEntry,
  type PoCVerificationLevel,
  type PoCEndorsement,
  type PoCRevocation,
  PoCError,
  PoCErrorCode,
} from './types';

interface VerifyQuoteResponse {
  verified: boolean;
  level: PoCVerificationLevel | null;
  hardwareIdHash: Hex;
  cloudProvider: string | null;
  region: string | null;
  evidenceHash: Hex;
  timestamp: number;
  endorsements: PoCEndorsement[];
  error?: string;
}

interface HardwareLookupResponse {
  found: boolean;
  entry: PoCRegistryEntry | null;
}

interface RevocationFeed {
  revocations: PoCRevocation[];
  lastTimestamp: number;
}

interface RegistryClientConfig {
  apiKey?: string;
  timeout?: number;
  enableCache?: boolean;
  cacheTtl?: number;
}

export class PoCRegistryClient {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeout: number;
  private readonly enableCache: boolean;
  private readonly cacheTtl: number;
  private readonly hardwareCache = new Map<string, { entry: PoCRegistryEntry | null; timestamp: number }>();

  constructor(endpoint: string, config?: RegistryClientConfig) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = config?.apiKey ?? null;
    this.timeout = config?.timeout ?? 30000;
    this.enableCache = config?.enableCache ?? true;
    this.cacheTtl = config?.cacheTtl ?? 5 * 60 * 1000;
  }

  async verifyQuote(quote: Hex, expectedMeasurement?: Hex): Promise<VerifyQuoteResponse> {
    return this.request<VerifyQuoteResponse>('/verify', {
      method: 'POST',
      body: JSON.stringify({ quote, expectedMeasurement }),
    });
  }

  async checkHardware(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    if (this.enableCache) {
      const cached = this.hardwareCache.get(hardwareIdHash);
      if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
        return cached.entry;
      }
    }

    const response = await this.request<HardwareLookupResponse>(
      `/hardware/${hardwareIdHash}`,
      { method: 'GET' },
    );

    if (this.enableCache) {
      this.hardwareCache.set(hardwareIdHash, { entry: response.entry, timestamp: Date.now() });
    }

    return response.entry;
  }

  async getRevocations(sinceTimestamp?: number): Promise<PoCRevocation[]> {
    const url = sinceTimestamp ? `/revocations?since=${sinceTimestamp}` : '/revocations';
    const response = await this.request<RevocationFeed>(url, { method: 'GET' });
    return response.revocations;
  }

  subscribeToRevocations(
    onRevocation: (revocation: PoCRevocation) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const wsEndpoint = this.endpoint.replace(/^http/, 'ws') + '/ws/revocations';
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let isClosing = false;

    const connect = () => {
      ws = new WebSocket(wsEndpoint);
      ws.onopen = () => { reconnectAttempts = 0; };
      ws.onmessage = (e) => onRevocation(JSON.parse(e.data as string));
      ws.onerror = () => onError?.(new Error('WebSocket error'));
      ws.onclose = () => {
        if (isClosing) return;
        if (reconnectAttempts++ < 5) {
          setTimeout(connect, Math.min(1000 * 2 ** reconnectAttempts, 30000));
        } else {
          onError?.(new Error('Max reconnection attempts'));
        }
      };
    };
    connect();
    return () => { isClosing = true; ws?.close(); };
  }

  async isHardwareValid(hardwareIdHash: Hex): Promise<boolean> {
    const entry = await this.checkHardware(hardwareIdHash);
    return entry?.active === true;
  }

  async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    const cached = this.hardwareCache.get(hardwareIdHash);
    if (cached?.entry && !cached.entry.active) return true;
    const revocations = await this.getRevocations();
    return revocations.some(r => r.hardwareIdHash === hardwareIdHash);
  }

  async getEndorsements(hardwareIdHash: Hex): Promise<PoCEndorsement[]> {
    const entry = await this.checkHardware(hardwareIdHash);
    return entry?.endorsements ?? [];
  }

  // Alliance Member API (requires API key)

  async submitVerification(
    hardwareIdHash: Hex,
    level: PoCVerificationLevel,
    cloudProvider: string,
    region: string,
    evidenceHash: Hex,
    signature: Hex,
  ): Promise<{ success: boolean; entry: PoCRegistryEntry }> {
    this.requireApiKey();
    return this.request('/verify/submit', {
      method: 'POST',
      body: JSON.stringify({ hardwareIdHash, level, cloudProvider, region, evidenceHash, signature }),
    });
  }

  async submitRevocation(
    hardwareIdHash: Hex,
    reason: string,
    evidenceHash: Hex,
    signature: Hex,
  ): Promise<{ success: boolean; revocation: PoCRevocation }> {
    this.requireApiKey();
    return this.request('/revoke', {
      method: 'POST',
      body: JSON.stringify({ hardwareIdHash, reason, evidenceHash, signature }),
    });
  }

  async addEndorsement(hardwareIdHash: Hex, signature: Hex): Promise<{ success: boolean }> {
    this.requireApiKey();
    return this.request('/endorse', {
      method: 'POST',
      body: JSON.stringify({ hardwareIdHash, signature }),
    });
  }

  clearCache(): void {
    this.hardwareCache.clear();
  }

  private requireApiKey(): void {
    if (!this.apiKey) throw new PoCError(PoCErrorCode.ORACLE_UNAVAILABLE, 'API key required');
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const response = await fetch(url, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errorText = await response.text();
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        `Registry API error: ${response.status} ${errorText}`,
        { status: response.status, url },
      );
    }

    return response.json() as Promise<T>;
  }
}

// Mock for testing/development

export class MockPoCRegistryClient extends PoCRegistryClient {
  private mockEntries = new Map<string, PoCRegistryEntry>();
  private mockRevocations: PoCRevocation[] = [];

  constructor() {
    super('http://localhost:0', { enableCache: false });
  }

  addMockEntry(entry: PoCRegistryEntry): void {
    this.mockEntries.set(entry.hardwareIdHash, entry);
  }

  addMockRevocation(revocation: PoCRevocation): void {
    this.mockRevocations.push(revocation);
    const entry = this.mockEntries.get(revocation.hardwareIdHash);
    if (entry) entry.active = false;
  }

  override async verifyQuote(quote: Hex): Promise<VerifyQuoteResponse> {
    const hardwareIdHash = ('0x' + quote.slice(2, 66).padEnd(64, '0')) as Hex;
    const entry = this.mockEntries.get(hardwareIdHash);

    if (!entry) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: null,
        region: null,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware not found',
      };
    }

    if (!entry.active) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: entry.cloudProvider,
        region: entry.region,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware revoked',
      };
    }

    return {
      verified: true,
      level: entry.level,
      hardwareIdHash,
      cloudProvider: entry.cloudProvider,
      region: entry.region,
      evidenceHash: entry.evidenceHashes[0] as Hex ?? ('0x' as Hex),
      timestamp: Date.now(),
      endorsements: entry.endorsements,
    };
  }

  override async checkHardware(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    return this.mockEntries.get(hardwareIdHash) ?? null;
  }

  override async getRevocations(): Promise<PoCRevocation[]> {
    return this.mockRevocations;
  }

  override async isHardwareValid(hardwareIdHash: Hex): Promise<boolean> {
    const entry = this.mockEntries.get(hardwareIdHash);
    return entry?.active === true;
  }

  override async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    return this.mockRevocations.some(r => r.hardwareIdHash === hardwareIdHash);
  }
}

export function createRegistryClient(): PoCRegistryClient {
  const endpoint = process.env.POC_REGISTRY_ENDPOINT;

  if (!endpoint) {
    console.warn('[PoCRegistry] No endpoint, using mock');
    return new MockPoCRegistryClient();
  }

  return new PoCRegistryClient(endpoint, {
    apiKey: process.env.POC_REGISTRY_API_KEY,
    timeout: Number(process.env.POC_REGISTRY_TIMEOUT) || 30000,
    enableCache: process.env.POC_REGISTRY_CACHE !== 'false',
    cacheTtl: Number(process.env.POC_REGISTRY_CACHE_TTL) || 5 * 60 * 1000,
  });
}
