/**
 * Bright Data Proxy Provider Adapter
 * 
 * Integrates Bright Data's residential proxy network as a fallback
 * when no internal Jeju nodes are available for a region.
 * 
 * @see https://brightdata.com/
 * @module @jeju/proxy/external/brightdata
 */

import { parseEther } from 'ethers';
import type { RegionCode, ProxyRequest, ProxyResponse } from '../types';
import { BaseExternalAdapter, type ExternalAdapterConfig, REGION_TO_COUNTRY, getAllRegionCodes } from './adapter';

interface BrightDataConfig extends ExternalAdapterConfig {
  zone: string; // Bright Data zone (e.g., 'residential')
  username: string;
  password: string;
}

/**
 * Bright Data proxy provider adapter
 */
export class BrightDataAdapter extends BaseExternalAdapter {
  private zone: string;
  private username: string;
  private password: string;

  // Bright Data pricing (approximate, in USD per GB)
  // Residential: ~$8-15/GB depending on region
  private static readonly BASE_PRICE_USD_PER_GB = 10;
  private static readonly ETH_PRICE_USD = 3000; // Approximate ETH price

  constructor(config: BrightDataConfig) {
    super(
      {
        name: config.name || 'Bright Data',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || 'https://brd.superproxy.io',
        markupBps: config.markupBps || 1000, // 10% default markup
        timeout: config.timeout,
      },
      'brightdata'
    );
    this.zone = config.zone;
    this.username = config.username;
    this.password = config.password;
  }

  /**
   * Check if Bright Data is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.username || !this.password || !this.zone) {
      return false;
    }

    try {
      // Test connection with a simple request
      const testUrl = 'https://lumtest.com/myip.json';
      const response = await this.makeProxyRequest(testUrl, 'US', 'GET');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get rate for region in wei per GB
   */
  async getRate(region: RegionCode): Promise<bigint> {
    // Base rate: $10/GB -> convert to ETH -> convert to wei
    const usdPerGb = BrightDataAdapter.BASE_PRICE_USD_PER_GB;
    const ethPerGb = usdPerGb / BrightDataAdapter.ETH_PRICE_USD;
    const weiPerGb = parseEther(ethPerGb.toFixed(18));
    
    return this.applyMarkup(weiPerGb);
  }

  /**
   * Get supported regions
   */
  async getSupportedRegions(): Promise<RegionCode[]> {
    // Bright Data supports all major regions
    return getAllRegionCodes();
  }

  /**
   * Fetch URL via Bright Data proxy
   */
  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const startTime = Date.now();
    const country = REGION_TO_COUNTRY[region] || 'us';

    try {
      const response = await this.makeProxyRequest(
        request.url,
        country,
        request.method,
        request.headers,
        request.body
      );

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return this.createResponse(
        request,
        response.status,
        response.statusText,
        headers,
        body,
        Date.now() - startTime
      );
    } catch (err) {
      return this.createResponse(
        request,
        0,
        'Error',
        {},
        '',
        Date.now() - startTime
      );
    }
  }

  /**
   * Make a request through Bright Data proxy
   */
  private async makeProxyRequest(
    url: string,
    country: string,
    method: string,
    headers?: Record<string, string>,
    body?: string
  ): Promise<Response> {
    // Bright Data uses HTTP proxy authentication
    // Format: username-zone-country:password
    const proxyUsername = `${this.username}-zone-${this.zone}-country-${country}`;
    const proxyAuth = Buffer.from(`${proxyUsername}:${this.password}`).toString('base64');

    // Build proxy URL
    const proxyUrl = `${this.baseUrl}:22225`;

    // Use fetch with proxy (requires undici in Node.js or native in Bun)
    // For Bun, we can use the built-in proxy support
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Bun supports proxy via environment or custom Agent
      // For now, use a simple fetch with Proxy-Authorization header
      // In production, this would use a proper HTTP proxy client
      
      const fetchOptions: RequestInit = {
        method,
        headers: {
          ...headers,
          'Proxy-Authorization': `Basic ${proxyAuth}`,
        },
        body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
        signal: controller.signal,
      };

      // Note: This is a simplified implementation
      // In production, use a proper proxy library like `undici` with ProxyAgent
      // or spawn a subprocess to curl with proxy
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

/**
 * Create a Bright Data adapter from environment
 */
export function createBrightDataAdapter(): BrightDataAdapter | null {
  const username = process.env.BRIGHTDATA_USERNAME;
  const password = process.env.BRIGHTDATA_PASSWORD;
  const zone = process.env.BRIGHTDATA_ZONE || 'residential';

  if (!username || !password) {
    console.log('[BrightData] Credentials not configured, adapter disabled');
    return null;
  }

  return new BrightDataAdapter({
    name: 'Bright Data',
    apiKey: '', // Not used for Bright Data
    zone,
    username,
    password,
    markupBps: parseInt(process.env.BRIGHTDATA_MARKUP_BPS || '1000', 10),
  });
}

