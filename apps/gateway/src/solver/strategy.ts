import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { arbitrum, optimism, mainnet, sepolia } from 'viem/chains';

interface StrategyConfig {
  minProfitBps: number;
  maxGasPrice: bigint;
  maxIntentSize: string;
}

interface IntentEvaluation {
  orderId: string;
  sourceChain: number;
  destinationChain: number;
  inputToken: string;
  inputAmount: string;
  outputToken: string;
  outputAmount: string;
}

interface EvaluationResult {
  profitable: boolean;
  expectedProfitBps: number;
  reason?: string;
  gasEstimate?: bigint;
}

// Chainlink ETH/USD feeds (mainnet only - testnets use CoinGecko API)
const CHAINLINK_ETH_USD: Record<number, Address> = {
  1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  10: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
};

const AGGREGATOR_ABI = [{
  type: 'function',
  name: 'latestRoundData',
  inputs: [],
  outputs: [
    { name: 'roundId', type: 'uint80' },
    { name: 'answer', type: 'int256' },
    { name: 'startedAt', type: 'uint256' },
    { name: 'updatedAt', type: 'uint256' },
    { name: 'answeredInRound', type: 'uint80' },
  ],
  stateMutability: 'view',
}] as const;

const CHAINS = { 1: mainnet, 42161: arbitrum, 10: optimism, 11155111: sepolia } as const;
const FILL_GAS = 150000n;

// Price state with staleness tracking
let ethPriceUsd = 0;
let priceLastUpdated = 0;
const PRICE_STALE_MS = 5 * 60 * 1000; // 5 minutes

export class StrategyEngine {
  private config: StrategyConfig;
  private clients = new Map<number, PublicClient>();
  private isTestnet: boolean;

  constructor(config: StrategyConfig) {
    this.config = config;
    this.isTestnet = !process.env.MAINNET_RPC_URL;
    
    for (const [id, chain] of Object.entries(CHAINS)) {
      const rpc = process.env[`${chain.name.toUpperCase().replace(/ /g, '_')}_RPC_URL`];
      if (rpc) {
        this.clients.set(Number(id), createPublicClient({ chain, transport: http(rpc) }) as PublicClient);
      }
    }
    
    this.refreshPrices();
    setInterval(() => this.refreshPrices(), 60000);
  }

  private async refreshPrices(): Promise<void> {
    // Try Chainlink first (mainnet)
    const client = this.clients.get(1);
    const feed = CHAINLINK_ETH_USD[1];
    
    if (client && feed) {
      const result = await client.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: 'latestRoundData' });
      if (result[1] > 0n) {
        ethPriceUsd = Number(result[1]) / 1e8;
        priceLastUpdated = Date.now();
        return;
      }
    }

    // Fallback: fetch from CoinGecko (works on testnets)
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (res.ok) {
      const data = await res.json() as { ethereum: { usd: number } };
      ethPriceUsd = data.ethereum.usd;
      priceLastUpdated = Date.now();
    }
  }

  async evaluate(intent: IntentEvaluation): Promise<EvaluationResult> {
    // Check price freshness
    if (Date.now() - priceLastUpdated > PRICE_STALE_MS) {
      console.warn('⚠️ ETH price is stale, refreshing...');
      await this.refreshPrices();
      if (Date.now() - priceLastUpdated > PRICE_STALE_MS) {
        return { profitable: false, expectedProfitBps: 0, reason: 'Price feed unavailable' };
      }
    }

    if (BigInt(intent.inputAmount) > BigInt(this.config.maxIntentSize)) {
      return { profitable: false, expectedProfitBps: 0, reason: 'Exceeds max size' };
    }

    const input = BigInt(intent.inputAmount);
    const output = BigInt(intent.outputAmount);
    const fee = input - output;
    if (fee <= 0n) return { profitable: false, expectedProfitBps: 0, reason: 'No fee' };

    const client = this.clients.get(intent.destinationChain);
    const gasPrice = client ? await client.getGasPrice() : this.config.maxGasPrice;
    if (gasPrice > this.config.maxGasPrice) {
      return { profitable: false, expectedProfitBps: 0, reason: 'Gas too high' };
    }

    const gasCost = FILL_GAS * gasPrice;
    const netProfit = fee - gasCost;
    if (netProfit <= 0n) return { profitable: false, expectedProfitBps: 0, reason: 'Gas exceeds fee', gasEstimate: gasCost };

    const profitBps = Number((netProfit * 10000n) / input);
    if (profitBps < this.config.minProfitBps) {
      return { profitable: false, expectedProfitBps: profitBps, reason: `${profitBps} bps < min ${this.config.minProfitBps}`, gasEstimate: gasCost };
    }

    return { profitable: true, expectedProfitBps: profitBps, gasEstimate: gasCost };
  }

  getEthPrice(): number {
    return ethPriceUsd;
  }
  
  isPriceStale(): boolean {
    return Date.now() - priceLastUpdated > PRICE_STALE_MS;
  }
}
