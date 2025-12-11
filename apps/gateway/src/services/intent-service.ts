import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import type { 
  Intent, 
  IntentQuote,
  OIFStats,
  SupportedChainId
} from '@jejunetwork/types/oif';
import * as chainService from './chain-service';
import { ZERO_ADDRESS } from '../lib/contracts.js';

// In-memory cache for intents
const intentCache: Map<string, Intent> = new Map();

// Stats cache
let statsCache: OIFStats = {
  totalIntents: 0,
  totalVolume: '0',
  totalVolumeUsd: '0',
  totalFees: '0',
  totalFeesUsd: '0',
  totalSolvers: 0,
  activeSolvers: 0,
  totalSolverStake: '0',
  totalRoutes: 0,
  activeRoutes: 0,
  avgFillTimeSeconds: 0,
  successRate: 0,
  last24hIntents: 0,
  last24hVolume: '0',
  last24hFees: '0',
  lastUpdated: Date.now(),
};

interface CreateIntentParams {
  sourceChain: number;
  destinationChain: number;
  sourceToken: string;
  destinationToken: string;
  amount: string;
  recipient?: string;
  maxFee?: string;
}

interface QuoteParams {
  sourceChain: number;
  destinationChain: number;
  sourceToken: string;
  destinationToken: string;
  amount: string;
}

interface ListIntentsParams {
  user?: string;
  status?: string;
  sourceChain?: number;
  destinationChain?: number;
  limit?: number;
}

export class IntentService {
  private chainWatchers: Array<() => void> = [];
  
  constructor() {
    this.startChainWatchers();
    this.refreshStats();
  }

  private startChainWatchers(): void {
    const chains = [1, 42161, 10, 11155111];
    
    for (const chainId of chains) {
      const unwatch = chainService.watchOrders(chainId, (log) => {
        const intent: Intent = {
          intentId: log.orderId,
          user: log.user,
          nonce: '0',
          sourceChainId: chainId as SupportedChainId,
          openDeadline: 0,
          fillDeadline: 0,
          inputs: [{
            token: ZERO_ADDRESS,
            amount: log.inputAmount.toString(),
            chainId: chainId as SupportedChainId,
          }],
          outputs: [],
          signature: '0x',
          status: 'open',
          createdAt: Date.now(),
        };
        
        intentCache.set(log.orderId, intent);
        console.log(`[IntentService] New intent: ${log.orderId.slice(0, 10)}...`);
      });
      
      this.chainWatchers.push(unwatch);
    }
  }

  private async refreshStats(): Promise<void> {
    const registryStats = await chainService.fetchRegistryStats();
    
    if (registryStats) {
      statsCache = {
        ...statsCache,
        totalSolverStake: registryStats.totalStaked.toString(),
        activeSolvers: Number(registryStats.activeSolvers),
        totalSolvers: Number(registryStats.activeSolvers),
        lastUpdated: Date.now(),
      };
    }
    
    setTimeout(() => this.refreshStats(), 30000);
  }

  async createIntent(params: CreateIntentParams): Promise<Intent> {
    const now = Date.now();
    const intentId = keccak256(
      encodeAbiParameters(
        parseAbiParameters('address, uint256, uint256, uint256'),
        [
          params.recipient as `0x${string}` || ZERO_ADDRESS,
          BigInt(params.sourceChain),
          BigInt(params.amount),
          BigInt(now),
        ]
      )
    );

    const intent: Intent = {
      intentId,
      user: params.recipient || ZERO_ADDRESS,
      nonce: now.toString(),
      sourceChainId: params.sourceChain as SupportedChainId,
      openDeadline: Math.floor(now / 1000) + 300,
      fillDeadline: Math.floor(now / 1000) + 3600,
      inputs: [{
        token: params.sourceToken as `0x${string}`,
        amount: params.amount,
        chainId: params.sourceChain as SupportedChainId,
      }],
      outputs: [{
        token: params.destinationToken as `0x${string}`,
        amount: params.amount,
        recipient: (params.recipient || params.sourceToken) as `0x${string}`,
        chainId: params.destinationChain as SupportedChainId,
      }],
      signature: '0x',
      status: 'open',
      createdAt: now,
    };

    intentCache.set(intentId, intent);
    statsCache.totalIntents++;
    statsCache.last24hIntents++;

    return intent;
  }

