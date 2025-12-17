/**
 * Arweave Backend - Permanent decentralized storage
 * 
 * User-selected permanent storage on Arweave.
 * No API keys required - uses Arweave wallets for payment.
 */

import { createHash } from 'crypto';
import type { 
  StorageBackendType, 
  ContentTier,
  ContentCategory,
} from './types';

// ============================================================================
// Types
// ============================================================================

interface ArweaveTransaction {
  id: string;
  owner: string;
  target: string;
  quantity: string;
  data: string;
  tags: Array<{ name: string; value: string }>;
  signature: string;
}

interface ArweaveWallet {
  kty: string;
  n: string;
  e: string;
  d?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
}

interface ArweaveBackendConfig {
  gateway: string;
  bundlerUrl?: string;
  wallet?: ArweaveWallet;
  timeout: number;
}

// ============================================================================
// Arweave Backend
// ============================================================================

export class ArweaveBackend {
  readonly name = 'arweave';
  readonly type: StorageBackendType = 'arweave';
  
  private gateway: string;
  private bundlerUrl: string;
  private wallet: ArweaveWallet | null = null;
  private timeout: number;

  constructor(config: Partial<ArweaveBackendConfig> = {}) {
    this.gateway = config.gateway ?? process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net';
    this.bundlerUrl = config.bundlerUrl ?? process.env.ARWEAVE_BUNDLER ?? 'https://node2.bundlr.network';
    this.timeout = config.timeout ?? 60000;
    
    if (config.wallet) {
      this.wallet = config.wallet;
    } else if (process.env.ARWEAVE_WALLET_JSON) {
      this.wallet = JSON.parse(process.env.ARWEAVE_WALLET_JSON) as ArweaveWallet;
    }
  }

  /**
   * Upload content to Arweave (permanent storage)
   */
  async upload(
    content: Buffer,
    options?: {
      filename?: string;
      contentType?: string;
      tags?: Record<string, string>;
      tier?: ContentTier;
      category?: ContentCategory;
    }
  ): Promise<{ txId: string; url: string; cost: string }> {
    // Calculate content hash for deduplication
    const contentHash = createHash('sha256').update(content).digest('hex');
    
    // Check if content already exists
    const existing = await this.findByHash(contentHash);
    if (existing) {
      console.log(`[Arweave] Content already exists: ${existing}`);
      return {
        txId: existing,
        url: `${this.gateway}/${existing}`,
        cost: '0',
      };
    }

    // Build transaction tags
    const tags: Array<{ name: string; value: string }> = [
      { name: 'Content-Type', value: options?.contentType ?? 'application/octet-stream' },
      { name: 'Content-SHA256', value: contentHash },
      { name: 'App-Name', value: 'Jeju-DWS' },
      { name: 'App-Version', value: '1.0.0' },
    ];
    
    if (options?.filename) {
      tags.push({ name: 'File-Name', value: options.filename });
    }
    if (options?.tier) {
      tags.push({ name: 'Jeju-Tier', value: options.tier });
    }
    if (options?.category) {
      tags.push({ name: 'Jeju-Category', value: options.category });
    }
    if (options?.tags) {
      for (const [name, value] of Object.entries(options.tags)) {
        tags.push({ name, value });
      }
    }

    // Try bundler first (faster, batched transactions)
    const bundlerResult = await this.uploadViaBundler(content, tags);
    if (bundlerResult) {
      return bundlerResult;
    }

    // Fall back to direct Arweave upload
    return this.uploadDirect(content, tags);
  }

