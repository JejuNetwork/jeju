/**
 * Orchid Network Adapter
 * Decentralized bandwidth marketplace with OXT token
 * 
 * IMPLEMENTATION STATUS: Partial
 * - ✅ Provider discovery from on-chain registry
 * - ✅ Rate calculation
 * - ❌ Actual proxy routing (requires Orchid client integration)
 * 
 * Orchid uses nanopayments and WireGuard tunnels. Full integration requires
 * running the Orchid client which manages payments and tunnel setup.
 * 
 * @see https://orchid.com/
 */

import { Contract, JsonRpcProvider } from 'ethers';
import type { RegionCode, ProxyRequest, ProxyResponse, DecentralizedProviderType } from '../types';
import { getAllRegionCodes } from '../types';
import {
  BaseExternalAdapter,
  PriceUtils,
  createErrorResponse,
  type AdapterConfig,
  type ProxyConfig,
} from './adapter';

interface OrchidConfig extends AdapterConfig {
  rpcUrl: string;
  stakingContract?: string;
}

interface Provider {
  address: string;
  url: string;
  stake: bigint;
}

const DIRECTORY_ABI = [
  'function providers(uint256 index) view returns (address addr, string url, uint256 stake)',
  'function providerCount() view returns (uint256)',
];

// Pricing - approximate, should be fetched from Orchid pricing
// TODO: Query actual OXT prices from DEX or oracle
const OXT_PER_GB = 1;
const OXT_USD = 0.05;  // Static - should use price oracle
const ETH_USD = 3000;   // Static - should use price oracle
const CACHE_TTL = 5 * 60 * 1000;

export class OrchidAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'orchid';
  private contract: Contract | null = null;
  private rpcProvider: JsonRpcProvider | null = null;
  private cachedProviders: Provider[] = [];
  private lastFetch = 0;
  private selectedProvider: Provider | null = null;

  constructor(config: OrchidConfig) {
    super({
      name: config.name || 'Orchid Network',
      baseUrl: config.rpcUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });

    if (config.stakingContract && config.rpcUrl) {
      this.rpcProvider = new JsonRpcProvider(config.rpcUrl);
      this.contract = new Contract(config.stakingContract, DIRECTORY_ABI, this.rpcProvider);
    }
  }

  /**
   * Orchid requires running their client for proxy functionality
   * This adapter can discover providers but cannot route traffic
   */
  getProxyConfig(): ProxyConfig | null {
    // Orchid doesn't expose a simple SOCKS5/HTTP proxy
    // Traffic routing requires the Orchid client daemon
    return null;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const providers = await this.getProviders();
      return providers.length > 0;
    } catch (err) {
      console.error('[Orchid] Availability check failed:', err);
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
    // TODO: Fetch live OXT/USD and ETH/USD prices
    return PriceUtils.toWeiPerGb(OXT_PER_GB, OXT_USD, ETH_USD, this.markupBps);
  }

  async getSupportedRegions(): Promise<RegionCode[]> {
    // Orchid doesn't enforce location - providers can be anywhere
    // In production, query provider metadata for locations
    return getAllRegionCodes();
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    const start = Date.now();
    
    try {
      // Select a provider (for future use)
      this.selectedProvider = await this.selectProvider();
      if (!this.selectedProvider) {
        throw new Error('No Orchid providers available in registry');
      }

      // Document that full integration requires Orchid client
      return createErrorResponse(
        request,
        `Orchid proxy routing not implemented. Selected provider: ${this.selectedProvider.address}. ` +
        `Full integration requires running the Orchid client daemon which handles ` +
        `nanopayments and WireGuard tunnel management. See: https://docs.orchid.com/`,
        Date.now() - start
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return createErrorResponse(request, msg, Date.now() - start);
    }
  }

  private async getProviders(): Promise<Provider[]> {
    const now = Date.now();
    if (this.cachedProviders.length > 0 && now - this.lastFetch < CACHE_TTL) {
      return this.cachedProviders;
    }

    if (!this.contract) {
      console.log('[Orchid] No staking contract configured');
      return [];
    }

    try {
      const count = await this.contract.providerCount();
      const providers: Provider[] = [];
      const maxProviders = Math.min(Number(count), 100);

      console.log(`[Orchid] Fetching ${maxProviders} providers from registry`);

      for (let i = 0; i < maxProviders; i++) {
        try {
          const [addr, url, stake] = await this.contract.providers(i);
          if (stake > 0n) {
            providers.push({ address: addr, url, stake: BigInt(stake.toString()) });
          }
        } catch (err) {
          console.warn(`[Orchid] Failed to fetch provider ${i}:`, err);
        }
      }

      // Sort by stake (higher = more reliable)
      providers.sort((a, b) => Number(b.stake - a.stake));
      this.cachedProviders = providers;
      this.lastFetch = now;
      
      console.log(`[Orchid] Found ${providers.length} active providers`);
      return providers;
    } catch (err) {
      console.error('[Orchid] Failed to fetch providers:', err);
      return this.cachedProviders;
    }
  }

  private async selectProvider(): Promise<Provider | null> {
    const providers = await this.getProviders();
    if (providers.length === 0) return null;
    
    // Return highest-staked provider
    // In production: implement weighted random selection
    return providers[0];
  }

  /** Get currently selected provider (for debugging/info) */
  getSelectedProvider(): Provider | null {
    return this.selectedProvider;
  }
}

export function createOrchidAdapter(): OrchidAdapter | null {
  const rpcUrl = process.env.ORCHID_RPC_URL || process.env.ETHEREUM_RPC_URL;
  const stakingContract = process.env.ORCHID_STAKING_CONTRACT;

  if (!rpcUrl || !stakingContract) {
    console.log('[Orchid] ORCHID_RPC_URL or ORCHID_STAKING_CONTRACT not set, adapter disabled');
    return null;
  }

  return new OrchidAdapter({
    name: 'Orchid Network',
    baseUrl: rpcUrl,
    rpcUrl,
    stakingContract,
    markupBps: parseInt(process.env.ORCHID_MARKUP_BPS || '500', 10),
  });
}
