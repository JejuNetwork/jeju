import type { PublicClient, WalletClient } from 'viem';
import { ZERO_ADDRESS } from '../lib/contracts.js';

interface LiquidityConfig {
  chains: Array<{ chainId: number; name: string }>;
  refreshIntervalMs?: number;
}

export class LiquidityManager {
  private config: LiquidityConfig;
  private balances = new Map<number, Map<string, bigint>>();
  private clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: LiquidityConfig) {
    this.config = config;
  }

  async initialize(clients: Map<number, { public: PublicClient; wallet?: WalletClient }>): Promise<void> {
    this.clients = clients;
    console.log('💰 Initializing liquidity...');
    
    await this.refresh();
    
    // Auto-refresh every 30s by default
    const interval = this.config.refreshIntervalMs || 30000;
    this.refreshInterval = setInterval(() => this.refresh(), interval);
  }

  async refresh(): Promise<void> {
    for (const chain of this.config.chains) {
      const client = this.clients.get(chain.chainId);
      if (!client?.wallet?.account) continue;

      const balance = await client.public.getBalance({ address: client.wallet.account.address });
      
      if (!this.balances.has(chain.chainId)) {
        this.balances.set(chain.chainId, new Map());
      }
      this.balances.get(chain.chainId)!.set(ZERO_ADDRESS, balance);
      
      console.log(`   ${chain.name}: ${(Number(balance) / 1e18).toFixed(4)} ETH`);
    }
  }

  async hasLiquidity(chainId: number, token: string, amount: string): Promise<boolean> {
    const chainBalances = this.balances.get(chainId);
    if (!chainBalances) {
      console.warn(`⚠️ No liquidity data for chain ${chainId}`);
      return false;
    }

    const available = chainBalances.get(token.toLowerCase()) || 0n;
    const required = BigInt(amount);
    
    if (available < required) {
      console.log(`   💸 Insufficient: have ${(Number(available) / 1e18).toFixed(4)}, need ${(Number(required) / 1e18).toFixed(4)}`);
      return false;
    }
    return true;
  }

  async recordFill(chainId: number, token: string, amount: string): Promise<void> {
    const key = token.toLowerCase();
    const chainBalances = this.balances.get(chainId);
    if (!chainBalances) return;
    
    const current = chainBalances.get(key) || 0n;
    const spent = BigInt(amount);
    chainBalances.set(key, current - spent);
    
    console.log(`   💸 -${(Number(spent) / 1e18).toFixed(4)} ETH on chain ${chainId}`);
    
    // Trigger async refresh to get actual on-chain balance
    this.refreshChain(chainId);
  }

  private async refreshChain(chainId: number): Promise<void> {
    const client = this.clients.get(chainId);
    if (!client?.wallet?.account) return;

    const balance = await client.public.getBalance({ address: client.wallet.account.address });
    this.balances.get(chainId)?.set(ZERO_ADDRESS, balance);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  getBalance(chainId: number, token: string): bigint {
    return this.balances.get(chainId)?.get(token.toLowerCase()) || 0n;
  }
}
