/**
 * Storage SDK Payment Integration
 *
 * Enables multi-token payment for storage services via ERC-4337 paymasters:
 * - Pay with ANY registered token (elizaOS, USDC, VIRTUAL, etc.)
 * - Paymaster handles token-to-ETH conversion automatically
 * - Credit-based prepayment for zero-latency operations
 *
 * Architecture:
 * ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
 * │   User      │───▶│ CreditManager    │───▶│ StorageLedger   │
 * │ (any token) │    │ (multi-token)    │    │ (storage)       │
 * └─────────────┘    └──────────────────┘    └─────────────────┘
 *       │                    │
 *       ▼                    ▼
 * ┌─────────────┐    ┌──────────────────┐
 * │ Paymaster   │◀───│ PaymasterFactory │
 * │ (gas sponsor)    │ (token registry) │
 * └─────────────┘    └──────────────────┘
 */

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  parseEther,
} from 'ethers';
import type { Address } from 'viem';
import { ZERO_ADDRESS, STORAGE_PRICING, type X402PaymentRequirement } from './x402';

const PREFERRED_TOKEN_SYMBOL = 'JEJU';

// ============================================================================
// Types
// ============================================================================

export interface StoragePaymentConfig {
  rpcUrl: string;
  bundlerUrl?: string;
  creditManagerAddress: Address;
  paymasterFactoryAddress: Address;
  ledgerManagerAddress: Address;
  tokenRegistryAddress: Address;
  entryPointAddress: Address;
}

