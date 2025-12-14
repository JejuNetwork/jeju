/**
 * Mysterium Network Adapter
 * Decentralized proxy/VPN with MYST token
 * @see https://mysterium.network/
 */

import type { RegionCode, ProxyRequest, ProxyResponse, DecentralizedProviderType } from '../types';
import {
  BaseExternalAdapter,
  PriceUtils,
  REGION_TO_COUNTRY,
  countriesToRegions,
  type AdapterConfig,
} from './adapter';

interface MysteriumConfig extends AdapterConfig {
  identityAddress?: string;
}

interface Proposal {
  providerId: string;
  serviceType: string;
  location: { country: string };
  quality: { quality: number; latency: number; bandwidth: number };
}

interface ConnectionStatus {
  status: string;
  id?: string;
  providerId?: string;
}

// Pricing constants
const MYST_PER_GB = 0.1;
const MYST_USD = 0.06;
const ETH_USD = 3000;

export class MysteriumAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'mysterium';
  private identity: string;
  private currentCountry: string | null = null;

  constructor(config: MysteriumConfig) {
    super({
      name: config.name || 'Mysterium Network',
      baseUrl: config.baseUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });
    this.identity = config.identityAddress || '';
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const r = await fetch(`${this.baseUrl}/healthcheck`, { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
    return PriceUtils.toWeiPerGb(MYST_PER_GB, MYST_USD, ETH_USD, this.markupBps);
  }

  async getSupportedRegions(): Promise<RegionCode[]> {
    try {
      const r = await fetch(`${this.baseUrl}/proposals?service_type=wireguard`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return [];
      
      const proposals = (await r.json()) as Proposal[];
      const countries = new Set(
        proposals.map((p) => p.location?.country?.toUpperCase()).filter(Boolean)
      );
      return countriesToRegions(countries as Set<string>);
    } catch {
      return [];
    }
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const country = REGION_TO_COUNTRY[region];
    return this.safeFetch(request, region, () => this.ensureConnection(country));
  }

  private async ensureConnection(country: string): Promise<void> {
    if (this.currentCountry === country && await this.isConnected()) return;
    
    await this.disconnect();
    const provider = await this.findProvider(country);
    if (!provider) throw new Error(`No Mysterium providers for: ${country}`);
    
    await this.connect(provider.providerId);
    this.currentCountry = country;
  }

  private async isConnected(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/connection`, { signal: AbortSignal.timeout(3000) });
      const s = (await r.json()) as ConnectionStatus;
      return s.status === 'Connected';
    } catch {
      return false;
    }
  }

  private async findProvider(country: string): Promise<Proposal | null> {
    try {
      const r = await fetch(
        `${this.baseUrl}/proposals?service_type=wireguard&location_country=${country}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) return null;
      
      const proposals = (await r.json()) as Proposal[];
      proposals.sort((a, b) => (b.quality?.quality || 0) - (a.quality?.quality || 0));
      return proposals[0] || null;
    } catch {
      return null;
    }
  }

  private async connect(providerId: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/connection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consumer_id: this.identity,
        provider_id: providerId,
        service_type: 'wireguard',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Mysterium connect failed: ${r.statusText}`);
    
    // Wait for connection
    for (let i = 0; i < 30; i++) {
      if (await this.isConnected()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Mysterium connection timeout');
  }

  private async disconnect(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/connection`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
    this.currentCountry = null;
  }
}

export function createMysteriumAdapter(): MysteriumAdapter | null {
  const nodeUrl = process.env.MYSTERIUM_NODE_URL;
  if (!nodeUrl) {
    console.log('[Mysterium] Node URL not configured, adapter disabled');
    return null;
  }

  return new MysteriumAdapter({
    name: 'Mysterium Network',
    baseUrl: nodeUrl,
    identityAddress: process.env.MYSTERIUM_IDENTITY,
    markupBps: parseInt(process.env.MYSTERIUM_MARKUP_BPS || '500', 10),
  });
}
