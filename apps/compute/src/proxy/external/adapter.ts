/**
 * External Proxy Provider Adapter Interface
 * Base class for integrating external proxy services as fallback
 * 
 * @module @jeju/proxy/external
 */

import type {
  RegionCode,
  ProxyRequest,
  ProxyResponse,
  ExternalProxyProvider,
  Address,
} from '../types';
import { REGION_CODES } from '../types';

/**
 * Base adapter configuration
 */
export interface ExternalAdapterConfig {
  name: string;
  apiKey: string;
  baseUrl?: string;
  markupBps: number; // Basis points markup on provider cost
  timeout?: number;
}

/**
 * Abstract base class for external proxy providers
 */
export abstract class BaseExternalAdapter implements ExternalProxyProvider {
  readonly name: string;
  readonly type: 'brightdata' | 'oxylabs' | 'mysterium';
  protected apiKey: string;
  protected baseUrl: string;
  protected markupBps: number;
  protected timeout: number;

  constructor(config: ExternalAdapterConfig, type: 'brightdata' | 'oxylabs' | 'mysterium') {
    this.name = config.name;
    this.type = type;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || '';
    this.markupBps = config.markupBps;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Check if the provider is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get the rate for a region in wei per GB
   */
  abstract getRate(region: RegionCode): Promise<bigint>;

  /**
   * Fetch a URL via the external proxy
   */
  abstract fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse>;

  /**
   * Get supported regions
   */
  abstract getSupportedRegions(): Promise<RegionCode[]>;

  /**
   * Apply markup to base rate
   */
  protected applyMarkup(baseRate: bigint): bigint {
    return baseRate + (baseRate * BigInt(this.markupBps)) / 10000n;
  }

  /**
   * Create a standard proxy response from fetch result
   */
  protected createResponse(
    request: ProxyRequest,
    statusCode: number,
    statusText: string,
    headers: Record<string, string>,
    body: string,
    latencyMs: number
  ): ProxyResponse {
    return {
      requestId: request.requestId,
      sessionId: request.sessionId,
      statusCode,
      statusText,
      headers,
      body,
      bytesTransferred: new TextEncoder().encode(body).length,
      latencyMs,
      nodeAddress: '0x0000000000000000000000000000000000000000' as Address, // External
    };
  }
}

/**
 * Map region code to country for proxy providers
 */
export const REGION_TO_COUNTRY: Record<RegionCode, string> = {
  US: 'us',
  GB: 'gb',
  DE: 'de',
  FR: 'fr',
  JP: 'jp',
  KR: 'kr',
  SG: 'sg',
  AU: 'au',
  BR: 'br',
  IN: 'in',
  CA: 'ca',
  NL: 'nl',
  SE: 'se',
  CH: 'ch',
  HK: 'hk',
};

/**
 * Get all valid region codes
 */
export function getAllRegionCodes(): RegionCode[] {
  return Object.keys(REGION_CODES) as RegionCode[];
}