export interface CreditBalance {
  usdc: bigint;
  eth: bigint;
  elizaOS: bigint;
  total: bigint;
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

export interface PaymentResult {
  success: boolean;
  txHash: string;
  tokenUsed: Address;
  amountPaid: bigint;
  gasSponsored: boolean;
  creditRemaining: bigint;
}

// ============================================================================
// ABIs
// ============================================================================

const CREDIT_MANAGER_ABI = [
  'function getBalance(address user, address token) view returns (uint256)',
  'function getAllBalances(address user) view returns (uint256 usdcBalance, uint256 elizaBalance, uint256 ethBalance)',
  'function hasSufficientCredit(address user, address token, uint256 amount) view returns (bool sufficient, uint256 available)',
  'function tryDeductCredit(address user, address token, uint256 amount) returns (bool success, uint256 remaining)',
  'function depositUSDC(uint256 amount)',
  'function depositElizaOS(uint256 amount)',
  'function depositETH() payable',
  'function deposit(address token, uint256 amount) payable',
];

const PAYMASTER_FACTORY_ABI = [
  'function getAllPaymasters() view returns (address[])',
  'function getPaymasterInfo(address paymaster) view returns (address token, uint256 stakedEth, bool isActive)',
  'function deployments(address token) view returns (address paymaster, address vault, address distributor, address token, address operator, uint256 deployedAt, uint256 feeMargin)',
  'function getDeployedTokens() view returns (address[])',
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

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// ============================================================================
// Payment Client
// ============================================================================

export class StoragePaymentClient {
  private provider: JsonRpcProvider;
  private config: StoragePaymentConfig;
  private creditManager: Contract;
  private paymasterFactory: Contract | null;
  private ledgerManager: Contract | null;

  constructor(config: StoragePaymentConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);

    this.creditManager = new Contract(
      config.creditManagerAddress,
      CREDIT_MANAGER_ABI,
      this.provider
    );

    this.paymasterFactory =
      config.paymasterFactoryAddress !== ZERO_ADDRESS
        ? new Contract(config.paymasterFactoryAddress, PAYMASTER_FACTORY_ABI, this.provider)
        : null;

    this.ledgerManager =
      config.ledgerManagerAddress !== ZERO_ADDRESS
        ? new Contract(config.ledgerManagerAddress, LEDGER_MANAGER_ABI, this.provider)
        : null;
  }

  // ============ Credit System ============

  async getCreditBalances(userAddress: string): Promise<CreditBalance> {
    const [usdcBalance, elizaBalance, ethBalance] = await this.creditManager.getAllBalances(
      userAddress
    );
    const totalEthEquivalent =
      ethBalance + (usdcBalance * parseEther('0.00033')) / 1000000n + (elizaBalance * parseEther('0.0001')) / parseEther('1');
    return {
      usdc: usdcBalance,
      elizaOS: elizaBalance,
      eth: ethBalance,
      total: totalEthEquivalent,
    };
  }

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

  async getLedgerBalance(userAddress: string): Promise<bigint> {
    if (!this.ledgerManager) return 0n;
    return this.ledgerManager.getAvailableBalance(userAddress);
  }

  // ============ Paymaster System ============

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
        paymasterContract.getTokenAmount(gasEstimateWei) as Promise<bigint>,
        paymasterContract.availableLiquidity() as Promise<bigint>,
      ]);

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

    return options.sort((a, b) => {
      if (a.tokenSymbol === PREFERRED_TOKEN_SYMBOL && b.tokenSymbol !== PREFERRED_TOKEN_SYMBOL) return -1;
      if (a.tokenSymbol !== PREFERRED_TOKEN_SYMBOL && b.tokenSymbol === PREFERRED_TOKEN_SYMBOL) return 1;
      return Number(a.estimatedCost - b.estimatedCost);
    });
  }

  /**
   * Select optimal paymaster based on user's token balances
   * Selects JEJU if available, otherwise cheapest option
   */
  async selectOptimalPaymaster(
    userAddress: string,
    gasEstimateWei: bigint
  ): Promise<PaymasterOption | null> {
    const options = await this.getAvailablePaymasters(gasEstimateWei);

    // First, try to find JEJU paymaster if user has JEJU balance
    const jejuPaymaster = options.find(o => o.tokenSymbol === PREFERRED_TOKEN_SYMBOL && o.isAvailable);
    if (jejuPaymaster) {
      const tokenContract = new Contract(jejuPaymaster.tokenAddress, ERC20_ABI, this.provider);
      const userBalance = (await tokenContract.balanceOf(userAddress)) as bigint;
      if (userBalance >= jejuPaymaster.estimatedCost) {
        return jejuPaymaster;
      }
    }

    // Fall back to any other available paymaster
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

  // ============ Payment Methods ============

  async payForStorage(
    signer: Wallet,
    amountRequired: bigint,
    preferredToken?: string
  ): Promise<PaymentResult> {
    const userAddress = signer.address;

    // 1. Check credit balance first (zero latency)
    const credits = await this.getCreditBalances(userAddress);
    if (credits.total >= amountRequired) {
      return {
        success: true,
        txHash: '0x0',
        tokenUsed: ZERO_ADDRESS,
        amountPaid: amountRequired,
        gasSponsored: true,
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
      const tokenContract = new Contract(paymaster.tokenAddress, ERC20_ABI, signer);

      const currentAllowance = (await tokenContract.allowance(
        userAddress,
        paymaster.address
      )) as bigint;

      if (currentAllowance < paymaster.estimatedCost) {
        const approveFn = tokenContract.getFunction('approve');
        const approveTx = await approveFn(paymaster.address, paymaster.estimatedCost);
        await approveTx.wait();
      }

      // Transfer tokens to paymaster for sponsorship
      const transferFn = tokenContract.getFunction('transfer');
      const transferTx = await transferFn(paymaster.address, paymaster.estimatedCost);
      const receipt = await transferTx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        tokenUsed: paymaster.tokenAddress,
        amountPaid: paymaster.estimatedCost,
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
      return {
        success: true,
        txHash: '0x0',
        tokenUsed: ZERO_ADDRESS,
        amountPaid: amountRequired,
        gasSponsored: false,
        creditRemaining: ledgerBalance - amountRequired,
      };
    }

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

  async depositCredits(signer: Wallet, tokenAddress: string, amount: bigint): Promise<string> {
    const creditManagerWithSigner = this.creditManager.connect(signer);

    if (tokenAddress === ZERO_ADDRESS) {
      const depositETH = creditManagerWithSigner.getFunction('depositETH');
      const tx = await depositETH({ value: amount });
      const receipt = await tx.wait();
      return receipt.hash;
    }

    const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
    const approveFn = tokenContract.getFunction('approve');
    const approveTx = await approveFn(this.config.creditManagerAddress, amount);
    await approveTx.wait();

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

  createPaymentRequirement(
    resource: string,
    amountWei: bigint,
    description: string,
    network: string = 'jeju'
  ): X402PaymentRequirement {
    const accepts: X402PaymentRequirement['accepts'] = [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: amountWei.toString(),
        asset: ZERO_ADDRESS,
        payTo: this.config.ledgerManagerAddress,
        resource,
        description,
      },
    ];

    return {
      x402Version: 1,
      error: 'Payment required to access storage service',
      accepts,
    };
  }

  // ============ Cost Estimation ============

  estimateStorageCost(sizeGB: number, durationMonths: number, tier: 'hot' | 'warm' | 'cold' = 'warm'): bigint {
    const pricePerGBMonth = tier === 'hot'
      ? STORAGE_PRICING.HOT_TIER_PER_GB_MONTH
      : tier === 'warm'
        ? STORAGE_PRICING.WARM_TIER_PER_GB_MONTH
        : STORAGE_PRICING.COLD_TIER_PER_GB_MONTH;
    return BigInt(Math.ceil(sizeGB * durationMonths)) * pricePerGBMonth;
  }

  estimatePermanentStorageCost(sizeGB: number): bigint {
    return BigInt(Math.ceil(sizeGB)) * STORAGE_PRICING.PERMANENT_PER_GB;
  }

  estimateRetrievalCost(sizeGB: number): bigint {
    return BigInt(Math.ceil(sizeGB * 1000)) * STORAGE_PRICING.RETRIEVAL_PER_GB / 1000n;
  }

  // ============ Utilities ============

  private formatTokenAmount(amount: bigint, decimals: number, symbol: string): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const frac = amount % divisor;
    return `${whole}.${frac.toString().padStart(decimals, '0').slice(0, 4)} ${symbol}`;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStoragePaymentClient(config?: Partial<StoragePaymentConfig>): StoragePaymentClient {
  const fullConfig: StoragePaymentConfig = {
    rpcUrl: config?.rpcUrl || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    bundlerUrl: config?.bundlerUrl || process.env.BUNDLER_URL,
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
      '0x0000000071727De22E5E9d8BAf0edAc6f37da032') as Address,
  };

  return new StoragePaymentClient(fullConfig);
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatStorageCost(weiAmount: bigint): string {
  const eth = formatEther(weiAmount);
  const ethNum = parseFloat(eth);

  if (ethNum < 0.0001) {
    return `~$${(ethNum * 3000 * 100).toFixed(2)} cents`;
  }

  return `${ethNum.toFixed(6)} ETH (~$${(ethNum * 3000).toFixed(2)})`;
}

export { ZERO_ADDRESS };

