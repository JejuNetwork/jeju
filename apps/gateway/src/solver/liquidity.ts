import type { PublicClient, WalletClient } from 'viem';
import { ZERO_ADDRESS } from '../lib/contracts.js';

interface LiquidityConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  maxExposurePerChain: string;
}

interface ChainLiquidity {
  chainId: number;
  available: Map<string, bigint>;
  locked: Map<string, bigint>;
}

export class LiquidityManager {
  private config: LiquidityConfig;
  private liquidity: Map<number, ChainLiquidity> = new Map();

  constructor(config: LiquidityConfig) {
    this.config = config;
  }

  async initialize(clients: Map<number, { public: PublicClient; wallet?: WalletClient }>): Promise<void> {
    console.log('💰 Initializing liquidity manager...');

    for (const chain of this.config.chains) {
      const client = clients.get(chain.chainId);
      if (!client?.wallet?.account) continue;

      const balance = await client.public.getBalance({ address: client.wallet.account.address });

      this.liquidity.set(chain.chainId, {
        chainId: chain.chainId,
        available: new Map([[ZERO_ADDRESS, balance]]),
        locked: new Map(),
      });
      console.log(`   ${chain.name}: ${(Number(balance) / 1e18).toFixed(4)} ETH`);
    }
  }

  async hasLiquidity(chainId: number, token: string, amount: string): Promise<boolean> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) return false;

    const available = chainLiquidity.available.get(token.toLowerCase()) || 0n;
    const locked = chainLiquidity.locked.get(token.toLowerCase()) || 0n;
    return (available - locked) >= BigInt(amount);
  }

  async lockLiquidity(chainId: number, token: string, amount: string): Promise<boolean> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity || !(await this.hasLiquidity(chainId, token, amount))) return false;

    const tokenKey = token.toLowerCase();
    const currentLocked = chainLiquidity.locked.get(tokenKey) || 0n;
    chainLiquidity.locked.set(tokenKey, currentLocked + BigInt(amount));
    return true;
  }

  async unlockLiquidity(chainId: number, token: string, amount: string): Promise<void> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) return;

    const tokenKey = token.toLowerCase();
    const currentLocked = chainLiquidity.locked.get(tokenKey) || 0n;
    const newLocked = currentLocked - BigInt(amount);
    chainLiquidity.locked.set(tokenKey, newLocked > 0n ? newLocked : 0n);
  }

  async deductLiquidity(chainId: number, token: string, amount: string): Promise<void> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) return;

    const tokenKey = token.toLowerCase();
    const current = chainLiquidity.available.get(tokenKey) || 0n;
    chainLiquidity.available.set(tokenKey, current - BigInt(amount));
    await this.unlockLiquidity(chainId, token, amount);
  }

  async addLiquidity(chainId: number, token: string, amount: string): Promise<void> {
    const chainLiquidity = this.liquidity.get(chainId);
    if (!chainLiquidity) return;

    const tokenKey = token.toLowerCase();
    const current = chainLiquidity.available.get(tokenKey) || 0n;
    chainLiquidity.available.set(tokenKey, current + BigInt(amount));
  }

  getAvailableLiquidity(chainId: number): Map<string, bigint> | undefined {
    return this.liquidity.get(chainId)?.available;
  }

  getTotalLiquidity(): { chainId: number; token: string; amount: bigint }[] {
    const result: { chainId: number; token: string; amount: bigint }[] = [];
    for (const [chainId, liquidity] of this.liquidity) {
      for (const [token, amount] of liquidity.available) {
        result.push({ chainId, token, amount });
      }
    }
    return result;
  }

  async recordFill(chainId: number, token: string, amount: string): Promise<void> {
    await this.deductLiquidity(chainId, token, amount);
    console.log(`   💸 Liquidity updated: -${(Number(amount) / 1e18).toFixed(4)} on chain ${chainId}`);
  }

  async recordSettlement(chainId: number, token: string, amount: string): Promise<void> {
    await this.addLiquidity(chainId, token, amount);
    console.log(`   💰 Settlement received: +${(Number(amount) / 1e18).toFixed(4)} on chain ${chainId}`);
  }
}
