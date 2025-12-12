import { type PublicClient, parseAbiItem } from 'viem';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
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
  orderType?: string;
  originData?: string;
}

interface MonitorConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  intentCheckIntervalMs: number;
}

const OPEN_EVENT = parseAbiItem(
  'event Open(bytes32 indexed orderId, (address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, (uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) order)'
);

// Load settler addresses from contracts.json
function loadSettlerAddresses(): Record<number, `0x${string}`> {
  const configPath = resolve(process.cwd(), '../../packages/config/contracts.json');
  const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  const addresses: Record<number, `0x${string}`> = {};
  
  // Load from external chains
  if (contracts.external) {
    for (const [, chain] of Object.entries(contracts.external)) {
      const c = chain as { chainId?: number; oif?: { inputSettler?: string } };
      if (c.chainId && c.oif?.inputSettler) {
        addresses[c.chainId] = c.oif.inputSettler as `0x${string}`;
      }
    }
  }
  
  // Load from testnet/mainnet jeju config
  if (contracts.testnet?.oif?.inputSettler) {
    addresses[contracts.testnet.chainId] = contracts.testnet.oif.inputSettler as `0x${string}`;
  }
  if (contracts.mainnet?.oif?.inputSettler) {
    addresses[contracts.mainnet.chainId] = contracts.mainnet.oif.inputSettler as `0x${string}`;
  }
  
  return addresses;
}

const SETTLER_ADDRESSES = loadSettlerAddresses();

export class EventMonitor extends EventEmitter {
  private config: MonitorConfig;
  private clients: Map<number, { public: PublicClient }> = new Map();
  private running = false;
  private unwatchers: Array<() => void> = [];

  constructor(config: MonitorConfig) {
    super();
    this.config = config;
  }

  async start(clients: Map<number, { public: PublicClient }>): Promise<void> {
    this.clients = clients;
    this.running = true;

    console.log('👁️ Starting event monitor...');

    for (const chain of this.config.chains) {
      const client = clients.get(chain.chainId);
      const settlerAddress = SETTLER_ADDRESSES[chain.chainId];
      if (!client || !settlerAddress) continue;

      const unwatch = client.public.watchContractEvent({
        address: settlerAddress,
        abi: [OPEN_EVENT],
        eventName: 'Open',
        onLogs: (logs) => logs.forEach(log => this.processOpenEvent(chain.chainId, log)),
        onError: (error) => console.error(`Event watch error on ${chain.name}:`, error.message),
      });

      this.unwatchers.push(unwatch);
      console.log(`   ✓ Watching ${chain.name} InputSettler`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unwatchers.forEach(unwatch => unwatch());
    this.unwatchers = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  getClients(): Map<number, { public: PublicClient }> {
    return this.clients;
  }

  private processOpenEvent(chainId: number, log: { args: Record<string, unknown>; blockNumber: bigint; transactionHash: `0x${string}` }): void {
    const args = log.args as {
      orderId: `0x${string}`;
      order: {
        user: `0x${string}`;
        originChainId: bigint;
        openDeadline: number;
        fillDeadline: number;
        orderId: `0x${string}`;
        maxSpent: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
        minReceived: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
        fillInstructions: Array<{ destinationChainId: bigint; destinationSettler: `0x${string}`; originData: `0x${string}` }>;
      };
    };

    const order = args.order;
    const maxSpent = order.maxSpent[0];
    const minReceived = order.minReceived[0];

    this.emit('intent', {
      orderId: args.orderId,
      user: order.user,
      sourceChain: chainId,
      destinationChain: Number(minReceived?.chainId || 0),
      inputToken: maxSpent?.token.slice(0, 42) || '0x',
      inputAmount: maxSpent?.amount.toString() || '0',
      outputToken: minReceived?.token.slice(0, 42) || '0x',
      outputAmount: minReceived?.amount.toString() || '0',
      recipient: minReceived?.recipient.slice(0, 42) || '0x',
      deadline: order.fillDeadline,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    } as IntentEvent);
  }
}
