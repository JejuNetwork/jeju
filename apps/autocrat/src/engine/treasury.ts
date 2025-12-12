/**
 * @fileoverview Treasury Manager
 *
 * Manages profit deposits to the AutocratTreasury contract:
 * - Deposit profits from successful trades
 * - Track earnings and distributions
 * - Withdraw operator rewards
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Account,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  ChainId,
  ProfitSource,
  TreasuryStats,
  ProfitDeposit,
} from '../types';
import { AUTOCRAT_TREASURY_ABI, ERC20_ABI, ZERO_ADDRESS } from '../lib/contracts';

// ============ Types ============

export interface TreasuryConfig {
  treasuryAddress: string;
  chainId: ChainId;
  rpcUrl: string;
  privateKey: string;
}

// Map our types to contract enum values
const PROFIT_SOURCE_MAP: Record<ProfitSource, number> = {
  DEX_ARBITRAGE: 0,
  CROSS_CHAIN_ARBITRAGE: 1,
  SANDWICH: 2,
  LIQUIDATION: 3,
  SOLVER_FEE: 4,
  ORACLE_KEEPER: 5,
  OTHER: 6,
};

// ============ Treasury Manager Class ============

export class TreasuryManager {
  private walletClient: WalletClient;
  private publicClient: PublicClient;
  private account: Account;
  private treasuryAddress: string;
  private chainId: ChainId;

  // Local tracking
  private pendingDeposits: ProfitDeposit[] = [];
  private totalDeposited: Map<string, bigint> = new Map(); // token -> amount

  constructor(config: TreasuryConfig) {
    this.treasuryAddress = config.treasuryAddress;
    this.chainId = config.chainId;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);

    const chain = {
      id: config.chainId,
      name: 'Chain',
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
  }

  /**
   * Initialize and verify treasury connection
   */
  async initialize(): Promise<void> {
    console.log('💰 Initializing treasury manager...');
    console.log(`   Treasury: ${this.treasuryAddress}`);
    console.log(`   Operator: ${this.account.address}`);

    // Check if we're authorized
    const isAuthorized = await this.isAuthorizedOperator();
    if (!isAuthorized) {
      console.warn('   ⚠️ Warning: Not an authorized operator');
    } else {
      console.log('   ✓ Authorized operator');
    }

    // Get current stats
    const stats = await this.getStats();
    console.log(`   Total ETH deposited: ${stats.totalProfitsByToken[ZERO_ADDRESS] || '0'}`);
  }

  /**
   * Deposit profit from a successful execution
   */
  async depositProfit(
    token: string,
    amount: bigint,
    source: ProfitSource,
    txHash: string
  ): Promise<{ success: boolean; depositTxHash?: string; error?: string }> {
    if (amount <= 0n) {
      return { success: false, error: 'Amount must be positive' };
    }

    console.log(`💵 Depositing profit: ${amount} ${token === ZERO_ADDRESS ? 'ETH' : 'tokens'}`);
    console.log(`   Source: ${source}`);
    console.log(`   From TX: ${txHash}`);

    try {
      // For ERC20 tokens, approve first
      if (token !== ZERO_ADDRESS) {
        const allowance = await this.publicClient.readContract({
          address: token as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [this.account.address, this.treasuryAddress as `0x${string}`],
        });

        if (allowance < amount) {
          console.log('   Approving token spend...');
          const approveHash = await this.walletClient.writeContract({
            address: token as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [this.treasuryAddress as `0x${string}`, amount],
          });
          await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      // Deposit
      const data = encodeFunctionData({
        abi: AUTOCRAT_TREASURY_ABI,
        functionName: 'depositProfit',
        args: [
          token as `0x${string}`,
          amount,
          PROFIT_SOURCE_MAP[source],
          txHash as `0x${string}`,
        ],
      });

      const hash = await this.walletClient.sendTransaction({
        to: this.treasuryAddress as `0x${string}`,
        data: data as `0x${string}`,
        value: token === ZERO_ADDRESS ? amount : 0n,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Deposit transaction reverted' };
      }

      // Track locally
      const deposit: ProfitDeposit = {
        token,
        amount: amount.toString(),
        source,
        txHash: hash,
        timestamp: Date.now(),
        operator: this.account.address,
      };
      this.pendingDeposits.push(deposit);

      const current = this.totalDeposited.get(token) || 0n;
      this.totalDeposited.set(token, current + amount);

      console.log(`   ✓ Deposited in TX: ${hash}`);

      return { success: true, depositTxHash: hash };
    } catch (error) {
      console.error(`   ✗ Deposit failed: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Deposit profit from an execution result
   */
  async depositFromExecution(
    result: ExecutionResult,
    source: ProfitSource
  ): Promise<{ success: boolean; depositTxHash?: string; error?: string }> {
    if (!result.success || !result.actualProfit || !result.txHash) {
      return { success: false, error: 'Invalid execution result' };
    }

    const profit = BigInt(result.actualProfit);
    if (profit <= 0n) {
      return { success: false, error: 'No profit to deposit' };
    }

    // Assume ETH profit for now
    return this.depositProfit(ZERO_ADDRESS, profit, source, result.txHash);
  }

  /**
   * Withdraw operator earnings
   */
  async withdrawEarnings(token: string = ZERO_ADDRESS): Promise<{
    success: boolean;
    amount?: string;
    txHash?: string;
    error?: string;
  }> {
    console.log(`🏧 Withdrawing operator earnings for token: ${token}`);

    try {
      // Check pending amount
      const pending = await this.getPendingWithdrawal(token);
      if (pending <= 0n) {
        return { success: false, error: 'No pending earnings' };
      }

      const hash = await this.walletClient.writeContract({
        address: this.treasuryAddress as `0x${string}`,
        abi: AUTOCRAT_TREASURY_ABI,
        functionName: 'withdrawOperatorEarnings',
        args: [token as `0x${string}`],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        return { success: false, error: 'Withdrawal reverted' };
      }

      console.log(`   ✓ Withdrawn ${pending} in TX: ${hash}`);

      return {
        success: true,
        amount: pending.toString(),
        txHash: hash,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check if current operator is authorized
   */
  async isAuthorizedOperator(): Promise<boolean> {
    try {
      const result = await this.publicClient.readContract({
        address: this.treasuryAddress as `0x${string}`,
        abi: AUTOCRAT_TREASURY_ABI,
        functionName: 'authorizedOperators',
        args: [this.account.address],
      });
      return result as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Get pending withdrawal amount for operator
   */
  async getPendingWithdrawal(token: string = ZERO_ADDRESS): Promise<bigint> {
    try {
      // This would need a view function in the contract
      // For now, return 0
      return 0n;
    } catch {
      return 0n;
    }
  }

  /**
   * Get treasury statistics
   */
  async getStats(): Promise<TreasuryStats> {
    try {
      // Get ETH profits
      const ethProfits = await this.publicClient.readContract({
        address: this.treasuryAddress as `0x${string}`,
        abi: AUTOCRAT_TREASURY_ABI,
        functionName: 'totalProfitsByToken',
        args: [ZERO_ADDRESS as `0x${string}`],
      });

      // Get distribution config
      const distConfig = await this.publicClient.readContract({
        address: this.treasuryAddress as `0x${string}`,
        abi: AUTOCRAT_TREASURY_ABI,
        functionName: 'getDistributionConfig',
      }) as { protocolBps: number; stakersBps: number; insuranceBps: number; operatorBps: number };

      return {
        totalProfitsByToken: {
          [ZERO_ADDRESS]: (ethProfits as bigint).toString(),
        },
        totalProfitsBySource: {
          DEX_ARBITRAGE: '0',
          CROSS_CHAIN_ARBITRAGE: '0',
          SANDWICH: '0',
          LIQUIDATION: '0',
          SOLVER_FEE: '0',
          ORACLE_KEEPER: '0',
          OTHER: '0',
        },
        totalDeposits: this.pendingDeposits.length,
        recentDeposits: this.pendingDeposits.slice(-10),
        distributionConfig: {
          protocolBps: distConfig.protocolBps,
          stakersBps: distConfig.stakersBps,
          insuranceBps: distConfig.insuranceBps,
          operatorBps: distConfig.operatorBps,
        },
      };
    } catch {
      return {
        totalProfitsByToken: {},
        totalProfitsBySource: {
          DEX_ARBITRAGE: '0',
          CROSS_CHAIN_ARBITRAGE: '0',
          SANDWICH: '0',
          LIQUIDATION: '0',
          SOLVER_FEE: '0',
          ORACLE_KEEPER: '0',
          OTHER: '0',
        },
        totalDeposits: 0,
        recentDeposits: [],
        distributionConfig: {
          protocolBps: 5000,
          stakersBps: 3000,
          insuranceBps: 1500,
          operatorBps: 500,
        },
      };
    }
  }

  /**
   * Get recent deposits (local cache)
   */
  getRecentDeposits(): ProfitDeposit[] {
    return [...this.pendingDeposits].slice(-100);
  }

  /**
   * Get total deposited by token (local cache)
   */
  getTotalDeposited(token: string = ZERO_ADDRESS): bigint {
    return this.totalDeposited.get(token) || 0n;
  }
}
