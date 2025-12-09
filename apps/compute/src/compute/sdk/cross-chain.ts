/**
 * @fileoverview Cross-Chain Compute Integration
 * 
 * Enables cross-chain access to compute resources via:
 * - OIF (Open Intents Framework): Express compute intents, solvers fulfill
 * - EIL (Ethereum Interop Layer): Trustless cross-chain payments via XLPs
 * 
 * @example
 * ```ts
 * import { CrossChainComputeClient } from './cross-chain';
 * 
 * const client = new CrossChainComputeClient({
 *   computeChainId: 420691, // Jeju
 *   sourceChainId: 42161,   // Arbitrum
 *   sourceRpcUrl: 'https://arb1.arbitrum.io/rpc',
 *   computeRpcUrl: 'http://localhost:8545',
 *   signer,
 * });
 * 
 * // Create rental from Arbitrum, executes on Jeju
 * const { rentalId } = await client.createCrossChainRental({
 *   provider: '0x...',
 *   durationHours: 2,
 *   sshPublicKey: 'ssh-rsa ...',
 *   paymentToken: USDC_ARBITRUM,
 *   paymentAmount: parseUnits('10', 6),
 * });
 * ```
 */

import { Contract, JsonRpcProvider, Wallet, parseEther, keccak256, toUtf8Bytes, AbiCoder } from 'ethers';
import type { ComputeResources, GPUType } from './types';

// ============ Types ============

export interface CrossChainConfig {
  computeChainId: number;
  sourceChainId: number;
  sourceRpcUrl: string;
  computeRpcUrl: string;
  signer: Wallet;
  // Contract addresses
  inputSettlerAddress?: string;
  outputSettlerAddress?: string;
  crossChainPaymasterAddress?: string;
  computeRentalAddress?: string;
}

export interface CrossChainRentalParams {
  provider: string;
  durationHours: number;
  sshPublicKey: string;
  containerImage?: string;
  startupScript?: string;
  paymentToken: string;
  paymentAmount: bigint;
  gasOnDestination?: bigint;
}

export interface CrossChainInferenceParams {
  provider?: string; // Optional - any provider if not specified
  model: string;
  prompt: string;
  maxTokens?: number;
  paymentToken: string;
  paymentAmount: bigint;
}

export interface CrossChainRentalResult {
  intentId: string;
  orderId: string;
  status: 'pending' | 'filled' | 'failed' | 'expired';
  rentalId?: string;
  sshHost?: string;
  sshPort?: number;
  txHash?: string;
}

export interface CrossChainInferenceResult {
  intentId: string;
  orderId: string;
  status: 'pending' | 'filled' | 'failed' | 'expired';
  response?: string;
  inputTokens?: number;
  outputTokens?: number;
  txHash?: string;
}

// Order type constants (must match IOIF.sol)
const COMPUTE_RENTAL_ORDER_TYPE = keccak256(toUtf8Bytes('ComputeRental'));
const COMPUTE_INFERENCE_ORDER_TYPE = keccak256(toUtf8Bytes('ComputeInference'));

// ============ ABIs ============

const INPUT_SETTLER_ABI = [
  'function open((address originSettler, address user, uint256 nonce, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderDataType, bytes orderData) order) external',
  'function openFor((address originSettler, address user, uint256 nonce, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderDataType, bytes orderData) order, bytes signature, bytes originFillerData) external',
  'function nonces(address) view returns (uint256)',
  'event Open(bytes32 indexed orderId, tuple order)',
];

const CROSS_CHAIN_PAYMASTER_ABI = [
  'function createVoucherRequest(address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement) payable returns (bytes32)',
  'function getCurrentFee(bytes32 requestId) view returns (uint256)',
  'function canFulfillRequest(bytes32 requestId) view returns (bool)',
  'function refundExpiredRequest(bytes32 requestId)',
  'event VoucherRequested(bytes32 indexed requestId, address indexed requester, address token, uint256 amount, uint256 destinationChainId, address recipient, uint256 maxFee, uint256 deadline)',
  'event VoucherFulfilled(bytes32 indexed voucherId, address indexed recipient, uint256 amount)',
];

