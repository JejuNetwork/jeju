import { createPublicClient, http, type Address, type PublicClient, type Chain } from 'viem';
import { arbitrum, optimism, mainnet, sepolia } from 'viem/chains';
import { ZERO_ADDRESS } from '../lib/contracts.js';

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
  expectedProfitUsd: string;
  reason?: string;
  gasEstimate?: bigint;
  route?: string;
}

const CHAINLINK_FEEDS: Record<number, Record<string, Address>> = {
  1: { ETH: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6' },
  42161: { ETH: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', USDC: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3' },
  10: { ETH: '0x13e3Ee699D1909E989722E753853AE30b17e08c5', USDC: '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3' },
};

const TOKEN_SYMBOLS: Record<string, string> = {
  [ZERO_ADDRESS]: 'ETH',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC',
};

const priceCache: Record<string, { price: number; timestamp: number }> = {
  ETH: { price: 2500, timestamp: Date.now() },
  USDC: { price: 1, timestamp: Date.now() },
};

const GAS_COSTS: Record<number, { fillGas: bigint; gasPrice: bigint }> = {
  1: { fillGas: 150000n, gasPrice: 30000000000n },
  42161: { fillGas: 300000n, gasPrice: 100000000n },
  10: { fillGas: 150000n, gasPrice: 1000000n },
  420691: { fillGas: 100000n, gasPrice: 1000000000n },
  11155111: { fillGas: 150000n, gasPrice: 5000000000n },
};

const AGGREGATOR_ABI = [
  { type: 'function', name: 'latestRoundData', inputs: [], outputs: [{ name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' }, { name: 'startedAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }, { name: 'answeredInRound', type: 'uint80' }], stateMutability: 'view' },
] as const;

const CHAINS: Record<number, Chain> = { 1: mainnet, 42161: arbitrum, 10: optimism, 11155111: sepolia };

export class StrategyEngine {
  private config: StrategyConfig;
  private clients = new Map<number, PublicClient>();

  constructor(config: StrategyConfig) {
    this.config = config;
    this.initializeClients();
    this.startPriceRefresh();
  }

  private initializeClients(): void {
    for (const [idStr, chain] of Object.entries(CHAINS)) {
      const rpcUrl = process.env[`${chain.name.toUpperCase().replace(/ /g, '_')}_RPC_URL`];
      this.clients.set(Number(idStr), createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient);
    }
  }

  private async startPriceRefresh(): Promise<void> {
    const refresh = async () => {
      await this.refreshPrices();
      setTimeout(refresh, 60000);
    };
    refresh();
  }

  private async refreshPrices(): Promise<void> {
    const client = this.clients.get(1);
    const feeds = CHAINLINK_FEEDS[1];
    if (!client || !feeds) return;

    for (const [symbol, feedAddress] of Object.entries(feeds)) {
      const result = await client.readContract({ address: feedAddress, abi: AGGREGATOR_ABI, functionName: 'latestRoundData' });
      if (result && result[1] > 0n) {
        priceCache[symbol] = { price: Number(result[1]) / 1e8, timestamp: Date.now() };
      }
    }
  }

  async evaluate(intent: IntentEvaluation): Promise<EvaluationResult> {
    const { inputAmount, outputAmount, destinationChain, inputToken } = intent;

    if (BigInt(inputAmount) > BigInt(this.config.maxIntentSize)) {
      return { profitable: false, expectedProfitBps: 0, expectedProfitUsd: '0', reason: 'Intent exceeds max size' };
    }

    const inputValue = BigInt(inputAmount);
    const outputValue = BigInt(outputAmount);
    const fee = inputValue - outputValue;

    if (fee <= 0n) return { profitable: false, expectedProfitBps: 0, expectedProfitUsd: '0', reason: 'No fee or negative fee' };

    let gasCosts = GAS_COSTS[destinationChain];
    if (!gasCosts) return { profitable: false, expectedProfitBps: 0, expectedProfitUsd: '0', reason: 'Unknown destination chain' };

    const client = this.clients.get(destinationChain);
    if (client) gasCosts = { ...gasCosts, gasPrice: await client.getGasPrice() };

    if (gasCosts.gasPrice > this.config.maxGasPrice) {
      return { profitable: false, expectedProfitBps: 0, expectedProfitUsd: '0', reason: 'Gas price too high' };
    }

    const gasCost = gasCosts.fillGas * gasCosts.gasPrice;
    const netProfit = fee - gasCost;

    if (netProfit <= 0n) return { profitable: false, expectedProfitBps: 0, expectedProfitUsd: '0', reason: 'Gas costs exceed fee', gasEstimate: gasCost };

    const netProfitBps = Number((netProfit * 10000n) / inputValue);

    if (netProfitBps < this.config.minProfitBps) {
      return { profitable: false, expectedProfitBps: netProfitBps, expectedProfitUsd: this.calculateUsdValue(netProfit, inputToken), reason: `Profit ${netProfitBps} bps below minimum ${this.config.minProfitBps} bps`, gasEstimate: gasCost };
    }

    return { profitable: true, expectedProfitBps: netProfitBps, expectedProfitUsd: this.calculateUsdValue(netProfit, inputToken), gasEstimate: gasCost, route: `${intent.sourceChain} → ${destinationChain}` };
  }

  private calculateUsdValue(amount: bigint, token: string): string {
    const symbol = TOKEN_SYMBOLS[token.toLowerCase()] || 'ETH';
    const price = priceCache[symbol]?.price || 0;
    return ((Number(amount) / 1e18) * price).toFixed(2);
  }

  getPrice(token: string): number {
    const symbol = TOKEN_SYMBOLS[token.toLowerCase()] || 'ETH';
    return priceCache[symbol]?.price || 0;
  }

  async rankIntents(intents: IntentEvaluation[]): Promise<Array<{ intent: IntentEvaluation; evaluation: EvaluationResult }>> {
    const evaluated = await Promise.all(intents.map(async (intent) => ({ intent, evaluation: await this.evaluate(intent) })));
    return evaluated.filter(e => e.evaluation.profitable).sort((a, b) => b.evaluation.expectedProfitBps - a.evaluation.expectedProfitBps);
  }
}
