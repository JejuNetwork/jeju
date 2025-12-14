/**
 * Network Swap Service
 * Token swaps via the network solver network
 */

import type { Address, Hex } from 'viem';
import { SupportedChainId } from '../rpc';
import { oracleService, type TokenPrice } from '../oracle';

const JEJU_SOLVER_URL = import.meta.env.VITE_JEJU_SOLVER_URL || 'https://solver.jeju.network/api';

interface Token {
  chainId: SupportedChainId;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

interface SwapQuote {
  id: string;
  inputToken: Token;
  outputToken: Token;
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpact: number;
  route: SwapRoute[];
  estimatedGas: bigint;
  fee: { amount: bigint; token: Token };
  validUntil: number;
  provider: string;
}

interface SwapRoute {
  protocol: string;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee?: number;
}

interface SwapParams {
  inputToken: Token;
  outputToken: Token;
  inputAmount: bigint;
  slippage: number; // Percentage, e.g., 0.5 for 0.5%
  recipient?: Address;
  deadline?: number;
}

interface SwapResult {
  txHash: Hex;
  inputAmount: bigint;
  outputAmount: bigint;
  route: SwapRoute[];
  gasUsed: bigint;
  status: 'pending' | 'success' | 'failed';
}

// Cross-chain swap using OIF
interface CrossChainSwapParams {
  inputToken: Token;
  outputToken: Token;
  inputAmount: bigint;
  slippage: number;
  sourceChainId: SupportedChainId;
  destinationChainId: SupportedChainId;
  recipient?: Address;
}

interface CrossChainSwapQuote extends SwapQuote {
  sourceChainId: SupportedChainId;
  destinationChainId: SupportedChainId;
  bridgeFee: bigint;
  estimatedTime: number; // seconds
  intentId?: Hex;
}

class SwapService {
  private recentToTokens: Token[] = [];
  private defaultSlippage = 0.5;
  private preferMevProtection = true;

  async getQuote(params: SwapParams): Promise<SwapQuote[]> {
    const { inputToken, outputToken, inputAmount, slippage } = params;
    
    try {
      const response = await fetch(`${JEJU_SOLVER_URL}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputToken: { chainId: inputToken.chainId, address: inputToken.address },
          outputToken: { chainId: outputToken.chainId, address: outputToken.address },
          inputAmount: inputAmount.toString(),
          slippage,
          mevProtection: this.preferMevProtection,
        }),
      });

      if (!response.ok) throw new Error(`Quote error: ${response.status}`);
      const quotes = await response.json() as SwapQuote[];
      return quotes.map(q => ({
        ...q,
        inputAmount: BigInt(q.inputAmount),
        outputAmount: BigInt(q.outputAmount),
        estimatedGas: BigInt(q.estimatedGas),
        fee: { ...q.fee, amount: BigInt(q.fee.amount) },
      }));
    } catch (error) {
      // Fallback: estimate locally
      return [this.estimateQuoteLocally(params)];
    }
  }

  async getCrossChainQuote(params: CrossChainSwapParams): Promise<CrossChainSwapQuote[]> {
    const { inputToken, outputToken, inputAmount, slippage, sourceChainId, destinationChainId } = params;
    
    try {
      const response = await fetch(`${JEJU_SOLVER_URL}/cross-chain/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputToken: { chainId: inputToken.chainId, address: inputToken.address },
          outputToken: { chainId: outputToken.chainId, address: outputToken.address },
          inputAmount: inputAmount.toString(),
          slippage,
          sourceChainId,
          destinationChainId,
        }),
      });