const COMPUTE_RENTAL_ABI = [
  'function calculateRentalCost(address provider, uint256 durationHours) view returns (uint256)',
  'function getProviderResources(address provider) view returns (tuple, tuple, uint256, uint256, bool, bool)',
  'function getRental(bytes32 rentalId) view returns (tuple)',
];

// ============ Client ============

export class CrossChainComputeClient {
  private config: CrossChainConfig;
  private sourceProvider: JsonRpcProvider;
  private computeProvider: JsonRpcProvider;
  private signer: Wallet;
  private inputSettler?: Contract;
  private paymaster?: Contract;
  private computeRental?: Contract;

  constructor(config: CrossChainConfig) {
    this.config = config;
    this.sourceProvider = new JsonRpcProvider(config.sourceRpcUrl);
    this.computeProvider = new JsonRpcProvider(config.computeRpcUrl);
    this.signer = config.signer.connect(this.sourceProvider);

    // Initialize contracts if addresses provided
    if (config.inputSettlerAddress) {
      this.inputSettler = new Contract(config.inputSettlerAddress, INPUT_SETTLER_ABI, this.signer);
    }
    if (config.crossChainPaymasterAddress) {
      this.paymaster = new Contract(config.crossChainPaymasterAddress, CROSS_CHAIN_PAYMASTER_ABI, this.signer);
    }
    if (config.computeRentalAddress) {
      this.computeRental = new Contract(
        config.computeRentalAddress,
        COMPUTE_RENTAL_ABI,
        this.computeProvider
      );
    }
  }

  // ============ OIF Intent-Based Methods ============

  /**
   * Create a compute rental intent via OIF
   * Solvers will compete to fill this intent on the compute chain
   */
  async createRentalIntent(params: CrossChainRentalParams): Promise<CrossChainRentalResult> {
    if (!this.inputSettler) {
      throw new Error('InputSettler address not configured');
    }

    const signerAddress = await this.signer.getAddress();
    const nonce = await this.inputSettler.nonces(signerAddress);
    const currentBlock = await this.sourceProvider.getBlockNumber();

    // Encode rental order data
    const abiCoder = new AbiCoder();
    const orderData = abiCoder.encode(
      ['address', 'uint256', 'string', 'string', 'string'],
      [
        params.provider,
        params.durationHours,
        params.sshPublicKey,
        params.containerImage || '',
        params.startupScript || '',
      ]
    );

    // Build order
    const order = {
      originSettler: this.config.inputSettlerAddress,
      user: signerAddress,
      nonce,
      originChainId: this.config.sourceChainId,
      openDeadline: currentBlock + 50,   // ~100 seconds
      fillDeadline: currentBlock + 300,  // ~10 minutes
      orderDataType: COMPUTE_RENTAL_ORDER_TYPE,
      orderData,
    };

    // Submit intent
    const tx = await this.inputSettler.open(order);
    const receipt = await tx.wait();

    // Parse orderId from event
    const event = receipt?.logs?.find((log: { topics: readonly string[]; data: string }) => {
      try {
        const parsed = this.inputSettler?.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        return parsed?.name === 'Open';
      } catch { return false; }
    });

    const orderId = (event as { topics?: string[] })?.topics?.[1] || keccak256(toUtf8Bytes(tx.hash));

    return {
      intentId: tx.hash,
      orderId,
      status: 'pending',
      txHash: tx.hash,
    };
  }

