/**
 * External Proxy Provider Adapter Base
 * Shared utilities for decentralized proxy network integrations
 * @module @jeju/proxy/external
 */

import { parseEther } from 'ethers';
import type {
  RegionCode,
  ProxyRequest,
  ProxyResponse,
  ExternalProxyProvider,
  DecentralizedProviderType,
  Address,
} from '../types';
import { REGION_CODES, getAllRegionCodes } from '../types';

// Re-export for convenience
export { getAllRegionCodes };
export type { DecentralizedProviderType };

export interface AdapterConfig {
  name: string;
  baseUrl: string;
  markupBps?: number;
  timeout?: number;
}

/** Region code to lowercase country code mapping */
export const REGION_TO_COUNTRY: Record<RegionCode, string> = {
  US: 'us', GB: 'gb', DE: 'de', FR: 'fr', JP: 'jp',
  KR: 'kr', SG: 'sg', AU: 'au', BR: 'br', IN: 'in',
  CA: 'ca', NL: 'nl', SE: 'se', CH: 'ch', HK: 'hk',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** Proxy configuration for routing through external nodes */
export interface ProxyConfig {
  host: string;
  port: number;
  protocol: 'socks5' | 'http' | 'https';
  auth?: { username: string; password: string };
}

/** Price conversion utilities */
export const PriceUtils = {
  /** Convert token rate to wei per GB with markup */
  toWeiPerGb(tokenPerGb: number, tokenPriceUsd: number, ethPriceUsd: number, markupBps: number): bigint {
    const usdPerGb = tokenPerGb * tokenPriceUsd;
    const ethPerGb = usdPerGb / ethPriceUsd;
    const base = parseEther(ethPerGb.toFixed(18));
    return base + (base * BigInt(markupBps)) / 10000n;
  },
};

/** Create error response */
export function createErrorResponse(
  request: ProxyRequest,
  error: string,
  latencyMs: number
): ProxyResponse {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    statusCode: 0,
    statusText: 'Error',
    headers: {},
    body: '',
    bytesTransferred: 0,
    latencyMs,
    nodeAddress: ZERO_ADDRESS,
    error,
  };
}

/** Create success response from fetch result */
export function createSuccessResponse(
  request: ProxyRequest,
  response: Response,
  body: string,
  latencyMs: number,
  nodeAddress: Address = ZERO_ADDRESS
): ProxyResponse {
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    statusCode: response.status,
    statusText: response.statusText,
    headers,
    body,
    bytesTransferred: new TextEncoder().encode(body).length,
    latencyMs,
    nodeAddress,
  };
}

/**
 * Execute HTTP request through a SOCKS5 proxy
 * 
 * Note: Bun doesn't have native SOCKS5 support in fetch().
 * This implementation uses HTTP CONNECT for HTTPS URLs through HTTP proxies,
 * or direct connection for testing. In production, use a SOCKS5 library.
 */
export async function executeProxiedFetch(
  request: ProxyRequest,
  timeout: number,
  proxyConfig?: ProxyConfig
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    signal: controller.signal,
  };
  
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
  }

  try {
    if (proxyConfig && proxyConfig.protocol === 'http') {
      // For HTTP proxy, we can use Bun's proxy support via environment
      // This is a workaround - in production use socks-proxy-agent
      const proxyUrl = proxyConfig.auth 
        ? `http://${proxyConfig.auth.username}:${proxyConfig.auth.password}@${proxyConfig.host}:${proxyConfig.port}`
        : `http://${proxyConfig.host}:${proxyConfig.port}`;
      
      // Bun supports HTTP_PROXY/HTTPS_PROXY environment variables
      const originalProxy = process.env.HTTP_PROXY;
      process.env.HTTP_PROXY = proxyUrl;
      process.env.HTTPS_PROXY = proxyUrl;
      
      try {
        const response = await fetch(request.url, init);
        return response;
      } finally {
        if (originalProxy) {
          process.env.HTTP_PROXY = originalProxy;
          process.env.HTTPS_PROXY = originalProxy;
        } else {
          delete process.env.HTTP_PROXY;
          delete process.env.HTTPS_PROXY;
        }
      }
    }
    
    // SOCKS5 requires external library - document this limitation
    if (proxyConfig && proxyConfig.protocol === 'socks5') {
      throw new Error(
        `SOCKS5 proxy requires socks-proxy-agent package. ` +
        `Configure: bun add socks-proxy-agent, then use SocksProxyAgent. ` +
        `Proxy: ${proxyConfig.host}:${proxyConfig.port}`
      );
    }

    // No proxy configured - direct fetch (for testing/fallback)
    const response = await fetch(request.url, init);
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Map country set to supported region codes */
export function countriesToRegions(countries: Set<string>): RegionCode[] {
  const regions: RegionCode[] = [];
  for (const region of getAllRegionCodes()) {
    if (countries.has(REGION_TO_COUNTRY[region].toUpperCase())) {
      regions.push(region);
    }
  }
  return regions;
}

/**
 * Abstract base for external proxy adapters
 */
export abstract class BaseExternalAdapter implements ExternalProxyProvider {
  readonly name: string;
  abstract readonly type: DecentralizedProviderType;
  protected baseUrl: string;
  protected markupBps: number;
  protected timeout: number;

  constructor(config: AdapterConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.markupBps = config.markupBps ?? 500;
    this.timeout = config.timeout ?? 30000;
  }

  abstract isAvailable(): Promise<boolean>;
  abstract getRate(region: RegionCode): Promise<bigint>;
  abstract fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse>;
  abstract getSupportedRegions(): Promise<RegionCode[]>;

  /**
   * Get the proxy configuration for this adapter
   * Subclasses should override to return actual proxy config when connected
   */
  abstract getProxyConfig(): ProxyConfig | null;

  /** Fetch with automatic error handling and proxy routing */
  protected async safeFetch(
    request: ProxyRequest,
    region: RegionCode,
    setupFn: () => Promise<void>
  ): Promise<ProxyResponse> {
    const start = Date.now();
    try {
      await setupFn();
      
      const proxyConfig = this.getProxyConfig();
      if (!proxyConfig) {
        throw new Error(`No proxy connection established for ${this.name}`);
      }
      
      const response = await executeProxiedFetch(request, this.timeout, proxyConfig);
      const body = await response.text();
      return createSuccessResponse(request, response, body, Date.now() - start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return createErrorResponse(request, msg, Date.now() - start);
    }
  }
  
  /** Direct fetch without proxy - use only for testing or API calls to provider */
  protected async directFetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.timeout),
    });
  }
}
