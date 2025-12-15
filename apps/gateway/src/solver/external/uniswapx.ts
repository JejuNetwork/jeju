/**
 * UniswapX Filler Integration
 * 
 * UniswapX is Uniswap's intent-based trading system.
 * Anyone can be a filler - no registration required.
 * 
 * Flow:
 * 1. User signs a UniswapX order (off-chain)
 * 2. Order is broadcast via UniswapX API
 * 3. Fillers compete to fill at best price
 * 4. Filler earns spread between order price and execution
 */

import { type PublicClient, type WalletClient, type Address } from 'viem';
import { EventEmitter } from 'events';

// UniswapX Reactor addresses
export const UNISWAPX_REACTORS: Record<number, Address> = {
  1: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4',      // Ethereum - ExclusiveDutchOrderReactor
  42161: '0x1bd1aAdc9E230626C44a139d7E70d842749351eb',  // Arbitrum
  10: '0x1bd1aAdc9E230626C44a139d7E70d842749351eb',     // Optimism
  8453: '0x1bd1aAdc9E230626C44a139d7E70d842749351eb',   // Base
  137: '0x1bd1aAdc9E230626C44a139d7E70d842749351eb',    // Polygon
};

// UniswapX API endpoints
const UNISWAPX_API = {
  mainnet: 'https://api.uniswap.org/v2/orders',
  testnet: 'https://api.uniswap.org/v2/orders', // Uses mainnet API with testnet chains
};

export interface UniswapXOrder {
  orderHash: `0x${string}`;
  chainId: number;
  swapper: Address;
  reactor: Address;
  deadline: number;
  input: {
    token: Address;
    amount: bigint;
  };
  outputs: Array<{
    token: Address;
    amount: bigint;
    recipient: Address;
  }>;
  decayStartTime: number;
  decayEndTime: number;
  exclusiveFiller?: Address;
  exclusivityOverrideBps?: number;
  nonce: bigint;
  encodedOrder: `0x${string}`;
  signature: `0x${string}`;
  createdAt: number;
  orderStatus: 'open' | 'filled' | 'expired' | 'cancelled';
}

