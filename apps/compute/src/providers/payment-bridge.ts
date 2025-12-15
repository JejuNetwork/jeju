/**
 * EIL Payment Bridge for External Compute
 *
 * Handles cross-chain payments for external compute providers.
 * Users pay in any supported token on the network, and the bridge
 * handles conversion and payment to external providers.
 */

import type { Address, Hex } from 'viem';
import { parseEther, formatEther, keccak256, toHex, encodeFunctionData } from 'viem';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import type {
  ExternalPaymentConfig,
  PaymentResult,
  ExternalProviderType,
} from '@jejunetwork/types';

// ============================================================================
// Configuration
// ============================================================================

export interface PaymentBridgeConfig {
  /** Network RPC URL */
  rpcUrl: string;
  /** CrossChainPaymaster address */
  crossChainPaymasterAddress: Address;
  /** ExternalComputeRegistry address */
  externalComputeRegistryAddress: Address;
  /** Private key for signing */
  privateKey: string;
  /** Default slippage tolerance (bps) */
  defaultSlippageBps: number;
  /** Oracle endpoint for price feeds */
  oracleEndpoint?: string;
}

// ABI fragments we need
const CROSS_CHAIN_PAYMASTER_ABI = [
  'function createVoucherRequest(address token, uint256 amount, uint256 destinationChainId, address recipient, bytes calldata data) payable returns (bytes32)',
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256)',
  'function getQuote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)',
  'function xlpDeposits(address xlp, address token) view returns (uint256)',
  'function xlpETHDeposits(address xlp) view returns (uint256)',
  'function supportedTokens(address token) view returns (bool)',
  'function getActiveXLPs() view returns (address[])',
];

