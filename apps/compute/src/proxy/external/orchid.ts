/**
 * Orchid Network Adapter
 * Decentralized bandwidth marketplace with OXT token
 * @see https://orchid.com/
 */

import { Contract, JsonRpcProvider } from 'ethers';
import type { RegionCode, ProxyRequest, ProxyResponse, DecentralizedProviderType } from '../types';
import { getAllRegionCodes } from '../types';
import { BaseExternalAdapter, PriceUtils, type AdapterConfig } from './adapter';

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

// Pricing constants
const OXT_PER_GB = 1;
const OXT_USD = 0.05;
const ETH_USD = 3000;
const CACHE_TTL = 5 * 60 * 1000;

export class OrchidAdapter extends BaseExternalAdapter {
  readonly type: DecentralizedProviderType = 'orchid';
  private contract: Contract | null = null;
  private cachedProviders: Provider[] = [];
  private lastFetch = 0;

  constructor(config: OrchidConfig) {
    super({
      name: config.name || 'Orchid Network',
      baseUrl: config.rpcUrl,
      markupBps: config.markupBps,
      timeout: config.timeout,
    });

    if (config.stakingContract) {
      const provider = new JsonRpcProvider(config.rpcUrl);
      this.contract = new Contract(config.stakingContract, DIRECTORY_ABI, provider);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const providers = await this.getProviders();
      return providers.length > 0;
    } catch {
      return false;
    }
  }

  async getRate(_region: RegionCode): Promise<bigint> {
    return PriceUtils.toWeiPerGb(OXT_PER_GB, OXT_USD, ETH_USD, this.markupBps);
  }

  async getSupportedRegions(): Promise<RegionCode[]> {
    // Orchid doesn't enforce location verification
    return getAllRegionCodes();
  }

  async fetchViaProxy(request: ProxyRequest, region: RegionCode): Promise<ProxyResponse> {
    return this.safeFetch(request, region, async () => {
      const provider = await this.selectProvider();
      if (!provider) throw new Error(`No Orchid providers available`);
    });
  }

  private async getProviders(): Promise<Provider[]> {
    const now = Date.now();
    if (this.cachedProviders.length > 0 && now - this.lastFetch < CACHE_TTL) {
      return this.cachedProviders;
    }

    if (!this.contract) return [];

    try {
      const count = await this.contract.providerCount();
      const providers: Provider[] = [];

      for (let i = 0; i < Math.min(Number(count), 100); i++) {
        try {
          const [addr, url, stake] = await this.contract.providers(i);
          if (stake > 0n) {
            providers.push({ address: addr, url, stake: BigInt(stake.toString()) });
          }
        } catch { /* skip */ }
      }

      providers.sort((a, b) => Number(b.stake - a.stake));
      this.cachedProviders = providers;
      this.lastFetch = now;
      return providers;
    } catch {
      return this.cachedProviders;
    }
  }

  private async selectProvider(): Promise<Provider | null> {
    const providers = await this.getProviders();
    return providers[0] || null;
  }
}

export function createOrchidAdapter(): OrchidAdapter | null {
  const rpcUrl = process.env.ORCHID_RPC_URL || process.env.ETHEREUM_RPC_URL;
  const stakingContract = process.env.ORCHID_STAKING_CONTRACT;

  if (!rpcUrl || !stakingContract) {
    console.log('[Orchid] RPC URL or staking contract not configured, adapter disabled');
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