  /**
   * Upload via bundler service (Bundlr/Irys)
   */
  private async uploadViaBundler(
    content: Buffer,
    tags: Array<{ name: string; value: string }>
  ): Promise<{ txId: string; url: string; cost: string } | null> {
    if (!this.wallet) {
      console.log('[Arweave] No wallet configured, cannot use bundler');
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const response = await fetch(`${this.bundlerUrl}/tx/arweave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-tags': JSON.stringify(tags),
      },
      body: content,
      signal: controller.signal,
    }).catch((e: Error) => {
      console.warn(`[Arweave] Bundler upload failed: ${e.message}`);
      return null;
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!response?.ok) {
      return null;
    }

    const result = await response.json() as { id: string; price?: string };
    
    return {
      txId: result.id,
      url: `${this.gateway}/${result.id}`,
      cost: result.price ?? '0',
    };
  }

  /**
   * Direct upload to Arweave (slower, requires AR tokens)
   */
  private async uploadDirect(
    content: Buffer,
    tags: Array<{ name: string; value: string }>
  ): Promise<{ txId: string; url: string; cost: string }> {
    // For direct uploads, we need a wallet
    if (!this.wallet) {
      throw new Error('Arweave wallet required for direct uploads');
    }

    // Get price
    const priceResponse = await fetch(`${this.gateway}/price/${content.length}`);
    if (!priceResponse.ok) {
      throw new Error('Failed to get Arweave price');
    }
    const price = await priceResponse.text();

    // Create and sign transaction
    const tx = await this.createTransaction(content, tags);
    const signedTx = await this.signTransaction(tx);
    
    // Submit transaction
    const submitResponse = await fetch(`${this.gateway}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedTx),
    });

    if (!submitResponse.ok) {
      throw new Error(`Arweave submit failed: ${submitResponse.statusText}`);
    }

