import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { LiquidityManager } from './liquidity';
import { StrategyEngine } from './strategy';
import { EventMonitor, type IntentEvent } from './monitor';
import { OUTPUT_SETTLERS, OUTPUT_SETTLER_ABI, ERC20_APPROVE_ABI, isNativeToken } from './contracts';
import { getChain } from '../lib/chains.js';

interface SolverConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  minProfitBps: number;
  maxGasPrice: bigint;
  maxIntentSize: string;
}

export class SolverAgent {
  private config: SolverConfig;
  private liquidity: LiquidityManager;
  private strategy: StrategyEngine;
  private monitor: EventMonitor;
  private clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
  private pending = new Map<string, Promise<void>>();
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
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.monitor.stop();
    await Promise.all(this.pending.values());
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

    if (!result.profitable) {
      console.log(`   ❌ ${result.reason}`);
      return;
    }
    console.log(`   ✅ Profitable: ${result.expectedProfitBps} bps`);

    if (!(await this.liquidity.hasLiquidity(e.destinationChain, e.outputToken, e.outputAmount))) {
      console.log('   ❌ Insufficient liquidity');
      return;
    }

    const fill = await this.fill(e);
    console.log(fill.success ? `   ✅ Filled: ${fill.txHash}` : `   ❌ ${fill.error}`);
  }

  private async fill(e: IntentEvent): Promise<{ success: boolean; txHash?: string; error?: string }> {
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
    return { success: true, txHash: fillTx };
  }
}