  async getQuotes(params: QuoteParams): Promise<IntentQuote[]> {
    const quotes: IntentQuote[] = [];
    
    const quoteId = keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint256, uint256, uint256'),
        [BigInt(params.sourceChain), BigInt(params.destinationChain), BigInt(Date.now())]
      )
    );

    const inputAmount = BigInt(params.amount);
    const isL2ToL2 = params.sourceChain > 1 && params.destinationChain > 1;
    const feePercent = isL2ToL2 ? 30 : 50;
    const fee = (inputAmount * BigInt(feePercent)) / 10000n;
    const outputAmount = inputAmount - fee;

    quotes.push({
      quoteId,
      sourceChainId: params.sourceChain as SupportedChainId,
      destinationChainId: params.destinationChain as SupportedChainId,
      sourceToken: params.sourceToken as `0x${string}`,
      destinationToken: params.destinationToken as `0x${string}`,
      inputAmount: params.amount,
      outputAmount: outputAmount.toString(),
      fee: fee.toString(),
      feePercent,
      priceImpact: 10,
      estimatedFillTimeSeconds: isL2ToL2 ? 15 : 30,
      validUntil: Math.floor(Date.now() / 1000) + 300,
      solver: ZERO_ADDRESS,
      solverReputation: 0,
    });

    return quotes;
  }

  async getIntent(intentId: string): Promise<Intent | undefined> {
    let intent = intentCache.get(intentId);
    if (intent) return intent;

    for (const chainId of [1, 42161, 10, 11155111]) {
      const order = await chainService.fetchOrder(chainId, intentId as `0x${string}`);
      if (order && order.user !== ZERO_ADDRESS) {
        intent = {
          intentId: intentId as `0x${string}`,
          user: order.user,
          nonce: '0',
          sourceChainId: chainId as SupportedChainId,
          openDeadline: order.openDeadline,
          fillDeadline: order.fillDeadline,
          inputs: [{
            token: order.inputToken,
            amount: order.inputAmount.toString(),
            chainId: chainId as SupportedChainId,
          }],
          outputs: [{
            token: order.outputToken,
            amount: order.outputAmount.toString(),
            recipient: order.recipient,
            chainId: Number(order.destinationChainId) as SupportedChainId,
          }],
          signature: '0x',
          status: order.filled ? 'filled' : order.refunded ? 'expired' : 'open',
          createdAt: Number(order.createdBlock) * 12000,
          filledAt: order.filled ? Date.now() : undefined,
          solver: order.solver !== ZERO_ADDRESS ? order.solver : undefined,
        };
        intentCache.set(intentId, intent);
        return intent;
      }
    }

    return undefined;
  }

  async cancelIntent(intentId: string, user: string): Promise<{ success: boolean; message: string }> {
    const intent = intentCache.get(intentId);
    if (!intent) {
      return { success: false, message: 'Intent not found' };
    }
    if (intent.user.toLowerCase() !== user.toLowerCase()) {
      return { success: false, message: 'Not authorized' };
    }
    if (intent.status !== 'open') {
      return { success: false, message: 'Intent cannot be cancelled' };
    }
    
    intent.status = 'expired';
    return { success: true, message: 'Intent marked for cancellation' };
  }

  async listIntents(params?: ListIntentsParams): Promise<Intent[]> {
    let intents = Array.from(intentCache.values());

    if (params?.user) {
      intents = intents.filter(i => i.user.toLowerCase() === params.user!.toLowerCase());
    }
    if (params?.status) {
      intents = intents.filter(i => i.status === params.status);
    }
    if (params?.sourceChain) {
      intents = intents.filter(i => i.sourceChainId === params.sourceChain);
    }
    if (params?.limit) {
      intents = intents.slice(0, params.limit);
    }

    return intents.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async getStats(): Promise<OIFStats> {
    return {
      ...statsCache,
      totalIntents: intentCache.size,
      lastUpdated: Date.now(),
    };
  }

  async getChainStats(chainId: number): Promise<{
    totalIntents: number;
    totalVolume: string;
    avgFillTime: number;
    successRate: number;
  }> {
    const chainIntents = Array.from(intentCache.values()).filter(
      i => i.sourceChainId === chainId
    );
    
    const totalVolume = chainIntents.reduce(
      (sum, i) => sum + BigInt(i.inputs[0]?.amount || '0'),
      0n
    );

    const filledIntents = chainIntents.filter(i => i.status === 'filled');
    const failedIntents = chainIntents.filter(i => i.status === 'expired');
    const totalCompleted = filledIntents.length + failedIntents.length;

    const avgFillTime = filledIntents.length > 0
      ? filledIntents.reduce((sum, i) => {
          const fillTime = (i.filledAt || Date.now()) - (i.createdAt || Date.now());
          return sum + fillTime / 1000;
        }, 0) / filledIntents.length
      : 0;

    const successRate = totalCompleted > 0
      ? (filledIntents.length / totalCompleted) * 100
      : 0;

    return {
      totalIntents: chainIntents.length,
      totalVolume: totalVolume.toString(),
      avgFillTime: Math.round(avgFillTime),
      successRate: Math.round(successRate * 10) / 10,
    };
  }

  destroy(): void {
    for (const unwatch of this.chainWatchers) {
      unwatch();
    }
  }
}

// Export singleton instance
export const intentService = new IntentService();