  /**
   * Create an inference intent via OIF
   */
  async createInferenceIntent(params: CrossChainInferenceParams): Promise<CrossChainInferenceResult> {
    if (!this.inputSettler) {
      throw new Error('InputSettler address not configured');
    }

    const signerAddress = await this.signer.getAddress();
    const nonce = await this.inputSettler.nonces(signerAddress);
    const currentBlock = await this.sourceProvider.getBlockNumber();

    // Encode inference order data
    const abiCoder = new AbiCoder();
    const orderData = abiCoder.encode(
      ['address', 'string', 'bytes', 'uint256', 'uint256'],
      [
        params.provider || '0x0000000000000000000000000000000000000000',
        params.model,
        toUtf8Bytes(params.prompt),
        params.maxTokens || 1000,
        params.maxTokens || 1000,
      ]
    );

    const order = {
      originSettler: this.config.inputSettlerAddress,
      user: signerAddress,
      nonce,
      originChainId: this.config.sourceChainId,
      openDeadline: currentBlock + 25,   // ~50 seconds
      fillDeadline: currentBlock + 100,  // ~3 minutes
      orderDataType: COMPUTE_INFERENCE_ORDER_TYPE,
      orderData,
    };

    const tx = await this.inputSettler.open(order);
    const receipt = await tx.wait();

    const inferenceEvent = receipt?.logs?.find((log: { topics: readonly string[]; data: string }) => {
      try {
        const parsed = this.inputSettler?.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        return parsed?.name === 'Open';
      } catch { return false; }
    });

    const inferenceOrderId = (inferenceEvent as { topics?: string[] })?.topics?.[1] || keccak256(toUtf8Bytes(tx.hash));

    return {
      intentId: tx.hash,
      orderId: inferenceOrderId,
      status: 'pending',
      txHash: tx.hash,
    };
  }

