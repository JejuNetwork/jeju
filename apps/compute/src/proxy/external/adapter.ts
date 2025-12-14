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
  latencyMs: number
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
    nodeAddress: ZERO_ADDRESS,
  };
}

/** Execute proxied HTTP request with timeout */
export async function executeProxiedFetch(
  request: ProxyRequest,
  timeout: number
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

  /** Fetch with automatic error handling */
  protected async safeFetch(
    request: ProxyRequest,
    region: RegionCode,
    setupFn: () => Promise<void>
  ): Promise<ProxyResponse> {
    const start = Date.now();
    try {
      await setupFn();
      const response = await executeProxiedFetch(request, this.timeout);
      const body = await response.text();
      return createSuccessResponse(request, response, body, Date.now() - start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return createErrorResponse(request, msg, Date.now() - start);
    }
  }
}
