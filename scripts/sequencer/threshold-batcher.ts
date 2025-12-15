#!/usr/bin/env bun
/**
 * Threshold Batch Submitter Proxy
 * 
 * This service sits between op-batcher and L1, collecting threshold signatures
 * before submitting batches. It implements the actual decentralization layer
 * for batch submission.
 * 
 * Flow:
 * 1. op-batcher sends batch data to this proxy (instead of directly to L1)
 * 2. Proxy requests signatures from threshold signers
 * 3. Once threshold is met, proxy submits batch to ThresholdBatchSubmitter contract
 * 4. Contract verifies signatures and forwards to BatchInbox
 * 
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   THRESHOLD_BATCH_SUBMITTER_ADDRESS - ThresholdBatchSubmitter contract
 *   COORDINATOR_PRIVATE_KEY - Coordinator wallet for gas
 *   SIGNER_*_URL - URLs for threshold signers
 *   SIGNER_API_KEY - API key for signers
 *   THRESHOLD - Required number of signatures (default: 2)
 */

import { Hono } from 'hono';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

// Contract ABI
const THRESHOLD_BATCH_SUBMITTER_ABI = [
  'function submitBatch(bytes batchData, bytes[] signatures, address[] signers) external',
  'function nonce() external view returns (uint256)',
  'function threshold() external view returns (uint256)',
  'function isSequencer(address) external view returns (bool)',
  'function DOMAIN_SEPARATOR() external view returns (bytes32)',
  'function BATCH_TYPEHASH() external view returns (bytes32)',
  'event BatchSubmitted(bytes32 indexed batchHash, uint256 indexed nonce, address[] signers)',
];

interface SignerConfig {
  url: string;
  apiKey: string;
}

interface BatchRequest {
  id: string;
  data: string;
  hash: string;
  signatures: Map<string, string>;
  timestamp: number;
}

interface SignResponse {
  requestId: string;
  signature: string;
  signer: string;
  error?: string;
}

class ThresholdBatcherProxy {
  private app: Hono;
  private provider: ethers.JsonRpcProvider;
  private coordinatorWallet: ethers.Wallet;
  private contract: ethers.Contract;
  private signers: SignerConfig[];
  private threshold: number;
  private pendingBatches = new Map<string, BatchRequest>();
  private chainId: bigint = 0n;
  private domainSeparator: string = '';

