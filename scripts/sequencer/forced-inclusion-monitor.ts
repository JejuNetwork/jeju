#!/usr/bin/env bun
/**
 * Forced Inclusion Monitor
 * 
 * Watches the ForcedInclusion contract and ensures sequencers include queued transactions
 * within the 50-block window. This is critical for Stage 2 censorship resistance.
 * 
 * Integration with op-batcher:
 * - Monitors TxQueued events from ForcedInclusion contract
 * - Alerts when transactions approach the inclusion deadline
 * - Can automatically force-include if sequencers fail
 * - Reports slashing opportunities for censoring sequencers
 * 
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   FORCED_INCLUSION_ADDRESS - ForcedInclusion contract address
 *   FORCER_PRIVATE_KEY - (optional) Wallet to force-include and earn rewards
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');

// ForcedInclusion ABI
const FORCED_INCLUSION_ABI = [
  'event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock)',
  'event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot)',
  'event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward)',
  'event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund)',
  'function queuedTxs(bytes32 txId) view returns (address sender, bytes data, uint256 gasLimit, uint256 fee, uint256 queuedAtBlock, uint256 queuedAtTimestamp, bool included, bool expired)',
  'function forceInclude(bytes32 txId) external',
  'function pendingTxIds(uint256 index) view returns (bytes32)',
  'function INCLUSION_WINDOW_BLOCKS() view returns (uint256)',
  'function MIN_FEE() view returns (uint256)',
];

interface QueuedTx {
  txId: string;
  sender: string;
  fee: bigint;
  queuedAtBlock: number;
  deadline: number;
  included: boolean;
  expired: boolean;
}

interface MonitorStats {
  txQueued: number;
  txIncluded: number;
  txForced: number;
  txExpired: number;
  pendingCount: number;
  alertCount: number;
}

class ForcedInclusionMonitor {
  private pendingTxs = new Map<string, QueuedTx>();
  private stats: MonitorStats = { txQueued: 0, txIncluded: 0, txForced: 0, txExpired: 0, pendingCount: 0, alertCount: 0 };
  private isRunning = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private provider: ethers.Provider,
    private forcedInclusion: ethers.Contract,
    private forcerWallet: ethers.Wallet | null,
    private inclusionWindow: bigint,
    private alertThreshold = 10,
    private checkInterval = 12000
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('📡 Forced Inclusion Monitor Started');
    console.log(`   Contract: ${await this.forcedInclusion.getAddress()}`);
    console.log(`   Inclusion window: ${this.inclusionWindow} blocks`);
    console.log(`   Alert threshold: ${this.alertThreshold} blocks before deadline`);
    if (this.forcerWallet) {
      console.log(`   Forcer wallet: ${this.forcerWallet.address}`);
    } else {
      console.log('   Forcer wallet: NONE (monitoring only)');
    }
    console.log('');

    // Listen for events
    this.forcedInclusion.on('TxQueued', this.handleTxQueued.bind(this));
    this.forcedInclusion.on('TxIncluded', this.handleTxIncluded.bind(this));
    this.forcedInclusion.on('TxForced', this.handleTxForced.bind(this));
    this.forcedInclusion.on('TxExpired', this.handleTxExpired.bind(this));

    // Start periodic checks
    this.pollInterval = setInterval(() => this.checkPendingTxs(), this.checkInterval);

    console.log('🔍 Monitoring for queued transactions...\n');
  }

  stop(): void {
    this.isRunning = false;
    this.forcedInclusion.removeAllListeners();
    if (this.pollInterval) clearInterval(this.pollInterval);
    console.log('\nMonitor stopped');
    this.printStats();
  }

  private handleTxQueued(txId: string, sender: string, fee: bigint, queuedAtBlock: bigint): void {
    this.stats.txQueued++;
    const deadline = Number(queuedAtBlock) + Number(this.inclusionWindow);
    
    this.pendingTxs.set(txId, {
      txId,
      sender,
      fee,
      queuedAtBlock: Number(queuedAtBlock),
      deadline,
      included: false,
      expired: false,
    });
    this.stats.pendingCount = this.pendingTxs.size;

    console.log(`📥 [QUEUED] ${txId.slice(0, 10)}...`);
    console.log(`   Sender: ${sender.slice(0, 10)}...`);
    console.log(`   Fee: ${ethers.formatEther(fee)} ETH`);
    console.log(`   Deadline: block ${deadline}`);
    console.log('');
  }

  private handleTxIncluded(txId: string, sequencer: string, batchRoot: string): void {
    this.stats.txIncluded++;
    const tx = this.pendingTxs.get(txId);
    if (tx) {
      tx.included = true;
      this.pendingTxs.delete(txId);
      this.stats.pendingCount = this.pendingTxs.size;
    }

    console.log(`✅ [INCLUDED] ${txId.slice(0, 10)}...`);
    console.log(`   Sequencer: ${sequencer.slice(0, 10)}...`);
    console.log(`   Batch: ${batchRoot.slice(0, 20)}...`);
    console.log('');
  }

  private handleTxForced(txId: string, forcer: string, reward: bigint): void {
    this.stats.txForced++;
    const tx = this.pendingTxs.get(txId);
    if (tx) {
      tx.included = true;
      this.pendingTxs.delete(txId);
      this.stats.pendingCount = this.pendingTxs.size;
    }

    console.log(`⚡ [FORCED] ${txId.slice(0, 10)}...`);
    console.log(`   Forcer: ${forcer.slice(0, 10)}...`);
    console.log(`   Reward: ${ethers.formatEther(reward)} ETH`);
    console.log('   ⚠️  Sequencer failed to include - slashing may apply');
    console.log('');
  }

  private handleTxExpired(txId: string, sender: string, refund: bigint): void {
    this.stats.txExpired++;
    const tx = this.pendingTxs.get(txId);
    if (tx) {
      tx.expired = true;
      this.pendingTxs.delete(txId);
      this.stats.pendingCount = this.pendingTxs.size;
    }

    console.log(`⏰ [EXPIRED] ${txId.slice(0, 10)}...`);
    console.log(`   Sender: ${sender.slice(0, 10)}...`);
    console.log(`   Refund: ${ethers.formatEther(refund)} ETH`);
    console.log('');
  }

  private async checkPendingTxs(): Promise<void> {
    if (this.pendingTxs.size === 0) return;

    const currentBlock = await this.provider.getBlockNumber();

    for (const [txId, tx] of this.pendingTxs) {
      const blocksRemaining = tx.deadline - currentBlock;

      // Alert if approaching deadline
      if (blocksRemaining <= this.alertThreshold && blocksRemaining > 0) {
        this.stats.alertCount++;
        console.log(`🚨 [ALERT] ${txId.slice(0, 10)}... - ${blocksRemaining} blocks until deadline!`);
        console.log(`   Sequencers should include this transaction immediately`);
        console.log('');
      }

      // Force include if past deadline and we have a forcer wallet
      if (blocksRemaining <= 0 && this.forcerWallet && !tx.included && !tx.expired) {
        await this.tryForceInclude(txId);
      }
    }
  }

  private async tryForceInclude(txId: string): Promise<void> {
    if (!this.forcerWallet) return;

    console.log(`⚡ Attempting to force-include ${txId.slice(0, 10)}...`);

    try {
      const contract = this.forcedInclusion.connect(this.forcerWallet) as ethers.Contract;
      const tx = await contract.forceInclude(txId);
      console.log(`   TX submitted: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Force-included in block ${receipt?.blockNumber}`);
      console.log(`   💰 Check wallet for reward`);
      console.log('');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('TxAlreadyIncluded')) {
        console.log(`   Already included by sequencer`);
      } else if (errorMsg.includes('WindowNotExpired')) {
        console.log(`   Window not yet expired`);
      } else {
        console.log(`   Failed: ${errorMsg.slice(0, 50)}`);
      }
      console.log('');
    }
  }

  printStats(): void {
    console.log('\n📊 Monitor Statistics:');
    console.log(`   Transactions queued: ${this.stats.txQueued}`);
    console.log(`   Transactions included: ${this.stats.txIncluded}`);
    console.log(`   Transactions forced: ${this.stats.txForced}`);
    console.log(`   Transactions expired: ${this.stats.txExpired}`);
    console.log(`   Currently pending: ${this.stats.pendingCount}`);
    console.log(`   Deadline alerts: ${this.stats.alertCount}`);
  }
}

// ============================================================
// OP-BATCHER INTEGRATION HELPER
// ============================================================

/**
 * Gets pending forced transactions that the batcher should include
 * This function should be called by op-batcher before creating a batch
 */
