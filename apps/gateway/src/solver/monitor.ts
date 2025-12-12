import { type PublicClient, parseAbiItem } from 'viem';
import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

// ERC-7683 Open event from InputSettler
const OPEN_EVENT = parseAbiItem(
  'event Open(bytes32 indexed orderId, (address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, (uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) order)'
);

function loadSettlers(): Record<number, `0x${string}`> {
  const path = resolve(process.cwd(), '../../packages/config/contracts.json');
  if (!existsSync(path)) {
    console.warn('⚠️ contracts.json not found');
    return {};
  }
  
  const contracts = JSON.parse(readFileSync(path, 'utf-8'));
  const out: Record<number, `0x${string}`> = {};

  for (const chain of Object.values(contracts.external || {})) {
    const c = chain as { chainId?: number; oif?: { inputSettler?: string } };
    if (c.chainId && c.oif?.inputSettler) out[c.chainId] = c.oif.inputSettler as `0x${string}`;
  }
  for (const net of ['testnet', 'mainnet'] as const) {
    const cfg = contracts[net];
    if (cfg?.chainId && cfg?.oif?.inputSettler) out[cfg.chainId] = cfg.oif.inputSettler as `0x${string}`;
  }
  return out;
}

const SETTLERS = loadSettlers();

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
      const settler = SETTLERS[chain.chainId];
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
    const args = log.args as {
      orderId?: `0x${string}`;
      order?: {
        user?: `0x${string}`;
        maxSpent?: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
        minReceived?: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
        fillDeadline?: number;
      };
    };

    // Validate required fields
    if (!args.orderId) {
      console.warn('⚠️ Event missing orderId, skipping');
      return null;
    }
    if (!args.order) {
      console.warn('⚠️ Event missing order struct, skipping');
      return null;
    }
    if (!args.order.maxSpent?.length) {
      console.warn('⚠️ Event has empty maxSpent array, skipping');
      return null;
    }
    if (!args.order.minReceived?.length) {
      console.warn('⚠️ Event has empty minReceived array, skipping');
      return null;
    }

    const spent = args.order.maxSpent[0];
    const received = args.order.minReceived[0];

    // Validate amounts are positive
    if (!spent.amount || spent.amount <= 0n) {
      console.warn('⚠️ Invalid input amount, skipping');
      return null;
    }
    if (!received.amount || received.amount <= 0n) {
      console.warn('⚠️ Invalid output amount, skipping');
      return null;
    }

    // Validate addresses
    if (!spent.token || spent.token.length < 42) {
      console.warn('⚠️ Invalid input token address, skipping');
      return null;
    }
    if (!received.token || received.token.length < 42) {
      console.warn('⚠️ Invalid output token address, skipping');
      return null;
    }
    if (!received.recipient || received.recipient.length < 42) {
      console.warn('⚠️ Invalid recipient address, skipping');
      return null;
    }

    // Convert bytes32 addresses to address format (first 20 bytes)
    const inputToken = '0x' + spent.token.slice(26);
    const outputToken = '0x' + received.token.slice(26);
    const recipient = '0x' + received.recipient.slice(26);

    return {
      orderId: args.orderId,
      user: args.order.user || '0x',
      sourceChain: chainId,
      destinationChain: Number(received.chainId || 0),
      inputToken,
      inputAmount: spent.amount.toString(),
      outputToken,
      outputAmount: received.amount.toString(),
      recipient,
      deadline: args.order.fillDeadline || 0,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    };
  }
}