      if (!response.ok) throw new Error(`Cross-chain quote error: ${response.status}`);
      return response.json();
    } catch {
      throw new Error('Cross-chain quotes unavailable');
    }
  }

  async executeSwap(quote: SwapQuote, signer: { signTransaction: (tx: object) => Promise<Hex> }): Promise<SwapResult> {
    // Get transaction data from solver
    const txResponse = await fetch(`${JEJU_SOLVER_URL}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId: quote.id }),
    });

    if (!txResponse.ok) throw new Error(`Swap error: ${txResponse.status}`);
    const txData = await txResponse.json() as { to: Address; data: Hex; value: string; gasLimit: string };

    // Sign and send transaction
    const signedTx = await signer.signTransaction({
      to: txData.to,
      data: txData.data,
      value: BigInt(txData.value),
      gasLimit: BigInt(txData.gasLimit),
    });

    // Submit to the network (MEV-protected)
    const submitResponse = await fetch(`${JEJU_SOLVER_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, mevProtection: this.preferMevProtection }),
    });

    if (!submitResponse.ok) throw new Error(`Submit error: ${submitResponse.status}`);
    const result = await submitResponse.json() as { txHash: Hex };

    // Track recent tokens
    this.addRecentToken(quote.outputToken);

    return {
      txHash: result.txHash,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      route: quote.route,
      gasUsed: quote.estimatedGas,
      status: 'pending',
    };
  }

  async executeCrossChainSwap(quote: CrossChainSwapQuote, signer: { signTransaction: (tx: object) => Promise<Hex> }): Promise<{ intentId: Hex; status: string }> {
    // Cross-chain swaps use network OIF
    const response = await fetch(`${JEJU_SOLVER_URL}/cross-chain/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId: quote.id }),
    });

    if (!response.ok) throw new Error(`Cross-chain swap error: ${response.status}`);
    const { intentData, intentId } = await response.json();

    // Sign intent
    const signedTx = await signer.signTransaction(intentData);

    // Submit intent
    const submitResponse = await fetch(`${JEJU_SOLVER_URL}/cross-chain/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, intentId }),
    });

    if (!submitResponse.ok) throw new Error(`Submit error: ${submitResponse.status}`);
    return { intentId, status: 'pending' };
  }

  private estimateQuoteLocally(params: SwapParams): SwapQuote {
    // Simple estimation - would be more sophisticated in production
    const { inputToken, outputToken, inputAmount } = params;
    const estimatedOutput = inputAmount * 99n / 100n; // 1% fee estimate
    
    return {
      id: `local-${Date.now()}`,
      inputToken,
      outputToken,
      inputAmount,
      outputAmount: estimatedOutput,
      priceImpact: 0.01,
      route: [],
      estimatedGas: 150000n,
      fee: { amount: inputAmount / 100n, token: inputToken },
      validUntil: Date.now() + 60000,
      provider: 'local-estimate',
    };
  }

  // Token list management
  async getPopularTokens(chainId: SupportedChainId): Promise<Token[]> {
    try {
      const response = await fetch(`${JEJU_SOLVER_URL}/tokens/${chainId}/popular`);
      return response.json();
    } catch {
      return [];
    }
  }

  async searchTokens(chainId: SupportedChainId, query: string): Promise<Token[]> {
    try {
      const response = await fetch(`${JEJU_SOLVER_URL}/tokens/${chainId}/search?q=${encodeURIComponent(query)}`);
      return response.json();
    } catch {
      return [];
    }
  }

  getRecentTokens(): Token[] {
    return this.recentToTokens.slice(0, 10);
  }

  private addRecentToken(token: Token) {
    this.recentToTokens = [token, ...this.recentToTokens.filter(t => t.address !== token.address)].slice(0, 10);
  }

  // Settings
  setSlippage(slippage: number) {
    this.defaultSlippage = slippage;
  }

  getSlippage(): number {
    return this.defaultSlippage;
  }

  setMevProtection(enabled: boolean) {
    this.preferMevProtection = enabled;
  }

  getMevProtection(): boolean {
    return this.preferMevProtection;
  }

  // Calculate minimum output
  calculateMinOutput(expectedOutput: bigint, slippagePercent: number): bigint {
    const slippageBps = BigInt(Math.floor(slippagePercent * 100));
    return expectedOutput * (10000n - slippageBps) / 10000n;
  }

  // Format amounts for display
  formatAmount(amount: bigint, decimals: number, maxDecimals = 4): string {
    const value = Number(amount) / Math.pow(10, decimals);
    if (value < 0.0001) return '< 0.0001';
    return value.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
  }
}

export const swapService = new SwapService();
export { SwapService };
export type { Token, SwapQuote, SwapParams, SwapResult, CrossChainSwapParams, CrossChainSwapQuote };

