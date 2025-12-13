import { createWalletClient, http, type Account, type Chain, type Hash, keccak256, toHex, concat, toBytes, numberToHex } from 'viem';
import { privateKeyToAccount, signMessage } from 'viem/accounts';
import { mainnet, arbitrum, optimism, base } from 'viem/chains';
import type { ChainId } from '../types';

interface BundleTransaction {
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

interface BundleParams {
  transactions: (BundleTransaction | SignedTransaction)[];
  targetBlock: bigint;
  minTimestamp?: number;
  maxTimestamp?: number;
  revertingTxHashes?: `0x${string}`[];
}

interface BundleResult {
  bundleHash: string;
  success: boolean;
  error?: string;
  blockNumber?: bigint;
  txHashes?: string[];
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}

interface SimulationResult {
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

interface MevShareHint {
  txHash: `0x${string}`;
  logs?: boolean;
  calldata?: boolean;
  contractAddress?: boolean;
  functionSelector?: boolean;
}

// Flashbots relay endpoints by chain
const FLASHBOTS_RELAYS: Partial<Record<ChainId, string>> = {
  1: 'https://relay.flashbots.net',
  11155111: 'https://relay-sepolia.flashbots.net',
};

// MEV-Share endpoints
const MEV_SHARE_RELAYS: Partial<Record<ChainId, string>> = {
  1: 'https://relay.flashbots.net',
  11155111: 'https://relay-sepolia.flashbots.net',
};

// Builder relays for L2s (use direct builder APIs)
const L2_BUILDERS: Partial<Record<ChainId, string[]>> = {
  42161: ['https://arbitrum-builder.flashbots.net'],
  10: ['https://optimism-builder.flashbots.net'],
  8453: ['https://base-builder.flashbots.net'],
};

const CHAIN_DEFS: Partial<Record<ChainId, Chain>> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

export class MevBundler {
  private account: Account;
  private chainId: ChainId;
  private relayUrl: string;
  private mevShareUrl: string | null;
  private l2Builders: string[];
  private pendingBundles: Map<string, { params: BundleParams; submittedAt: number }> = new Map();

  constructor(privateKey: string, chainId: ChainId) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.chainId = chainId;
    this.relayUrl = FLASHBOTS_RELAYS[chainId] || '';
    this.mevShareUrl = MEV_SHARE_RELAYS[chainId] || null;
    this.l2Builders = L2_BUILDERS[chainId] || [];
  }

  get signerAddress(): string {
    return this.account.address;
  }

  get isL2(): boolean {
    return [42161, 10, 8453].includes(this.chainId);
  }

