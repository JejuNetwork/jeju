import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { LiquidityManager } from './liquidity';
import { StrategyEngine } from './strategy';
import { EventMonitor, type IntentEvent } from './monitor';
import { OUTPUT_SETTLERS, INPUT_SETTLERS, OUTPUT_SETTLER_ABI, INPUT_SETTLER_ABI, ERC20_APPROVE_ABI, ORACLE_ABI, isNativeToken } from './contracts';
import { getChain } from '../lib/chains.js';
import {
  recordIntentReceived,
  recordIntentEvaluated,
  recordIntentFilled,
  recordIntentSkipped,
  recordSettlementClaimed,
  recordSettlementFailed,
  updatePendingSettlements,
} from './metrics';

interface SolverConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  minProfitBps: number;
  maxGasPrice: bigint;
  maxIntentSize: string;
}

interface PendingSettlement {
  orderId: string;
  sourceChain: number;
  destChain: number;
  inputAmount: bigint;
  fillTxHash: string;
  filledAt: number;
  retryCount: number;
}

const MAX_SETTLEMENT_RETRIES = 5;
const SETTLEMENT_CHECK_INTERVAL_MS = 30_000;

export class SolverAgent {
  private config: SolverConfig;
  private liquidity: LiquidityManager;
  private strategy: StrategyEngine;
  private monitor: EventMonitor;
  private clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
  private pending = new Map<string, Promise<void>>();
  private pendingSettlements = new Map<string, PendingSettlement>();
  private settlementTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: SolverConfig, liquidity: LiquidityManager, strategy: StrategyEngine, monitor: EventMonitor) {
    this.config = config;
    this.liquidity = liquidity;
    this.strategy = strategy;
    this.monitor = monitor;
  }

  async start(): Promise<void> {
    console.log('📡 Connecting to chains...');
    const pk = process.env.SOLVER_PRIVATE_KEY;

    for (const chain of this.config.chains) {
      const chainDef = getChain(chain.chainId);
      const pub = createPublicClient({ chain: chainDef, transport: http(chain.rpcUrl) });
      const wallet = pk
        ? createWalletClient({ account: privateKeyToAccount(pk as `0x${string}`), chain: chainDef, transport: http(chain.rpcUrl) })
        : undefined;
      this.clients.set(chain.chainId, { public: pub, wallet });
      console.log(`   ✓ ${chain.name}`);
    }

    await this.liquidity.initialize(this.clients);
    this.monitor.on('intent', (e: IntentEvent) => this.handleIntent(e));
    await this.monitor.start(this.clients);
    this.startSettlementWatcher();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.settlementTimer) {
      clearInterval(this.settlementTimer);
      this.settlementTimer = null;
    }
    await this.monitor.stop();
    await Promise.all(this.pending.values());
  }

  private startSettlementWatcher(): void {
    this.settlementTimer = setInterval(() => this.checkPendingSettlements(), SETTLEMENT_CHECK_INTERVAL_MS);
  }

  private async checkPendingSettlements(): Promise<void> {
    updatePendingSettlements(this.pendingSettlements.size);
    
    for (const [orderId, settlement] of this.pendingSettlements) {
      const result = await this.trySettle(settlement);
      if (result.settled) {
        this.pendingSettlements.delete(orderId);
        recordSettlementClaimed(settlement.sourceChain, settlement.inputAmount);
        console.log(`   ✅ Settlement claimed: ${orderId.slice(0, 10)}...`);
      } else if (result.retry) {
        settlement.retryCount++;
        if (settlement.retryCount >= MAX_SETTLEMENT_RETRIES) {
          this.pendingSettlements.delete(orderId);
          recordSettlementFailed(settlement.sourceChain, 'max_retries');
          console.log(`   ❌ Settlement failed after ${MAX_SETTLEMENT_RETRIES} retries: ${orderId.slice(0, 10)}...`);
        }
      } else {
        this.pendingSettlements.delete(orderId);
        recordSettlementFailed(settlement.sourceChain, result.reason || 'unknown');
        console.log(`   ❌ Settlement failed: ${result.reason}`);
      }
    }
    
    updatePendingSettlements(this.pendingSettlements.size);
  }

  private async trySettle(settlement: PendingSettlement): Promise<{ settled: boolean; retry: boolean; reason?: string }> {
    const client = this.clients.get(settlement.sourceChain);
    if (!client?.wallet) return { settled: false, retry: false, reason: 'No wallet for source chain' };

    const inputSettler = INPUT_SETTLERS[settlement.sourceChain];
    if (!inputSettler) return { settled: false, retry: false, reason: 'No InputSettler on source chain' };

    // Check if oracle has attested the fill
    const oracleAddr = process.env[`OIF_ORACLE_${settlement.sourceChain}`] as `0x${string}` | undefined;
    if (oracleAddr) {
      const attested = await client.public.readContract({
        address: oracleAddr,
        abi: ORACLE_ABI,
        functionName: 'hasAttested',
        args: [settlement.orderId as `0x${string}`],
      }).catch(() => false);
      
      if (!attested) {
        return { settled: false, retry: true, reason: 'Awaiting oracle attestation' };
      }
    }

    // Try to settle on InputSettler
    const chain = getChain(settlement.sourceChain);
    const settleTx = await client.wallet.writeContract({
      chain,
      account: client.wallet.account!,
      address: inputSettler,
      abi: INPUT_SETTLER_ABI,
      functionName: 'settle',
      args: [settlement.orderId as `0x${string}`],
    }).catch((err: Error) => {
      console.warn(`Settlement tx failed: ${err.message}`);
      return null;
    });

    if (!settleTx) return { settled: false, retry: true, reason: 'Transaction failed' };

    const receipt = await client.public.waitForTransactionReceipt({ hash: settleTx });
    if (receipt.status === 'reverted') {
      return { settled: false, retry: true, reason: 'Transaction reverted' };
    }

    return { settled: true, retry: false };
  }

  isRunning(): boolean {
    return this.running;
  }

  private async handleIntent(e: IntentEvent): Promise<void> {
    if (this.pending.has(e.orderId)) {
      console.log(`   ⏭️ Already processing ${e.orderId.slice(0, 10)}...`);
      return;
    }
    const promise = this.processIntent(e);
    this.pending.set(e.orderId, promise);
    await promise;
    this.pending.delete(e.orderId);
  }

  private async processIntent(e: IntentEvent): Promise<void> {
    recordIntentReceived(e.sourceChain);
    console.log(`\n🎯 Intent ${e.orderId.slice(0, 10)}... | ${e.sourceChain} → ${e.destinationChain}`);

    const client = this.clients.get(e.destinationChain);
    const settler = OUTPUT_SETTLERS[e.destinationChain] || process.env[`OIF_OUTPUT_SETTLER_${e.destinationChain}`] as `0x${string}`;
    
    if (client && settler) {
      const filled = await client.public.readContract({
        address: settler,
        abi: OUTPUT_SETTLER_ABI,
        functionName: 'isFilled',
        args: [e.orderId as `0x${string}`],
      });
      if (filled) {
        console.log('   ⏭️ Already filled on-chain');
        recordIntentSkipped(e.sourceChain, 'already_filled');
        return;
      }
    }

    const result = await this.strategy.evaluate({
      orderId: e.orderId,
      sourceChain: e.sourceChain,
      destinationChain: e.destinationChain,
      inputToken: e.inputToken,
      inputAmount: e.inputAmount,
      outputToken: e.outputToken,
      outputAmount: e.outputAmount,
    });

    recordIntentEvaluated(e.sourceChain, result.profitable);

    if (!result.profitable) {
      console.log(`   ❌ ${result.reason}`);
      recordIntentSkipped(e.sourceChain, result.reason || 'unprofitable');
      return;
    }
    console.log(`   ✅ Profitable: ${result.expectedProfitBps} bps`);

    if (!(await this.liquidity.hasLiquidity(e.destinationChain, e.outputToken, e.outputAmount))) {
      console.log('   ❌ Insufficient liquidity');
      recordIntentSkipped(e.sourceChain, 'insufficient_liquidity');
      return;
    }

    const fillStart = Date.now();
    const fill = await this.fill(e);
    const fillDurationMs = Date.now() - fillStart;

    if (fill.success) {
      recordIntentFilled(e.sourceChain, e.destinationChain, fillDurationMs, fill.gasUsed || 0n);
      console.log(`   ✅ Filled: ${fill.txHash}`);
      
      // Track for settlement claiming
      this.pendingSettlements.set(e.orderId, {
        orderId: e.orderId,
        sourceChain: e.sourceChain,
        destChain: e.destinationChain,
        inputAmount: BigInt(e.inputAmount),
        fillTxHash: fill.txHash!,
        filledAt: Date.now(),
        retryCount: 0,
      });
      updatePendingSettlements(this.pendingSettlements.size);
    } else {
      recordIntentSkipped(e.destinationChain, fill.error || 'fill_failed');
      console.log(`   ❌ ${fill.error}`);
    }
  }

  private async fill(e: IntentEvent): Promise<{ success: boolean; txHash?: string; gasUsed?: bigint; error?: string }> {
    const client = this.clients.get(e.destinationChain);
    if (!client?.wallet) return { success: false, error: 'No wallet' };

    const settler = OUTPUT_SETTLERS[e.destinationChain] || process.env[`OIF_OUTPUT_SETTLER_${e.destinationChain}`] as `0x${string}`;
    if (!settler) return { success: false, error: 'No OutputSettler' };

    const gasPrice = await client.public.getGasPrice();
    if (gasPrice > this.config.maxGasPrice) return { success: false, error: 'Gas too high' };

    const amount = BigInt(e.outputAmount);
    const chain = getChain(e.destinationChain);
    const native = isNativeToken(e.outputToken);

    if (!native) {
      const approveTx = await client.wallet.writeContract({
        chain,
        account: client.wallet.account!,
        address: e.outputToken as `0x${string}`,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [settler, amount],
      });
      await client.public.waitForTransactionReceipt({ hash: approveTx });
    }

    const fillTx = await client.wallet.writeContract({
      chain,
      account: client.wallet.account!,
      address: settler,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fillDirect',
      args: [e.orderId as `0x${string}`, e.outputToken as `0x${string}`, amount, e.recipient as `0x${string}`],
      value: native ? amount : 0n,
    });

    const receipt = await client.public.waitForTransactionReceipt({ hash: fillTx });
    if (receipt.status === 'reverted') return { success: false, error: 'Reverted' };

    await this.liquidity.recordFill(e.destinationChain, e.outputToken, e.outputAmount);
    return { success: true, txHash: fillTx, gasUsed: receipt.gasUsed };
  }
}
