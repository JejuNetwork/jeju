/**
 * Compute SDK Payment Integration
 *
 * Enables multi-token payment for compute services via ERC-4337 paymasters:
 * - Pay with ANY registered token (elizaOS, USDC, VIRTUAL, etc.)
 * - Paymaster handles token-to-ETH conversion automatically
 * - No bridging required - payments work seamlessly across tokens
 * - Credit-based prepayment for zero-latency operations
 *
 * Architecture:
 * ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
 * │   User      │───▶│ CreditManager    │───▶│ LedgerManager   │
 * │ (any token) │    │ (multi-token)    │    │ (compute)       │
 * └─────────────┘    └──────────────────┘    └─────────────────┘
 *       │                    │
 *       ▼                    ▼
 * ┌─────────────┐    ┌──────────────────┐
 * │ Paymaster   │◀───│ PaymasterFactory │
 * │ (gas sponsor)    │ (token registry) │
 * └─────────────┘    └──────────────────┘
 */

import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from 'ethers';
import type { Address } from 'viem';

// ============ Types ============

export interface PaymentConfig {
  rpcUrl: string;
  bundlerUrl?: string; // ERC-4337 bundler endpoint
  creditManagerAddress: Address;
  paymasterFactoryAddress: Address;
  ledgerManagerAddress: Address;
  tokenRegistryAddress: Address;
  entryPointAddress: Address;
}

export interface BundlerResponse {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: { code: number; message: string };
}

export interface CreditBalance {
  usdc: bigint;
  eth: bigint;
  elizaOS: bigint;
  total: bigint; // Total in ETH equivalent
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  paymasterAddress: Address | null;
  priceUSD: bigint;
  availableLiquidity: bigint;
  isActive: boolean;
}

export interface PaymasterOption {
  address: Address;
  tokenAddress: Address;
  tokenSymbol: string;
  estimatedCost: bigint;
  estimatedCostUSD: string;
  availableLiquidity: bigint;
  isAvailable: boolean;
}

export interface UserOperationParams {
  sender: Address;
  nonce: bigint;
  callData: `0x${string}`;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterData: `0x${string}`;
  signature: `0x${string}`;
}

// X402PaymentRequirement is now in x402.ts - import for local use and re-export
import type { X402PaymentRequirement } from './x402';
export type { X402PaymentRequirement };

export interface PaymentResult {
  success: boolean;
  txHash: string;
  tokenUsed: Address;
  amountPaid: bigint;
  gasSponsored: boolean;
  creditRemaining: bigint;
}

// ============ ABIs ============

const CREDIT_MANAGER_ABI = [
  'function getBalance(address user, address token) view returns (uint256)',
  'function getAllBalances(address user) view returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)',
  'function hasSufficientCredit(address user, address token, uint256 amount) view returns (bool sufficient, uint256 available)',
  'function tryDeductCredit(address user, address token, uint256 amount) returns (bool success, uint256 remaining)',
  'function depositUSDC(uint256 amount)',
  'function depositElizaOS(uint256 amount)',
  'function depositETH() payable',
  'function deposit(address token, uint256 amount) payable',
  'function authorizedServices(address service) view returns (bool)',
];

const PAYMASTER_FACTORY_ABI = [
  'function getAllPaymasters() view returns (address[])',
  'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
  'function deployments(address token) view returns (address paymaster, address vault, address distributor, address token, address operator, uint256 deployedAt, uint256 feeMargin)',
  'function getDeployedTokens() view returns (address[])',
];

const TOKEN_REGISTRY_ABI = [
  'function getTokenInfo(address token) view returns (string symbol, string name, uint8 decimals, bool active, uint256 registeredAt)',
  'function getAllActiveTokens() view returns (address[])',
  'function isTokenActive(address token) view returns (bool)',
];

const PAYMASTER_ABI = [
  'function getQuote(uint256 ethAmount) view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
  'function token() view returns (address)',
  'function getTokenAmount(uint256 ethAmount) view returns (uint256 tokenAmount)',
];

const LEDGER_MANAGER_ABI = [
  'function createLedger() payable',
  'function deposit() payable',
  'function getLedger(address user) view returns (tuple(uint256 totalBalance, uint256 availableBalance, uint256 lockedBalance, uint256 createdAt))',
  'function getAvailableBalance(address user) view returns (uint256)',
];

