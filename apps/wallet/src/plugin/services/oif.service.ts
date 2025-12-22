/**
 * Open Intent Framework (OIF) Service
 * 
 * Handles intent-based transactions using the network's InputSettler/OutputSettler.
 * Enables users to express high-level goals that solvers optimize and execute.
 */

import type { IAgentRuntime } from '@elizaos/core';
import { 
  createPublicClient, 
  http,
  type PublicClient,
  type Address,
  type Hex,
  encodeFunctionData,
  keccak256,
  toHex,
  concat,
} from 'viem';
import type {
  Intent,
  IntentOrder,
  OIFServiceConfig,
} from '../types';
import {
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonNegative,
} from '../../lib/validation';

// InputSettler ABI (from the network contracts)
const INPUT_SETTLER_ABI = [
  {
    name: 'open',
    type: 'function',
    inputs: [
      { name: 'inputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputToken', type: 'address' },
      { name: 'minOutputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'resolver', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'orderId', type: 'bytes32' }],
  },
  {
    name: 'openFor',
    type: 'function',
    inputs: [
      { name: 'order', type: 'tuple', components: [
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'sourceChainId', type: 'uint256' },
        { name: 'openDeadline', type: 'uint256' },
        { name: 'fillDeadline', type: 'uint256' },
        { name: 'orderDataType', type: 'bytes32' },
        { name: 'orderData', type: 'bytes' },
      ]},
      { name: 'signature', type: 'bytes' },
      { name: 'originFillerData', type: 'bytes' },
    ],
    outputs: [{ name: 'orderId', type: 'bytes32' }],
  },
  {
    name: 'getOrder',
    type: 'function',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputToken', type: 'address' },
      { name: 'minOutputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'resolver', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
] as const;

export class OIFService {
  static readonly serviceType = 'jeju-oif';
  
  private runtime: IAgentRuntime | null = null;
  private publicClients: Map<number, PublicClient> = new Map();
  private config: OIFServiceConfig;
  
  // Cache for intent status
  private intentCache: Map<string, { intent: Intent; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 10000;
  
  constructor() {
    this.config = {
      inputSettlerAddress: '0x0000000000000000000000000000000000000000' as Address,
      outputSettlerAddresses: new Map([
        [8453, '0x0000000000000000000000000000000000000000' as Address],
        [1, '0x0000000000000000000000000000000000000000' as Address],
        [42161, '0x0000000000000000000000000000000000000000' as Address],
        [10, '0x0000000000000000000000000000000000000000' as Address],
        [137, '0x0000000000000000000000000000000000000000' as Address],
      ]),
      supportedChains: [8453, 1, 42161, 10, 137],
    };
  }
  
  get serviceType(): string {
    return OIFService.serviceType;
  }
  
  static async start(): Promise<OIFService> {
    return new OIFService();
  }
  
  static async stop(): Promise<void> {
    // Cleanup
  }
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    runtime.logger.info('[OIFService] Initialized');
  }
  
  async stop(): Promise<void> {
    this.runtime?.logger.info('[OIFService] Stopped');
  }
  
  /**
   * Create a new intent/order
   */
  async createIntent(options: {
    sourceChainId: number;
    destinationChainId: number;
    inputToken: Address;
    inputAmount: bigint;
    outputToken: Address;
    minOutputAmount: bigint;
    resolver?: Address;
    deadline?: number;
    data?: Hex;
  }): Promise<{
    orderId: Hex;
    callData: Hex;
  }> {
    expectChainId(options.sourceChainId, 'sourceChainId');
    expectChainId(options.destinationChainId, 'destinationChainId');
    expectAddress(options.inputToken, 'inputToken');
    expectAddress(options.outputToken, 'outputToken');
    expectBigInt(options.inputAmount, 'inputAmount');
    expectBigInt(options.minOutputAmount, 'minOutputAmount');
    if (options.resolver) expectAddress(options.resolver, 'resolver');
    if (options.deadline) expectNonNegative(options.deadline, 'deadline');
    if (options.data) expectHex(options.data, 'data');

    this.runtime?.logger.info(`[OIFService] Creating intent: ${options.sourceChainId} -> ${options.destinationChainId}`);
    
    const deadline = options.deadline || Math.floor(Date.now() / 1000) + 3600;
    const resolver = options.resolver || '0x0000000000000000000000000000000000000000' as Address;
    
    const callData = encodeFunctionData({
      abi: INPUT_SETTLER_ABI,
      functionName: 'open',
      args: [
        options.inputToken,
        options.inputAmount,
        options.outputToken,
        options.minOutputAmount,
        BigInt(options.destinationChainId),
        resolver,
        BigInt(deadline),
        options.data || '0x',
      ],
    });
    
    const orderId = keccak256(
      toHex(
        JSON.stringify({
          inputToken: options.inputToken,
          inputAmount: options.inputAmount.toString(),
          outputToken: options.outputToken,
          destinationChainId: options.destinationChainId,
          deadline,
        })
      )
    );
    
    return {
      orderId,
      callData,
    };
  }
  
  /**
   * Create intent for gasless execution (ERC-7683 style)
   */
  async createGaslessIntent(options: {
    user: Address;
    sourceChainId: number;
    destinationChainId: number;
    inputToken: Address;
    inputAmount: bigint;
    outputToken: Address;
    minOutputAmount: bigint;
    fillDeadline?: number;
  }): Promise<{
    order: IntentOrder;
    signatureData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }> {
    expectAddress(options.user, 'user');
    expectChainId(options.sourceChainId, 'sourceChainId');
    expectChainId(options.destinationChainId, 'destinationChainId');
    expectAddress(options.inputToken, 'inputToken');
    expectAddress(options.outputToken, 'outputToken');
    expectBigInt(options.inputAmount, 'inputAmount');
    expectBigInt(options.minOutputAmount, 'minOutputAmount');
    if (options.fillDeadline) expectNonNegative(options.fillDeadline, 'fillDeadline');

    const openDeadline = Math.floor(Date.now() / 1000) + 300;
    const fillDeadline = options.fillDeadline || Math.floor(Date.now() / 1000) + 3600;
    
    const order: IntentOrder = {
      user: options.user,
      nonce: BigInt(Date.now()),
      sourceChainId: options.sourceChainId,
      openDeadline,
      fillDeadline,
      orderDataType: keccak256(toHex('CROSS_CHAIN_SWAP')),
      orderData: concat([
        options.inputToken,
        toHex(options.inputAmount, { size: 32 }),
        options.outputToken,
        toHex(options.minOutputAmount, { size: 32 }),
        toHex(options.destinationChainId, { size: 32 }),
      ]),
    };
    
    const signatureData = {
      domain: {
        name: 'InputSettler',
        version: '1',
        chainId: options.sourceChainId,
        verifyingContract: this.config.inputSettlerAddress,
      },
      types: {
        GaslessCrossChainOrder: [
          { name: 'user', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'sourceChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint256' },
          { name: 'fillDeadline', type: 'uint256' },
          { name: 'orderDataType', type: 'bytes32' },
          { name: 'orderData', type: 'bytes' },
        ],
      },
      primaryType: 'GaslessCrossChainOrder' as const,
      message: {
        user: order.user,
        nonce: order.nonce.toString(),
        sourceChainId: order.sourceChainId,
        openDeadline: order.openDeadline,
        fillDeadline: order.fillDeadline,
        orderDataType: order.orderDataType,
        orderData: order.orderData,
      },
    };
    
    return { order, signatureData };
  }
  
  /**
   * Submit a signed gasless order
   */
  buildOpenForCallData(order: IntentOrder, signature: Hex): Hex {
    return encodeFunctionData({
      abi: INPUT_SETTLER_ABI,
      functionName: 'openFor',
      args: [
        {
          user: order.user,
          nonce: order.nonce,
          sourceChainId: BigInt(order.sourceChainId),
          openDeadline: BigInt(order.openDeadline),
          fillDeadline: BigInt(order.fillDeadline),
          orderDataType: order.orderDataType,
          orderData: order.orderData,
        },
        signature,
        '0x',
      ],
    });
  }
  
  /**
   * Get intent/order status
   */
  async getIntent(orderId: Hex, chainId: number): Promise<Intent | null> {
    expectHex(orderId, 'orderId');
    expectChainId(chainId, 'chainId');

    const cacheKey = `${chainId}-${orderId}`;
    const cached = this.intentCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.intent;
    }
    
    const publicClient = this.getPublicClient(chainId);
    
    const result = await publicClient.readContract({
      address: this.config.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'getOrder',
      args: [orderId],
    });
    
    const [user, inputToken, inputAmount, outputToken, minOutputAmount, destinationChainId, resolver, deadline, status] = result as [Address, Address, bigint, Address, bigint, bigint, Address, bigint, number];
    
    if (!user || user === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    
    const statusMap: Record<number, Intent['status']> = {
      0: 'pending',
      1: 'open',
      2: 'filled',
      3: 'settled',
      4: 'cancelled',
      5: 'expired',
    };
    
    const intent: Intent = {
      id: orderId,
      user,
      sourceChainId: chainId,
      destinationChainId: Number(destinationChainId),
      inputToken,
      inputAmount,
      outputToken,
      minOutputAmount,
      resolver,
      deadline: Number(deadline),
      status: statusMap[status] || 'pending',
      createdAt: Date.now(),
    };
    
    this.intentCache.set(cacheKey, { intent, timestamp: Date.now() });
    
    return intent;
  }
  
  /**
   * Express a natural language intent and convert to structured intent
   */
  parseIntent(naturalLanguage: string): {
    action: 'swap' | 'transfer' | 'stake' | 'unknown';
    amount?: string;
    inputToken?: string;
    outputToken?: string;
    chain?: string;
    recipient?: string;
  } {
    const lower = naturalLanguage.toLowerCase();
    
    if (lower.includes('swap') || lower.includes('exchange') || lower.includes('trade')) {
      const amountMatch = lower.match(/(\d+(?:\.\d+)?)\s*(\w+)/);
      const forMatch = lower.match(/for\s+(\w+)/);
      const onMatch = lower.match(/on\s+(\w+)/);
      
      return {
        action: 'swap',
        amount: amountMatch?.[1],
        inputToken: amountMatch?.[2]?.toUpperCase(),
        outputToken: forMatch?.[1]?.toUpperCase(),
        chain: onMatch?.[1],
      };
    }
    
    if (lower.includes('send') || lower.includes('transfer')) {
      const amountMatch = lower.match(/(\d+(?:\.\d+)?)\s*(\w+)/);
      const toMatch = lower.match(/to\s+(0x[a-fA-F0-9]{40})/);
      const onMatch = lower.match(/on\s+(\w+)/);
      
      return {
        action: 'transfer',
        amount: amountMatch?.[1],
        inputToken: amountMatch?.[2]?.toUpperCase(),
        recipient: toMatch?.[1],
        chain: onMatch?.[1],
      };
    }
    
    return { action: 'unknown' };
  }
  
  /**
   * Get solver recommendations for an intent
   */
  async getSolverRecommendations(_options: {
    sourceChainId: number;
    destinationChainId: number;
    inputToken: Address;
    inputAmount: bigint;
    outputToken: Address;
  }): Promise<Array<{
    solver: Address;
    reputation: number;
    estimatedOutput: bigint;
    fee: bigint;
    estimatedTime: number;
  }>> {
    return [
      {
        solver: '0x1234567890123456789012345678901234567890' as Address,
        reputation: 95,
        estimatedOutput: BigInt(1000),
        fee: BigInt(10),
        estimatedTime: 60,
      },
    ];
  }
  
  private getPublicClient(chainId: number): PublicClient {
    let client = this.publicClients.get(chainId);
    if (!client) {
      client = createPublicClient({
        transport: http(`http://localhost:4010/rpc/${chainId}`),
      });
      this.publicClients.set(chainId, client);
    }
    return client;
  }
}

export default OIFService;
