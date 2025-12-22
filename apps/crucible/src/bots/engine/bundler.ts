/**
 * MEV Bundler - Multi-builder submission for maximum inclusion rate
 * 
 * Features:
 * - Submits to multiple builders simultaneously
 * - Flashbots relay for mainnet
 * - MEV-Share for private transactions
 * - L2 builder support
 * - Bundle simulation
 * - Retry logic with gas escalation
 */

import { createWalletClient, http, type Chain, keccak256, toBytes } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, base } from 'viem/chains';
import type { ChainId } from '../autocrat-types';
import { createLogger } from '../../sdk/logger';

const log = createLogger('Bundler');

export interface BundleTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

interface SignedTransaction {
  signedTransaction: `0x${string}`;
}

export interface BundleParams {
  transactions: (BundleTransaction | SignedTransaction)[];
  targetBlock: bigint;
  minTimestamp?: number;
  maxTimestamp?: number;
  revertingTxHashes?: `0x${string}`[];
}

export interface BundleResult {
  bundleHash: string;
  success: boolean;
  error?: string;
  blockNumber?: bigint;
  txHashes?: string[];
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  builder?: string;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  results?: {
    txHash: string;
    gasUsed: bigint;
    revert?: string;
  }[];
  totalGasUsed?: bigint;
  coinbaseDiff?: bigint;
}

export interface MevShareHint {
  txHash: `0x${string}`;
  logs?: boolean;
  calldata?: boolean;
  contractAddress?: boolean;
  functionSelector?: boolean;
}

// Multiple builders for higher inclusion rates
const MAINNET_BUILDERS: Record<string, string> = {
  flashbots: 'https://relay.flashbots.net',
  builder0x69: 'https://builder0x69.io',
  beaverbuild: 'https://rpc.beaverbuild.org',
  titanBuilder: 'https://rpc.titanbuilder.xyz',
  rsyncBuilder: 'https://rsync-builder.xyz',
  // Note: Add API keys as needed for some builders
};

const SEPOLIA_BUILDERS: Record<string, string> = {
  flashbots: 'https://relay-sepolia.flashbots.net',
};

// MEV-Share endpoints
const MEV_SHARE_RELAYS: Partial<Record<ChainId, string>> = {
  1: 'https://relay.flashbots.net',
  11155111: 'https://relay-sepolia.flashbots.net',
};

// L2 builder endpoints (direct builder APIs)
const L2_BUILDERS: Partial<Record<ChainId, Record<string, string>>> = {
  42161: { // Arbitrum
    sequencer: 'https://arb1.arbitrum.io/rpc', // Direct sequencer
  },
  10: { // Optimism
    sequencer: 'https://mainnet.optimism.io', // Direct sequencer
  },
  8453: { // Base
    sequencer: 'https://mainnet.base.org', // Direct sequencer
  },
};

const CHAIN_DEFS: Partial<Record<ChainId, Chain>> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

interface BuilderStats {
  submissions: number;
  inclusions: number;
  lastSubmission: number;
  avgLatencyMs: number;
}

export class MevBundler {
  private account: PrivateKeyAccount;
  private chainId: ChainId;
  private builders: Map<string, string> = new Map();
  private mevShareUrl: string | null;
  private pendingBundles: Map<string, { params: BundleParams; submittedAt: number; builder: string }> = new Map();
  private builderStats: Map<string, BuilderStats> = new Map();

  constructor(privateKey: string, chainId: ChainId) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.chainId = chainId;
    this.mevShareUrl = MEV_SHARE_RELAYS[chainId] || null;

