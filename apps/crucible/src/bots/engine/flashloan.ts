/**
 * Flash Loan Executor - Execute arbitrage without capital
 * 
 * Supports multiple flash loan providers:
 * - Aave V3 (most liquid, 0.05% fee)
 * - Balancer (no fee for swaps)
 * - Uniswap V3 (flash swaps)
 * 
 * Enables capital-efficient MEV extraction by borrowing
 * assets for arbitrage within a single transaction.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, base } from 'viem/chains';
import type { ChainId, ArbitrageOpportunity } from '../autocrat-types';

// Flash loan provider addresses by chain
const AAVE_V3_POOL: Record<number, `0x${string}`> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // Mainnet
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Arbitrum
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Optimism
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', // Base
};

const BALANCER_VAULT: Record<number, `0x${string}`> = {
  1: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  42161: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  10: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  8453: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
};

// ABIs
const AAVE_V3_POOL_ABI = parseAbi([
  'function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata interestRateModes, address onBehalfOf, bytes calldata params, uint16 referralCode) external',
  'function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external',
  'function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128)',
]);

const BALANCER_VAULT_ABI = parseAbi([
  'function flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData) external',
]);

const FLASH_LOAN_RECEIVER_ABI = parseAbi([
  'function executeOperation(address[] calldata assets, uint256[] calldata amounts, uint256[] calldata premiums, address initiator, bytes calldata params) external returns (bool)',
]);

// Flash loan callback contract interface
const ARBITRAGE_EXECUTOR_ABI = parseAbi([
  // Execute arbitrage with flash loan
  'function executeArbitrage(address[] path, uint256 amountIn, uint256 minAmountOut, bytes[] swapData) external',
  // Flash loan callback
  'function executeOperation(address[] calldata assets, uint256[] calldata amounts, uint256[] calldata premiums, address initiator, bytes calldata params) external returns (bool)',
  // Balancer flash loan callback
  'function receiveFlashLoan(address[] tokens, uint256[] amounts, uint256[] feeAmounts, bytes userData) external',
]);

export interface FlashLoanConfig {
  chainId: ChainId;
  rpcUrl: string;
  privateKey: string;
  executorAddress?: `0x${string}`; // Custom executor contract
}

export interface FlashLoanParams {
  token: `0x${string}`;
  amount: bigint;
  calldata: `0x${string}`;
}

export interface FlashLoanResult {
  success: boolean;
  txHash?: string;
  actualProfit?: bigint;
  gasUsed?: bigint;
  error?: string;
}

type FlashLoanProvider = 'aave' | 'balancer' | 'uniswap';

const CHAIN_DEFS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
};

export class FlashLoanExecutor {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: Account;
  private chainId: ChainId;
  private aavePool: `0x${string}` | null;
  private balancerVault: `0x${string}` | null;
  private executorAddress: `0x${string}` | null;
  private aavePremium: bigint = 5n; // 0.05% default (5 bps)

  constructor(config: FlashLoanConfig) {
    this.chainId = config.chainId;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);

    const chain = CHAIN_DEFS[config.chainId] || {
      id: config.chainId,
      name: 'Custom',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    });

    this.aavePool = AAVE_V3_POOL[config.chainId] || null;
    this.balancerVault = BALANCER_VAULT[config.chainId] || null;
    this.executorAddress = config.executorAddress || null;
  }

  /**
   * Initialize and fetch flash loan premiums
   */
  async initialize(): Promise<void> {
    console.log(`⚡ Initializing flash loan executor (chain ${this.chainId})`);

    if (this.aavePool) {
      try {
        const premium = await this.publicClient.readContract({
          address: this.aavePool,
          abi: AAVE_V3_POOL_ABI,
          functionName: 'FLASHLOAN_PREMIUM_TOTAL',
        });
        this.aavePremium = premium;
        console.log(`   Aave V3 premium: ${Number(premium)} bps`);
      } catch {
        console.log(`   Aave V3 not available`);
        this.aavePool = null;
      }
    }

    if (this.balancerVault) {
      console.log(`   Balancer Vault available (no fee)`);
    }

    if (!this.aavePool && !this.balancerVault) {
      console.warn(`   ⚠️ No flash loan providers available on chain ${this.chainId}`);
    }
  }

  /**
   * Get the best flash loan provider for a given token/amount
   */
  getBestProvider(token: `0x${string}`, amount: bigint): FlashLoanProvider | null {
    // Balancer has no fee, so prefer it when available
    if (this.balancerVault) return 'balancer';
    if (this.aavePool) return 'aave';
    return null;
  }

  /**
   * Calculate flash loan fee
   */
  calculateFee(provider: FlashLoanProvider, amount: bigint): bigint {
    switch (provider) {
      case 'aave':
        return (amount * this.aavePremium) / 10000n;
      case 'balancer':
        return 0n; // No fee for most tokens
      case 'uniswap':
        return (amount * 3n) / 1000n; // 0.3% fee
      default:
        return 0n;
    }
  }

  /**
   * Execute arbitrage with flash loan
   */
  async executeWithFlashLoan(
    opportunity: ArbitrageOpportunity,
    swapCalldata: `0x${string}`[]
  ): Promise<FlashLoanResult> {
    const inputToken = opportunity.inputToken.address as `0x${string}`;
    const inputAmount = BigInt(opportunity.inputAmount);

    const provider = this.getBestProvider(inputToken, inputAmount);
    if (!provider) {
      return { success: false, error: 'No flash loan provider available' };
    }

    console.log(`⚡ Executing flash loan arbitrage via ${provider}`);
    console.log(`   Token: ${inputToken}`);
    console.log(`   Amount: ${inputAmount}`);

    switch (provider) {
      case 'aave':
        return this.executeAaveFlashLoan(opportunity, swapCalldata);
      case 'balancer':
        return this.executeBalancerFlashLoan(opportunity, swapCalldata);
      default:
        return { success: false, error: `Provider ${provider} not implemented` };
    }
  }

  private async executeAaveFlashLoan(
    opportunity: ArbitrageOpportunity,
    swapCalldata: `0x${string}`[]
  ): Promise<FlashLoanResult> {
    if (!this.aavePool || !this.executorAddress) {
      return { success: false, error: 'Aave or executor not configured' };
    }

    const inputToken = opportunity.inputToken.address as `0x${string}`;
    const inputAmount = BigInt(opportunity.inputAmount);

    // Encode arbitrage params for callback
    const arbitrageParams = this.encodeArbitrageParams(opportunity, swapCalldata);

    try {
      // Get balance before
      const balanceBefore = await this.publicClient.getBalance({
        address: this.account.address,
      });

      // Execute flash loan
      const data = encodeFunctionData({
        abi: AAVE_V3_POOL_ABI,
        functionName: 'flashLoanSimple',
        args: [
          this.executorAddress,
          inputToken,
          inputAmount,
          arbitrageParams,
          0, // referral code
        ],
      });

      const hash = await this.walletClient.sendTransaction({
        account: this.account,
        to: this.aavePool,
        data,
        chain: CHAIN_DEFS[this.chainId] || null,
      });

      console.log(`   Flash loan TX: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Flash loan reverted', txHash: hash };
      }

      // Calculate actual profit
      const balanceAfter = await this.publicClient.getBalance({
        address: this.account.address,
      });

      const gasUsed = receipt.gasUsed;
      const gasCost = gasUsed * (receipt.effectiveGasPrice || 0n);
      const actualProfit = balanceAfter - balanceBefore + gasCost; // Add back gas to see gross profit

      console.log(`   ✓ Flash loan executed`);
      console.log(`   Actual profit: ${Number(actualProfit) / 1e18} ETH`);

      return {
        success: true,
        txHash: hash,
        actualProfit,
        gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeBalancerFlashLoan(
    opportunity: ArbitrageOpportunity,
    swapCalldata: `0x${string}`[]
  ): Promise<FlashLoanResult> {
    if (!this.balancerVault || !this.executorAddress) {
      return { success: false, error: 'Balancer or executor not configured' };
    }

    const inputToken = opportunity.inputToken.address as `0x${string}`;
    const inputAmount = BigInt(opportunity.inputAmount);

    // Encode arbitrage params for callback
    const arbitrageParams = this.encodeArbitrageParams(opportunity, swapCalldata);

    try {
      const balanceBefore = await this.publicClient.getBalance({
        address: this.account.address,
      });

      const data = encodeFunctionData({
        abi: BALANCER_VAULT_ABI,
        functionName: 'flashLoan',
        args: [
          this.executorAddress,
          [inputToken],
          [inputAmount],
          arbitrageParams,
        ],
      });

      const hash = await this.walletClient.sendTransaction({
        account: this.account,
        to: this.balancerVault,
        data,
        chain: CHAIN_DEFS[this.chainId] || null,
      });

      console.log(`   Flash loan TX: ${hash}`);

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Flash loan reverted', txHash: hash };
      }

      const balanceAfter = await this.publicClient.getBalance({
        address: this.account.address,
      });

      const gasUsed = receipt.gasUsed;
      const gasCost = gasUsed * (receipt.effectiveGasPrice || 0n);
      const actualProfit = balanceAfter - balanceBefore + gasCost;

      console.log(`   ✓ Flash loan executed`);
      console.log(`   Actual profit: ${Number(actualProfit) / 1e18} ETH`);

      return {
        success: true,
        txHash: hash,
        actualProfit,
        gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private encodeArbitrageParams(
    opportunity: ArbitrageOpportunity,
    swapCalldata: `0x${string}`[]
  ): `0x${string}` {
    // Encode: [path addresses, min output, swap calldata array]
    const pathAddresses = opportunity.path.map(p => p.address as `0x${string}`);
    const minOutput = BigInt(opportunity.expectedOutput) * 995n / 1000n; // 0.5% slippage

    // Simple ABI encoding
    const encoded = encodeFunctionData({
      abi: ARBITRAGE_EXECUTOR_ABI,
      functionName: 'executeArbitrage',
      args: [
        pathAddresses,
        BigInt(opportunity.inputAmount),
        minOutput,
        swapCalldata,
      ],
    });

    return encoded;
  }

  /**
   * Simulate flash loan execution
   */
  async simulateFlashLoan(
    opportunity: ArbitrageOpportunity,
    swapCalldata: `0x${string}`[]
  ): Promise<{
    success: boolean;
    expectedProfit?: bigint;
    gasEstimate?: bigint;
    error?: string;
  }> {
    const inputToken = opportunity.inputToken.address as `0x${string}`;
    const inputAmount = BigInt(opportunity.inputAmount);

    const provider = this.getBestProvider(inputToken, inputAmount);
    if (!provider) {
      return { success: false, error: 'No flash loan provider' };
    }

    const flashLoanFee = this.calculateFee(provider, inputAmount);
    const expectedProfit = BigInt(opportunity.expectedProfit) - flashLoanFee;

    if (expectedProfit <= 0n) {
      return { success: false, error: 'Flash loan fee exceeds profit' };
    }

    // Estimate gas
    const gasEstimate = 500000n + (BigInt(opportunity.path.length) * 150000n);

    return {
      success: true,
      expectedProfit,
      gasEstimate,
    };
  }

  /**
   * Check if flash loans are available
   */
  isAvailable(): boolean {
    return this.aavePool !== null || this.balancerVault !== null;
  }

  /**
   * Get available flash loan providers
   */
  getAvailableProviders(): FlashLoanProvider[] {
    const providers: FlashLoanProvider[] = [];
    if (this.aavePool) providers.push('aave');
    if (this.balancerVault) providers.push('balancer');
    return providers;
  }

  /**
   * Get executor address
   */
  getExecutorAddress(): `0x${string}` | null {
    return this.executorAddress;
  }

  /**
   * Set custom executor contract
   */
  setExecutorAddress(address: `0x${string}`): void {
    this.executorAddress = address;
  }
}

/**
 * Flash loan executor contract Solidity interface
 * 
 * This contract should be deployed to execute arbitrage within flash loan callback.
 * 
 * ```solidity
 * // SPDX-License-Identifier: MIT
 * pragma solidity ^0.8.20;
 * 
 * import "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
 * import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
 * 
 * contract ArbitrageExecutor is FlashLoanSimpleReceiverBase {
 *     address public owner;
 *     
 *     constructor(IPoolAddressesProvider provider) 
 *         FlashLoanSimpleReceiverBase(provider) {
 *         owner = msg.sender;
 *     }
 *     
 *     function executeOperation(
 *         address asset,
 *         uint256 amount,
 *         uint256 premium,
 *         address initiator,
 *         bytes calldata params
 *     ) external override returns (bool) {
 *         require(msg.sender == address(POOL), "Invalid caller");
 *         require(initiator == owner, "Invalid initiator");
 *         
 *         // Decode params and execute swaps
 *         (address[] memory path, uint256 minOut, bytes[] memory swapData) = 
 *             abi.decode(params, (address[], uint256, bytes[]));
 *         
 *         // Execute arbitrage swaps...
 *         
 *         // Approve repayment
 *         uint256 amountOwed = amount + premium;
 *         IERC20(asset).approve(address(POOL), amountOwed);
 *         
 *         return true;
 *     }
 *     
 *     function withdraw(address token) external {
 *         require(msg.sender == owner);
 *         uint256 balance = IERC20(token).balanceOf(address(this));
 *         IERC20(token).transfer(owner, balance);
 *     }
 * }
 * ```
 */
export const ARBITRAGE_EXECUTOR_SOLIDITY = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ArbitrageExecutor is FlashLoanSimpleReceiverBase {
    using SafeERC20 for IERC20;
    
    address public immutable owner;
    
    constructor(IPoolAddressesProvider provider) 
        FlashLoanSimpleReceiverBase(provider) {
        owner = msg.sender;
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Invalid caller");
        require(initiator == owner, "Invalid initiator");
        
        // Execute arbitrage (decoded from params)
        _executeArbitrage(asset, amount, params);
        
        // Approve repayment
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);
        
        return true;
    }
    
    function _executeArbitrage(
        address asset,
        uint256 amount,
        bytes calldata params
    ) internal {
        (address[] memory path, uint256 minOut, bytes[] memory swapData) = 
            abi.decode(params, (address[], uint256, bytes[]));
        
        // Execute each swap in path
        uint256 currentAmount = amount;
        for (uint256 i = 0; i < swapData.length; i++) {
            (bool success, bytes memory result) = path[i].call(swapData[i]);
            require(success, "Swap failed");
            currentAmount = abi.decode(result, (uint256));
        }
        
        require(currentAmount >= minOut, "Insufficient output");
    }
    
    function withdraw(address token) external {
        require(msg.sender == owner, "Not owner");
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner, balance);
        }
    }
    
    function withdrawETH() external {
        require(msg.sender == owner, "Not owner");
        payable(owner).transfer(address(this).balance);
    }
    
    receive() external payable {}
}
`;