export async function getPendingForcedTxs(
  provider: ethers.Provider,
  forcedInclusionAddress: string
): Promise<Array<{ txId: string; sender: string; data: string; gasLimit: bigint; deadline: number }>> {
  const contract = new ethers.Contract(forcedInclusionAddress, FORCED_INCLUSION_ABI, provider);
  const currentBlock = await provider.getBlockNumber();
  const inclusionWindow = await contract.INCLUSION_WINDOW_BLOCKS();
  
  const pendingTxs: Array<{ txId: string; sender: string; data: string; gasLimit: bigint; deadline: number }> = [];
  
  // Get all queued transactions by listening to past events
  const filter = contract.filters.TxQueued();
  const events = await contract.queryFilter(filter, currentBlock - Number(inclusionWindow) - 10);
  
  for (const event of events) {
    const txId = event.args?.[0] as string;
    const queuedAtBlock = event.args?.[3] as bigint;
    
    // Check if still pending
    const txData = await contract.queuedTxs(txId);
    if (!txData.included && !txData.expired) {
      const deadline = Number(queuedAtBlock) + Number(inclusionWindow);
      
      // Prioritize transactions close to deadline
      if (deadline - currentBlock <= 25) { // Last 25 blocks
        pendingTxs.push({
          txId,
          sender: txData.sender,
          data: txData.data,
          gasLimit: txData.gasLimit,
          deadline,
        });
      }
    }
  }
  
  // Sort by deadline (soonest first)
  pendingTxs.sort((a, b) => a.deadline - b.deadline);
  
  return pendingTxs;
}

