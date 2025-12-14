/**
 * @fileoverview ERC-4337 Account Abstraction SDK
 *
 * Enables smart contract wallets with:
 * - Gasless transactions via paymasters
 * - Batched operations
 * - Social recovery
 * - Multi-sig support
 * - Session keys
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import {
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  concat,
  toHex,
  pad,
} from 'viem';
import type { SmartAccount, UserOperation, GasEstimate, GasOption } from './types';
import { getChainContracts } from './chains';

// ============================================================================
// ABI Fragments
// ============================================================================

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
    stateMutability: 'nonpayable',
  },
  {
    name: 'getNonce',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
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
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'depositTo',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const SIMPLE_ACCOUNT_FACTORY_ABI = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'ret', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAddress',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const SIMPLE_ACCOUNT_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeBatch',
    type: 'function',
    inputs: [
      { name: 'dest', type: 'address[]' },
      { name: 'func', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'owner',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// Constants
// ============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address;

// Default gas limits
const DEFAULT_VERIFICATION_GAS_LIMIT = 100000n;
const DEFAULT_CALL_GAS_LIMIT = 200000n;
const DEFAULT_PRE_VERIFICATION_GAS = 50000n;

// ============================================================================
// Account Abstraction Client
// ============================================================================

export interface AAClientConfig {
  chainId: number;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  entryPointAddress?: Address;
  bundlerUrl?: string;
  paymasterUrl?: string;
}

export interface Call {
  to: Address;
  value?: bigint;
  data?: Hex;
}

export interface SmartAccountConfig {
  owner: Address;
  salt?: bigint;
  factoryAddress?: Address;
  implementation?: 'simple' | 'safe' | 'kernel' | 'light';
}

export class AAClient {
  private config: AAClientConfig;
  private entryPoint: Address;
  private bundlerUrl: string;
  private paymasterUrl: string | undefined;

  constructor(config: AAClientConfig) {
    this.config = config;
    const contracts = getChainContracts(config.chainId);
    this.entryPoint = config.entryPointAddress ?? contracts.entryPoint ?? ENTRY_POINT_V06;
    this.bundlerUrl = config.bundlerUrl ?? 'https://bundler.jeju.network';
    this.paymasterUrl = config.paymasterUrl;
  }

  /**
   * Get or compute smart account address
   */
  async getSmartAccountAddress(
    owner: Address,
    salt: bigint = 0n,
    factoryAddress?: Address
  ): Promise<Address> {
    if (!factoryAddress) {
      throw new Error('Factory address required');
    }

    const address = await this.config.publicClient.readContract({
      address: factoryAddress,
      abi: SIMPLE_ACCOUNT_FACTORY_ABI,
      functionName: 'getAddress',
      args: [owner, salt],
    });

    return address;
  }

  /**
   * Check if smart account is deployed
   */
  async isAccountDeployed(address: Address): Promise<boolean> {
    const code = await this.config.publicClient.getCode({ address });
    return code !== undefined && code !== '0x';
  }

  /**
   * Get account nonce from EntryPoint
   */
  async getNonce(sender: Address, key: bigint = 0n): Promise<bigint> {
    const nonce = await this.config.publicClient.readContract({
      address: this.entryPoint,
      abi: ENTRY_POINT_ABI,
      functionName: 'getNonce',
      args: [sender, key],
    });
    return nonce;
  }

  /**
   * Build init code for account deployment
   */
  buildInitCode(
    factoryAddress: Address,
    owner: Address,
    salt: bigint = 0n
  ): Hex {
    const createAccountData = encodeFunctionData({
      abi: SIMPLE_ACCOUNT_FACTORY_ABI,
      functionName: 'createAccount',
      args: [owner, salt],
    });

    return concat([factoryAddress, createAccountData]);
  }

  /**
   * Build call data for single call
   */
  buildCallData(call: Call): Hex {
    return encodeFunctionData({
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'execute',
      args: [call.to, call.value ?? 0n, call.data ?? '0x'],
    });
  }

  /**
   * Build call data for batch calls
   */
  buildBatchCallData(calls: Call[]): Hex {
    const destinations = calls.map((c) => c.to);
    const datas = calls.map((c) => c.data ?? '0x');

    return encodeFunctionData({
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'executeBatch',
      args: [destinations, datas],
    });
  }

  /**
   * Estimate gas for UserOp
   */
  async estimateGas(
    userOp: Partial<UserOperation>,
    paymentTokens?: Address[]
  ): Promise<GasEstimate> {
    const { publicClient } = this.config;

    // Get current gas prices
    const feeData = await publicClient.estimateFeesPerGas();
    const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;

    // Estimate gas via bundler
    let gasLimits = {
      callGasLimit: DEFAULT_CALL_GAS_LIMIT,
      verificationGasLimit: DEFAULT_VERIFICATION_GAS_LIMIT,
      preVerificationGas: DEFAULT_PRE_VERIFICATION_GAS,
    };

    try {
      const response = await fetch(`${this.bundlerUrl}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_estimateUserOperationGas',
          params: [userOp, this.entryPoint],
        }),
      });

      const data = await response.json();
      if (data.result) {
        gasLimits = {
          callGasLimit: BigInt(data.result.callGasLimit),
          verificationGasLimit: BigInt(data.result.verificationGasLimit),
          preVerificationGas: BigInt(data.result.preVerificationGas),
        };
      }
    } catch {
      // Use defaults
    }

    const totalGas =
      gasLimits.callGasLimit +
      gasLimits.verificationGasLimit +
      gasLimits.preVerificationGas;

    const totalCostEth = totalGas * maxFeePerGas;

    // Get token options if paymaster available
    let tokenOptions: GasOption[] = [];
    if (this.paymasterUrl && paymentTokens?.length) {
      try {
        const response = await fetch(`${this.paymasterUrl}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gasCostEth: totalCostEth.toString(),
            tokens: paymentTokens,
          }),
        });
        const data = await response.json();
        tokenOptions = data.options ?? [];
      } catch {
        // No token options available
      }
    }

    return {
      gasLimit: totalGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      totalCostEth,
      tokenOptions,
    };
  }

  /**
   * Build UserOperation
   */
  async buildUserOp(params: {
    sender: Address;
    calls: Call | Call[];
    initCode?: Hex;
    paymasterAndData?: Hex;
    nonce?: bigint;
    gasEstimate?: GasEstimate;
  }): Promise<UserOperation> {
    const { sender, calls, initCode = '0x', paymasterAndData = '0x' } = params;

    const callData = Array.isArray(calls)
      ? this.buildBatchCallData(calls)
      : this.buildCallData(calls);

    const nonce = params.nonce ?? (await this.getNonce(sender));

    const gasEstimate =
      params.gasEstimate ??
      (await this.estimateGas({
        sender,
        nonce,
        initCode,
        callData,
      }));

    return {
      sender,
      nonce,
      initCode,
      callData,
      callGasLimit: gasEstimate.gasLimit,
      verificationGasLimit: DEFAULT_VERIFICATION_GAS_LIMIT,
      preVerificationGas: DEFAULT_PRE_VERIFICATION_GAS,
      maxFeePerGas: gasEstimate.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      paymasterAndData,
      signature: '0x', // To be filled after signing
    };
  }

  /**
   * Get UserOperation hash for signing
   */
  async getUserOpHash(userOp: UserOperation): Promise<Hex> {
    // Cast through unknown to satisfy strict ABI typing
    const args = [userOp] as const;
    const hash = await this.config.publicClient.readContract({
      address: this.entryPoint,
      abi: ENTRY_POINT_ABI,
      functionName: 'getUserOpHash',
      // @ts-expect-error - Complex ABI tuple type
      args,
    });
    return hash as Hex;
  }

  /**
   * Sign UserOperation with wallet
   */
  async signUserOp(userOp: UserOperation): Promise<UserOperation> {
    const { walletClient } = this.config;
    if (!walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.getUserOpHash(userOp);
    const signature = await walletClient.signMessage({
      account: walletClient.account,
      message: { raw: hash },
    });

    return {
      ...userOp,
      signature,
    };
  }

  /**
   * Send UserOperation to bundler
   */
  async sendUserOp(userOp: UserOperation): Promise<Hex> {
    const response = await fetch(`${this.bundlerUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [userOp, this.entryPoint],
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message ?? 'Failed to send UserOp');
    }

    return data.result as Hex;
  }

  /**
   * Wait for UserOperation receipt
   */
  async waitForUserOp(userOpHash: Hex, timeout = 60000): Promise<{
    success: boolean;
    transactionHash?: Hex;
    reason?: string;
  }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`${this.bundlerUrl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getUserOperationReceipt',
            params: [userOpHash],
          }),
        });

        const data = await response.json();

        if (data.result) {
          return {
            success: data.result.success,
            transactionHash: data.result.receipt?.transactionHash,
            reason: data.result.reason,
          };
        }
      } catch {
        // Continue polling
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error('UserOp timeout');
  }

  /**
   * Execute calls via smart account
   * Complete flow: build -> estimate -> sign -> send -> wait
   */
  async execute(params: {
    sender: Address;
    calls: Call | Call[];
    paymasterAndData?: Hex;
    waitForReceipt?: boolean;
  }): Promise<{
    userOpHash: Hex;
    transactionHash?: Hex;
  }> {
    const isDeployed = await this.isAccountDeployed(params.sender);

    const userOp = await this.buildUserOp({
      sender: params.sender,
      calls: params.calls,
      initCode: isDeployed ? '0x' : undefined, // Would need factory for deployment
      paymasterAndData: params.paymasterAndData,
    });

    const signedOp = await this.signUserOp(userOp);
    const userOpHash = await this.sendUserOp(signedOp);

    if (params.waitForReceipt) {
      const receipt = await this.waitForUserOp(userOpHash);
      return {
        userOpHash,
        transactionHash: receipt.transactionHash,
      };
    }

    return { userOpHash };
  }

  /**
   * Get EntryPoint deposit balance for account
   */
  async getDeposit(account: Address): Promise<bigint> {
    const balance = await this.config.publicClient.readContract({
      address: this.entryPoint,
      abi: ENTRY_POINT_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
    return balance;
  }

  /**
   * Deposit ETH to EntryPoint for account
   */
  async deposit(account: Address, amount: bigint): Promise<Hex> {
    const { walletClient } = this.config;
    if (!walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.entryPoint,
      abi: ENTRY_POINT_ABI,
      functionName: 'depositTo',
      args: [account],
      value: amount,
    });

    return hash;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAAClient(config: AAClientConfig): AAClient {
  return new AAClient(config);
}

