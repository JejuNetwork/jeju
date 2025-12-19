/**
 * Proof-of-Cloud Registry Client
 * 
 * Client for interacting with the PoC Alliance registry.
 * Supports both direct API access (for alliance members) and
 * public verification endpoints.
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

// ============================================================================
// API Types
// ============================================================================

interface VerifyQuoteRequest {
  quote: Hex;
  expectedMeasurement?: Hex;
}

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

interface RegistrySnapshot {
  version: number;
  timestamp: number;
  entriesHash: Hex;
  entries: PoCRegistryEntry[];
  signatures: Record<string, Hex>;
}

interface RevocationFeed {
  revocations: PoCRevocation[];
  lastTimestamp: number;
}

// ============================================================================
// Registry Client Configuration
// ============================================================================

interface RegistryClientConfig {
  /** Base API endpoint */
  endpoint: string;
  /** API key for authenticated requests (alliance members) */
  apiKey?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Enable snapshot caching */
  enableCache?: boolean;
  /** Cache TTL in ms */
  cacheTtl?: number;
}

// ============================================================================
// PoCRegistryClient Class
// ============================================================================

export class PoCRegistryClient {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeout: number;
  private readonly enableCache: boolean;
  private readonly cacheTtl: number;

  // Local cache of registry entries
  private snapshotCache: RegistrySnapshot | null = null;
  private snapshotCacheTime: number = 0;
  private hardwareCache: Map<string, { entry: PoCRegistryEntry | null; timestamp: number }> = new Map();

  constructor(endpoint: string, config?: Partial<RegistryClientConfig>) {
    this.endpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    this.apiKey = config?.apiKey ?? null;
    this.timeout = config?.timeout ?? 30000;
    this.enableCache = config?.enableCache ?? true;
    this.cacheTtl = config?.cacheTtl ?? 5 * 60 * 1000; // 5 minutes default
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Verify an attestation quote against the PoC registry
   * Uses the public verification endpoint
   */
  async verifyQuote(quote: Hex, expectedMeasurement?: Hex): Promise<VerifyQuoteResponse> {
    const response = await this.request<VerifyQuoteResponse>('/verify', {
      method: 'POST',
      body: JSON.stringify({
        quote,
        expectedMeasurement,
      } satisfies VerifyQuoteRequest),
    });

    return response;
  }

  /**
   * Check if a hardware ID is registered in the PoC registry
   */
  async checkHardware(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    // Check cache first
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

    // Update cache
    if (this.enableCache) {
      this.hardwareCache.set(hardwareIdHash, {
        entry: response.entry,
        timestamp: Date.now(),
      });
    }

    return response.entry;
  }

  /**
   * Get the current registry snapshot
   * Requires API key for full data access
   */
  async getSnapshot(): Promise<RegistrySnapshot> {
    // Check cache
    if (this.enableCache && this.snapshotCache && 
        Date.now() - this.snapshotCacheTime < this.cacheTtl) {
      return this.snapshotCache;
    }

    const response = await this.request<RegistrySnapshot>('/snapshot', {
      method: 'GET',
    });

    // Update cache
    if (this.enableCache) {
      this.snapshotCache = response;
      this.snapshotCacheTime = Date.now();
    }

    return response;
  }

  /**
   * Get recent revocations
   */
  async getRevocations(sinceTimestamp?: number): Promise<PoCRevocation[]> {
    const url = sinceTimestamp 
      ? `/revocations?since=${sinceTimestamp}`
      : '/revocations';

    const response = await this.request<RevocationFeed>(url, {
      method: 'GET',
    });

    return response.revocations;
  }

  /**
   * Subscribe to revocation events (WebSocket)
   */
  subscribeToRevocations(
    onRevocation: (revocation: PoCRevocation) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const wsEndpoint = this.endpoint.replace(/^http/, 'ws') + '/ws/revocations';
    
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let isClosing = false;

    const connect = () => {
      ws = new WebSocket(wsEndpoint);

      ws.onopen = () => {
        console.log('[PoCRegistry] WebSocket connected');
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string) as PoCRevocation;
        onRevocation(data);
      };

      ws.onerror = (event) => {
        console.error('[PoCRegistry] WebSocket error:', event);
        onError?.(new Error('WebSocket connection error'));
      };

      ws.onclose = () => {
        if (isClosing) return;
        
        console.log('[PoCRegistry] WebSocket closed, attempting reconnect...');
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          setTimeout(connect, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
        } else {
          onError?.(new Error('Max reconnection attempts reached'));
        }
      };
    };

    connect();

    // Return cleanup function
    return () => {
      isClosing = true;
      ws?.close();
    };
  }

  /**
   * Check if a hardware entry is still valid
   */
  async isHardwareValid(hardwareIdHash: Hex): Promise<boolean> {
    const entry = await this.checkHardware(hardwareIdHash);
    if (!entry) return false;
    return entry.active && !await this.isRevoked(hardwareIdHash);
  }