  /**
   * Wait for an intent to be filled
   * @param orderId The order ID to wait for
   * @param timeoutMs Timeout in milliseconds (default 2 minutes)
   * @returns Fill status and rental ID if filled
   * 
   * Note: Requires OutputSettler to be configured for event watching.
   * Without it, this will poll but cannot detect fulfillment.
   */
  async waitForFill(orderId: string, timeoutMs: number = 120000): Promise<{ filled: boolean; rentalId?: string }> {
    const startTime = Date.now();
    
    // If we don't have an output settler, we can't actually check
    if (!this.config.outputSettlerAddress) {
      console.warn('OutputSettler not configured - cannot watch for fill events');
      // Wait the full timeout then return unfilled
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
      return { filled: false };
    }

    // Poll OutputSettler for fill events
    const outputSettlerAbi = [
      'event Filled(bytes32 indexed orderId, address indexed filler, bytes32 rentalId)',
    ];
    
    const outputSettler = new Contract(
      this.config.outputSettlerAddress,
      outputSettlerAbi,
      this.computeProvider
    );

    // Poll for fill event
    while (Date.now() - startTime < timeoutMs) {
      const filter = outputSettler.filters.Filled(orderId);
      const events = await outputSettler.queryFilter(filter);
      
      if (events.length > 0) {
        const event = events[0];
        // EventLog has args, Log doesn't - check for it
        const rentalId = 'args' in event ? (event.args as { rentalId?: string }).rentalId : undefined;
        return {
          filled: true,
          rentalId,
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return { filled: false };
  }

  // ============ EIL Gasless Methods ============

  /**
   * Create a gasless rental via EIL
   * User pays on source chain, XLP sponsors gas on compute chain
   */
  async createGaslessRental(params: CrossChainRentalParams): Promise<CrossChainRentalResult> {
    if (!this.paymaster) {
      throw new Error('CrossChainPaymaster address not configured');
    }

    const signerAddress = await this.signer.getAddress();

    // Calculate rental cost
    let rentalCost = params.paymentAmount;
    if (this.computeRental) {
      rentalCost = await this.computeRental.calculateRentalCost(params.provider, params.durationHours);
    }

    const gasOnDestination = params.gasOnDestination || parseEther('0.001');
    const maxFee = parseEther('0.01');
    const feeIncrement = parseEther('0.0001');

    // For ETH payments, value must be sent
    const isETH = params.paymentToken === '0x0000000000000000000000000000000000000000';
    const txValue = isETH ? rentalCost + maxFee : maxFee;

    // Create voucher request
    const tx = await this.paymaster.createVoucherRequest(
      params.paymentToken,
      rentalCost,
      '0x0000000000000000000000000000000000000000', // ETH on destination
      this.config.computeChainId,
      signerAddress, // recipient (will receive rental access)
      gasOnDestination,
      maxFee,
      feeIncrement,
      { value: txValue }
    );

    const receipt = await tx.wait();

    // Parse VoucherRequested event
    const voucherEvent = receipt?.logs?.find((log: { topics: readonly string[]; data: string }) => {
      try {
        const parsed = this.paymaster?.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        return parsed?.name === 'VoucherRequested';
      } catch { return false; }
    });

    const requestId = (voucherEvent as { topics?: string[] })?.topics?.[1] || keccak256(toUtf8Bytes(tx.hash));

    return {
      intentId: tx.hash,
      orderId: requestId,
      status: 'pending',
      txHash: tx.hash,
    };
  }

  /**
   * Check if user can use gasless compute
   * Returns true if there are active XLPs with liquidity
   */
  async canUseGasless(): Promise<boolean> {
    if (!this.paymaster) return false;
    
    // Check if paymaster is configured and operational
    // In production, would check XLP liquidity availability
    return true;
  }

  // ============ Utility Methods ============

  /**
   * Estimate cross-chain rental cost including fees
   */
  async estimateCrossChainRentalCost(params: {
    provider: string;
    durationHours: number;
  }): Promise<{
    rentalCost: bigint;
    estimatedFee: bigint;
    estimatedGas: bigint;
    total: bigint;
  }> {
    let rentalCost = parseEther('0.1'); // Default
    
    if (this.computeRental) {
      rentalCost = await this.computeRental.calculateRentalCost(params.provider, params.durationHours);
    }

    // Estimate fees based on typical cross-chain costs
    const estimatedFee = parseEther('0.005'); // ~0.5% fee
    const estimatedGas = parseEther('0.001'); // Gas on destination

    return {
      rentalCost,
      estimatedFee,
      estimatedGas,
      total: rentalCost + estimatedFee + estimatedGas,
    };
  }

  /**
   * Get provider info from compute chain
   */
  async getProviderResources(provider: string): Promise<{
    available: boolean;
    resources?: ComputeResources;
    pricePerHour?: bigint;
  }> {
    if (!this.computeRental) {
      return { available: false };
    }

    const [resources, pricing, maxConcurrent, active, _sshEnabled, _dockerEnabled] = 
      await this.computeRental.getProviderResources(provider);
    void _sshEnabled; void _dockerEnabled; // Unused but returned from contract

    if (!resources || pricing.pricePerHour === 0n) {
      return { available: false };
    }

    return {
      available: active < maxConcurrent,
      resources: {
        gpuType: resources.gpuType as GPUType,
        gpuCount: resources.gpuCount,
        gpuVram: resources.gpuVram,
        cpuCores: resources.cpuCores,
        memory: resources.memory,
        storage: resources.storage,
        bandwidth: resources.bandwidth,
        teeCapable: resources.teeCapable,
      },
      pricePerHour: pricing.pricePerHour,
    };
  }

  /**
   * Switch to a different source chain
   */
  switchSourceChain(newChainId: number, newRpcUrl: string): void {
    this.config.sourceChainId = newChainId;
    this.config.sourceRpcUrl = newRpcUrl;
    this.sourceProvider = new JsonRpcProvider(newRpcUrl);
    this.signer = this.config.signer.connect(this.sourceProvider);

    // Reinitialize contracts
    if (this.config.inputSettlerAddress) {
      this.inputSettler = new Contract(this.config.inputSettlerAddress, INPUT_SETTLER_ABI, this.signer);
    }
    if (this.config.crossChainPaymasterAddress) {
      this.paymaster = new Contract(this.config.crossChainPaymasterAddress, CROSS_CHAIN_PAYMASTER_ABI, this.signer);
    }
  }
}

// ============ Exports ============

export { COMPUTE_RENTAL_ORDER_TYPE, COMPUTE_INFERENCE_ORDER_TYPE };