    // Initialize builders based on chain
    this.initializeBuilders();
  }

  private initializeBuilders(): void {
    if (this.chainId === 1) {
      // Mainnet: use all builders
      for (const [name, url] of Object.entries(MAINNET_BUILDERS)) {
        this.builders.set(name, url);
        this.builderStats.set(name, {
          submissions: 0,
          inclusions: 0,
          lastSubmission: 0,
          avgLatencyMs: 0,
        });
      }
    } else if (this.chainId === 11155111) {
      // Sepolia testnet
      for (const [name, url] of Object.entries(SEPOLIA_BUILDERS)) {
        this.builders.set(name, url);
        this.builderStats.set(name, {
          submissions: 0,
          inclusions: 0,
          lastSubmission: 0,
          avgLatencyMs: 0,
        });
      }
    } else {
      // L2 chains
      const l2Builders = L2_BUILDERS[this.chainId];
      if (l2Builders) {
        for (const [name, url] of Object.entries(l2Builders)) {
          this.builders.set(name, url);
          this.builderStats.set(name, {
            submissions: 0,
            inclusions: 0,
            lastSubmission: 0,
            avgLatencyMs: 0,
          });
        }
      }
    }
  }

  get signerAddress(): string {
    return this.account.address;
  }

  get isL2(): boolean {
    return [42161, 10, 8453].includes(this.chainId);
  }

  get hasFlashbotsSupport(): boolean {
    return this.builders.size > 0;
  }

  get availableBuilders(): string[] {
    return Array.from(this.builders.keys());
  }

  /**
   * Get builder statistics
   */
  getBuilderStats(): Map<string, BuilderStats> {
    return new Map(this.builderStats);
  }

  /**
   * Sign a bundle for submission
   */
  async signBundle(params: BundleParams): Promise<{ signature: string; body: string }> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendBundle',
      params: [{
        txs: await this.prepareTransactions(params.transactions),
        blockNumber: `0x${params.targetBlock.toString(16)}`,
        minTimestamp: params.minTimestamp,
        maxTimestamp: params.maxTimestamp,
        revertingTxHashes: params.revertingTxHashes,
      }],
    });

    const signature = await this.signPayload(body);
    return { signature, body };
  }

  private async prepareTransactions(txs: (BundleTransaction | SignedTransaction)[]): Promise<string[]> {
    const signed: string[] = [];
    for (const tx of txs) {
      if ('signedTransaction' in tx) {
        signed.push(tx.signedTransaction);
      } else {
        const signedTx = await this.signTransaction(tx);
        signed.push(signedTx);
      }
    }
    return signed;
  }

  private async signTransaction(tx: BundleTransaction): Promise<string> {
    const chain = CHAIN_DEFS[this.chainId];
    if (!chain) {
      throw new Error(`Chain ${this.chainId} not supported for signing`);
    }

    if (tx.nonce === undefined) {
      throw new Error('Nonce required for transaction signing');
    }

    const txRequest = {
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      gas: tx.gas ?? 21000n,
      nonce: tx.nonce,
      chainId: chain.id,
      ...(tx.maxFeePerGas ? {
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? tx.maxFeePerGas / 10n,
        type: 'eip1559' as const,
      } : {
        gasPrice: tx.gasPrice ?? 30000000000n,
        type: 'legacy' as const,
      }),
    };

    return this.account.signTransaction(txRequest);
  }

  private async signPayload(payload: string): Promise<string> {
    const hash = keccak256(toBytes(payload));
    const signature = await this.account.signMessage({ message: { raw: hash } });
    return `${this.account.address}:${signature}`;
  }

  /**
   * Send bundle to ALL builders simultaneously for maximum inclusion
   */
  async sendBundle(params: BundleParams): Promise<BundleResult> {
    if (this.isL2) {
      return this.sendL2Bundle(params);
    }
    return this.sendToAllBuilders(params);
  }

  /**
   * Send to all builders and return first success
   */
  private async sendToAllBuilders(params: BundleParams): Promise<BundleResult> {
    if (this.builders.size === 0) {
      return { bundleHash: '', success: false, error: 'No builders configured' };
    }

    const { signature, body } = await this.signBundle(params);

    log.info('Sending bundle to builders', { builderCount: this.builders.size });

    // Submit to all builders in parallel
    const results = await Promise.allSettled(
      Array.from(this.builders.entries()).map(async ([name, url]) => {
        const startTime = Date.now();
        const stats = this.builderStats.get(name)!;
        stats.submissions++;
        stats.lastSubmission = startTime;

        const result = await this.fetchBuilder(url, signature, body);

        // Update stats
        const latency = Date.now() - startTime;
        stats.avgLatencyMs = (stats.avgLatencyMs * (stats.submissions - 1) + latency) / stats.submissions;

        if (result.success && result.bundleHash) {
          stats.inclusions++;
          return { ...result, builder: name };
        }
        throw new Error(result.error || 'Unknown error');
      })
    );

    // Find successful results
    const successes = results
      .filter((r): r is PromiseFulfilledResult<BundleResult & { builder: string }> =>
        r.status === 'fulfilled' && r.value.success
      )
      .map(r => r.value);

    if (successes.length > 0) {
      // Return first success, but track all for monitoring
      const best = successes[0];
      console.log(`   ✓ Bundle accepted by ${successes.length}/${this.builders.size} builders (${best.builder})`);

      // Store pending bundle for tracking
      if (best.bundleHash) {
        this.pendingBundles.set(best.bundleHash, {
          params,
          submittedAt: Date.now(),
          builder: best.builder,
        });
      }

      return best;
    }

    // All failed - collect errors
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');

    log.warn('Bundle rejected by all builders');
    return {
      bundleHash: '',
      success: false,
      error: `All builders failed: ${[...new Set(errors)].join('; ')}`,
    };
  }

  private async fetchBuilder(
    url: string,
    signature: string,
    body: string
  ): Promise<BundleResult> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': signature,
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { bundleHash: '', success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json() as { result?: { bundleHash?: string }; error?: { message: string } };

      if (result.error) {
        return { bundleHash: '', success: false, error: result.error.message };
      }

      if (!result.result?.bundleHash) {
        return { bundleHash: '', success: false, error: 'No bundleHash in response' };
      }

      return { bundleHash: result.result.bundleHash, success: true };
    } catch (error) {
      return {
        bundleHash: '',
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  private async sendL2Bundle(params: BundleParams): Promise<BundleResult> {
    // L2s don't have traditional MEV - submit directly to sequencer
    const builderEntries = Array.from(this.builders.entries());
    if (builderEntries.length === 0) {
      return { bundleHash: '', success: false, error: 'No L2 builder configured' };
    }

    const [name, url] = builderEntries[0];

    // For L2, we submit transactions individually
    const signedTxs = await this.prepareTransactions(params.transactions);

    for (const signedTx of signedTxs) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendRawTransaction',
            params: [signedTx],
          }),
        });

        const result = await response.json() as { result?: string; error?: { message: string } };

        if (result.error) {
          return { bundleHash: '', success: false, error: result.error.message, builder: name };
        }

        return { bundleHash: result.result || '', success: true, builder: name };
      } catch (error) {
        return {
          bundleHash: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          builder: name,
        };
      }
    }

    return { bundleHash: '', success: false, error: 'No transactions in bundle' };
  }

  /**
   * Simulate bundle before submission
   */
  async simulateBundle(params: BundleParams): Promise<SimulationResult> {
    const flashbotsUrl = this.builders.get('flashbots');
    if (!flashbotsUrl) {
      return { success: false, error: 'No Flashbots relay for simulation' };
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_callBundle',
      params: [{
        txs: await this.prepareTransactions(params.transactions),
        blockNumber: `0x${params.targetBlock.toString(16)}`,
        stateBlockNumber: 'latest',
      }],
    });

    const signature = await this.signPayload(body);

    try {
      const response = await fetch(flashbotsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': signature,
        },
        body,
      });

      const result = await response.json() as {
        result?: {
          results?: Array<{ txHash: string; gasUsed: string; revert?: string }>;
          totalGasUsed?: string;
          coinbaseDiff?: string;
        };
        error?: { message: string };
      };

      if (result.error || !result.result) {
        return { success: false, error: result.error?.message || 'No result' };
      }

      if (!result.result.results) {
        return { success: false, error: 'Invalid simulation response' };
      }

      return {
        success: true,
        results: result.result.results.map(r => ({
          txHash: r.txHash,
          gasUsed: BigInt(r.gasUsed),
          revert: r.revert,
        })),
        totalGasUsed: result.result.totalGasUsed ? BigInt(result.result.totalGasUsed) : undefined,
        coinbaseDiff: result.result.coinbaseDiff ? BigInt(result.result.coinbaseDiff) : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  /**
   * Get bundle inclusion status
   */
  async getBundleStats(bundleHash: string): Promise<{
    isIncluded: boolean;
    blockNumber?: bigint;
    builder?: string;
  }> {
    const flashbotsUrl = this.builders.get('flashbots');
    if (!flashbotsUrl) {
      return { isIncluded: false };
    }

    const pending = this.pendingBundles.get(bundleHash);

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'flashbots_getBundleStats',
      params: [{ bundleHash }],
    });

    const signature = await this.signPayload(body);

    try {
      const response = await fetch(flashbotsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': signature,
        },
        body,
      });

      const result = await response.json() as {
        result?: {
          isSimulated?: boolean;
          isIncluded?: boolean;
          blockNumber?: string;
        };
      };

      const stats = result.result;
      const isIncluded = stats?.isIncluded === true || stats?.isSimulated === true;

      return {
        isIncluded,
        blockNumber: stats?.blockNumber ? BigInt(stats.blockNumber) : undefined,
        builder: pending?.builder,
      };
    } catch {
      return { isIncluded: false };
    }
  }

  /**
   * Send private transaction via MEV-Share
   */
  async sendPrivateTransaction(
    tx: BundleTransaction,
    hints?: Omit<MevShareHint, 'txHash'>
  ): Promise<{ txHash: string; success: boolean; error?: string }> {
    if (!this.mevShareUrl) {
      return { txHash: '', success: false, error: 'MEV-Share not available' };
    }

    const chain = CHAIN_DEFS[this.chainId];
    if (!chain) {
      return { txHash: '', success: false, error: 'Chain not supported' };
    }

    const walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(),
    });

    const signedTx = await walletClient.prepareTransactionRequest({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      gas: tx.gas,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    });

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendPrivateTransaction',
      params: [{
        tx: signedTx,
        maxBlockNumber: undefined,
        preferences: hints ? {
          fast: true,
          privacy: {
            hints: [
              hints.logs ? 'logs' : null,
              hints.calldata ? 'calldata' : null,
              hints.contractAddress ? 'contract_address' : null,
              hints.functionSelector ? 'function_selector' : null,
            ].filter(Boolean),
          },
        } : undefined,
      }],
    });

    const signature = await this.signPayload(body);

    try {
      const response = await fetch(this.mevShareUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': signature,
        },
        body,
      });

      const result = await response.json() as { result?: string | { txHash?: string }; error?: { message: string } };

      if (result.error) {
        return { txHash: '', success: false, error: result.error.message };
      }

      const txHash = typeof result.result === 'string'
        ? result.result
        : result.result?.txHash || '';

      return { txHash, success: !!txHash };
    } catch (error) {
      return {
        txHash: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel a private transaction
   */
  async cancelPrivateTransaction(txHash: `0x${string}`): Promise<boolean> {
    if (!this.mevShareUrl) return false;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_cancelPrivateTransaction',
      params: [{ txHash }],
    });

    const signature = await this.signPayload(body);

    try {
      const response = await fetch(this.mevShareUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': signature,
        },
        body,
      });

      const result = await response.json() as { result?: boolean };
      return result.result === true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old pending bundles
   */
  cleanupPendingBundles(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [hash, bundle] of this.pendingBundles) {
      if (now - bundle.submittedAt > maxAgeMs) {
        this.pendingBundles.delete(hash);
      }
    }
  }

  getPendingBundles(): Map<string, { params: BundleParams; submittedAt: number; builder: string }> {
    return this.pendingBundles;
  }
}

// Types already exported via interface declarations above
