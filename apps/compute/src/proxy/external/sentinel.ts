/**
 * Sentinel Network Adapter
 * Decentralized VPN on Cosmos with dVPN token
 * @see https://sentinel.co/
 */

import type { RegionCode, ProxyRequest, ProxyResponse, DecentralizedProviderType } from '../types';
import {
  BaseExternalAdapter,
  PriceUtils,
  REGION_TO_COUNTRY,
  countriesToRegions,
  type AdapterConfig,
} from './adapter';

interface SentinelNode {
  address: string;
  moniker: string;
  country: string;
  status: 'active' | 'inactive';
  pricePerGB: number;
  bandwidth: { upload: number; download: number };
}

// Pricing constants
const DVPN_PER_GB = 10;
const DVPN_USD = 0.002;
const ETH_USD = 3000;
const CACHE_TTL = 5 * 60 * 1000;

export class SentinelAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'sentinel';
  private cachedNodes: SentinelNode[] = [];
  private lastFetch = 0;

  constructor(config: AdapterConfig) {
    super({
      name: config.name || 'Sentinel Network',
      baseUrl: config.baseUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const r = await fetch(`${this.baseUrl}/api/v1/nodes`, { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
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
    } catch {
      return [];
    }
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const country = REGION_TO_COUNTRY[region];
    return this.safeFetch(request, region, async () => {
      const node = await this.selectNode(country);
      if (!node) throw new Error(`No Sentinel nodes for: ${country}`);
    });
  }

  private async getNodes(): Promise<SentinelNode[]> {
    const now = Date.now();
    if (this.cachedNodes.length > 0 && now - this.lastFetch < CACHE_TTL) {
      return this.cachedNodes;
    }

    try {
      const r = await fetch(`${this.baseUrl}/api/v1/nodes?status=active`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return this.cachedNodes;

      const data = (await r.json()) as { nodes: SentinelNode[] };
      this.cachedNodes = data.nodes || [];
      this.lastFetch = now;
      return this.cachedNodes;
    } catch {
      return this.cachedNodes;
    }
  }

  private async selectNode(country: string): Promise<SentinelNode | null> {
    const nodes = await this.getNodes();
    const filtered = nodes.filter(
      (n) => n.status === 'active' && n.country?.toUpperCase() === country.toUpperCase()
    );

    if (filtered.length === 0) return null;

    // Sort by bandwidth
    filtered.sort((a, b) => {
      const bwA = (a.bandwidth?.download || 0) + (a.bandwidth?.upload || 0);
      const bwB = (b.bandwidth?.download || 0) + (b.bandwidth?.upload || 0);
      return bwB - bwA;
    });

    return filtered[0] || null;
  }
}

export function createSentinelAdapter(): SentinelAdapter | null {
  const apiUrl = process.env.SENTINEL_API_URL;
  if (!apiUrl) {
    console.log('[Sentinel] API URL not configured, adapter disabled');
    return null;
  }

  return new SentinelAdapter({
    name: 'Sentinel Network',
    baseUrl: apiUrl,
    markupBps: parseInt(process.env.SENTINEL_MARKUP_BPS || '500', 10),
  });
}