/**
 * Generates the batch data that includes a forced transaction
 * This should be integrated into op-batcher's batch building logic
 */
export function generateForcedTxBatchData(
  sender: string,
  data: string,
  gasLimit: bigint
): string {
  // Format: 0x7e (forced tx marker) + sender + gasLimit + data
  const encoded = ethers.solidityPacked(
    ['bytes1', 'address', 'uint256', 'bytes'],
    ['0x7e', sender, gasLimit, data]
  );
  return encoded;
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  console.log('📡 Forced Inclusion Monitor\n');

  const network = process.env.NETWORK || 'localnet';
  const l1RpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const alertThreshold = parseInt(process.env.ALERT_THRESHOLD || '10', 10);
  const checkInterval = parseInt(process.env.CHECK_INTERVAL || '12000', 10);

  let forcedInclusionAddress = process.env.FORCED_INCLUSION_ADDRESS;
  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`);
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    forcedInclusionAddress = forcedInclusionAddress || deployment.forcedInclusion;
    console.log(`Loaded deployment from ${deploymentFile}`);
  }

  if (!forcedInclusionAddress) {
    console.error('FORCED_INCLUSION_ADDRESS required');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(l1RpcUrl);
  const forcedInclusion = new ethers.Contract(forcedInclusionAddress, FORCED_INCLUSION_ABI, provider);

  // Optional forcer wallet for automatic force-inclusion
  let forcerWallet: ethers.Wallet | null = null;
  const forcerKey = process.env.FORCER_PRIVATE_KEY;
  if (forcerKey) {
    forcerWallet = new ethers.Wallet(forcerKey, provider);
    const balance = await provider.getBalance(forcerWallet.address);
    console.log(`Forcer wallet: ${forcerWallet.address}`);
    console.log(`Forcer balance: ${ethers.formatEther(balance)} ETH`);
  }

  const inclusionWindow = await forcedInclusion.INCLUSION_WINDOW_BLOCKS();
  console.log(`Inclusion window: ${inclusionWindow} blocks`);
  console.log('');

  const monitor = new ForcedInclusionMonitor(
    provider,
    forcedInclusion,
    forcerWallet,
    inclusionWindow,
    alertThreshold,
    checkInterval
  );

  process.on('SIGINT', () => { monitor.stop(); process.exit(0); });
  process.on('SIGTERM', () => { monitor.stop(); process.exit(0); });

  await monitor.start();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

