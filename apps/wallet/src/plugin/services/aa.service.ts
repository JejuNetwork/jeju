/**
 * Account Abstraction Service
 * 
 * Handles ERC-4337 Smart Accounts and ERC-7702 delegated EOAs.
 * Integrates with network's bundler and paymaster infrastructure.
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
  UserOperation,
  SmartAccountInfo,
  SessionKey,
  AAServiceConfig,
} from '../types';

// EntryPoint v0.7 ABI (partial)
const ENTRY_POINT_ABI = [
  {
    name: 'handleOps',
    type: 'function',
    inputs: [
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'callGasLimit', type: 'uint256' },
          { name: 'verificationGasLimit', type: 'uint256' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'getUserOpHash',
    type: 'function',
    inputs: [
      {
        name: 'userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'callGasLimit', type: 'uint256' },
          { name: 'verificationGasLimit', type: 'uint256' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getNonce',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Simple Account Factory ABI
const ACCOUNT_FACTORY_ABI = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
  {
    name: 'getAddress',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

// Default addresses (Network deployment)
const DEFAULT_ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address;
const DEFAULT_ACCOUNT_FACTORY = '0x0000000000000000000000000000000000000000' as Address;

export class AccountAbstractionService {
  static readonly serviceType = 'jeju-aa';
  
  private runtime: IAgentRuntime | null = null;
  private publicClients: Map<number, PublicClient> = new Map();
  private config: AAServiceConfig;
  
  constructor() {
    this.config = {
      entryPointAddress: DEFAULT_ENTRY_POINT,
      accountFactoryAddress: DEFAULT_ACCOUNT_FACTORY,
      bundlerUrl: 'http://localhost:4010/bundler',
      supportedChains: [8453, 1, 42161, 10, 137],
    };
  }
  
  get serviceType(): string {
    return AccountAbstractionService.serviceType;
  }
  
  static async start(): Promise<AccountAbstractionService> {
    return new AccountAbstractionService();
  }
  
  static async stop(): Promise<void> {
    // Cleanup
  }
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    runtime.logger.info('[AAService] Initialized');
  }
  
  async stop(): Promise<void> {
    this.runtime?.logger.info('[AAService] Stopped');
  }
  
  /**
   * Get or compute the counterfactual smart account address for an owner
   */
  async getSmartAccountAddress(
    owner: Address,
    chainId: number,
    salt: bigint = BigInt(0)
  ): Promise<Address> {
    const publicClient = this.getPublicClient(chainId);
    
    const address = await publicClient.readContract({
      address: this.config.accountFactoryAddress,
      abi: ACCOUNT_FACTORY_ABI,
      functionName: 'getAddress',
      args: [owner, salt],
    }) as Address;
    
    return address;
  }
  
  /**
   * Check if a smart account is deployed
   */
  async isAccountDeployed(address: Address, chainId: number): Promise<boolean> {
    const publicClient = this.getPublicClient(chainId);
    const code = await publicClient.getBytecode({ address });
    return code !== undefined && code !== '0x';
  }
  
  /**
   * Get smart account info
   */
  async getSmartAccountInfo(
    address: Address,
    chainId: number
  ): Promise<SmartAccountInfo> {
    const publicClient = this.getPublicClient(chainId);
    
    const isDeployed = await this.isAccountDeployed(address, chainId);
    
    let nonce = BigInt(0);
    if (isDeployed) {
      nonce = await publicClient.readContract({
        address: this.config.entryPointAddress,
        abi: ENTRY_POINT_ABI,
        functionName: 'getNonce',
        args: [address, BigInt(0)],
      }) as bigint;
    }
    
    return {
      address,
      owner: address,
      isDeployed,
      implementation: '0x0000000000000000000000000000000000000000' as Address,
      nonce,
      entryPoint: this.config.entryPointAddress,
    };
  }
  
  /**
   * Build a UserOperation for a transaction
   */
  async buildUserOperation(options: {
    sender: Address;
    chainId: number;
    calls: Array<{
      to: Address;
      value?: bigint;
      data?: Hex;
    }>;
    paymasterData?: Hex;
  }): Promise<UserOperation> {
    const publicClient = this.getPublicClient(options.chainId);
    
    // Get account info
    const accountInfo = await this.getSmartAccountInfo(options.sender, options.chainId);
    
    // Build initCode if not deployed
    let initCode: Hex = '0x';
    if (!accountInfo.isDeployed) {
      initCode = this.buildInitCode(options.sender, BigInt(0));
    }
    
    // Build callData for batched calls
    const callData = this.encodeExecuteBatch(options.calls);
    
    // Estimate gas
    const gasEstimates = this.estimateUserOpGas(initCode !== '0x');
    
    // Get gas prices
    const feeData = await publicClient.estimateFeesPerGas();
    
    const userOp: UserOperation = {
      sender: options.sender,
      nonce: accountInfo.nonce,
      initCode,
      callData,
      callGasLimit: gasEstimates.callGasLimit,
      verificationGasLimit: gasEstimates.verificationGasLimit,
      preVerificationGas: gasEstimates.preVerificationGas,
      maxFeePerGas: feeData.maxFeePerGas || BigInt(0),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt(0),
      paymasterAndData: options.paymasterData || '0x',
      signature: '0x',
    };
    
    return userOp;
  }
  
  /**
   * Build initCode for account deployment
   */
  private buildInitCode(owner: Address, salt: bigint): Hex {
    const initCallData = encodeFunctionData({
      abi: ACCOUNT_FACTORY_ABI,
      functionName: 'createAccount',
      args: [owner, salt],
    });
    
    return concat([this.config.accountFactoryAddress, initCallData]);
  }
  
  /**
   * Encode execute batch call data
   */
  private encodeExecuteBatch(calls: Array<{
    to: Address;
    value?: bigint;
    data?: Hex;
  }>): Hex {
    const targets = calls.map(c => c.to);
    const values = calls.map(c => c.value || BigInt(0));
    const datas = calls.map(c => c.data || '0x' as Hex);
    
    return encodeFunctionData({
      abi: [{
        name: 'executeBatch',
        type: 'function',
        inputs: [
          { name: 'dest', type: 'address[]' },
          { name: 'value', type: 'uint256[]' },
          { name: 'func', type: 'bytes[]' },
        ],
        outputs: [],
      }],
      functionName: 'executeBatch',
      args: [targets, values, datas],
    });
  }
  
  /**
   * Estimate gas for UserOperation
   */
  private estimateUserOpGas(hasInitCode: boolean): {
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
  } {
    return {
      callGasLimit: BigInt(200000),
      verificationGasLimit: hasInitCode ? BigInt(500000) : BigInt(150000),
      preVerificationGas: BigInt(50000),
    };
  }
  
  /**
   * Get UserOperation hash for signing
   */
  async getUserOpHash(userOp: UserOperation, chainId: number): Promise<Hex> {
    const publicClient = this.getPublicClient(chainId);
    
    const hash = await publicClient.readContract({
      address: this.config.entryPointAddress,
      abi: ENTRY_POINT_ABI,
      functionName: 'getUserOpHash',
      args: [userOp],
    }) as Hex;
    
    return hash;
  }
  
  /**
   * Submit signed UserOperation to bundler
   */
  async submitUserOperation(
    userOp: UserOperation,
    chainId: number
  ): Promise<Hex> {
    this.runtime?.logger.info(`[AAService] Submitting UserOp to bundler`);
    
    const response = await fetch(`${this.config.bundlerUrl}/${chainId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [
          {
            sender: userOp.sender,
            nonce: toHex(userOp.nonce),
            initCode: userOp.initCode,
            callData: userOp.callData,
            callGasLimit: toHex(userOp.callGasLimit),
            verificationGasLimit: toHex(userOp.verificationGasLimit),
            preVerificationGas: toHex(userOp.preVerificationGas),
            maxFeePerGas: toHex(userOp.maxFeePerGas),
            maxPriorityFeePerGas: toHex(userOp.maxPriorityFeePerGas),
            paymasterAndData: userOp.paymasterAndData,
            signature: userOp.signature,
          },
          this.config.entryPointAddress,
        ],
      }),
    });
    
    const result = await response.json() as { result?: Hex; error?: { message: string } };
    
    if (result.error) {
      throw new Error(`Bundler error: ${result.error.message}`);
    }
    
    return result.result as Hex;
  }
  
  /**
   * Wait for UserOperation to be included
   */
  async waitForUserOperation(
    userOpHash: Hex,
    chainId: number,
    timeout: number = 60000
  ): Promise<{ txHash: Hex; success: boolean }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const response = await fetch(`${this.config.bundlerUrl}/${chainId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getUserOperationReceipt',
          params: [userOpHash],
        }),
      });
      
      const result = await response.json() as { result?: { receipt: { transactionHash: Hex }; success: boolean } };
      
      if (result.result) {
        return {
          txHash: result.result.receipt.transactionHash,
          success: result.result.success,
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('UserOperation timeout');
  }
  
  /**
   * Build ERC-7702 authorization for delegating EOA to smart account
   */
  async build7702Authorization(options: {
    eoa: Address;
    implementation: Address;
    chainId: number;
    nonce?: bigint;
  }): Promise<{
    chainId: number;
    address: Address;
    nonce: bigint;
  }> {
    const publicClient = this.getPublicClient(options.chainId);
    
    const nonce = options.nonce ?? BigInt(await publicClient.getTransactionCount({
      address: options.eoa,
    }));
    
    return {
      chainId: options.chainId,
      address: options.implementation,
      nonce,
    };
  }
  
  /**
   * Create a session key for limited permissions
   */
  async createSessionKey(options: {
    smartAccount: Address;
    chainId: number;
    permissions: Array<{
      target: Address;
      selector?: Hex;
      maxValue?: bigint;
    }>;
    validUntil: number;
  }): Promise<SessionKey> {
    const { privateKeyToAccount } = await import('viem/accounts');
    const sessionPrivateKey = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);
    
    const sessionKey: SessionKey = {
      publicKey: sessionAccount.address,
      validUntil: options.validUntil,
      validAfter: Math.floor(Date.now() / 1000),
      permissions: options.permissions.map(p => ({
        target: p.target,
        selector: p.selector,
        maxValue: p.maxValue,
      })),
    };
    
    return sessionKey;
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

export default AccountAbstractionService;
