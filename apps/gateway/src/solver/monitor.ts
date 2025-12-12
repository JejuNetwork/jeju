import { type PublicClient, parseAbiItem } from 'viem';
import { EventEmitter } from 'events';
import { INPUT_SETTLERS, bytes32ToAddress } from './contracts';

export interface IntentEvent {
  orderId: string;
  user: string;
  sourceChain: number;
  destinationChain: number;
  inputToken: string;
  inputAmount: string;
  outputToken: string;
  outputAmount: string;
  recipient: string;
  deadline: number;
  blockNumber: bigint;
  transactionHash: string;
}

const OPEN_EVENT = parseAbiItem(
  'event Open(bytes32 indexed orderId, (address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, (uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) order)'
);

interface EventArgs {
  orderId?: `0x${string}`;
  order?: {
    user?: `0x${string}`;
    maxSpent?: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
    minReceived?: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
    fillDeadline?: number;
  };
}

export class EventMonitor extends EventEmitter {
  private chains: Array<{ chainId: number; name: string }>;
  private unwatchers: Array<() => void> = [];
  private running = false;

  constructor(config: { chains: Array<{ chainId: number; name: string }> }) {
    super();
    this.chains = config.chains;
  }

  async start(clients: Map<number, { public: PublicClient }>): Promise<void> {
    this.running = true;
    console.log('👁️ Starting event monitor...');

    for (const chain of this.chains) {
      const client = clients.get(chain.chainId);
      const settler = INPUT_SETTLERS[chain.chainId];
      if (!client) continue;
      if (!settler) {
        console.warn(`   ⚠️ No settler for ${chain.name}, skipping`);
        continue;
      }

      const unwatch = client.public.watchContractEvent({
        address: settler,
        abi: [OPEN_EVENT],
        eventName: 'Open',
        onLogs: (logs) => {
          for (const log of logs) {
            const event = this.parseEvent(chain.chainId, log);
            if (event) this.emit('intent', event);
          }
        },
        onError: (err) => console.error(`Event error on ${chain.name}:`, err.message),
      });

      this.unwatchers.push(unwatch);
      console.log(`   ✓ Watching ${chain.name}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatchers.forEach(fn => fn());
    this.unwatchers = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  private parseEvent(
    chainId: number,
    log: { args: Record<string, unknown>; blockNumber: bigint; transactionHash: `0x${string}` }
  ): IntentEvent | null {
    const args = log.args as EventArgs;

    // Validate required struct
    if (!args.orderId || !args.order?.maxSpent?.[0] || !args.order?.minReceived?.[0]) {
      console.warn('⚠️ Malformed event, skipping');
      return null;
    }

    const spent = args.order.maxSpent[0];
    const received = args.order.minReceived[0];

    // Validate amounts and addresses
    if (!spent.amount || spent.amount <= 0n || !received.amount || received.amount <= 0n) {
      console.warn('⚠️ Invalid amounts, skipping');
      return null;
    }
    if (!spent.token || !received.token || !received.recipient) {
      console.warn('⚠️ Invalid addresses, skipping');
      return null;
    }

    return {
      orderId: args.orderId,
      user: args.order.user || '0x',
      sourceChain: chainId,
      destinationChain: Number(received.chainId || 0),
      inputToken: bytes32ToAddress(spent.token),
      inputAmount: spent.amount.toString(),
      outputToken: bytes32ToAddress(received.token),
      outputAmount: received.amount.toString(),
      recipient: bytes32ToAddress(received.recipient),
      deadline: args.order.fillDeadline || 0,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  }
}
