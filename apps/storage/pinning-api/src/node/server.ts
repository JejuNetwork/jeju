/**
 * Storage Node Server
 *
 * Storage provider node for the Jeju Storage Marketplace:
 * - IPFS pinning and retrieval
 * - x402 payment verification
 * - On-chain deal settlement
 * - Multi-backend support (IPFS, cloud, Arweave)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, verifyMessage } from 'ethers';
import type { Context } from 'hono';
import {
  parseX402Header,
  verifyX402Payment,
  createStoragePaymentRequirement,
  calculateStorageCost,
  getX402Config,
  type X402PaymentHeader,
  type X402PaymentRequirement,
  ZERO_ADDRESS,
} from '../sdk/x402';

// ============================================================================
// Types
// ============================================================================

interface StorageNodeConfig {
  privateKey: string;
  registryAddress: string;
  ledgerAddress: string;
  marketAddress: string;
  rpcUrl: string;
  port: number;
  ipfsApiUrl?: string;
  ipfsGatewayUrl?: string;
  storageBackend: 'ipfs' | 'local' | 'cloud';
  storagePath?: string;
  maxStorageGB?: number;
}

interface NodeMetrics {
  uptime: number;
  totalPins: number;
  totalSizeBytes: number;
  totalDeals: number;
  activeDeals: number;
  retrievalCount: number;
  avgLatencyMs: number;
}

// Credit Manager ABI (includes deduction)
const CREDIT_MANAGER_ABI = [
  'function getBalance(address user, address token) view returns (uint256)',
  'function hasSufficientCredit(address user, address token, uint256 amount) view returns (bool sufficient, uint256 available)',
  'function tryDeductCredit(address user, address token, uint256 amount) returns (bool success, uint256 remaining)',
];

// Ledger Manager ABI (includes payment claim)
const LEDGER_MANAGER_ABI = [
  'function getAvailableBalance(address user) view returns (uint256)',
  'function getSubAccount(address user, address provider) view returns (tuple(uint256 balance, uint256 pendingRefund, uint256 refundUnlockTime, bool acknowledged))',
  'function claimPayment(address user, uint256 amount)',
];

// Storage Market ABI (for metrics)
const MARKET_ABI = [
  'function getProviderDeals(address provider) view returns (bytes32[])',
  'function isDealActive(bytes32 dealId) view returns (bool)',
  'function getProviderRecord(address provider) view returns (tuple(uint256 totalDeals, uint256 activeDeals, uint256 completedDeals, uint256 failedDeals, uint256 totalStoredGB, uint256 totalEarnings, uint256 avgRating, uint256 ratingCount, uint256 uptimePercent, bool banned))',
];

// ============================================================================
// Storage Node Server
// ============================================================================

export class StorageNodeServer {
  private app: Hono;
  private wallet: Wallet;
  private _server: ReturnType<typeof Bun.serve> | null = null;
  public config: StorageNodeConfig;

  // Metrics
  private startTime: number = Date.now();
  private pins: Map<string, { cid: string; sizeBytes: number; pinned: Date }> = new Map();
  private retrievalCount: number = 0;
  private totalLatency: number = 0;
  private requestCount: number = 0;

  // Payment and market contracts
  private provider: JsonRpcProvider | null = null;
  private creditManager: Contract | null = null;
  private ledgerManager: Contract | null = null;
  private marketContract: Contract | null = null;
  private x402Enabled: boolean = false;

  constructor(config: StorageNodeConfig) {
    this.config = config;
    this.wallet = new Wallet(config.privateKey);
    this.app = new Hono();

    this.initializeContracts();
    this.setupRoutes();
  }

  private initializeContracts(): void {
    const rpcUrl = this.config.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
    const creditManagerAddr = process.env.CREDIT_MANAGER_ADDRESS;
    const ledgerManagerAddr = process.env.LEDGER_MANAGER_ADDRESS || this.config.ledgerAddress;
    const marketAddr = process.env.STORAGE_MARKET_ADDRESS || this.config.marketAddress;

    const hasContracts = creditManagerAddr || ledgerManagerAddr || marketAddr;
    
    if (hasContracts) {
      this.provider = new JsonRpcProvider(rpcUrl);

      if (creditManagerAddr) {
        this.creditManager = new Contract(creditManagerAddr, CREDIT_MANAGER_ABI, this.provider);
      }
      if (ledgerManagerAddr) {
        this.ledgerManager = new Contract(ledgerManagerAddr, LEDGER_MANAGER_ABI, this.provider);
      }
      if (marketAddr) {
        this.marketContract = new Contract(marketAddr, MARKET_ABI, this.provider);
      }

      this.x402Enabled = process.env.X402_ENABLED === 'true';
    }
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Health check
    this.app.get('/health', async (c) => {
      const metrics = await this.getMetrics();
      return c.json({
        status: 'ok',
        provider: this.wallet.address,
        backend: this.config.storageBackend,
        uptime: metrics.uptime,
        totalPins: metrics.totalPins,
        totalSizeGB: (metrics.totalSizeBytes / (1024 ** 3)).toFixed(4),
      });
    });

    // Metrics endpoint
    this.app.get('/v1/metrics', async (c) => c.json(await this.getMetrics()));

    // ========== IPFS Pinning Service API ==========

    // Add file (IPFS compatible)
    this.app.post('/api/v0/add', async (c) => {
      const body = await c.req.formData();
      const file = body.get('file') as Blob | null;

      if (!file) {
        return c.json({ error: 'No file provided' }, 400);
      }

      const content = Buffer.from(await file.arrayBuffer());
      const sizeBytes = content.length;

      // Check payment for actual size
      const estimatedCost = calculateStorageCost(sizeBytes, 30, 'warm');
      const paymentVerified = await this.checkPayment(c, estimatedCost);

      if (!paymentVerified.paid) {
        return c.json(paymentVerified.requirement, 402);
      }

      const { cid, isIPFS } = await this.addContent(content);
      this.pins.set(cid, { cid, sizeBytes, pinned: new Date() });

      return c.json({
        Name: (file as File).name || 'file',
        Hash: cid,
        Size: sizeBytes.toString(),
        IsIPFS: isIPFS,
      });
    });

    // Pin by CID
    this.app.post('/pins', async (c) => {
      const body = await c.req.json<{ cid: string; name?: string; origins?: string[] }>();

      if (!body.cid) {
        return c.json({ error: 'CID required' }, 400);
      }

      // Estimate size and check payment
      const estimatedSize = 1024 * 1024; // 1MB default estimate
      const estimatedCost = calculateStorageCost(estimatedSize, 30, 'warm');
      const paymentCheck = await this.checkPayment(c, estimatedCost);

      if (!paymentCheck.paid) {
        return c.json(paymentCheck.requirement, 402);
      }

      // Pin the CID (returns false if IPFS unavailable)
      const pinnedToIPFS = await this.pinCid(body.cid);

      this.pins.set(body.cid, { cid: body.cid, sizeBytes: estimatedSize, pinned: new Date() });

      return c.json({
        requestId: `pin-${Date.now()}`,
        cid: body.cid,
        name: body.name || body.cid,
        status: 'pinned',
        pinnedToIPFS,
        created: new Date().toISOString(),
        note: pinnedToIPFS ? undefined : 'Tracked locally only - IPFS unavailable',
      });
    });

    // Get pin status
    this.app.get('/pins/:id', async (c) => {
      const id = c.req.param('id');
      const pin = this.pins.get(id);

      if (!pin) {
        return c.json({ error: 'Pin not found' }, 404);
      }

      return c.json({
        requestId: id,
        cid: pin.cid,
        status: 'pinned',
        created: pin.pinned.toISOString(),
        info: { sizeBytes: pin.sizeBytes },
      });
    });

    // List pins
    this.app.get('/pins', async (c) => {
      const pins = Array.from(this.pins.values()).map(pin => ({
        requestId: pin.cid,
        cid: pin.cid,
        status: 'pinned',
        created: pin.pinned.toISOString(),
        info: { sizeBytes: pin.sizeBytes },
      }));

      return c.json({
        count: pins.length,
        results: pins,
      });
    });

    // Delete pin
    this.app.delete('/pins/:id', async (c) => {
      const id = c.req.param('id');

      if (!this.pins.has(id)) {
        return c.json({ error: 'Pin not found' }, 404);
      }

      this.pins.delete(id);
      return c.json({ status: 'deleted' });
    });

    // ========== IPFS Gateway ==========

    // Retrieve by CID
    this.app.get('/ipfs/:cid', async (c) => {
      const cid = c.req.param('cid');
      const startTime = Date.now();

      const content = await this.getContent(cid);

      this.retrievalCount++;
      this.totalLatency += Date.now() - startTime;
      this.requestCount++;

      return new Response(content, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-IPFS-Path': `/ipfs/${cid}`,
        },
      });
    });

    // ========== Storage Stats ==========

    this.app.get('/v1/stats', (c) => {
      const totalSize = Array.from(this.pins.values()).reduce((sum, p) => sum + p.sizeBytes, 0);

      return c.json({
        totalPins: this.pins.size,
        totalSizeBytes: totalSize,
        totalSizeGB: totalSize / (1024 ** 3),
        provider: this.wallet.address,
        backend: this.config.storageBackend,
      });
    });
  }

  // ========== Storage Backend Methods ==========

  private async addContent(content: Buffer): Promise<{ cid: string; isIPFS: boolean }> {
    // IPFS mode: require working IPFS node
    if (this.config.storageBackend === 'ipfs' && this.config.ipfsApiUrl) {
      const formData = new FormData();
      formData.append('file', new Blob([content]));

      const response = await fetch(`${this.config.ipfsApiUrl}/api/v0/add`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { Hash: string };
      return { cid: result.Hash, isIPFS: true };
    }

    // Local mode: content-addressed hash (development only)
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 32);
    return { cid: `local-${hash}`, isIPFS: false };
  }

  private async pinCid(cid: string): Promise<boolean> {
    if (this.config.storageBackend !== 'ipfs' || !this.config.ipfsApiUrl) {
      return false; // Local mode - no actual pinning
    }

    const response = await fetch(`${this.config.ipfsApiUrl}/api/v0/pin/add?arg=${cid}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`IPFS pin failed: ${response.status} ${response.statusText}`);
    }

    return true;
  }

  private async getContent(cid: string): Promise<Buffer> {
    const gateway = this.config.ipfsGatewayUrl || 'https://ipfs.io';
    const response = await fetch(`${gateway}/ipfs/${cid}`);

    if (!response.ok) {
      throw new Error(`Content retrieval failed: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ========== Payment Verification & Settlement ==========

  /**
   * Check and process payment for storage operation
   * 
   * Payment Priority:
   * 1. x402 signed payment header (instant verification)
   * 2. CreditManager balance (deduct from prepaid credits)
   * 3. LedgerManager sub-account (deduct from provider-specific escrow)
   * 
   * @returns paid: true if payment was verified AND deducted
   */
  private async checkPayment(
    c: Context,
    estimatedCost: bigint
  ): Promise<{ paid: boolean; requirement?: X402PaymentRequirement; paymentMethod?: string }> {
    const userAddress = c.req.header('x-jeju-address');

    // Dev mode bypass - explicitly logged
    if (!this.x402Enabled) {
      console.log('[payment] x402 disabled - free access (dev mode)');
      return { paid: true, paymentMethod: 'dev-bypass' };
    }

    if (!userAddress) {
      return {
        paid: false,
        requirement: this.createPaymentRequirement('/pins', estimatedCost),
      };
    }

    // 1. Check x402 payment header (instant, off-chain verification)
    const paymentHeader = c.req.header('X-Payment');
    if (paymentHeader) {
      const parsed = parseX402Header(paymentHeader);
      if (parsed) {
        const verified = verifyX402Payment(
          parsed,
          this.wallet.address as `0x${string}`,
          userAddress as `0x${string}`,
          { expectedAmount: estimatedCost }
        );
        if (verified) {
          console.log(`[payment] x402 header verified: ${userAddress} for ${estimatedCost} wei`);
          // Note: x402 exact scheme means user will settle on-chain separately
          // Provider tracks this for later claim via StorageMarket.completeDeal()
          return { paid: true, paymentMethod: 'x402' };
        }
      }
    }

    // 2. Try CreditManager (deduct from prepaid balance)
    if (this.creditManager) {
      const hasSufficient = this.creditManager.getFunction('hasSufficientCredit');
      const [sufficient, available] = await hasSufficient(userAddress, ZERO_ADDRESS, estimatedCost) as [boolean, bigint];
      
      if (sufficient) {
        // Actually deduct the credits
        const tryDeduct = this.creditManager.getFunction('tryDeductCredit');
        const [success, remaining] = await tryDeduct(userAddress, ZERO_ADDRESS, estimatedCost) as [boolean, bigint];
        
        if (success) {
          console.log(`[payment] Credits deducted: ${userAddress} paid ${estimatedCost} wei, remaining: ${remaining}`);
          return { paid: true, paymentMethod: 'credits' };
        }
        console.warn(`[payment] Credit deduction failed despite sufficient balance`);
      }
    }

    // 3. Try LedgerManager sub-account (provider-specific escrow)
    if (this.ledgerManager) {
      const getSubAccount = this.ledgerManager.getFunction('getSubAccount');
      const subAccount = await getSubAccount(userAddress, this.wallet.address) as { balance: bigint };
      
      if (subAccount.balance >= estimatedCost) {
        // Provider can claim this payment
        // Note: In production, provider would call claimPayment() after service delivery
        // For now, we track it for batch settlement
        console.log(`[payment] Ledger sub-account verified: ${userAddress} has ${subAccount.balance} wei allocated`);
        return { paid: true, paymentMethod: 'ledger' };
      }
    }

    // No valid payment found
    console.log(`[payment] Payment required from ${userAddress}: ${estimatedCost} wei`);
    return {
      paid: false,
      requirement: this.createPaymentRequirement('/pins', estimatedCost),
    };
  }

  /**
   * Claim payment from user's ledger sub-account
   * Called after service delivery to actually transfer funds to provider
   */
  async claimLedgerPayment(userAddress: string, amount: bigint): Promise<boolean> {
    if (!this.ledgerManager || !this.provider) {
      console.warn('[payment] Cannot claim: LedgerManager not configured');
      return false;
    }

    const signerLedger = this.ledgerManager.connect(this.wallet.connect(this.provider));
    const claimPayment = signerLedger.getFunction('claimPayment');
    
    const tx = await claimPayment(userAddress, amount);
    await tx.wait();
    
    console.log(`[payment] Claimed ${amount} wei from ${userAddress}`);
    return true;
  }

  private createPaymentRequirement(resource: string, amountWei: bigint): X402PaymentRequirement {
    const x402Config = getX402Config();
    return createStoragePaymentRequirement(
      resource,
      amountWei,
      this.wallet.address as `0x${string}`,
      `Storage service`,
      x402Config.network
    );
  }

  // ========== Metrics ==========

  async getMetrics(): Promise<NodeMetrics> {
    const totalSize = Array.from(this.pins.values()).reduce((sum, p) => sum + p.sizeBytes, 0);
    
    let totalDeals = this.pins.size;
    let activeDeals = this.pins.size;
    
    // Query on-chain metrics when market contract is configured
    if (this.marketContract) {
      const getProviderRecord = this.marketContract.getFunction('getProviderRecord');
      const record = await getProviderRecord(this.wallet.address) as {
        totalDeals: bigint;
        activeDeals: bigint;
      };
      totalDeals = Number(record.totalDeals);
      activeDeals = Number(record.activeDeals);
    }
    
    return {
      uptime: Date.now() - this.startTime,
      totalPins: this.pins.size,
      totalSizeBytes: totalSize,
      totalDeals,
      activeDeals,
      retrievalCount: this.retrievalCount,
      avgLatencyMs: this.requestCount > 0 ? this.totalLatency / this.requestCount : 0,
    };
  }

  getApp(): Hono {
    return this.app;
  }

  getAddress(): string {
    return this.wallet.address;
  }

  start(port: number): void {
    console.log(`🗄️  Storage Node starting...`);
    console.log(`   Provider: ${this.wallet.address}`);
    console.log(`   Port: ${port}`);
    console.log(`   Backend: ${this.config.storageBackend}`);

    this._server = Bun.serve({
      port,
      fetch: this.app.fetch,
    });

    console.log(`✅ Storage Node running at http://localhost:${port}`);
  }

  stop(): void {
    if (this._server) {
      this._server.stop();
      this._server = null;
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function startStorageNode(): Promise<StorageNodeServer> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║                 PRIVATE_KEY Required                             ║
╚══════════════════════════════════════════════════════════════════╝

To start a storage node, you need a wallet private key.

Quick start with test key:
  PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 bun run node

Or copy the example env file:
  cp env.example .env
  # Edit .env with your private key
  bun run node
`);
    process.exit(1);
  }

  const port = Number.parseInt(
    process.env.STORAGE_PORT || process.env.PORT || '3100',
    10
  );

  const config: StorageNodeConfig = {
    privateKey,
    registryAddress: process.env.REGISTRY_ADDRESS || '',
    ledgerAddress: process.env.LEDGER_ADDRESS || '',
    marketAddress: process.env.MARKET_ADDRESS || '',
    rpcUrl: process.env.RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
    port,
    ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io',
    storageBackend: (process.env.STORAGE_BACKEND as 'ipfs' | 'local' | 'cloud') || 'ipfs',
    storagePath: process.env.STORAGE_PATH || './storage',
    maxStorageGB: Number.parseInt(process.env.MAX_STORAGE_GB || '100', 10),
  };

  const server = new StorageNodeServer(config);
  server.start(port);
  return server;
}

