/**
 * Network Swap Service
 * Token swaps via the network solver network
 */

import type { Address, Hex } from 'viem';
import type { Token } from '../../sdk/types';
import { SupportedChainId } from '../rpc';

const JEJU_SOLVER_URL = import.meta.env.VITE_JEJU_SOLVER_URL || 'https://solver.jejunetwork.org/api';

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
      // Re-throw with context - swap quotes are critical for user transactions
      throw new Error(`Failed to get swap quote: ${error instanceof Error ? error.message : String(error)}`);
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

  // Token list management
  async getPopularTokens(chainId: SupportedChainId): Promise<Token[]> {
    const response = await fetch(`${JEJU_SOLVER_URL}/tokens/${chainId}/popular`);
    if (!response.ok) {
      throw new Error(`Failed to fetch popular tokens: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async searchTokens(chainId: SupportedChainId, query: string): Promise<Token[]> {
    const response = await fetch(`${JEJU_SOLVER_URL}/tokens/${chainId}/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`Failed to search tokens: ${response.status} ${response.statusText}`);
    }
    return response.json();
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