    return {
      txId: signedTx.id,
      url: `${this.gateway}/${signedTx.id}`,
      cost: price,
    };
  }

  /**
   * Download content from Arweave
   */
  async download(txId: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const response = await fetch(`${this.gateway}/${txId}`, {
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!response.ok) {
      throw new Error(`Arweave download failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Check if transaction exists
   */
  async exists(txId: string): Promise<boolean> {
    const response = await fetch(`${this.gateway}/tx/${txId}/status`).catch(() => null);
    if (!response?.ok) return false;
    
    const status = await response.json() as { number_of_confirmations?: number };
    return (status.number_of_confirmations ?? 0) > 0;
  }

  /**
   * Get transaction status
   */
  async getStatus(txId: string): Promise<{
    confirmed: boolean;
    confirmations: number;
    blockHeight?: number;
  }> {
    const response = await fetch(`${this.gateway}/tx/${txId}/status`);
    if (!response.ok) {
      return { confirmed: false, confirmations: 0 };
    }

    const status = await response.json() as {
      number_of_confirmations?: number;
      block_height?: number;
    };

    return {
      confirmed: (status.number_of_confirmations ?? 0) > 0,
      confirmations: status.number_of_confirmations ?? 0,
      blockHeight: status.block_height,
    };
  }

  /**
   * Get transaction metadata
   */
  async getMetadata(txId: string): Promise<{
    id: string;
    owner: string;
    tags: Record<string, string>;
    dataSize: number;
    timestamp?: number;
  } | null> {
    const response = await fetch(`${this.gateway}/tx/${txId}`);
    if (!response.ok) return null;

    const tx = await response.json() as ArweaveTransaction;
    
    const tags: Record<string, string> = {};
    for (const tag of tx.tags) {
      const name = Buffer.from(tag.name, 'base64').toString();
      const value = Buffer.from(tag.value, 'base64').toString();
      tags[name] = value;
    }

    return {
      id: tx.id,
      owner: tx.owner,
      tags,
      dataSize: tx.data.length,
    };
  }

  /**
   * Find content by SHA256 hash (deduplication)
   */
  async findByHash(sha256: string): Promise<string | null> {
    const query = `
      query {
        transactions(
          tags: [
            { name: "Content-SHA256", values: ["${sha256}"] },
            { name: "App-Name", values: ["Jeju-DWS"] }
          ],
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    const response = await fetch(`${this.gateway}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }).catch(() => null);

    if (!response?.ok) return null;

    const result = await response.json() as {
      data?: {
        transactions?: {
          edges?: Array<{ node: { id: string } }>;
        };
      };
    };

    const edges = result.data?.transactions?.edges;
    if (edges && edges.length > 0 && edges[0]) {
      return edges[0].node.id;
    }

    return null;
  }

  /**
   * Query content by tags
   */
  async queryByTags(
    tags: Array<{ name: string; values: string[] }>,
    options?: { first?: number; after?: string }
  ): Promise<Array<{ id: string; tags: Record<string, string> }>> {
    const tagsQuery = tags.map(t => 
      `{ name: "${t.name}", values: ${JSON.stringify(t.values)} }`
    ).join(', ');

    const query = `
      query {
        transactions(
          tags: [${tagsQuery}],
          first: ${options?.first ?? 100}
          ${options?.after ? `, after: "${options.after}"` : ''}
        ) {
          edges {
            node {
              id
              tags {
                name
                value
              }
            }
          }
        }
      }
    `;

    const response = await fetch(`${this.gateway}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) return [];

    const result = await response.json() as {
      data?: {
        transactions?: {
          edges?: Array<{
            node: {
              id: string;
              tags: Array<{ name: string; value: string }>;
            };
          }>;
        };
      };
    };

    return (result.data?.transactions?.edges ?? []).map(edge => {
      const tags: Record<string, string> = {};
      for (const tag of edge.node.tags) {
        const name = Buffer.from(tag.name, 'base64').toString();
        const value = Buffer.from(tag.value, 'base64').toString();
        tags[name] = value;
      }
      return { id: edge.node.id, tags };
    });
  }

  /**
   * Estimate upload cost
   */
  async estimateCost(sizeBytes: number): Promise<{ ar: string; usd: string }> {
    const [priceResponse, rateResponse] = await Promise.all([
      fetch(`${this.gateway}/price/${sizeBytes}`),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd')
        .catch(() => null),
    ]);

    if (!priceResponse.ok) {
      throw new Error('Failed to get Arweave price');
    }

    const winstonPrice = await priceResponse.text();
    const arPrice = (parseInt(winstonPrice, 10) / 1e12).toFixed(12);

    let usdPrice = '0';
    if (rateResponse?.ok) {
      const rates = await rateResponse.json() as { arweave?: { usd?: number } };
      const arUsd = rates.arweave?.usd ?? 0;
      usdPrice = (parseFloat(arPrice) * arUsd).toFixed(4);
    }

    return { ar: arPrice, usd: usdPrice };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    const response = await fetch(`${this.gateway}/info`).catch(() => null);
    return response?.ok ?? false;
  }

  // ============================================================================
  // Transaction Helpers
  // ============================================================================

  private async createTransaction(
    data: Buffer,
    tags: Array<{ name: string; value: string }>
  ): Promise<ArweaveTransaction> {
    // This is a simplified version - real implementation would use arweave-js
    const dataBase64 = data.toString('base64url');
    
    return {
      id: '',
      owner: this.wallet?.n ?? '',
      target: '',
      quantity: '0',
      data: dataBase64,
      tags: tags.map(t => ({
        name: Buffer.from(t.name).toString('base64url'),
        value: Buffer.from(t.value).toString('base64url'),
      })),
      signature: '',
    };
  }

  private async signTransaction(tx: ArweaveTransaction): Promise<ArweaveTransaction> {
    // Simplified - real implementation would use RSA-PSS signing
    const txData = JSON.stringify({
      owner: tx.owner,
      target: tx.target,
      quantity: tx.quantity,
      data: tx.data,
      tags: tx.tags,
    });
    
    const hash = createHash('sha256').update(txData).digest('hex');
    tx.id = hash.slice(0, 43); // Arweave IDs are 43 chars
    tx.signature = hash; // Placeholder
    
    return tx;
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalArweaveBackend: ArweaveBackend | null = null;

export function getArweaveBackend(config?: Partial<ArweaveBackendConfig>): ArweaveBackend {
  if (!globalArweaveBackend) {
    globalArweaveBackend = new ArweaveBackend(config);
  }
  return globalArweaveBackend;
}

export function resetArweaveBackend(): void {
  globalArweaveBackend = null;
}


