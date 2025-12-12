import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { LiquidityManager } from './liquidity';
import { StrategyEngine } from './strategy';
import { EventMonitor, type IntentEvent } from './monitor';
import { getChain } from '../lib/chains.js';
import { ZERO_ADDRESS } from '../lib/contracts.js';

function loadOutputSettlers(): Record<number, `0x${string}`> {
  const configPath = resolve(process.cwd(), '../../packages/config/contracts.json');
  if (!existsSync(configPath)) return {};
  
  const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
  const addresses: Record<number, `0x${string}`> = {};

  for (const chain of Object.values(contracts.external || {})) {
    const c = chain as { chainId?: number; oif?: { outputSettler?: string } };
    if (c.chainId && c.oif?.outputSettler) {
      addresses[c.chainId] = c.oif.outputSettler as `0x${string}`;
    }
  }

  for (const net of ['testnet', 'mainnet'] as const) {
    const cfg = contracts[net];
    if (cfg?.chainId && cfg?.oif?.outputSettler) {
      addresses[cfg.chainId] = cfg.oif.outputSettler as `0x${string}`;
    }
  }

  return addresses;
}

const OUTPUT_SETTLERS = loadOutputSettlers();

interface SolverConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  minProfitBps: number;
  maxGasPrice: bigint;
  maxExposurePerChain: string;
  maxIntentSize: string;
  minReputation: number;
  intentCheckIntervalMs: number;
  liquidityRebalanceIntervalMs: number;
}

interface SolverAgentDeps {
  config: SolverConfig;
  liquidityManager: LiquidityManager;
  strategyEngine: StrategyEngine;
  eventMonitor: EventMonitor;
}

export class SolverAgent {
  private config: SolverConfig;
  private liquidityManager: LiquidityManager;
  private strategyEngine: StrategyEngine;
  private eventMonitor: EventMonitor;
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }> = new Map();
  private running = false;
  private pendingFills: Set<string> = new Set();

  constructor(deps: SolverAgentDeps) {
    this.config = deps.config;
    this.liquidityManager = deps.liquidityManager;
    this.strategyEngine = deps.strategyEngine;
    this.eventMonitor = deps.eventMonitor;
  }

  async start(): Promise<void> {
    console.log('📡 Initializing chain connections...');

    for (const chain of this.config.chains) {
      const chainDef = getChain(chain.chainId);
      const publicClient = createPublicClient({ chain: chainDef, transport: http(chain.rpcUrl) });

      let walletClient: WalletClient | undefined;
      const privateKey = process.env.SOLVER_PRIVATE_KEY;
      if (privateKey) {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        walletClient = createWalletClient({ account, chain: chainDef, transport: http(chain.rpcUrl) });
      }

      this.clients.set(chain.chainId, { public: publicClient, wallet: walletClient });
      console.log(`   ✓ ${chain.name} (${chain.chainId})`);
    }

    await this.liquidityManager.initialize(this.clients);
    this.eventMonitor.on('intent', this.handleIntent.bind(this));
    await this.eventMonitor.start(this.clients);
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.eventMonitor.stop();
    console.log('Solver agent stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async handleIntent(event: IntentEvent): Promise<void> {
    const { orderId, sourceChain, destinationChain, inputToken, inputAmount, outputToken, outputAmount, recipient } = event;

    if (this.pendingFills.has(orderId)) return;

    console.log(`\n🎯 Intent: ${orderId.slice(0, 10)}... | ${sourceChain} → ${destinationChain}`);

    const evaluation = await this.strategyEngine.evaluate({ orderId, sourceChain, destinationChain, inputToken, inputAmount, outputToken, outputAmount });
    if (!evaluation.profitable) {
      console.log(`   ❌ Not profitable: ${evaluation.reason}`);
      return;
    }

    console.log(`   ✅ Profitable: ${evaluation.expectedProfitBps} bps`);

    if (!(await this.liquidityManager.hasLiquidity(destinationChain, outputToken, outputAmount))) {
      console.log(`   ❌ Insufficient liquidity`);
      return;
    }

    this.pendingFills.add(orderId);
    const result = await this.executeFill({ orderId, sourceChain, destinationChain, outputToken, outputAmount, recipient });
    console.log(result.success ? `   ✅ Filled: ${result.txHash}` : `   ❌ Failed: ${result.error}`);
    this.pendingFills.delete(orderId);
  }

  private async executeFill(params: { orderId: string; sourceChain: number; destinationChain: number; outputToken: string; outputAmount: string; recipient: string }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(params.destinationChain);
    if (!client?.wallet) return { success: false, error: 'No wallet for destination chain' };

    const outputSettler = this.getOutputSettler(params.destinationChain);
    if (!outputSettler) return { success: false, error: 'No OutputSettler on destination chain' };

    const gasPrice = await client.public.getGasPrice();
    if (gasPrice > this.config.maxGasPrice) return { success: false, error: `Gas too high: ${gasPrice}` };

    const isNative = params.outputToken === ZERO_ADDRESS;
    const amount = BigInt(params.outputAmount);
    const chainDef = getChain(params.destinationChain);

    // Approve if ERC20
    if (!isNative) {
      const approveAbi = [{ type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }] as const;
      const approveTx = await client.wallet.writeContract({ chain: chainDef, account: client.wallet.account!, address: params.outputToken as `0x${string}`, abi: approveAbi, functionName: 'approve', args: [outputSettler, amount] });
      await client.public.waitForTransactionReceipt({ hash: approveTx });
    }

    const fillAbi = [{ type: 'function', name: 'fill', inputs: [{ name: 'orderId', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: isNative ? 'payable' : 'nonpayable' }] as const;
    
    const fillTx = await client.wallet.writeContract({
      chain: chainDef,
      account: client.wallet.account!,
      address: outputSettler,
      abi: fillAbi,
      functionName: 'fill',
      args: [params.orderId as `0x${string}`, params.recipient as `0x${string}`, params.outputToken as `0x${string}`, amount],
      value: isNative ? amount : undefined,
    });

    const receipt = await client.public.waitForTransactionReceipt({ hash: fillTx });
    if (receipt.status === 'reverted') return { success: false, error: 'Reverted' };

    await this.liquidityManager.recordFill(params.destinationChain, params.outputToken, params.outputAmount);
    return { success: true, txHash: fillTx };
  }

  private getOutputSettler(chainId: number): `0x${string}` | undefined {
    const envAddr = process.env[`OIF_OUTPUT_SETTLER_${chainId}`];
    if (envAddr?.startsWith('0x') && envAddr.length === 42) return envAddr as `0x${string}`;
    return OUTPUT_SETTLERS[chainId];
  }
}