  /**
   * Check if hardware has been revoked
   */
  async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    // Check local cache entry first
    if (this.enableCache) {
      const cached = this.hardwareCache.get(hardwareIdHash);
      if (cached?.entry && !cached.entry.active) {
        return true;
      }
    }

    // Query revocations API
    const revocations = await this.getRevocations();
    return revocations.some(r => r.hardwareIdHash === hardwareIdHash);
  }

  /**
   * Get endorsements for a hardware entry
   */
  async getEndorsements(hardwareIdHash: Hex): Promise<PoCEndorsement[]> {
    const entry = await this.checkHardware(hardwareIdHash);
    return entry?.endorsements ?? [];
  }

  // ============================================================================
  // Alliance Member API (requires API key)
  // ============================================================================

  /**
   * Submit a new verification (alliance members only)
   */
  async submitVerification(
    hardwareIdHash: Hex,
    level: PoCVerificationLevel,
    cloudProvider: string,
    region: string,
    evidenceHash: Hex,
    signature: Hex,
  ): Promise<{ success: boolean; entry: PoCRegistryEntry }> {
    if (!this.apiKey) {
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'API key required for verification submission',
      );
    }

    return this.request('/verify/submit', {
      method: 'POST',
      body: JSON.stringify({
        hardwareIdHash,
        level,
        cloudProvider,
        region,
        evidenceHash,
        signature,
      }),
    });
  }

  /**
   * Submit a revocation request (alliance members only)
   */
  async submitRevocation(
    hardwareIdHash: Hex,
    reason: string,
    evidenceHash: Hex,
    signature: Hex,
  ): Promise<{ success: boolean; revocation: PoCRevocation }> {
    if (!this.apiKey) {
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'API key required for revocation submission',
      );
    }

    return this.request('/revoke', {
      method: 'POST',
      body: JSON.stringify({
        hardwareIdHash,
        reason,
        evidenceHash,
        signature,
      }),
    });
  }

  /**
   * Add endorsement to existing entry (alliance members only)
   */
  async addEndorsement(
    hardwareIdHash: Hex,
    signature: Hex,
  ): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'API key required for endorsement',
      );
    }

    return this.request('/endorse', {
      method: 'POST',
      body: JSON.stringify({
        hardwareIdHash,
        signature,
      }),
    });
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.snapshotCache = null;
    this.snapshotCacheTime = 0;
    this.hardwareCache.clear();
  }

  /**
   * Refresh hardware cache for specific entry
   */
  async refreshHardwareCache(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    this.hardwareCache.delete(hardwareIdHash);
    return this.checkHardware(hardwareIdHash);
  }

  /**
   * Preload hardware entries into cache
   */
  async preloadHardware(hardwareIdHashes: Hex[]): Promise<void> {
    // Batch lookup would be ideal, but fetch individually for now
    await Promise.all(
      hardwareIdHashes.map(hash => this.checkHardware(hash)),
    );
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.endpoint}${path}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

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

// ============================================================================
// Mock Registry Client (for testing/development)
// ============================================================================

/**
 * Mock registry client for development without actual PoC registry access
 */
export class MockPoCRegistryClient extends PoCRegistryClient {
  private mockEntries: Map<string, PoCRegistryEntry> = new Map();
  private mockRevocations: PoCRevocation[] = [];

  constructor() {
    super('http://localhost:0', { enableCache: false });
  }

  /**
   * Add a mock hardware entry
   */
  addMockEntry(entry: PoCRegistryEntry): void {
    this.mockEntries.set(entry.hardwareIdHash, entry);
  }

  /**
   * Add a mock revocation
   */
  addMockRevocation(revocation: PoCRevocation): void {
    this.mockRevocations.push(revocation);
    
    // Mark entry as inactive
    const entry = this.mockEntries.get(revocation.hardwareIdHash);
    if (entry) {
      entry.active = false;
    }
  }

  override async verifyQuote(quote: Hex): Promise<VerifyQuoteResponse> {
    // Mock: always return verified for testing
    return {
      verified: true,
      level: 1,
      hardwareIdHash: quote.slice(0, 66) as Hex,
      cloudProvider: 'mock-provider',
      region: 'mock-region',
      evidenceHash: quote.slice(0, 66) as Hex,
      timestamp: Date.now(),
      endorsements: [],
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
    return entry ? entry.active : false;
  }

  override async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    return this.mockRevocations.some(r => r.hardwareIdHash === hardwareIdHash);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create registry client from environment variables
 */
export function createRegistryClient(): PoCRegistryClient {
  const endpoint = process.env.POC_REGISTRY_ENDPOINT;
  
  if (!endpoint) {
    console.warn('[PoCRegistry] No endpoint configured, using mock client');
    return new MockPoCRegistryClient();
  }

  return new PoCRegistryClient(endpoint, {
    apiKey: process.env.POC_REGISTRY_API_KEY,
    timeout: Number(process.env.POC_REGISTRY_TIMEOUT) || 30000,
    enableCache: process.env.POC_REGISTRY_CACHE !== 'false',
    cacheTtl: Number(process.env.POC_REGISTRY_CACHE_TTL) || 5 * 60 * 1000,
  });
}