const ENTRY_POINT_ABI = [
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Reserved for future price oracle integration
void [
  'function getPrice(address token) view returns (uint256 priceUSD, uint256 decimals)',
  'function convertAmount(address fromToken, address toToken, uint256 amount) view returns (uint256)',
];

// ============ Constants ============

// Import and re-export ZERO_ADDRESS from x402.ts for backwards compatibility
import { ZERO_ADDRESS } from './x402';
export { ZERO_ADDRESS };

export const SUPPORTED_TOKENS = {
  ETH: ZERO_ADDRESS,
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // Mainnet USDC
  ELIZA: '0x0000000000000000000000000000000000000000' as Address, // Set at runtime
} as const;

// ============ Payment Client ============

export class ComputePaymentClient {
  private provider: JsonRpcProvider;
  private config: PaymentConfig;
  private bundlerUrl: string | null;
  private creditManager: Contract;
  private paymasterFactory: Contract | null;
  private _tokenRegistry: Contract | null; // Reserved for future token lookup
  private ledgerManager: Contract | null;
  private entryPoint: Contract | null;

  constructor(config: PaymentConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.bundlerUrl = config.bundlerUrl || null;

    this.creditManager = new Contract(
      config.creditManagerAddress,
      CREDIT_MANAGER_ABI,
      this.provider
    );

    this.paymasterFactory =
      config.paymasterFactoryAddress !== ZERO_ADDRESS
        ? new Contract(config.paymasterFactoryAddress, PAYMASTER_FACTORY_ABI, this.provider)
        : null;

    this._tokenRegistry =
      config.tokenRegistryAddress !== ZERO_ADDRESS
        ? new Contract(config.tokenRegistryAddress, TOKEN_REGISTRY_ABI, this.provider)
        : null;
    void this._tokenRegistry; // Reserved for token discovery

    this.ledgerManager =
      config.ledgerManagerAddress !== ZERO_ADDRESS
        ? new Contract(config.ledgerManagerAddress, LEDGER_MANAGER_ABI, this.provider)
        : null;

    this.entryPoint =
      config.entryPointAddress !== ZERO_ADDRESS
        ? new Contract(config.entryPointAddress, ENTRY_POINT_ABI, this.provider)
        : null;
  }

  // ============ Credit System ============

  /**
   * Get user's credit balances across all tokens
   */
  async getCreditBalances(userAddress: string): Promise<CreditBalance> {
    const [usdcBalance, elizaBalance, ethBalance] = await this.creditManager.getAllBalances(
      userAddress
    );
    // Rough ETH equivalent calculation (assumes 1 USDC = 0.00033 ETH, 1 elizaOS = 0.0001 ETH)
    const totalEthEquivalent =
      ethBalance + (usdcBalance * parseEther('0.00033')) / 1000000n + (elizaBalance * parseEther('0.0001')) / parseEther('1');
    return {
      usdc: usdcBalance,
      elizaOS: elizaBalance,
      eth: ethBalance,
      total: totalEthEquivalent,
    };
  }

  /**
   * Check if user has sufficient credit in any token
   */
  async hasSufficientCredit(
    userAddress: string,
    tokenAddress: string,
    amount: bigint
  ): Promise<{ sufficient: boolean; available: bigint }> {
    const [sufficient, available] = await this.creditManager.hasSufficientCredit(
      userAddress,
      tokenAddress,
      amount
    );
    return { sufficient, available };
  }

  /**
   * Get compute ledger balance (for direct ETH payments)
   */
  async getLedgerBalance(userAddress: string): Promise<bigint> {
    if (!this.ledgerManager) return 0n;
    return this.ledgerManager.getAvailableBalance(userAddress);
  }

  // ============ Paymaster System ============

  /**
   * Get all available paymasters (tokens that can sponsor gas)
   */
  async getAvailablePaymasters(gasEstimateWei: bigint): Promise<PaymasterOption[]> {
    if (!this.paymasterFactory) return [];

    const options: PaymasterOption[] = [];
    const deployedTokens = (await this.paymasterFactory.getDeployedTokens()) as string[];

    for (const tokenAddr of deployedTokens) {
      const [, , , , , , feeMargin] = await this.paymasterFactory.deployments(tokenAddr);

      const deployment = await this.paymasterFactory.deployments(tokenAddr);
      const paymasterAddr = deployment[0];
      const isActive = paymasterAddr !== ZERO_ADDRESS;

      if (!isActive) continue;

      const paymasterContract = new Contract(paymasterAddr, PAYMASTER_ABI, this.provider);
      const tokenContract = new Contract(tokenAddr, ERC20_ABI, this.provider);

      const [symbol, decimals, quote, liquidity] = await Promise.all([
        tokenContract.symbol() as Promise<string>,
        tokenContract.decimals() as Promise<number>,
        paymasterContract.getTokenAmount(gasEstimateWei).catch(() => 0n) as Promise<bigint>,
        paymasterContract.availableLiquidity().catch(() => 0n) as Promise<bigint>,
      ]);

      // Add fee margin to quote
      const quotedWithMargin = quote + (quote * BigInt(feeMargin)) / 10000n;

      options.push({
        address: paymasterAddr as Address,
        tokenAddress: tokenAddr as Address,
        tokenSymbol: symbol,
        estimatedCost: quotedWithMargin,
        estimatedCostUSD: this.formatTokenAmount(quotedWithMargin, decimals, symbol),
        availableLiquidity: liquidity,
        isAvailable: liquidity > quotedWithMargin,
      });
    }

    // Sort by cost (cheapest first)
    return options.sort((a, b) => Number(a.estimatedCost - b.estimatedCost));
  }

  /**
   * Select optimal paymaster based on user's token balances
   */
  async selectOptimalPaymaster(
    userAddress: string,
    gasEstimateWei: bigint
  ): Promise<PaymasterOption | null> {
    const options = await this.getAvailablePaymasters(gasEstimateWei);

    for (const option of options) {
      if (!option.isAvailable) continue;

      const tokenContract = new Contract(option.tokenAddress, ERC20_ABI, this.provider);
      const userBalance = (await tokenContract.balanceOf(userAddress)) as bigint;

      if (userBalance >= option.estimatedCost) {
        return option;
      }
    }

    return null;
  }

  /**
   * Build paymaster data for ERC-4337 UserOperation
   */
  buildPaymasterData(
    paymasterAddress: Address,
    verificationGasLimit: bigint = 100000n,
    postOpGasLimit: bigint = 50000n
  ): `0x${string}` {
    const encoder = new AbiCoder();
    return encoder.encode(
      ['address', 'uint128', 'uint128'],
      [paymasterAddress, verificationGasLimit, postOpGasLimit]
    ) as `0x${string}`;
  }

  /**
   * Create a UserOperation with paymaster sponsorship
   */
  async createSponsoredUserOp(
    signer: Wallet,
    target: Address,
    callData: `0x${string}`,
    preferredToken?: Address
  ): Promise<UserOperationParams | null> {
    if (!this.entryPoint) {
      throw new Error('EntryPoint not configured');
    }

    // Estimate gas
    const gasEstimate = await this.provider.estimateGas({
      to: target,
      data: callData,
      from: signer.address,
    });

    // Find paymaster
    let paymaster: PaymasterOption | null = null;
    if (preferredToken) {
      const options = await this.getAvailablePaymasters(gasEstimate);
      paymaster = options.find((o) => o.tokenAddress === preferredToken) || null;
    } else {
      paymaster = await this.selectOptimalPaymaster(signer.address, gasEstimate);
    }

    if (!paymaster) {
      return null; // No suitable paymaster found
    }

    // Get nonce from EntryPoint
    const nonce = await this.entryPoint.getNonce(signer.address, 0n);

    // Get gas prices
    const feeData = await this.provider.getFeeData();

    const userOp: UserOperationParams = {
      sender: signer.address as Address,
      nonce,
      callData,
      callGasLimit: gasEstimate,
      verificationGasLimit: 100000n,
      preVerificationGas: 50000n,
      maxFeePerGas: feeData.maxFeePerGas || parseEther('0.0000001'),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseEther('0.00000001'),
      paymaster: paymaster.address,
      paymasterVerificationGasLimit: 100000n,
      paymasterPostOpGasLimit: 50000n,
      paymasterData: this.buildPaymasterData(paymaster.address),
      signature: '0x' as `0x${string}`,
    };

    // Sign the user operation
    const userOpHash = this.hashUserOp(userOp);
    const signature = await signer.signMessage(userOpHash);
    userOp.signature = signature as `0x${string}`;

    return userOp;
  }

  private hashUserOp(userOp: UserOperationParams): Uint8Array {
    const encoder = new AbiCoder();
    const packed = encoder.encode(
      ['address', 'uint256', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [
        userOp.sender,
        userOp.nonce,
        userOp.callData,
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
      ]
    );
    return toUtf8Bytes(keccak256(packed));
  }

  /**
   * Submit UserOperation to ERC-4337 bundler
   */
  private async submitUserOperationToBundler(
    signer: Wallet,
    paymasterAddress: Address,
    _amount: bigint // Used for future gas estimation
  ): Promise<string> {
    if (!this.bundlerUrl || !this.entryPoint) {
      throw new Error('Bundler URL and EntryPoint required');
    }

    // Build a simple deposit call to LedgerManager
    const callData = this.ledgerManager
      ? new AbiCoder().encode(['bytes4'], ['0xd0e30db0']) // deposit() selector
      : '0x' as `0x${string}`;

    const userOp = await this.createSponsoredUserOp(
      signer,
      (this.ledgerManager?.target || this.config.ledgerManagerAddress) as Address,
      callData as `0x${string}`,
      paymasterAddress
    );

    if (!userOp) {
      throw new Error('Failed to create UserOperation');
    }

    // Format for bundler
    const packedUserOp = {
      sender: userOp.sender,
      nonce: '0x' + userOp.nonce.toString(16),
      initCode: '0x',
      callData: userOp.callData,
      accountGasLimits: this.packGasLimits(userOp.verificationGasLimit, userOp.callGasLimit),
      preVerificationGas: '0x' + userOp.preVerificationGas.toString(16),
      gasFees: this.packGasFees(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas),
      paymasterAndData: this.packPaymasterData(
        userOp.paymaster,
        userOp.paymasterVerificationGasLimit,
        userOp.paymasterPostOpGasLimit,
        userOp.paymasterData
      ),
      signature: userOp.signature,
    };

    // Submit to bundler
    const response = await fetch(this.bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [packedUserOp, this.config.entryPointAddress],
      }),
    });

    const result = await response.json() as BundlerResponse;
    
    if (result.error) {
      throw new Error(`Bundler error: ${result.error.message}`);
    }

    // Wait for transaction to be mined
    if (result.result) {
      // Poll for UserOperation receipt
      const txHash = await this.waitForUserOperationReceipt(result.result);
      return txHash;
    }

    throw new Error('No result from bundler');
  }

  private packGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): `0x${string}` {
    const packed = (verificationGasLimit << 128n) | callGasLimit;
    return ('0x' + packed.toString(16).padStart(64, '0')) as `0x${string}`;
  }

  private packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): `0x${string}` {
    const packed = (maxPriorityFeePerGas << 128n) | maxFeePerGas;
    return ('0x' + packed.toString(16).padStart(64, '0')) as `0x${string}`;
  }

  private packPaymasterData(
    paymaster: Address,
    verificationGasLimit: bigint,
    postOpGasLimit: bigint,
    data: `0x${string}`
  ): `0x${string}` {
    const encoder = new AbiCoder();
    const packed = encoder.encode(
      ['address', 'uint128', 'uint128', 'bytes'],
      [paymaster, verificationGasLimit, postOpGasLimit, data]
    );
    return packed as `0x${string}`;
  }

  private async waitForUserOperationReceipt(userOpHash: string, timeout = 60000): Promise<string> {
    if (!this.bundlerUrl) throw new Error('Bundler URL required');
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const response = await fetch(this.bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getUserOperationReceipt',
          params: [userOpHash],
        }),
      });

      const result = await response.json() as BundlerResponse & { 
        result?: { receipt?: { transactionHash: string } } 
      };
      
      if (result.result?.receipt?.transactionHash) {
        return result.result.receipt.transactionHash;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error('Timeout waiting for UserOperation receipt');
  }

  // ============ Payment Methods ============

  /**
   * Pay for compute using the optimal method:
   * 1. Use credit if available
   * 2. Use paymaster-sponsored tx if token balance available
   * 3. Fall back to direct ETH payment
   */
  async payForCompute(
    signer: Wallet,
    amountRequired: bigint,
    preferredToken?: string
  ): Promise<PaymentResult> {
    const userAddress = signer.address;

    // 1. Check credit balance first (zero latency!)
    const credits = await this.getCreditBalances(userAddress);
    if (credits.total >= amountRequired) {
      // Use credit - no blockchain tx needed for payment
      return {
        success: true,
        txHash: '0x0', // No tx needed
        tokenUsed: ZERO_ADDRESS,
        amountPaid: amountRequired,
        gasSponsored: true, // Credits cover everything
        creditRemaining: credits.total - amountRequired,
      };
    }

    // 2. Try paymaster-sponsored payment
    const paymaster = preferredToken
      ? (await this.getAvailablePaymasters(amountRequired)).find(
          (p) => p.tokenAddress === preferredToken
        )
      : await this.selectOptimalPaymaster(userAddress, amountRequired);

    if (paymaster) {
      // Build and submit sponsored transaction via ERC-4337
      const tokenContract = new Contract(paymaster.tokenAddress, ERC20_ABI, signer);

      // Approve paymaster to spend tokens
      const currentAllowance = (await tokenContract.allowance(
        userAddress,
        paymaster.address
      )) as bigint;

      if (currentAllowance < paymaster.estimatedCost) {
        const approveFn = tokenContract.getFunction('approve');
        const approveTx = await approveFn(paymaster.address, paymaster.estimatedCost);
        await approveTx.wait();
      }

      // Submit via bundler if available
      if (this.bundlerUrl && this.entryPoint) {
        const txHash = await this.submitUserOperationToBundler(
          signer,
          paymaster.address,
          amountRequired
        );
        
        return {
          success: true,
          txHash,
          tokenUsed: paymaster.tokenAddress,
          amountPaid: paymaster.estimatedCost,
          gasSponsored: true,
          creditRemaining: 0n,
        };
      }

      // Fallback: Direct paymaster interaction (without AA bundler)
      // This works when paymaster supports direct token payment
      const paymasterContract = new Contract(paymaster.address, PAYMASTER_ABI, signer);
      const sponsorFn = paymasterContract.getFunction('getTokenAmount');
      const tokenAmount = await sponsorFn(amountRequired);
      
      // Transfer tokens directly to paymaster for sponsorship
      const transferFn = tokenContract.getFunction('transfer');
      const transferTx = await transferFn(paymaster.address, tokenAmount);
      const receipt = await transferTx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        tokenUsed: paymaster.tokenAddress,
        amountPaid: tokenAmount as bigint,
        gasSponsored: true,
        creditRemaining: 0n,
      };
    }

    // 3. Fall back to direct ETH payment
    if (!this.ledgerManager) {
      throw new Error('No payment method available - no credit, paymaster, or ledger');
    }

    const ledgerBalance = await this.getLedgerBalance(userAddress);
    if (ledgerBalance >= amountRequired) {
      // Already have balance in ledger
      return {
        success: true,
        txHash: '0x0',
        tokenUsed: ZERO_ADDRESS,
        amountPaid: amountRequired,
        gasSponsored: false,
        creditRemaining: ledgerBalance - amountRequired,
      };
    }

    // Need to deposit more ETH to ledger
    const depositAmount = amountRequired - ledgerBalance;
    const ledgerManagerWithSigner = this.ledgerManager.connect(signer);
    const depositFn = ledgerManagerWithSigner.getFunction('deposit');
    const tx = await depositFn({ value: depositAmount });
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt.hash,
      tokenUsed: ZERO_ADDRESS,
      amountPaid: depositAmount,
      gasSponsored: false,
      creditRemaining: 0n,
    };
  }

  /**
   * Deposit credits for future compute usage
   */
  async depositCredits(signer: Wallet, tokenAddress: string, amount: bigint): Promise<string> {
    const creditManagerWithSigner = this.creditManager.connect(signer);

    if (tokenAddress === ZERO_ADDRESS) {
      const depositETH = creditManagerWithSigner.getFunction('depositETH');
      const tx = await depositETH({ value: amount });
      const receipt = await tx.wait();
      return receipt.hash;
    }

    // Approve and deposit ERC20
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
    const approveFn = tokenContract.getFunction('approve');
    const approveTx = await approveFn(this.config.creditManagerAddress, amount);
    await approveTx.wait();

    // Detect token type and call appropriate deposit
    const symbolFn = tokenContract.getFunction('symbol');
    const symbol = await symbolFn();
    if (symbol === 'USDC') {
      const depositUSDC = creditManagerWithSigner.getFunction('depositUSDC');
      const tx = await depositUSDC(amount);
      const receipt = await tx.wait();
      return receipt.hash;
    } else {
      const depositElizaOS = creditManagerWithSigner.getFunction('depositElizaOS');
      const tx = await depositElizaOS(amount);
      const receipt = await tx.wait();
      return receipt.hash;
    }
  }

  // ============ x402 Payment Requirements ============

  /**
   * Create multi-token x402 payment requirement
   */
  createPaymentRequirement(
    resource: string,
    amountWei: bigint,
    description: string,
    network: string = 'jeju'
  ): X402PaymentRequirement {
    // Accept multiple payment options
    const accepts: X402PaymentRequirement['accepts'] = [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: amountWei.toString(),
        asset: ZERO_ADDRESS, // ETH
        payTo: this.config.ledgerManagerAddress,
        resource,
        description,
      },
    ];

    // Add token options from paymasters
    // (In a full implementation, we'd query available paymasters here)

    return {
      x402Version: 1,
      error: 'Payment required to access compute service',
      accepts,
    };
  }

  // ============ Cost Estimation ============

  estimateInferenceCost(
    inputTokens: number,
    outputTokens: number,
    pricePerInputToken: bigint,
    pricePerOutputToken: bigint
  ): bigint {
    return BigInt(inputTokens) * pricePerInputToken + BigInt(outputTokens) * pricePerOutputToken;
  }

  estimateRentalCost(hourlyRate: bigint, hours: number, gpuCount: number = 1): bigint {
    return hourlyRate * BigInt(hours) * BigInt(gpuCount);
  }

  // ============ Utilities ============

  private formatTokenAmount(amount: bigint, decimals: number, symbol: string): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const frac = amount % divisor;
    return `${whole}.${frac.toString().padStart(decimals, '0').slice(0, 4)} ${symbol}`;
  }
}

