#!/usr/bin/env bun
/**
 * Monitor Bridge Transfers for All Tokens
 * 
 * Tracks token transfers from Base to Jeju:
 * - Watches for ERC20BridgeInitiated events on Base
 * - Monitors ERC20BridgeFinalized events on Jeju
 * - Shows transfer status and confirmation times
 * - Alerts on stuck or failed transfers
 * 
 * Usage:
 *   bun run scripts/monitor-bridge-transfers.ts
 */

import { createPublicClient, http, parseAbiItem, type Address, type Log } from 'viem';
import { base } from 'viem/chains';
import { OP_STACK_PREDEPLOYS } from './shared/bridge-helpers';
import { getTokenSymbol, formatTokenAmount } from './shared/token-utils';

interface BridgeTransfer {
  id: string;
  token: Address;
  tokenSymbol: string;
  from: Address;
  to: Address;
  amount: bigint;
  sourceT xHash: string;
  destinationTxHash?: string;
  status: 'initiated' | 'finalized' | 'failed';
  initiatedAt: number;
  finalizedAt?: number;
  duration?: number;
}

class BridgeMonitor {
  private baseClient;
  private jejuClient;
  private transfers: Map<string, BridgeTransfer> = new Map();

  constructor() {
    const baseRpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const jejuRpcUrl = process.env.JEJU_RPC_URL || 'https://rpc.jeju.network';

    this.baseClient = createPublicClient({
      chain: base,
      transport: http(baseRpcUrl)
    });

    this.jejuClient = createPublicClient({
      transport: http(jejuRpcUrl)
    });

    console.log('👀 Bridge Transfer Monitor');
    console.log('='.repeat(70));
    console.log('  Base RPC:', baseRpcUrl);
    console.log('  Jeju RPC:', jejuRpcUrl);
    console.log('  Bridge:', OP_STACK_PREDEPLOYS.L2StandardBridge);
    console.log('='.repeat(70));
    console.log('');
  }

  /**
   * Start monitoring
   */
  async start() {
    console.log('🚀 Starting bridge monitor...\n');

    // Watch Base for initiated transfers
    this.baseClient.watchEvent({
      address: OP_STACK_PREDEPLOYS.L2StandardBridge,
      event: parseAbiItem('event ERC20BridgeInitiated(address indexed localToken, address indexed remoteToken, address indexed from, address to, uint256 amount, bytes extraData)'),
      onLogs: (logs) => this.handleInitiatedTransfers(logs),
    });

    // Watch Jeju for finalized transfers
    this.jejuClient.watchEvent({
      address: OP_STACK_PREDEPLOYS.L2StandardBridge,
      event: parseAbiItem('event ERC20BridgeFinalized(address indexed localToken, address indexed remoteToken, address indexed from, address to, uint256 amount, bytes extraData)'),
      onLogs: (logs) => this.handleFinalizedTransfers(logs),
    });

    console.log('✅ Watching for bridge events...\n');

    // Periodic status display
    setInterval(() => {
      this.displayStatus();
    }, 30000); // Every 30 seconds

    // Keep process alive
    await new Promise(() => {});
  }

  private handleInitiatedTransfers(logs: Log[]) {
    for (const log of logs) {
      const transfer: BridgeTransfer = {
        id: log.transactionHash!,
        token: log.topics[1] as Address,
        tokenSymbol: getTokenSymbol(log.topics[1] as string),
        from: `0x${log.topics[3]!.slice(26)}` as Address,
        to: log.args.to as Address,
        amount: log.args.amount as bigint,
        sourceTxHash: log.transactionHash!,
        status: 'initiated',
        initiatedAt: Date.now(),
      };

      this.transfers.set(transfer.id, transfer);

      console.log('🆕 New Bridge Transfer Initiated');
      console.log('   Token:', transfer.tokenSymbol);
      console.log('   Amount:', formatTokenAmount(transfer.amount, transfer.tokenSymbol));
      console.log('   From:', transfer.from);
      console.log('   To:', transfer.to);
      console.log('   Tx:', transfer.sourceTxHash);
      console.log('   ⏳ Waiting for finalization (~2 minutes)...');
      console.log('');
    }
  }

  private handleFinalizedTransfers(logs: Log[]) {
    for (const log of logs) {
      const txHash = log.transactionHash!;
      
      // Find matching initiated transfer
      const transfer = Array.from(this.transfers.values()).find(t => 
        t.from === (`0x${log.topics[3]!.slice(26)}` as Address) &&
        t.to === (log.args.to as Address) &&
        t.amount === (log.args.amount as bigint)
      );

      if (transfer) {
        transfer.status = 'finalized';
        transfer.destinationTxHash = txHash;
        transfer.finalizedAt = Date.now();
        transfer.duration = Math.floor((transfer.finalizedAt - transfer.initiatedAt) / 1000);

        console.log('✅ Bridge Transfer Finalized');
        console.log('   Token:', transfer.tokenSymbol);
        console.log('   Amount:', formatTokenAmount(transfer.amount, transfer.tokenSymbol));
        console.log('   Duration:', transfer.duration, 'seconds');
        console.log('   Jeju Tx:', transfer.destinationTxHash);
        console.log('');
      }
    }
  }

  private displayStatus() {
    const pending = Array.from(this.transfers.values()).filter(t => t.status === 'initiated');
    const completed = Array.from(this.transfers.values()).filter(t => t.status === 'finalized');

    console.log('\n📊 Bridge Monitor Status');
    console.log('-'.repeat(70));
    console.log(`  Pending: ${pending.length}`);
    console.log(`  Completed: ${completed.length}`);
    console.log(`  Total: ${this.transfers.size}`);
    console.log('-'.repeat(70));

    // Show pending transfers
    if (pending.length > 0) {
      console.log('\nPending Transfers:');
      for (const transfer of pending) {
        const elapsed = Math.floor((Date.now() - transfer.initiatedAt) / 1000);
        console.log(`  • ${transfer.tokenSymbol}: ${formatTokenAmount(transfer.amount, transfer.tokenSymbol)} (${elapsed}s ago)`);
      }
    }

    console.log('');
  }
}

/**
 * CLI
 */
async function main() {
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const network = (process.env.NETWORK || 'mainnet') as 'mainnet' | 'testnet';

  const monitor = new BridgeMonitor();
  await monitor.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { BridgeMonitor };