// UniswapX execute function (reserved for batch fills)
const _EXECUTE_ABI = [{
  type: 'function',
  name: 'execute',
  inputs: [
    {
      name: 'order',
      type: 'tuple',
      components: [
        { name: 'info', type: 'tuple', components: [
          { name: 'reactor', type: 'address' },
          { name: 'swapper', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'additionalValidationContract', type: 'address' },
          { name: 'additionalValidationData', type: 'bytes' },
        ]},
        { name: 'decayStartTime', type: 'uint256' },
        { name: 'decayEndTime', type: 'uint256' },
        { name: 'exclusiveFiller', type: 'address' },
        { name: 'exclusivityOverrideBps', type: 'uint256' },
        { name: 'input', type: 'tuple', components: [
          { name: 'token', type: 'address' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
        ]},
        { name: 'outputs', type: 'tuple[]', components: [
          { name: 'token', type: 'address' },
          { name: 'startAmount', type: 'uint256' },
          { name: 'endAmount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ]},
      ],
    },
    { name: 'sig', type: 'bytes' },
    { name: 'fillContract', type: 'address' },
    { name: 'fillData', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const;

// Fill callback interface (reserved for advanced fills)
const _FILL_CALLBACK_ABI = [{
  type: 'function',
  name: 'reactorCallback',
  inputs: [
    {
      name: 'resolvedOrders',
      type: 'tuple[]',
      components: [
        { name: 'info', type: 'tuple', components: [
          { name: 'reactor', type: 'address' },
          { name: 'swapper', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'additionalValidationContract', type: 'address' },
          { name: 'additionalValidationData', type: 'bytes' },
        ]},
        { name: 'input', type: 'tuple', components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'maxAmount', type: 'uint256' },
        ]},
        { name: 'outputs', type: 'tuple[]', components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
        ]},
        { name: 'sig', type: 'bytes' },
        { name: 'hash', type: 'bytes32' },
      ],
    },
    { name: 'fillData', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const;

// Reserve ABIs for future batch/callback implementations
void _EXECUTE_ABI;
void _FILL_CALLBACK_ABI;

export class UniswapXAdapter extends EventEmitter {
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }>;
  private supportedChains: number[];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processedOrders = new Set<string>();
  private pendingOrders = new Map<string, UniswapXOrder>();

  constructor(
    clients: Map<number, { public: PublicClient; wallet?: WalletClient }>,
    supportedChains: number[],
    _isTestnet = false
  ) {
    super();
    this.clients = clients;
    this.supportedChains = supportedChains;
  }

  /**
   * Get a pending order by hash
   */
  getPendingOrder(orderHash: string): UniswapXOrder | undefined {
    return this.pendingOrders.get(orderHash);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('🦄 Starting UniswapX monitor...');

    // Poll UniswapX API for open orders
    await this.pollOrders();
    this.pollInterval = setInterval(() => this.pollOrders(), 5000); // Poll every 5s
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollOrders(): Promise<void> {
    for (const chainId of this.supportedChains) {
      if (!this.clients.has(chainId)) continue;
      if (!UNISWAPX_REACTORS[chainId]) continue;

      try {
        const orders = await this.fetchOpenOrders(chainId);
        
        for (const order of orders) {
          if (this.processedOrders.has(order.orderHash)) continue;
          this.processedOrders.add(order.orderHash);
          this.pendingOrders.set(order.orderHash, order);
          
          console.log(`🦄 UniswapX order: ${order.orderHash.slice(0, 10)}... on chain ${chainId}`);
          this.emit('order', order);
        }

        // Cleanup old processed orders (keep last 1000)
        if (this.processedOrders.size > 1000) {
          const arr = Array.from(this.processedOrders);
          const toKeep = new Set(arr.slice(-500));
          // Also cleanup pendingOrders
          for (const hash of this.pendingOrders.keys()) {
            if (!toKeep.has(hash)) {
              this.pendingOrders.delete(hash);
            }
          }
          this.processedOrders = toKeep;
        }
      } catch (err) {
        console.error(`UniswapX API error for chain ${chainId}:`, err);
      }
    }
  }

  private async fetchOpenOrders(chainId: number): Promise<UniswapXOrder[]> {
    const url = `${UNISWAPX_API.mainnet}?chainId=${chainId}&orderStatus=open&limit=50`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`UniswapX API returned ${response.status}`);
    }

    const data = await response.json() as { orders: Array<{
      orderHash: string;
      chainId: number;
      swapper: string;
      reactor: string;
      deadline: number;
      input: { token: string; startAmount: string; endAmount: string };
      outputs: Array<{ token: string; startAmount: string; endAmount: string; recipient: string }>;
      decayStartTime: number;
      decayEndTime: number;
      exclusiveFiller?: string;
      exclusivityOverrideBps?: number;
      nonce: string;
      encodedOrder: string;
      signature: string;
      createdAt: number;
      orderStatus: string;
    }> };

    return data.orders.map(o => ({
      orderHash: o.orderHash as `0x${string}`,
      chainId: o.chainId,
      swapper: o.swapper as Address,
      reactor: o.reactor as Address,
      deadline: o.deadline,
      input: {
        token: o.input.token as Address,
        amount: BigInt(o.input.startAmount), // Use start amount for evaluation
      },
      outputs: o.outputs.map(out => ({
        token: out.token as Address,
        amount: BigInt(out.endAmount), // Use end amount (what we need to provide)
        recipient: out.recipient as Address,
      })),
      decayStartTime: o.decayStartTime,
      decayEndTime: o.decayEndTime,
      exclusiveFiller: o.exclusiveFiller as Address | undefined,
      exclusivityOverrideBps: o.exclusivityOverrideBps,
      nonce: BigInt(o.nonce),
      encodedOrder: o.encodedOrder as `0x${string}`,
      signature: o.signature as `0x${string}`,
      createdAt: o.createdAt,
      orderStatus: o.orderStatus as 'open' | 'filled' | 'expired' | 'cancelled',
    }));
  }

  /**
   * Fill a UniswapX order
   * 
   * Note: Proper UniswapX filling requires:
   * 1. Having output tokens available
   * 2. Approving reactor to spend output tokens
   * 3. Calling execute/executeSingle on the reactor
   * 
   * This implementation uses direct execution - filler must have tokens ready
   */
  async fill(order: UniswapXOrder): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(order.chainId);
    const reactor = UNISWAPX_REACTORS[order.chainId];

    if (!client?.wallet) {
      return { success: false, error: 'No wallet for chain' };
    }
    if (!reactor) {
      return { success: false, error: 'No reactor on chain' };
    }

    // Check deadline
    const now = Math.floor(Date.now() / 1000);
    if (now > order.deadline) {
      return { success: false, error: 'Order expired' };
    }

    // Check exclusivity
    if (
      order.exclusiveFiller &&
      order.exclusiveFiller !== '0x0000000000000000000000000000000000000000' &&
      now < order.decayStartTime &&
      order.exclusiveFiller !== client.wallet.account?.address
    ) {
      return { success: false, error: 'Exclusive filler period active' };
    }

    // Execute via reactor - use executeSingle for single order fills
    // The filler (us) must have pre-approved and have output tokens ready
    const EXECUTE_SINGLE_ABI = [{
      type: 'function',
      name: 'executeSingle',
      inputs: [
        { name: 'order', type: 'bytes' },
        { name: 'sig', type: 'bytes' },
      ],
      outputs: [],
      stateMutability: 'payable',
    }] as const;

    const hash = await client.wallet.writeContract({
      chain: client.wallet.chain,
      account: client.wallet.account!,
      address: reactor,
      abi: EXECUTE_SINGLE_ABI,
      functionName: 'executeSingle',
      args: [order.encodedOrder, order.signature],
    });

    const receipt = await client.public.waitForTransactionReceipt({ hash });

    if (receipt.status === 'reverted') {
      return { success: false, error: 'Transaction reverted' };
    }

    console.log(`   ✅ UniswapX fill success: ${hash}`);
    return { success: true, txHash: hash };
  }

  /**
   * Calculate current output amount considering decay
   */
  getCurrentOutputAmount(order: UniswapXOrder): bigint {
    const now = Math.floor(Date.now() / 1000);
    
    if (now <= order.decayStartTime) {
      // Before decay - return start amount
      return order.outputs.reduce((sum, o) => sum + o.amount, 0n);
    }
    
    if (now >= order.decayEndTime) {
      // After decay - return end amount (minimum)
      return order.outputs.reduce((sum, o) => sum + o.amount, 0n);
    }
    
    // During decay - linear interpolation
    // Amount increases during decay (worse for filler)
    const elapsed = BigInt(now - order.decayStartTime);
    const duration = BigInt(order.decayEndTime - order.decayStartTime);
    const decayProgress = duration > 0n ? (elapsed * 10000n) / duration : 0n;
    
    let totalOutput = 0n;
    for (const output of order.outputs) {
      // Apply decay: startAmount + (endAmount - startAmount) * progress
      // Since we only have final amount, estimate start as 95% of final
      const startAmount = (output.amount * 95n) / 100n;
      const decayedAmount = startAmount + ((output.amount - startAmount) * decayProgress) / 10000n;
      totalOutput += decayedAmount;
    }
    
    return totalOutput;
  }

  /**
   * Evaluate profitability of filling an order
   */
  evaluateProfitability(
    order: UniswapXOrder,
    gasPrice: bigint,
    _ethPriceUsd: number
  ): { profitable: boolean; expectedProfitBps: number; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    
    // Check deadline
    if (now > order.deadline) {
      return { profitable: false, expectedProfitBps: 0, reason: 'Order expired' };
    }

    // Calculate current output needed
    const outputNeeded = this.getCurrentOutputAmount(order);
    const inputReceived = order.input.amount;
    
    // For same-token swaps, profit is input - output
    // For cross-token, need price oracle
    const spread = inputReceived - outputNeeded;
    
    // Estimate gas cost (~300k gas for fill)
    const gasCost = BigInt(300000) * gasPrice;
    
    if (spread <= gasCost) {
      return { profitable: false, expectedProfitBps: 0, reason: 'Spread below gas cost' };
    }

    const profitBps = Number((spread * BigInt(10000)) / inputReceived);
    
    if (profitBps < 5) {
      return { profitable: false, expectedProfitBps: profitBps, reason: 'Below minimum profit' };
    }

    return { profitable: true, expectedProfitBps: profitBps };
  }
}