// ============ Factory ============

export function createPaymentClient(config?: Partial<PaymentConfig>): ComputePaymentClient {
  const fullConfig: PaymentConfig = {
    rpcUrl: config?.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    bundlerUrl: config?.bundlerUrl || process.env.BUNDLER_URL || undefined,
    creditManagerAddress: (config?.creditManagerAddress ||
      process.env.CREDIT_MANAGER_ADDRESS ||
      ZERO_ADDRESS) as Address,
    paymasterFactoryAddress: (config?.paymasterFactoryAddress ||
      process.env.PAYMASTER_FACTORY_ADDRESS ||
      ZERO_ADDRESS) as Address,
    ledgerManagerAddress: (config?.ledgerManagerAddress ||
      process.env.LEDGER_MANAGER_ADDRESS ||
      ZERO_ADDRESS) as Address,
    tokenRegistryAddress: (config?.tokenRegistryAddress ||
      process.env.TOKEN_REGISTRY_ADDRESS ||
      ZERO_ADDRESS) as Address,
    entryPointAddress: (config?.entryPointAddress ||
      process.env.ENTRY_POINT_ADDRESS ||
      '0x0000000071727De22E5E9d8BAf0edAc6f37da032') as Address, // Standard ERC-4337 EntryPoint v0.7
  };

  return new ComputePaymentClient(fullConfig);
}

