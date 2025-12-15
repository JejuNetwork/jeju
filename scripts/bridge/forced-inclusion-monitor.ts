#!/usr/bin/env bun
/**
 * Forced Inclusion Monitor - Anti-censorship enforcement
 * 
 * ENV: L1_RPC_URL, FORCED_INCLUSION_ADDRESS, MONITOR_PRIVATE_KEY (optional)
 */

import { ethers } from 'ethers';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DEPLOYMENTS_DIR = join(import.meta.dir, '../../packages/contracts/deployments');

const ABI = [
  'function queuedTxs(bytes32) view returns (address sender, bytes data, uint256 gasLimit, uint256 fee, uint256 queuedAtBlock, uint256 queuedAtTimestamp, bool included, bool expired)',
  'function INCLUSION_WINDOW_BLOCKS() view returns (uint256)',
  'function canForceInclude(bytes32) view returns (bool)',
  'function forceInclude(bytes32)',
  'function getOverdueTxs() view returns (bytes32[])',
  'function getPendingCount() view returns (uint256)',
  'event TxQueued(bytes32 indexed txId, address indexed sender, uint256 fee, uint256 queuedAtBlock)',
  'event TxIncluded(bytes32 indexed txId, address indexed sequencer, bytes32 batchRoot)',
  'event TxForced(bytes32 indexed txId, address indexed forcer, uint256 reward)',
  'event TxExpired(bytes32 indexed txId, address indexed sender, uint256 refund)'
];

interface QueuedTx { txId: string; queuedAtBlock: bigint; included: boolean; expired: boolean; fee: bigint }

class ForcedInclusionMonitor {
  private pending = new Map<string, QueuedTx>();
  private stats = { monitored: 0, included: 0, forced: 0, expired: 0, rewards: 0n };
  private running = false;

  constructor(
    private provider: ethers.Provider,
    private contract: ethers.Contract,
    private wallet: ethers.Wallet | null,
    private window: bigint,
    private alertBlocks = 10,
    private interval = 12000
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;

    console.log(`📋 Monitor: ${await this.contract.getAddress()} | Window: ${this.window} blocks`);
    if (this.wallet) console.log(`   Executor: ${this.wallet.address}`);

    this.contract.on('TxQueued', (id: string, sender: string, fee: bigint, block: bigint) => {
      console.log(`📥 Queued ${id.slice(0, 10)}... from ${sender}, ${ethers.formatEther(fee)} ETH, due block ${block + this.window}`);
      this.pending.set(id, { txId: id, queuedAtBlock: block, included: false, expired: false, fee });
      this.stats.monitored++;
    });

    this.contract.on('TxIncluded', (id: string, seq: string) => {
      console.log(`✅ Included ${id.slice(0, 10)}... by ${seq}`);
      this.pending.delete(id);
      this.stats.included++;
    });

    this.contract.on('TxForced', (id: string, forcer: string, reward: bigint) => {
      console.log(`⚡ Forced ${id.slice(0, 10)}... reward ${ethers.formatEther(reward)} ETH`);
      if (this.wallet?.address.toLowerCase() === forcer.toLowerCase()) this.stats.rewards += reward;
      this.pending.delete(id);
      this.stats.forced++;
    });

    this.contract.on('TxExpired', (id: string) => { this.pending.delete(id); this.stats.expired++; });

    await this.loadOverdue();
    this.startLoop();
  }

  stop() {
    this.running = false;
    this.contract.removeAllListeners();
    console.log(`📊 Stats: ${this.stats.monitored} monitored, ${this.stats.included} included, ${this.stats.forced} forced, ${this.stats.expired} expired, ${ethers.formatEther(this.stats.rewards)} ETH earned`);
  }

  private async loadOverdue() {
    const overdue = await this.contract.getOverdueTxs().catch(() => []);
    for (const id of overdue) {
      const tx = await this.contract.queuedTxs(id);
      this.pending.set(id, { txId: id, queuedAtBlock: tx.queuedAtBlock, included: tx.included, expired: tx.expired, fee: tx.fee });
    }
    if (overdue.length > 0) console.log(`⚠️  ${overdue.length} overdue txs`);
  }

  private startLoop() {
    setInterval(async () => {
      if (!this.running) return;
      const block = await this.provider.getBlockNumber();

      for (const [id, tx] of this.pending) {
        if (tx.included || tx.expired) { this.pending.delete(id); continue; }
        const remaining = Number(tx.queuedAtBlock) + Number(this.window) - block;
        if (remaining > 0 && remaining <= this.alertBlocks) console.log(`⚠️  ${id.slice(0, 10)}... ${remaining} blocks left`);

        if (await this.contract.canForceInclude(id) && this.wallet) {
          console.log(`🔨 Force-including ${id.slice(0, 10)}...`);
          try {
            const tx = await this.contract.connect(this.wallet).forceInclude(id);
            await tx.wait();
            console.log(`   ✓ Done`);
          } catch (e) { console.error(`   ✗ Failed:`, e); }
        }
      }
    }, this.interval);
  }
}

async function main() {
  const network = process.env.NETWORK || 'localnet';
  const rpc = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  let addr = process.env.FORCED_INCLUSION_ADDRESS;

  const file = join(DEPLOYMENTS_DIR, `${network}.json`);
  if (existsSync(file)) addr = addr || JSON.parse(readFileSync(file, 'utf-8')).forcedInclusion;
  if (!addr) { console.error('FORCED_INCLUSION_ADDRESS required'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = process.env.MONITOR_PRIVATE_KEY ? new ethers.Wallet(process.env.MONITOR_PRIVATE_KEY, provider) : null;
  const contract = new ethers.Contract(addr, ABI, provider);
  const window = await contract.INCLUSION_WINDOW_BLOCKS();

  const monitor = new ForcedInclusionMonitor(provider, contract, wallet, window);
  process.on('SIGINT', () => { monitor.stop(); process.exit(0); });
  process.on('SIGTERM', () => { monitor.stop(); process.exit(0); });

  await monitor.start();
  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });

export { ForcedInclusionMonitor };
