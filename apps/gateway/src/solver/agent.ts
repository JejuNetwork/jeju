import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LiquidityManager } from './liquidity';
import { StrategyEngine } from './strategy';
import { EventMonitor, type IntentEvent } from './monitor';
import { getChain } from '../lib/chains.js';
import { ZERO_ADDRESS } from '../lib/contracts.js';

// Load output settler addresses from contracts.json
function loadOutputSettlers(): Record<number, `0x${string}`> {
  const configPath = resolve(process.cwd(), '../../packages/config/contracts.json');
  const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  const addresses: Record<number, `0x${string}`> = {};
  
  // Load from external chains
  if (contracts.external) {
    for (const [, chain] of Object.entries(contracts.external)) {
      const c = chain as { chainId?: number; oif?: { outputSettler?: string } };
      if (c.chainId && c.oif?.outputSettler) {
        addresses[c.chainId] = c.oif.outputSettler as `0x${string}`;
      }
    }
  }
  
  // Load from testnet/mainnet jeju config  
  if (contracts.testnet?.oif?.outputSettler) {
    addresses[contracts.testnet.chainId] = contracts.testnet.oif.outputSettler as `0x${string}`;
  }
  if (contracts.mainnet?.oif?.outputSettler) {
    addresses[contracts.mainnet.chainId] = contracts.mainnet.oif.outputSettler as `0x${string}`;
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
      const chainDef = this.getChainDef(chain.chainId);
      const publicClient = createPublicClient({ chain: chainDef, transport: http(chain.rpcUrl) });

      let walletClient: WalletClient | undefined;
      const privateKey = process.env.SOLVER_PRIVATE_KEY;
      if (privateKey) {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        walletClient = createWalletClient({ account, chain: chainDef, transport: http(chain.rpcUrl) });
      }

      this.clients.set(chain.chainId, { public: publicClient, wallet: walletClient });
      console.log(`   ✓ Connected to ${chain.name} (${chain.chainId})`);
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
    const { orderId, sourceChain, destinationChain, inputToken, inputAmount, outputToken, outputAmount } = event;

    if (this.pendingFills.has(orderId)) return;

    console.log(`\n🎯 New Intent: ${orderId.slice(0, 10)}...`);
    console.log(`   Route: ${sourceChain} → ${destinationChain}`);
    console.log(`   Amount: ${inputAmount}`);

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

    const result = await this.executeFill({ orderId, sourceChain, destinationChain, outputToken, outputAmount, recipient: event.recipient });

    if (result.success) {
      console.log(`   ✅ Fill executed: ${result.txHash}`);
    } else {
      console.log(`   ❌ Fill failed: ${result.error}`);
    }

    this.pendingFills.delete(orderId);
  }

  private async executeFill(params: { orderId: string; sourceChain: number; destinationChain: number; outputToken: string; outputAmount: string; recipient: string }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(params.destinationChain);
    if (!client?.wallet) return { success: false, error: 'No wallet configured for destination chain' };

    const outputSettlerAddress = this.getOutputSettler(params.destinationChain);
    if (!outputSettlerAddress) return { success: false, error: 'No OutputSettler deployed on destination chain' };

    console.log(`   📤 Filling on chain ${params.destinationChain}...`);

    const gasPrice = await client.public.getGasPrice();
    if (gasPrice > this.config.maxGasPrice) return { success: false, error: `Gas price too high: ${gasPrice} > ${this.config.maxGasPrice}` };

    const isNativeToken = params.outputToken === ZERO_ADDRESS;
    const outputAmount = BigInt(params.outputAmount);
    const chainDef = this.getChainDef(params.destinationChain);

    const fillAbiPayable = [{ type: 'function', name: 'fill', inputs: [{ name: 'orderId', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'payable' }] as const;
    const fillAbiNonpayable = [{ type: 'function', name: 'fill', inputs: [{ name: 'orderId', type: 'bytes32' }, { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }] as const;

    if (!isNativeToken) {
      const approveAbi = [{ type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }] as const;
      const approveHash = await client.wallet.writeContract({ chain: chainDef, account: client.wallet.account!, address: params.outputToken as `0x${string}`, abi: approveAbi, functionName: 'approve', args: [outputSettlerAddress, outputAmount] });
      console.log(`   📝 Approval tx: ${approveHash}`);
      await client.public.waitForTransactionReceipt({ hash: approveHash });
    }

    const fillHash = isNativeToken
      ? await client.wallet.writeContract({ chain: chainDef, account: client.wallet.account!, address: outputSettlerAddress, abi: fillAbiPayable, functionName: 'fill', args: [params.orderId as `0x${string}`, params.recipient as `0x${string}`, params.outputToken as `0x${string}`, outputAmount], value: outputAmount })
      : await client.wallet.writeContract({ chain: chainDef, account: client.wallet.account!, address: outputSettlerAddress, abi: fillAbiNonpayable, functionName: 'fill', args: [params.orderId as `0x${string}`, params.recipient as `0x${string}`, params.outputToken as `0x${string}`, outputAmount] });

    console.log(`   📝 Fill tx: ${fillHash}`);

    const receipt = await client.public.waitForTransactionReceipt({ hash: fillHash });
    if (receipt.status === 'reverted') return { success: false, error: 'Transaction reverted' };

    await this.liquidityManager.recordFill(params.destinationChain, params.outputToken, params.outputAmount);
    return { success: true, txHash: fillHash };
  }

  private getOutputSettler(chainId: number): `0x${string}` | undefined {
    // First check env var override
    const envAddr = process.env[`OIF_OUTPUT_SETTLER_${chainId}`];
    if (envAddr && envAddr.startsWith('0x') && envAddr.length === 42) {
      return envAddr as `0x${string}`;
    }
    // Fall back to contracts.json
    return OUTPUT_SETTLERS[chainId];
  }

  private getChainDef(chainId: number): Chain {
    return getChain(chainId);
  }
}
