/**
 * Mysterium Network Adapter
 * Decentralized proxy/VPN with MYST token
 * 
 * Mysterium exposes a SOCKS5 proxy on localhost:1080 when connected.
 * Requires running mysterium-node locally.
 * 
 * @see https://mysterium.network/
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

interface MysteriumConfig extends AdapterConfig {
  identityAddress?: string;
  proxyPort?: number; // Default 1080
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

// Pricing - these are approximate and should be fetched from API in production
// TODO: Fetch live rates from Mysterium pricing API
const MYST_PER_GB = 0.1;
const MYST_USD = 0.06;  // Static - should use price oracle
const ETH_USD = 3000;   // Static - should use price oracle

export class MysteriumAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'mysterium';
  private identity: string;
  private proxyPort: number;
  private currentCountry: string | null = null;
  private connected = false;

  constructor(config: MysteriumConfig) {
    super({
      name: config.name || 'Mysterium Network',
      baseUrl: config.baseUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });
    this.identity = config.identityAddress || '';
    this.proxyPort = config.proxyPort || 1080;
  }

  /**
   * Get the SOCKS5 proxy configuration when connected
   * Mysterium node exposes SOCKS5 on localhost:1080 by default
   */
  getProxyConfig(): ProxyConfig | null {
    if (!this.connected) {
      return null;
    }
    return {
      host: '127.0.0.1',
      port: this.proxyPort,
      protocol: 'socks5',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const r = await this.directFetch(`${this.baseUrl}/healthcheck`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
    // TODO: Fetch live MYST/USD and ETH/USD prices
    return PriceUtils.toWeiPerGb(MYST_PER_GB, MYST_USD, ETH_USD, this.markupBps);
  }

  async getSupportedRegions(): Promise<RegionCode[]> {
    try {
      const r = await this.directFetch(`${this.baseUrl}/proposals?service_type=wireguard`);
      if (!r.ok) return [];
      
      const proposals = (await r.json()) as Proposal[];
      const countries = new Set(
        proposals.map((p) => p.location?.country?.toUpperCase()).filter(Boolean)
      );
      return countriesToRegions(countries as Set<string>);
    } catch (err) {
      console.error('[Mysterium] Failed to fetch proposals:', err);
      return [];
    }
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const country = REGION_TO_COUNTRY[region];
    const start = Date.now();
    
    try {
      await this.ensureConnection(country);
      
      const proxyConfig = this.getProxyConfig();
      if (!proxyConfig) {
        throw new Error('Mysterium connection failed - no proxy available');
      }

      // For now, document that SOCKS5 requires additional setup
      // In production, integrate socks-proxy-agent
      return createErrorResponse(
        request,
        `Mysterium SOCKS5 proxy at ${proxyConfig.host}:${proxyConfig.port} requires socks-proxy-agent. ` +
        `Install: bun add socks-proxy-agent, then configure fetch to use the agent.`,
        Date.now() - start
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return createErrorResponse(request, msg, Date.now() - start);
    }
  }

  private async ensureConnection(country: string): Promise<void> {
    if (this.currentCountry === country && this.connected && await this.checkConnected()) {
      return;
    }
    
    await this.disconnect();
    const provider = await this.findProvider(country);
    if (!provider) {
      throw new Error(`No Mysterium providers available for: ${country}`);
    }
    
    await this.connect(provider.providerId);
    this.currentCountry = country;
  }

  private async checkConnected(): Promise<boolean> {
    try {
      const r = await this.directFetch(`${this.baseUrl}/connection`);
      const s = (await r.json()) as ConnectionStatus;
      this.connected = s.status === 'Connected';
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  private async findProvider(country: string): Promise<Proposal | null> {
    try {
      const r = await this.directFetch(
        `${this.baseUrl}/proposals?service_type=wireguard&location_country=${country}`
      );
      if (!r.ok) {
        console.error('[Mysterium] Failed to fetch providers:', r.status, r.statusText);
        return null;
      }
      
      const proposals = (await r.json()) as Proposal[];
      if (proposals.length === 0) {
        console.log('[Mysterium] No providers found for country:', country);
        return null;
      }
      
      // Sort by quality and pick best
      proposals.sort((a, b) => (b.quality?.quality || 0) - (a.quality?.quality || 0));
      return proposals[0];
    } catch (err) {
      console.error('[Mysterium] Error finding provider:', err);
      return null;
    }
  }

  private async connect(providerId: string): Promise<void> {
    console.log('[Mysterium] Connecting to provider:', providerId);
    
    const r = await this.directFetch(`${this.baseUrl}/connection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consumer_id: this.identity,
        provider_id: providerId,
        service_type: 'wireguard',
      }),
    });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Mysterium connect failed: ${r.status} ${r.statusText} - ${text}`);
    }
    
    // Wait for connection to establish
    for (let i = 0; i < 30; i++) {
      if (await this.checkConnected()) {
        console.log('[Mysterium] Connected successfully');
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    
    throw new Error('Mysterium connection timeout after 30s');
  }

  private async disconnect(): Promise<void> {
    if (!this.connected) return;
    
    try {
      await this.directFetch(`${this.baseUrl}/connection`, { method: 'DELETE' });
      console.log('[Mysterium] Disconnected');
    } catch (err) {
      console.warn('[Mysterium] Disconnect error (ignored):', err);
    }
    
    this.connected = false;
    this.currentCountry = null;
  }
}

export function createMysteriumAdapter(): MysteriumAdapter | null {
  const nodeUrl = process.env.MYSTERIUM_NODE_URL;
  if (!nodeUrl) {
    console.log('[Mysterium] MYSTERIUM_NODE_URL not set, adapter disabled');
    return null;
  }

  return new MysteriumAdapter({
    name: 'Mysterium Network',
    baseUrl: nodeUrl,
    identityAddress: process.env.MYSTERIUM_IDENTITY,
    proxyPort: parseInt(process.env.MYSTERIUM_PROXY_PORT || '1080', 10),
    markupBps: parseInt(process.env.MYSTERIUM_MARKUP_BPS || '500', 10),
  });
}
