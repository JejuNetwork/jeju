/**
 * Sentinel Network Adapter
 * Decentralized VPN on Cosmos with dVPN token
 * 
 * IMPLEMENTATION STATUS: Partial
 * - ✅ Node discovery from Sentinel API
 * - ✅ Rate calculation
 * - ❌ Actual proxy routing (requires Sentinel client + Cosmos wallet)
 * 
 * Sentinel uses WireGuard tunnels and requires:
 * 1. Cosmos wallet with dVPN tokens
 * 2. Subscribing to a node (on-chain transaction)
 * 3. Getting WireGuard config from node
 * 4. Establishing tunnel
 * 
 * @see https://sentinel.co/
 */

import type { RegionCode, ProxyRequest, ProxyResponse, DecentralizedProviderType } from '../types';
import {
  BaseExternalAdapter,
  PriceUtils,
  REGION_TO_COUNTRY,
  countriesToRegions,
  createErrorResponse,
  type AdapterConfig,
  type ProxyConfig,
} from './adapter';

interface SentinelNode {
  address: string;
  moniker: string;
  country: string;
  status: 'active' | 'inactive';
  pricePerGB: number;
  bandwidth: { upload: number; download: number };
}

// Pricing - approximate, dVPN prices vary by node
// TODO: Use actual node pricing from API
const DVPN_PER_GB = 10;
const DVPN_USD = 0.002;  // Static - should query market
const ETH_USD = 3000;     // Static - should use price oracle
const CACHE_TTL = 5 * 60 * 1000;

export class SentinelAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'sentinel';
  private cachedNodes: SentinelNode[] = [];
  private lastFetch = 0;
  private selectedNode: SentinelNode | null = null;

  constructor(config: AdapterConfig) {
    super({
      name: config.name || 'Sentinel Network',
      baseUrl: config.baseUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });
  }

  /**
   * Sentinel requires running their client for proxy functionality
   * This adapter can discover nodes but cannot route traffic
   */
  getProxyConfig(): ProxyConfig | null {
    // Sentinel doesn't expose a simple SOCKS5/HTTP proxy
    // Traffic routing requires the Sentinel client and Cosmos wallet
    return null;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const r = await this.directFetch(`${this.baseUrl}/api/v1/nodes`);
      return r.ok;
    } catch (err) {
      console.error('[Sentinel] Availability check failed:', err);
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
    // TODO: Fetch actual node pricing from selected node
    return PriceUtils.toWeiPerGb(DVPN_PER_GB, DVPN_USD, ETH_USD, this.markupBps);
  }

  async getSupportedRegions(): Promise<RegionCode[]> {
    try {
      const nodes = await this.getNodes();
      const countries = new Set(
        nodes.filter((n) => n.status === 'active' && n.country)
          .map((n) => n.country.toUpperCase())
      );
      return countriesToRegions(countries);
    } catch (err) {
      console.error('[Sentinel] Failed to get supported regions:', err);
      return [];
    }
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const country = REGION_TO_COUNTRY[region];
    const start = Date.now();
    
    try {
      this.selectedNode = await this.selectNode(country);
      if (!this.selectedNode) {
        throw new Error(`No Sentinel nodes available for country: ${country}`);
      }

      // Document that full integration requires Sentinel client
      return createErrorResponse(
        request,
        `Sentinel proxy routing not implemented. Selected node: ${this.selectedNode.moniker} (${this.selectedNode.address}). ` +
        `Full integration requires: 1) Cosmos wallet with dVPN, 2) Subscribe to node on-chain, ` +
        `3) Get WireGuard config, 4) Establish tunnel. See: https://docs.sentinel.co/`,
        Date.now() - start
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return createErrorResponse(request, msg, Date.now() - start);
    }
  }

  private async getNodes(): Promise<SentinelNode[]> {
    const now = Date.now();
    if (this.cachedNodes.length > 0 && now - this.lastFetch < CACHE_TTL) {
      return this.cachedNodes;
    }

    try {
      const r = await this.directFetch(`${this.baseUrl}/api/v1/nodes?status=active`);
      if (!r.ok) {
        console.error('[Sentinel] Failed to fetch nodes:', r.status, r.statusText);
        return this.cachedNodes;
      }

      const data = (await r.json()) as { nodes: SentinelNode[] };
      this.cachedNodes = data.nodes || [];
      this.lastFetch = now;
      
      console.log(`[Sentinel] Found ${this.cachedNodes.length} active nodes`);
      return this.cachedNodes;
    } catch (err) {
      console.error('[Sentinel] Failed to fetch nodes:', err);
      return this.cachedNodes;
    }
  }

  private async selectNode(country: string): Promise<SentinelNode | null> {
    const nodes = await this.getNodes();
    const filtered = nodes.filter(
      (n) => n.status === 'active' && n.country?.toUpperCase() === country.toUpperCase()
    );

    if (filtered.length === 0) {
      console.log(`[Sentinel] No nodes found for country: ${country}`);
      return null;
    }

    // Sort by bandwidth (higher = better)
    filtered.sort((a, b) => {
      const bwA = (a.bandwidth?.download || 0) + (a.bandwidth?.upload || 0);
      const bwB = (b.bandwidth?.download || 0) + (b.bandwidth?.upload || 0);
      return bwB - bwA;
    });

    return filtered[0];
  }

  /** Get currently selected node (for debugging/info) */
  getSelectedNode(): SentinelNode | null {
    return this.selectedNode;
  }
}

export function createSentinelAdapter(): SentinelAdapter | null {
  const apiUrl = process.env.SENTINEL_API_URL;
  if (!apiUrl) {
    console.log('[Sentinel] SENTINEL_API_URL not set, adapter disabled');
    return null;
  }

  return new SentinelAdapter({
    name: 'Sentinel Network',
    baseUrl: apiUrl,
    markupBps: parseInt(process.env.SENTINEL_MARKUP_BPS || '500', 10),
  });
}
