#!/usr/bin/env bun
/**
 * Forced Inclusion Monitor - Anti-censorship enforcement
 * 
 * ENV: L1_RPC_URL, FORCED_INCLUSION_ADDRESS, MONITOR_PRIVATE_KEY (optional)
 */

import { createPublicClient, createWalletClient, http, formatEther, readContract, waitForTransactionReceipt, getBlockNumber, watchContractEvent, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../shared/chain-utils';

const DEPLOYMENTS_DIR = join(import.meta.dir, '../../packages/contracts/deployments');

const ABI = parseAbi([
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
]);

interface QueuedTx { txId: string; queuedAtBlock: bigint; included: boolean; expired: boolean; fee: bigint }

class ForcedInclusionMonitor {
  private pending = new Map<string, QueuedTx>();
  private stats = { monitored: 0, included: 0, forced: 0, expired: 0, rewards: 0n };
  private running = false;
  private unwatch: (() => void)[] = [];

  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient | null,
    private contractAddress: Address,
    private window: bigint,
    private alertBlocks = 10,
    private interval = 12000
  ) {}

  async start() {
    if (this.running) return;
    this.running = true;

    console.log(`📋 Monitor: ${this.contractAddress} | Window: ${this.window} blocks`);
    if (this.walletClient) console.log(`   Executor: ${this.walletClient.account.address}`);

    const unwatch1 = watchContractEvent(this.publicClient, {
      address: this.contractAddress,
      abi: ABI,
      eventName: 'TxQueued',
      onLogs: (logs) => {
        for (const log of logs) {
          const id = log.args.txId as string;
          const sender = log.args.sender as Address;
          const fee = log.args.fee as bigint;
          const block = log.args.queuedAtBlock as bigint;
          console.log(`📥 Queued ${id.slice(0, 10)}... from ${sender}, ${formatEther(fee)} ETH, due block ${block + this.window}`);
          this.pending.set(id, { txId: id, queuedAtBlock: block, included: false, expired: false, fee });
          this.stats.monitored++;
        }
      },
    });
    this.unwatch.push(unwatch1);

    const unwatch2 = watchContractEvent(this.publicClient, {
      address: this.contractAddress,
      abi: ABI,
      eventName: 'TxIncluded',
      onLogs: (logs) => {
        for (const log of logs) {
          const id = log.args.txId as string;
          console.log(`✅ Included ${id.slice(0, 10)}...`);
          this.pending.delete(id);
          this.stats.included++;
        }
      },
    });
    this.unwatch.push(unwatch2);

    const unwatch3 = watchContractEvent(this.publicClient, {
      address: this.contractAddress,
      abi: ABI,
      eventName: 'TxForced',
      onLogs: (logs) => {
        for (const log of logs) {
          const id = log.args.txId as string;
          const forcer = log.args.forcer as Address;
          const reward = log.args.reward as bigint;
          console.log(`⚡ Forced ${id.slice(0, 10)}... reward ${formatEther(reward)} ETH`);
          if (this.walletClient?.account.address.toLowerCase() === forcer.toLowerCase()) this.stats.rewards += reward;
          this.pending.delete(id);
          this.stats.forced++;
        }
      },
    });
    this.unwatch.push(unwatch3);

    const unwatch4 = watchContractEvent(this.publicClient, {
      address: this.contractAddress,
      abi: ABI,
      eventName: 'TxExpired',
      onLogs: (logs) => {
        for (const log of logs) {
          const id = log.args.txId as string;
          this.pending.delete(id);
          this.stats.expired++;
        }
      },
    });
    this.unwatch.push(unwatch4);

    await this.loadOverdue();
    this.startLoop();
  }

  stop() {
    this.running = false;
    for (const unwatch of this.unwatch) unwatch();
    console.log(`📊 Stats: ${this.stats.monitored} monitored, ${this.stats.included} included, ${this.stats.forced} forced, ${this.stats.expired} expired, ${formatEther(this.stats.rewards)} ETH earned`);
  }

  private async loadOverdue() {
    const overdue = await readContract(this.publicClient, {
      address: this.contractAddress,
      abi: ABI,
      functionName: 'getOverdueTxs',
    }).catch(() => [] as `0x${string}`[]);
    for (const id of overdue) {
      const tx = await readContract(this.publicClient, {
        address: this.contractAddress,
        abi: ABI,
        functionName: 'queuedTxs',
        args: [id],
      });
      this.pending.set(id, { txId: id, queuedAtBlock: tx[4], included: tx[6], expired: tx[7], fee: tx[3] });
    }
    if (overdue.length > 0) console.log(`⚠️  ${overdue.length} overdue txs`);
  }

  private startLoop() {
    setInterval(async () => {
      if (!this.running) return;
      const block = await getBlockNumber(this.publicClient);

      for (const [id, tx] of this.pending) {
        if (tx.included || tx.expired) { this.pending.delete(id); continue; }
        const remaining = Number(tx.queuedAtBlock) + Number(this.window) - Number(block);
        if (remaining > 0 && remaining <= this.alertBlocks) console.log(`⚠️  ${id.slice(0, 10)}... ${remaining} blocks left`);

        if (this.walletClient) {
          const canForce = await readContract(this.publicClient, {
            address: this.contractAddress,
            abi: ABI,
            functionName: 'canForceInclude',
            args: [id as `0x${string}`],
          });
          if (canForce) {
            console.log(`🔨 Force-including ${id.slice(0, 10)}...`);
            try {
              const hash = await this.walletClient.writeContract({
                address: this.contractAddress,
                abi: ABI,
                functionName: 'forceInclude',
                args: [id as `0x${string}`],
              });
              await waitForTransactionReceipt(this.publicClient, { hash });
              console.log(`   ✓ Done`);
            } catch (e) { console.error(`   ✗ Failed:`, e); }
          }
        }
      }
    }, this.interval);
  }
}

async function main() {
  const network = process.env.NETWORK || 'localnet';
  const rpc = process.env.L1_RPC_URL || 'http://127.0.0.1:6545';
  let addr = process.env.FORCED_INCLUSION_ADDRESS;

  const file = join(DEPLOYMENTS_DIR, `${network}.json`);
  if (existsSync(file)) addr = addr || JSON.parse(readFileSync(file, 'utf-8')).forcedInclusion;
  if (!addr) { console.error('FORCED_INCLUSION_ADDRESS required'); process.exit(1); }

  const chain = inferChainFromRpcUrl(rpc);
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const account = process.env.MONITOR_PRIVATE_KEY ? privateKeyToAccount(process.env.MONITOR_PRIVATE_KEY as `0x${string}`) : null;
  const walletClient = account ? createWalletClient({ chain, transport: http(rpc), account }) : null;
  const window = await readContract(publicClient, {
    address: addr as Address,
    abi: ABI,
    functionName: 'INCLUSION_WINDOW_BLOCKS',
  });

  const monitor = new ForcedInclusionMonitor(publicClient, walletClient, addr as Address, window);
  process.on('SIGINT', () => { monitor.stop(); process.exit(0); });
  process.on('SIGTERM', () => { monitor.stop(); process.exit(0); });

  await monitor.start();
  await new Promise(() => { /* keep process running */ });
}

main().catch(e => { console.error(e); process.exit(1); });

export { ForcedInclusionMonitor };