  constructor(
    rpcUrl: string,
    contractAddress: string,
    coordinatorKey: string,
    signers: SignerConfig[],
    threshold: number
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.coordinatorWallet = new ethers.Wallet(coordinatorKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, THRESHOLD_BATCH_SUBMITTER_ABI, this.coordinatorWallet);
    this.signers = signers;
    this.threshold = threshold;
    this.app = new Hono();
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    this.chainId = (await this.provider.getNetwork()).chainId;
    this.domainSeparator = await this.contract.DOMAIN_SEPARATOR();
    
    // Verify threshold matches contract
    const contractThreshold = await this.contract.threshold();
    if (Number(contractThreshold) > this.threshold) {
      console.warn(`Warning: Contract threshold (${contractThreshold}) > configured threshold (${this.threshold})`);
    }
    
    console.log(`[ThresholdBatcher] Initialized`);
    console.log(`  Chain ID: ${this.chainId}`);
    console.log(`  Contract: ${await this.contract.getAddress()}`);
    console.log(`  Threshold: ${this.threshold}/${this.signers.length}`);
    console.log(`  Coordinator: ${this.coordinatorWallet.address}`);
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok', service: 'threshold-batcher' }));

    // Metrics
    this.app.get('/metrics', (c) => {
      return c.text([
        '# TYPE threshold_batcher_pending_batches gauge',
        `threshold_batcher_pending_batches ${this.pendingBatches.size}`,
        '# TYPE threshold_batcher_threshold gauge',
        `threshold_batcher_threshold ${this.threshold}`,
        '# TYPE threshold_batcher_signers gauge',
        `threshold_batcher_signers ${this.signers.length}`,
      ].join('\n'));
    });

    // Submit batch (called by op-batcher)
    this.app.post('/submit', async (c) => {
      try {
        const body = await c.req.json() as { data: string };
        if (!body.data) {
          return c.json({ error: 'Missing batch data' }, 400);
        }

        const result = await this.submitBatch(body.data);
        return c.json(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[ThresholdBatcher] Submit error:', errorMsg);
        return c.json({ error: errorMsg }, 500);
      }
    });

    // Get pending batches
    this.app.get('/pending', (c) => {
      const batches = Array.from(this.pendingBatches.values()).map(b => ({
        id: b.id,
        hash: b.hash,
        signatures: b.signatures.size,
        timestamp: b.timestamp,
      }));
      return c.json({ batches, threshold: this.threshold });
    });

    // Get status
    this.app.get('/status', async (c) => {
      const nonce = await this.contract.nonce();
      const balance = await this.provider.getBalance(this.coordinatorWallet.address);
      return c.json({
        nonce: Number(nonce),
        coordinatorBalance: ethers.formatEther(balance),
        pendingBatches: this.pendingBatches.size,
        threshold: this.threshold,
        signers: this.signers.length,
      });
    });
  }

  async submitBatch(batchData: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const batchHash = ethers.keccak256(batchData);
    const batchId = `${batchHash.slice(0, 10)}_${Date.now()}`;
    
    console.log(`\n[ThresholdBatcher] New batch: ${batchId}`);
    console.log(`  Data size: ${batchData.length / 2 - 1} bytes`);
    console.log(`  Hash: ${batchHash.slice(0, 20)}...`);

    // Create pending batch
    const batch: BatchRequest = {
      id: batchId,
      data: batchData,
      hash: batchHash,
      signatures: new Map(),
      timestamp: Date.now(),
    };
    this.pendingBatches.set(batchId, batch);

    // Get current nonce
    const nonce = await this.contract.nonce();
    
    // Create the digest for signing (EIP-712)
    const digest = this.computeBatchDigest(batchHash, nonce);
    console.log(`  Nonce: ${nonce}`);
    console.log(`  Digest: ${digest.slice(0, 20)}...`);

    // Collect signatures from threshold signers
    console.log(`  Collecting signatures (${this.threshold} required)...`);
    
    const signaturePromises = this.signers.map(async (signer, index) => {
      try {
        const requestId = `${batchId}_${index}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${signer.url}/sign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${signer.apiKey}`,
          },
          body: JSON.stringify({
            digest,
            requestId,
            timestamp: Date.now(),
            context: `batch_${batchId}`,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.log(`    Signer ${index + 1}: HTTP ${response.status}`);
          return null;
        }

        const result = await response.json() as SignResponse;
        if (result.error) {
          console.log(`    Signer ${index + 1}: ${result.error}`);
          return null;
        }

        console.log(`    ✓ Signer ${index + 1} (${result.signer.slice(0, 10)}...)`);
        return { signer: result.signer, signature: result.signature };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`    Signer ${index + 1}: ${errorMsg.slice(0, 30)}`);
        return null;
      }
    });

    const results = await Promise.all(signaturePromises);
    
    // Collect valid signatures
    const validSignatures: { signer: string; signature: string }[] = [];
    for (const result of results) {
      if (result) {
        batch.signatures.set(result.signer, result.signature);
        validSignatures.push(result);
      }
    }

    console.log(`  Collected ${validSignatures.length}/${this.threshold} signatures`);

    if (validSignatures.length < this.threshold) {
      this.pendingBatches.delete(batchId);
      return {
        success: false,
        error: `Insufficient signatures: ${validSignatures.length}/${this.threshold}`,
      };
    }

    // Submit to contract
    console.log(`  Submitting to contract...`);
    
    try {
      const signers = validSignatures.slice(0, this.threshold).map(s => s.signer);
      const signatures = validSignatures.slice(0, this.threshold).map(s => s.signature);

      const tx = await this.contract.submitBatch(batchData, signatures, signers);
      console.log(`  TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`  ✅ Confirmed in block ${receipt?.blockNumber}`);
      
      this.pendingBatches.delete(batchId);
      
      return {
        success: true,
        txHash: tx.hash,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Submission failed: ${errorMsg}`);
      this.pendingBatches.delete(batchId);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private computeBatchDigest(batchHash: string, nonce: bigint): string {
    // EIP-712 typed data hash
    const BATCH_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes('BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)')
    );

    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'uint256', 'uint256'],
        [BATCH_TYPEHASH, batchHash, nonce, this.chainId]
      )
    );

    return ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes('\x19\x01'),
        this.domainSeparator,
        structHash,
      ])
    );
  }

  getApp(): Hono {
    return this.app;
  }
}

// CLI
async function main(): Promise<void> {
  console.log('🔐 Threshold Batch Submitter Proxy\n');

  const network = process.env.NETWORK || 'localnet';
  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const port = parseInt(process.env.BATCHER_PROXY_PORT || '4200', 10);

  // Load contract address
  let contractAddress = process.env.THRESHOLD_BATCH_SUBMITTER_ADDRESS;
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    contractAddress = contractAddress || deployment.thresholdBatchSubmitter;
    console.log(`Loaded deployment from ${deploymentFile}`);
  }

  if (!contractAddress) {
    console.error('THRESHOLD_BATCH_SUBMITTER_ADDRESS required');
    process.exit(1);
  }

  // Load coordinator key
  const coordinatorKey = process.env.COORDINATOR_PRIVATE_KEY;
  if (!coordinatorKey) {
    console.error('COORDINATOR_PRIVATE_KEY required');
    process.exit(1);
  }

  // Configure signers
  const signerUrls = [
    process.env.SIGNER_1_URL || 'http://signer-1:4100',
    process.env.SIGNER_2_URL || 'http://signer-2:4100',
    process.env.SIGNER_3_URL || 'http://signer-3:4100',
  ].filter(Boolean);

  const apiKey = process.env.SIGNER_API_KEY || 'demo-key';
  const signers: SignerConfig[] = signerUrls.map(url => ({ url, apiKey }));
  const threshold = parseInt(process.env.THRESHOLD || '2', 10);

  // Create and start proxy
  const proxy = new ThresholdBatcherProxy(
    rpcUrl,
    contractAddress,
    coordinatorKey,
    signers,
    threshold
  );

  await proxy.initialize();

  const server = Bun.serve({
    port,
    fetch: proxy.getApp().fetch,
  });

  console.log(`\n🚀 Threshold Batcher Proxy running on port ${port}`);
  console.log(`   Submit batches to: POST http://localhost:${port}/submit`);
  console.log(`   Health: GET http://localhost:${port}/health`);
  console.log(`   Status: GET http://localhost:${port}/status\n`);

  process.on('SIGINT', () => { server.stop(); process.exit(0); });
  process.on('SIGTERM', () => { server.stop(); process.exit(0); });
}

if (import.meta.main) {
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

export { ThresholdBatcherProxy };