// ============ Pricing Constants ============

export const COMPUTE_PRICING = {
  // Inference pricing (per 1000 tokens)
  INFERENCE_INPUT_PER_1K: parseEther('0.0001'),
  INFERENCE_OUTPUT_PER_1K: parseEther('0.0003'),

  // GPU rental pricing (per hour)
  GPU_A100_HOURLY: parseEther('0.50'),
  GPU_H100_HOURLY: parseEther('1.00'),
  GPU_A10G_HOURLY: parseEther('0.15'),

  // CPU rental pricing
  CPU_4CORE_HOURLY: parseEther('0.02'),
  CPU_8CORE_HOURLY: parseEther('0.04'),
  CPU_16CORE_HOURLY: parseEther('0.08'),

  // Storage
  STORAGE_GB_MONTHLY: parseEther('0.001'),

  // Minimum fees
  MIN_INFERENCE_FEE: parseEther('0.0001'),
  MIN_RENTAL_FEE: parseEther('0.01'),
} as const;

// ============ Utility Functions ============

export function formatComputeCost(weiAmount: bigint): string {
  const eth = formatEther(weiAmount);
  const ethNum = parseFloat(eth);

  if (ethNum < 0.0001) {
    return `~$${(ethNum * 3000 * 100).toFixed(2)} cents`;
  }

  return `${ethNum.toFixed(6)} ETH (~$${(ethNum * 3000).toFixed(2)})`;
}

export function estimateGasForOperation(operationType: 'inference' | 'rental' | 'deposit'): bigint {
  switch (operationType) {
    case 'inference':
      return 150000n; // ~150k gas for settlement
    case 'rental':
      return 250000n; // ~250k gas for rental creation
    case 'deposit':
      return 80000n; // ~80k gas for deposit
    default:
      return 200000n;
  }
}