const EXTERNAL_COMPUTE_REGISTRY_ABI = [
  'function requestDeployment(address bridgeNode, uint8 providerType, uint256 durationHours) payable returns (bytes32)',
  'function governanceParams() view returns (uint256 defaultMarkupBps, uint256 minBridgeNodeStake, uint256 maxMarkupBps, uint256 deploymentDepositBps, bool requireAgentRegistration)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// ============================================================================
// Price Oracle
// ============================================================================

interface TokenPrice {
  symbol: string;
  priceUsd: number;
  priceEth: number;
  decimals: number;
  updatedAt: number;
}

const DEFAULT_PRICES: Record<string, TokenPrice> = {
  ETH: { symbol: 'ETH', priceUsd: 3000, priceEth: 1, decimals: 18, updatedAt: Date.now() },
  AKT: { symbol: 'AKT', priceUsd: 3.5, priceEth: 0.00116, decimals: 6, updatedAt: Date.now() },
  USDC: { symbol: 'USDC', priceUsd: 1, priceEth: 0.000333, decimals: 6, updatedAt: Date.now() },
  JEJU: { symbol: 'JEJU', priceUsd: 0.1, priceEth: 0.0000333, decimals: 18, updatedAt: Date.now() },
};

// ============================================================================
// Payment Bridge
// ============================================================================

export class PaymentBridge {
  private config: PaymentBridgeConfig;
  private provider: JsonRpcProvider;
  private signer: Wallet;
  private crossChainPaymaster: Contract;
  private externalComputeRegistry: Contract;
  private priceCache: Record<string, TokenPrice> = { ...DEFAULT_PRICES };
  private priceCacheUpdatedAt = 0;

  constructor(config: PaymentBridgeConfig) {
    this.config = {
      defaultSlippageBps: 100, // 1% default slippage
      ...config,
    };

    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(config.privateKey, this.provider);

    this.crossChainPaymaster = new Contract(
      config.crossChainPaymasterAddress,
      CROSS_CHAIN_PAYMASTER_ABI,
      this.signer
    );

    this.externalComputeRegistry = new Contract(
      config.externalComputeRegistryAddress,
      EXTERNAL_COMPUTE_REGISTRY_ABI,
      this.signer
    );
  }

  /**
   * Get a quote for payment conversion
   */
  async getQuote(
    paymentToken: Address,
    amount: bigint,
    destinationToken: string
  ): Promise<{
    inputAmount: bigint;
    outputAmount: bigint;
    rate: number;
    fee: bigint;
    priceImpact: number;
  }> {
    await this.refreshPrices();

    const inputPrice = await this.getTokenPrice(paymentToken);
    const outputPrice = this.priceCache[destinationToken] ?? DEFAULT_PRICES.ETH;

    // Calculate expected output
    const inputValueUsd = (Number(amount) / 10 ** inputPrice.decimals) * inputPrice.priceUsd;
    const outputAmount = (inputValueUsd / outputPrice.priceUsd) * 10 ** outputPrice.decimals;

    // Estimate fee (protocol fee + XLP spread)
    const feeBps = 50; // 0.5% total fee estimate
    const fee = (amount * BigInt(feeBps)) / 10000n;

    // Price impact estimate (based on liquidity depth)
    const priceImpact = Number(amount) > 1e20 ? 0.5 : 0.1; // Higher for large orders

    return {
      inputAmount: amount,
      outputAmount: BigInt(Math.floor(outputAmount)),
      rate: outputPrice.priceUsd / inputPrice.priceUsd,
      fee,
      priceImpact,
    };
  }

  /**
   * Execute payment for external compute
   */
  async payForCompute(
    config: ExternalPaymentConfig
  ): Promise<PaymentResult> {
    const startTime = Date.now();

    console.log('[PaymentBridge] Processing payment', {
      sourceChainId: config.sourceChainId,
      amount: formatEther(config.amount),
      useEIL: config.useEIL,
    });

    let result: PaymentResult;

    if (config.useEIL && config.destinationChainId) {
      // Cross-chain payment via EIL
      result = await this.executeCrossChainPayment(config);
    } else {
      // Same-chain payment
      result = await this.executeSameChainPayment(config);
    }

    console.log('[PaymentBridge] Payment completed', {
      success: result.success,
      txHash: result.sourceTxHash,
      duration: Date.now() - startTime,
    });

    return result;
  }

  /**
   * Execute same-chain payment (token swap if needed)
   */
  private async executeSameChainPayment(
    config: ExternalPaymentConfig
  ): Promise<PaymentResult> {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

    if (config.paymentToken === ZERO_ADDRESS) {
      // Direct ETH payment to registry
      const tx = await this.signer.sendTransaction({
        to: config.recipient,
        value: config.amount,
      });
      const receipt = await tx.wait();

      return {
        success: true,
        sourceTxHash: (receipt?.hash ?? '0x') as Hex,
        amountPaid: config.amount,
        feePaid: 0n,
        timestamp: Date.now(),
      };
    }

    // Token payment - swap to ETH first if needed
    const tokenContract = new Contract(config.paymentToken, ERC20_ABI, this.signer);

    // Check allowance
    const allowance = await tokenContract.allowance(
      this.signer.address,
      this.config.crossChainPaymasterAddress
    );

    if (allowance < config.amount) {
      const approveTx = await tokenContract.approve(
        this.config.crossChainPaymasterAddress,
        config.amount
      );
      await approveTx.wait();
    }

    // Get quote for swap
    const quote = await this.crossChainPaymaster.getQuote(
      config.paymentToken,
      ZERO_ADDRESS, // ETH
      config.amount
    );

    const minOutput = quote - (quote * BigInt(config.slippageBps ?? this.config.defaultSlippageBps)) / 10000n;

    // Execute swap
    const swapTx = await this.crossChainPaymaster.swap(
      config.paymentToken,
      ZERO_ADDRESS,
      config.amount,
      minOutput
    );
    const receipt = await swapTx.wait();

    return {
      success: true,
      sourceTxHash: receipt.hash as Hex,
      amountPaid: config.amount,
      amountReceived: quote,
      feePaid: config.amount - quote,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute cross-chain payment via EIL
   */
  private async executeCrossChainPayment(
    config: ExternalPaymentConfig
  ): Promise<PaymentResult> {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

    // Find best XLP with liquidity
    const xlps = await this.crossChainPaymaster.getActiveXLPs();
    if (xlps.length === 0) {
      throw new Error('No active XLPs available for cross-chain transfer');
    }

    // Check XLP liquidity
    let bestXlp: string | null = null;
    for (const xlp of xlps) {
      const ethLiquidity = await this.crossChainPaymaster.xlpETHDeposits(xlp);
      if (ethLiquidity >= config.amount) {
        bestXlp = xlp as string;
        break;
      }
    }

    if (!bestXlp) {
      throw new Error('No XLP with sufficient liquidity');
    }

    // Create voucher request for cross-chain transfer
    const destinationData = this.encodeAkashPayment(
      config.destinationToken ?? 'AKT',
      config.amount
    );

    const voucherTx = await this.crossChainPaymaster.createVoucherRequest(
      config.paymentToken,
      config.amount,
      config.destinationChainId,
      config.recipient,
      destinationData,
      { value: config.paymentToken === ZERO_ADDRESS ? config.amount : 0n }
    );

    const receipt = await voucherTx.wait();

    // Parse voucher ID from event
    const voucherCreatedTopic = keccak256(
      toHex('VoucherRequested(bytes32,address,address,uint256,uint256,address)')
    );
    const voucherLog = receipt.logs.find(
      (log: { topics: string[] }) => log.topics[0] === voucherCreatedTopic
    );
    const voucherId = voucherLog?.topics[1] ?? '0x';

    return {
      success: true,
      sourceTxHash: receipt.hash as Hex,
      destinationTxHash: voucherId as Hex, // Voucher ID acts as reference
      amountPaid: config.amount,
      amountReceived: await this.estimateAktAmount(config.amount),
      feePaid: (config.amount * 50n) / 10000n, // ~0.5% fee estimate
      timestamp: Date.now(),
    };
  }

  /**
   * Request deployment on external compute registry with payment
   */
  async requestDeploymentWithPayment(
    bridgeNode: Address,
    providerType: ExternalProviderType,
    durationHours: number,
    paymentToken: Address,
    maxPaymentAmount: bigint
  ): Promise<{
    deploymentId: Hex;
    paymentResult: PaymentResult;
  }> {
    // Get quote for deployment
    const governanceParams = await this.externalComputeRegistry.governanceParams();
    const markup = governanceParams.defaultMarkupBps as bigint;

    // Calculate required ETH payment
    // (This would normally come from the bridge node's pricing)
    const basePrice = parseEther('0.1') * BigInt(durationHours); // Example base price
    const totalPrice = basePrice + (basePrice * markup) / 10000n;

    // Execute payment
    const paymentResult = await this.payForCompute({
      sourceChainId: 8453, // Base chain
      paymentToken,
      amount: totalPrice,
      recipient: this.config.externalComputeRegistryAddress,
      useEIL: false,
    });

    if (!paymentResult.success) {
      throw new Error('Payment failed');
    }

    // Request deployment
    const providerTypeNum = providerType === 'akash' ? 0 : 1;
    const deploymentTx = await this.externalComputeRegistry.requestDeployment(
      bridgeNode,
      providerTypeNum,
      BigInt(durationHours),
      { value: totalPrice }
    );
    const receipt = await deploymentTx.wait();

    // Parse deployment ID from event
    const deploymentCreatedTopic = keccak256(
      toHex('DeploymentCreated(bytes32,address,address,uint8,uint256)')
    );
    const deploymentLog = receipt.logs.find(
      (log: { topics: string[] }) => log.topics[0] === deploymentCreatedTopic
    );
    const deploymentId = deploymentLog?.topics[1] ?? '0x';

    return {
      deploymentId: deploymentId as Hex,
      paymentResult,
    };
  }

  /**
   * Estimate AKT amount from ETH amount
   */
  private async estimateAktAmount(ethAmount: bigint): Promise<bigint> {
    const ethPrice = this.priceCache.ETH?.priceUsd ?? 3000;
    const aktPrice = this.priceCache.AKT?.priceUsd ?? 3.5;

    const ethValue = Number(ethAmount) / 1e18;
    const usdValue = ethValue * ethPrice;
    const aktAmount = (usdValue / aktPrice) * 1e6; // AKT has 6 decimals

    return BigInt(Math.floor(aktAmount));
  }

  /**
   * Encode Akash payment data for cross-chain message
   */
  private encodeAkashPayment(token: string, amount: bigint): Hex {
    // Simple encoding for Akash payment instruction
    const data = {
      action: 'deposit',
      token,
      amount: amount.toString(),
    };
    return toHex(JSON.stringify(data)) as Hex;
  }

  /**
   * Get token price
   */
  private async getTokenPrice(tokenAddress: Address): Promise<TokenPrice> {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

    if (tokenAddress === ZERO_ADDRESS) {
      return this.priceCache.ETH ?? DEFAULT_PRICES.ETH;
    }

    // Get token symbol
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();

    if (this.priceCache[symbol]) {
      return this.priceCache[symbol];
    }

    // Default fallback
    return {
      symbol,
      priceUsd: 1,
      priceEth: 0.000333,
      decimals: Number(decimals),
      updatedAt: Date.now(),
    };
  }

  /**
   * Refresh price cache
   */
  private async refreshPrices(): Promise<void> {
    const cacheAge = Date.now() - this.priceCacheUpdatedAt;
    if (cacheAge < 60000) return; // Cache for 1 minute

    // In production, fetch from oracle
    if (this.config.oracleEndpoint) {
      const response = await fetch(`${this.config.oracleEndpoint}/prices`).catch(
        () => null
      );
      if (response?.ok) {
        const prices = (await response.json()) as Record<string, TokenPrice>;
        this.priceCache = { ...DEFAULT_PRICES, ...prices };
      }
    }

    // Update ETH price from env if set
    const ethPriceEnv = process.env.ETH_PRICE_USD;
    if (ethPriceEnv) {
      this.priceCache.ETH.priceUsd = parseFloat(ethPriceEnv);
    }

    this.priceCacheUpdatedAt = Date.now();
  }

  /**
   * Check if a token is supported for payment
   */
  async isTokenSupported(tokenAddress: Address): Promise<boolean> {
    return this.crossChainPaymaster.supportedTokens(tokenAddress);
  }

  /**
   * Get available XLP liquidity
   */
  async getAvailableLiquidity(): Promise<{
    ethLiquidity: bigint;
    xlpCount: number;
  }> {
    const xlps = await this.crossChainPaymaster.getActiveXLPs();
    let totalEth = 0n;

    for (const xlp of xlps) {
      const ethBalance = await this.crossChainPaymaster.xlpETHDeposits(xlp);
      totalEth += ethBalance;
    }

    return {
      ethLiquidity: totalEth,
      xlpCount: xlps.length,
    };
  }
}

/**
 * Create payment bridge from environment
 */
export function createPaymentBridgeFromEnv(): PaymentBridge {
  const rpcUrl = process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545';
  const crossChainPaymasterAddress = (process.env.CROSS_CHAIN_PAYMASTER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address;
  const externalComputeRegistryAddress = (process.env.EXTERNAL_COMPUTE_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address;
  const privateKey = process.env.PRIVATE_KEY ?? '';

  return new PaymentBridge({
    rpcUrl,
    crossChainPaymasterAddress,
    externalComputeRegistryAddress,
    privateKey,
    defaultSlippageBps: parseInt(process.env.PAYMENT_SLIPPAGE_BPS ?? '100', 10),
    oracleEndpoint: process.env.ORACLE_ENDPOINT,
  });
}

// Singleton
let paymentBridgeInstance: PaymentBridge | null = null;

export function getPaymentBridge(): PaymentBridge {
  if (!paymentBridgeInstance) {
    paymentBridgeInstance = createPaymentBridgeFromEnv();
  }
  return paymentBridgeInstance;
}

export function resetPaymentBridge(): void {
  paymentBridgeInstance = null;
}