  get hasFlashbotsSupport(): boolean {
    return !!this.relayUrl || this.l2Builders.length > 0;
  }

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
        // Sign transaction without broadcasting
        const signedTx = await this.signTransaction(tx);
        signed.push(signedTx);
      }
    }
    return signed;
  }

  private async signTransaction(tx: BundleTransaction): Promise<string> {
    const chain = CHAIN_DEFS[this.chainId] || mainnet;
    
    // Build transaction request
    const txRequest = {
      to: tx.to,
      data: tx.data,
      value: tx.value || 0n,
      gas: tx.gas || 21000n,
      nonce: tx.nonce,
      chainId: chain.id,
      ...(tx.maxFeePerGas ? {
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas || tx.maxFeePerGas / 10n,
        type: 'eip1559' as const,
      } : {
        gasPrice: tx.gasPrice || 30000000000n,
        type: 'legacy' as const,
      }),
    };

    // Sign with account
    const signature = await this.account.signTransaction(txRequest);
    return signature;
  }

  private async signPayload(payload: string): Promise<string> {
    const hash = keccak256(toBytes(payload));
    const signature = await this.account.signMessage({ message: { raw: hash } });
    return `${this.account.address}:${signature}`;
  }

  async sendBundle(params: BundleParams): Promise<BundleResult> {
    if (this.isL2) {
      return this.sendL2Bundle(params);
    }
    return this.sendFlashbotsBundle(params);
  }

  private async sendFlashbotsBundle(params: BundleParams): Promise<BundleResult> {
    if (!this.relayUrl) {
      return { bundleHash: '', success: false, error: 'No Flashbots relay configured for this chain' };
    }

    const { signature, body } = await this.signBundle(params);
    const result = await this.fetchRelay(this.relayUrl, signature, body);

    if (result.error) {
      return { bundleHash: '', success: false, error: result.error.message };
    }

    const bundleHash = result.result.bundleHash;
    this.pendingBundles.set(bundleHash, { params, submittedAt: Date.now() });

    return { bundleHash, success: true };
  }

  private async sendL2Bundle(params: BundleParams): Promise<BundleResult> {
    if (this.l2Builders.length === 0) {
      return { bundleHash: '', success: false, error: 'No L2 builders configured for this chain' };
    }

    // Send to all L2 builders in parallel
    const results = await Promise.allSettled(
      this.l2Builders.map(builder => this.sendToBuilder(builder, params))
    );

    const successResult = results.find(r => r.status === 'fulfilled' && r.value.success);
    if (successResult && successResult.status === 'fulfilled') {
      return successResult.value;
    }

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');

    return { bundleHash: '', success: false, error: errors.join('; ') };
  }

  private async sendToBuilder(builderUrl: string, params: BundleParams): Promise<BundleResult> {
    const { signature, body } = await this.signBundle(params);
    const result = await this.fetchRelay(builderUrl, signature, body);

    if (result.error) {
      throw new Error(result.error.message);
    }

    return { bundleHash: result.result.bundleHash, success: true };
  }

  async simulateBundle(params: BundleParams): Promise<SimulationResult> {
    if (!this.relayUrl) {
      return { success: false, error: 'No relay configured for simulation' };
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

    const response = await fetch(this.relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body,
    });

    const result = await response.json();

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    const bundleResult = result.result;
    return {
      success: true,
      results: bundleResult.results?.map((r: { txHash: string; gasUsed: string; revert?: string }) => ({
        txHash: r.txHash,
        gasUsed: BigInt(r.gasUsed),
        revert: r.revert,
      })),
      totalGasUsed: BigInt(bundleResult.totalGasUsed || '0'),
      coinbaseDiff: BigInt(bundleResult.coinbaseDiff || '0'),
    };
  }

  async getBundleStats(bundleHash: string): Promise<{ isIncluded: boolean; blockNumber?: bigint }> {
    if (!this.relayUrl) {
      return { isIncluded: false };
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'flashbots_getBundleStats',
      params: [{ bundleHash }],
    });

    const signature = await this.signPayload(body);

    const response = await fetch(this.relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body,
    });

    const result = await response.json();
    if (result.error || !result.result) {
      return { isIncluded: false };
    }

    return {
      isIncluded: result.result.isSimulated === true,
      blockNumber: result.result.simulatedAt ? BigInt(result.result.simulatedAt) : undefined,
    };
  }

  async sendPrivateTransaction(tx: BundleTransaction, hints?: MevShareHint): Promise<{ txHash: string; success: boolean; error?: string }> {
    if (!this.mevShareUrl) {
      return { txHash: '', success: false, error: 'MEV-Share not available on this chain' };
    }

    const chain = CHAIN_DEFS[this.chainId] || mainnet;
    const walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(),
    });

    const signedTx = await walletClient.prepareTransactionRequest({
      to: tx.to,
      data: tx.data,
      value: tx.value || 0n,
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

    const response = await fetch(this.mevShareUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body,
    });

    const result = await response.json();
    if (result.error) {
      return { txHash: '', success: false, error: result.error.message };
    }

    return { txHash: result.result, success: true };
  }

  async cancelPrivateTransaction(txHash: `0x${string}`): Promise<boolean> {
    if (!this.mevShareUrl) return false;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_cancelPrivateTransaction',
      params: [{ txHash }],
    });

    const signature = await this.signPayload(body);

    const response = await fetch(this.mevShareUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body,
    });

    const result = await response.json();
    return result.result === true;
  }

  cleanupPendingBundles(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [hash, bundle] of this.pendingBundles) {
      if (now - bundle.submittedAt > maxAgeMs) {
        this.pendingBundles.delete(hash);
      }
    }
  }

  getPendingBundles(): Map<string, { params: BundleParams; submittedAt: number }> {
    return this.pendingBundles;
  }
}

export type { BundleTransaction, BundleParams, BundleResult, SimulationResult, MevShareHint };
