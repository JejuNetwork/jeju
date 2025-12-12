/**
 * @fileoverview OIF Solver Integration Strategy
 *
 * Participates in the Open Intents Framework as a solver:
 * - Monitor for new intents
 * - Evaluate profitability
 * - Fill intents across chains
 * - Capture solver fees for treasury
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  parseAbiItem,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainId, ChainConfig, StrategyConfig } from '../types';
import { OUTPUT_SETTLER_ABI, ERC20_ABI, ZERO_ADDRESS } from '../lib/contracts';

// ============ Types ============

interface Intent {
  orderId: string;
  user: string;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  inputToken: string;
  inputAmount: bigint;
  outputToken: string;
  outputAmount: bigint;
  recipient: string;
  maxFee: bigint;
  openDeadline: number;
  fillDeadline: number;
  solver: string;
  filled: boolean;
  createdBlock: bigint;
  receivedAt: number;
}

interface IntentEvaluation {
  intent: Intent;
  profitable: boolean;
  expectedProfitBps: number;
  expectedProfitWei: bigint;
  estimatedGasCost: bigint;
  reason?: string;
}

// ============ Constants ============

const OPEN_EVENT = parseAbiItem(
  'event Open(bytes32 indexed orderId, (address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, (uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) order)'
);

const INTENT_TTL_MS = 30000; // 30 seconds

// ============ Strategy Class ============

export class SolverStrategy {
  private clients: Map<ChainId, { public: PublicClient; wallet?: WalletClient }> = new Map();
  private account: Account;
  private intents: Map<string, Intent> = new Map();
  private pendingFills: Set<string> = new Set();
  private inputSettlers: Map<ChainId, string> = new Map();
  private outputSettlers: Map<ChainId, string> = new Map();
  private unwatchers: Array<() => void> = [];
  private running = false;
  private config: StrategyConfig;
  private chainConfigs: ChainConfig[];

  constructor(
    chainConfigs: ChainConfig[],
    config: StrategyConfig,
    privateKey: string
  ) {
    this.chainConfigs = chainConfigs;
    this.config = config;
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
  }

  /**
   * Initialize solver with settler addresses
   */
  async initialize(
    inputSettlers: Record<number, string>,
    outputSettlers: Record<number, string>
  ): Promise<void> {
    console.log(`🔮 Initializing OIF solver strategy`);
    console.log(`   Solver address: ${this.account.address}`);

    for (const config of this.chainConfigs) {
      const chain = {
        id: config.chainId,
        name: config.name,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
      };

      const publicClient = createPublicClient({
        chain,
        transport: http(config.rpcUrl),
      });

      const walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      });

      this.clients.set(config.chainId, { public: publicClient, wallet: walletClient });

      // Store settler addresses
      const inputSettler = inputSettlers[config.chainId];
      const outputSettler = outputSettlers[config.chainId];

      if (inputSettler) {
        this.inputSettlers.set(config.chainId, inputSettler);
        console.log(`   ${config.name}: InputSettler ${inputSettler.slice(0, 10)}...`);
      }
      if (outputSettler) {
        this.outputSettlers.set(config.chainId, outputSettler);
      }
    }
  }

  /**
   * Start monitoring for intents
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`   Starting intent monitoring...`);

    for (const [chainId, settler] of this.inputSettlers) {
      const client = this.clients.get(chainId);
      if (!client) continue;

      const unwatch = client.public.watchContractEvent({
        address: settler as `0x${string}`,
        abi: [OPEN_EVENT],
        eventName: 'Open',
        onLogs: (logs) => this.handleOpenEvents(chainId, logs),
        onError: (error) => console.error(`Intent watch error on ${chainId}:`, error),
      });

      this.unwatchers.push(unwatch);
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false;
    this.unwatchers.forEach((unwatch) => unwatch());
    this.unwatchers = [];
  }

  /**
   * Get pending intents that could be filled
   */
  getPendingIntents(): Intent[] {
    const now = Date.now();

    // Clean expired intents
    for (const [id, intent] of this.intents) {
      if (intent.receivedAt + INTENT_TTL_MS < now || intent.filled) {
        this.intents.delete(id);
      }
    }

    return Array.from(this.intents.values())
      .filter(i => !this.pendingFills.has(i.orderId))
      .sort((a, b) => Number(b.inputAmount - a.inputAmount));
  }

  /**
   * Evaluate an intent for profitability
   */
  async evaluate(intent: Intent): Promise<IntentEvaluation> {
    // Check if we have liquidity on destination chain
    const destClient = this.clients.get(intent.destinationChainId);
    if (!destClient?.wallet) {
      return {
        intent,
        profitable: false,
        expectedProfitBps: 0,
        expectedProfitWei: 0n,
        estimatedGasCost: 0n,
        reason: 'No wallet for destination chain',
      };
    }

    // Check balance
    let balance: bigint;
    if (intent.outputToken === ZERO_ADDRESS) {
      balance = await destClient.public.getBalance({
        address: this.account.address,
      });
    } else {
      balance = await destClient.public.readContract({
        address: intent.outputToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account.address],
      }) as bigint;
    }

    if (balance < intent.outputAmount) {
      return {
        intent,
        profitable: false,
        expectedProfitBps: 0,
        expectedProfitWei: 0n,
        estimatedGasCost: 0n,
        reason: 'Insufficient liquidity',
      };
    }

    // Estimate gas cost
    const gasPrice = await destClient.public.getGasPrice();
    const estimatedGasCost = 300000n * gasPrice; // Fill typically costs ~300k gas

    // Calculate profit
    // Fee = inputAmount - outputAmount
    const fee = intent.inputAmount - intent.outputAmount;
    const expectedProfitWei = fee - estimatedGasCost;

    if (expectedProfitWei <= 0n) {
      return {
        intent,
        profitable: false,
        expectedProfitBps: 0,
        expectedProfitWei,
        estimatedGasCost,
        reason: 'Gas cost exceeds fee',
      };
    }

    const expectedProfitBps = Number((expectedProfitWei * 10000n) / intent.inputAmount);

    if (expectedProfitBps < this.config.minProfitBps) {
      return {
        intent,
        profitable: false,
        expectedProfitBps,
        expectedProfitWei,
        estimatedGasCost,
        reason: `Profit ${expectedProfitBps} bps below minimum ${this.config.minProfitBps}`,
      };
    }

    return {
      intent,
      profitable: true,
      expectedProfitBps,
      expectedProfitWei,
      estimatedGasCost,
    };
  }

  /**
   * Fill an intent
   */
  async fill(intent: Intent): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    if (this.pendingFills.has(intent.orderId)) {
      return { success: false, error: 'Already pending fill' };
    }

    this.pendingFills.add(intent.orderId);

    try {
      const destClient = this.clients.get(intent.destinationChainId);
      if (!destClient?.wallet) {
        return { success: false, error: 'No wallet for destination chain' };
      }

      const outputSettler = this.outputSettlers.get(intent.destinationChainId);
      if (!outputSettler) {
        return { success: false, error: 'No OutputSettler on destination chain' };
      }

      console.log(`📤 Filling intent ${intent.orderId.slice(0, 10)}...`);
      console.log(`   Route: ${intent.sourceChainId} → ${intent.destinationChainId}`);
      console.log(`   Amount: ${intent.outputAmount}`);

      // Approve token if needed
      if (intent.outputToken !== ZERO_ADDRESS) {
        const allowance = await destClient.public.readContract({
          address: intent.outputToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [this.account.address, outputSettler as `0x${string}`],
        }) as bigint;

        if (allowance < intent.outputAmount) {
          console.log(`   Approving token...`);
          const approveHash = await destClient.wallet.writeContract({
            address: intent.outputToken as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [outputSettler as `0x${string}`, intent.outputAmount],
          });
          await destClient.public.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      // Fill the intent
      const isNativeToken = intent.outputToken === ZERO_ADDRESS;

      const hash = await destClient.wallet.writeContract({
        address: outputSettler as `0x${string}`,
        abi: OUTPUT_SETTLER_ABI,
        functionName: 'fill',
        args: [
          intent.orderId as `0x${string}`,
          intent.recipient as `0x${string}`,
          intent.outputToken as `0x${string}`,
          intent.outputAmount,
        ],
        value: isNativeToken ? intent.outputAmount : 0n,
      });

      console.log(`   Fill TX: ${hash}`);

      const receipt = await destClient.public.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Fill transaction reverted' };
      }

      // Mark as filled
      intent.filled = true;

      console.log(`   ✓ Intent filled successfully`);

      return { success: true, txHash: hash };
    } catch (error) {
      console.error(`   ✗ Fill failed:`, error);
      return { success: false, error: String(error) };
    } finally {
      this.pendingFills.delete(intent.orderId);
    }
  }

  // ============ Private Methods ============

  private handleOpenEvents(chainId: ChainId, logs: Array<{ args: Record<string, unknown> }>): void {
    for (const log of logs) {
      this.processOpenEvent(chainId, log);
    }
  }

  private processOpenEvent(
    chainId: ChainId,
    log: { args: Record<string, unknown> }
  ): void {
    const args = log.args as {
      orderId: `0x${string}`;
      order: {
        user: `0x${string}`;
        originChainId: bigint;
        openDeadline: number;
        fillDeadline: number;
        orderId: `0x${string}`;
        maxSpent: Array<{
          token: `0x${string}`;
          amount: bigint;
          recipient: `0x${string}`;
          chainId: bigint;
        }>;
        minReceived: Array<{
          token: `0x${string}`;
          amount: bigint;
          recipient: `0x${string}`;
          chainId: bigint;
        }>;
        fillInstructions: Array<{
          destinationChainId: bigint;
          destinationSettler: `0x${string}`;
          originData: `0x${string}`;
        }>;
      };
    };

    const order = args.order;
    const maxSpent = order.maxSpent[0];
    const minReceived = order.minReceived[0];

    if (!maxSpent || !minReceived) return;

    const intent: Intent = {
      orderId: args.orderId,
      user: order.user,
      sourceChainId: chainId,
      destinationChainId: Number(minReceived.chainId) as ChainId,
      inputToken: maxSpent.token.slice(0, 42),
      inputAmount: maxSpent.amount,
      outputToken: minReceived.token.slice(0, 42),
      outputAmount: minReceived.amount,
      recipient: minReceived.recipient.slice(0, 42),
      maxFee: 0n,
      openDeadline: order.openDeadline,
      fillDeadline: order.fillDeadline,
      solver: ZERO_ADDRESS,
      filled: false,
      createdBlock: 0n,
      receivedAt: Date.now(),
    };

    this.intents.set(intent.orderId, intent);

    console.log(`🎯 New intent: ${intent.orderId.slice(0, 10)}...`);
    console.log(`   Route: ${intent.sourceChainId} → ${intent.destinationChainId}`);
    console.log(`   Input: ${intent.inputAmount}, Output: ${intent.outputAmount}`);
  }
}
