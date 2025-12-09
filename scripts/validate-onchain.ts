#!/usr/bin/env bun
/**
 * On-Chain Validation Script
 * 
 * Monitors and validates:
 * - Contract state changes
 * - Balance movements
 * - Event emissions
 * - Fee distribution accuracy
 * - Staking mechanics
 * 
 * Usage:
 *   bun run scripts/validate-onchain.ts [--watch] [--network testnet|mainnet]
 */

import { ethers, type Contract, type Provider } from 'ethers';
import { Logger } from './shared/logger';

const logger = new Logger('OnChainValidator');

// ============================================================
// Configuration
// ============================================================

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  contracts: {
    staking?: string;
    creditManager?: string;
    paymentToken?: string;
    crossChainPaymaster?: string;
    l1StakeManager?: string;
  };
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    name: 'Localnet',
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    chainId: 31337,
    contracts: {
      staking: process.env.STAKING_ADDRESS,
      creditManager: process.env.CREDIT_MANAGER_ADDRESS,
      paymentToken: process.env.PAYMENT_TOKEN_ADDRESS,
    },
  },
  testnet: {
    name: 'Sepolia',
    rpcUrl: process.env.TESTNET_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
    contracts: {
      staking: process.env.TESTNET_STAKING_ADDRESS,
      creditManager: process.env.TESTNET_CREDIT_MANAGER_ADDRESS,
    },
  },
  mainnet: {
    name: 'Ethereum',
    rpcUrl: process.env.MAINNET_RPC_URL || 'https://eth.llamarpc.com',
    chainId: 1,
    contracts: {},
  },
};

// Contract ABIs
const STAKING_ABI = [
  'function getPoolStats() view returns (uint256 totalEth, uint256 totalToken, uint256 totalShares, uint256 rewardRate)',
  'function getPosition(address) view returns (uint256 ethStaked, uint256 tokenStaked, uint256 shares, uint256 pendingRewards)',
  'function totalRewardsDistributed() view returns (uint256)',
  'function treasury() view returns (address)',
  'event Staked(address indexed user, uint256 ethAmount, uint256 tokenAmount, uint256 shares)',
  'event Unstaked(address indexed user, uint256 shares, uint256 ethReturned, uint256 tokenReturned)',
  'event RewardsClaimed(address indexed user, uint256 amount)',
  'event RewardsDistributed(uint256 amount)',
];

const CREDIT_MANAGER_ABI = [
  'function getBalance(address) view returns (uint256)',
  'function totalDeposits() view returns (uint256)',
  'function totalSpent() view returns (uint256)',
  'event Deposited(address indexed user, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 amount)',
  'event Spent(address indexed user, uint256 amount)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

// ============================================================
// Validation Types
// ============================================================

interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  value?: string;
  expected?: string;
}

interface PoolSnapshot {
  timestamp: number;
  totalEth: bigint;
  totalToken: bigint;
  totalShares: bigint;
  rewardRate: bigint;
  totalRewardsDistributed: bigint;
}

interface BalanceSnapshot {
  timestamp: number;
  address: string;
  ethBalance: bigint;
  tokenBalance: bigint;
  stakingShares: bigint;
  creditBalance: bigint;
}

// ============================================================
// Validator Class
// ============================================================

class OnChainValidator {
  private provider: Provider;
  private network: NetworkConfig;
  private contracts: {
    staking?: Contract;
    creditManager?: Contract;
    paymentToken?: Contract;
  } = {};
  
  private poolSnapshots: PoolSnapshot[] = [];
  private balanceSnapshots: Map<string, BalanceSnapshot[]> = new Map();
  
  constructor(network: NetworkConfig) {
    this.network = network;
    this.provider = new ethers.JsonRpcProvider(network.rpcUrl);
  }

  async initialize(): Promise<void> {
    logger.info(`Initializing validator for ${this.network.name}...`);
    
    // Verify connection
    const blockNumber = await this.provider.getBlockNumber();
    logger.info(`Connected to block ${blockNumber}`);
    
    // Initialize contracts
    if (this.network.contracts.staking) {
      this.contracts.staking = new ethers.Contract(
        this.network.contracts.staking,
        STAKING_ABI,
        this.provider
      );
      logger.info(`Staking: ${this.network.contracts.staking}`);
    }
    
    if (this.network.contracts.creditManager) {
      this.contracts.creditManager = new ethers.Contract(
        this.network.contracts.creditManager,
        CREDIT_MANAGER_ABI,
        this.provider
      );
      logger.info(`CreditManager: ${this.network.contracts.creditManager}`);
    }
    
    if (this.network.contracts.paymentToken) {
      this.contracts.paymentToken = new ethers.Contract(
        this.network.contracts.paymentToken,
        ERC20_ABI,
        this.provider
      );
      logger.info(`PaymentToken: ${this.network.contracts.paymentToken}`);
    }
  }

  // --------------------------------------------------------
  // Pool State Validation
  // --------------------------------------------------------

  async validatePoolState(): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    
    if (!this.contracts.staking) {
      checks.push({
        name: 'Pool State',
        status: 'skip',
        message: 'Staking contract not configured',
      });
      return checks;
    }

    try {
      const [totalEth, totalToken, totalShares, rewardRate] = 
        await this.contracts.staking.getPoolStats();
      
      // Check 1: Total shares should match if there are deposits
      if (totalEth > 0n || totalToken > 0n) {
        const sharesValid = totalShares > 0n;
        checks.push({
          name: 'Shares Consistency',
          status: sharesValid ? 'pass' : 'fail',
          message: sharesValid 
            ? `${ethers.formatEther(totalShares)} shares for ${ethers.formatEther(totalEth)} ETH`
            : 'Pool has assets but no shares issued',
          value: ethers.formatEther(totalShares),
        });
      }
      
      // Check 2: Reward rate should be reasonable (< 100% APY)
      const maxReasonableRate = ethers.parseEther('1') / 365n / 24n / 3600n; // ~100% APY per second
      const rateValid = rewardRate <= maxReasonableRate;
      checks.push({
        name: 'Reward Rate',
        status: rateValid ? 'pass' : 'warn',
        message: rateValid
          ? `Rate: ${ethers.formatEther(rewardRate * 365n * 24n * 3600n * 100n)}% APY`
          : 'Reward rate seems unusually high',
        value: ethers.formatEther(rewardRate),
      });
      
      // Store snapshot
      this.poolSnapshots.push({
        timestamp: Date.now(),
        totalEth,
        totalToken,
        totalShares,
        rewardRate,
        totalRewardsDistributed: await this.contracts.staking.totalRewardsDistributed().catch(() => 0n),
      });
      
      // Check 3: Compare with previous snapshot if available
      if (this.poolSnapshots.length >= 2) {
        const prev = this.poolSnapshots[this.poolSnapshots.length - 2];
        const curr = this.poolSnapshots[this.poolSnapshots.length - 1];
        
        const ethChange = curr.totalEth - prev.totalEth;
        const tokenChange = curr.totalToken - prev.totalToken;
        
        checks.push({
          name: 'Pool Movement',
          status: 'pass',
          message: `ETH: ${ethChange >= 0n ? '+' : ''}${ethers.formatEther(ethChange)}, ` +
                   `Token: ${tokenChange >= 0n ? '+' : ''}${ethers.formatEther(tokenChange)}`,
        });
      }
      
    } catch (error) {
      checks.push({
        name: 'Pool State',
        status: 'fail',
        message: `Failed to read pool state: ${error}`,
      });
    }
    
    return checks;
  }

  // --------------------------------------------------------
  // Balance Validation
  // --------------------------------------------------------

  async validateBalances(addresses: string[]): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    
    for (const address of addresses) {
      try {
        const ethBalance = await this.provider.getBalance(address);
        
        let tokenBalance = 0n;
        if (this.contracts.paymentToken) {
          tokenBalance = await this.contracts.paymentToken.balanceOf(address);
        }
        
        let stakingShares = 0n;
        if (this.contracts.staking) {
          const position = await this.contracts.staking.getPosition(address);
          stakingShares = position[2]; // shares
        }
        
        let creditBalance = 0n;
        if (this.contracts.creditManager) {
          creditBalance = await this.contracts.creditManager.getBalance(address);
        }
        
        const snapshot: BalanceSnapshot = {
          timestamp: Date.now(),
          address,
          ethBalance,
          tokenBalance,
          stakingShares,
          creditBalance,
        };
        
        // Store snapshot
        if (!this.balanceSnapshots.has(address)) {
          this.balanceSnapshots.set(address, []);
        }
        this.balanceSnapshots.get(address)!.push(snapshot);
        
        // Report current balances
        checks.push({
          name: `Balance: ${address.slice(0, 8)}...`,
          status: 'pass',
          message: `ETH: ${ethers.formatEther(ethBalance)}, ` +
                   `Staked: ${ethers.formatEther(stakingShares)} shares`,
          value: ethers.formatEther(ethBalance),
        });
        
        // Compare with previous if available
        const snapshots = this.balanceSnapshots.get(address)!;
        if (snapshots.length >= 2) {
          const prev = snapshots[snapshots.length - 2];
          const curr = snapshots[snapshots.length - 1];
          
          const ethChange = curr.ethBalance - prev.ethBalance;
          if (ethChange !== 0n) {
            checks.push({
              name: `Change: ${address.slice(0, 8)}...`,
              status: 'pass',
              message: `ETH: ${ethChange >= 0n ? '+' : ''}${ethers.formatEther(ethChange)}`,
            });
          }
        }
        
      } catch (error) {
        checks.push({
          name: `Balance: ${address.slice(0, 8)}...`,
          status: 'fail',
          message: `Failed to read balance: ${error}`,
        });
      }
    }
    
    return checks;
  }

  // --------------------------------------------------------
  // Fee Distribution Validation
  // --------------------------------------------------------

  async validateFeeDistribution(): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    
    if (!this.contracts.staking) {
      checks.push({
        name: 'Fee Distribution',
        status: 'skip',
        message: 'Staking contract not configured',
      });
      return checks;
    }

    try {
      const totalDistributed = await this.contracts.staking.totalRewardsDistributed();
      const treasury = await this.contracts.staking.treasury();
      
      checks.push({
        name: 'Total Distributed',
        status: 'pass',
        message: `${ethers.formatEther(totalDistributed)} ETH distributed to stakers`,
        value: ethers.formatEther(totalDistributed),
      });
      
      checks.push({
        name: 'Treasury',
        status: 'pass',
        message: `Treasury: ${treasury}`,
        value: treasury,
      });
      
    } catch (error) {
      checks.push({
        name: 'Fee Distribution',
        status: 'fail',
        message: `Failed to read fee distribution: ${error}`,
      });
    }
    
    return checks;
  }

  // --------------------------------------------------------
  // Event Monitoring
  // --------------------------------------------------------

  async watchEvents(): Promise<void> {
    logger.info('Starting event monitoring...');
    
    if (this.contracts.staking) {
      this.contracts.staking.on('Staked', (user, ethAmount, tokenAmount, shares) => {
        logger.info(`[EVENT] Staked: ${user} staked ${ethers.formatEther(ethAmount)} ETH, ${ethers.formatEther(tokenAmount)} tokens → ${ethers.formatEther(shares)} shares`);
      });
      
      this.contracts.staking.on('Unstaked', (user, shares, ethReturned, tokenReturned) => {
        logger.info(`[EVENT] Unstaked: ${user} burned ${ethers.formatEther(shares)} shares → ${ethers.formatEther(ethReturned)} ETH, ${ethers.formatEther(tokenReturned)} tokens`);
      });
      
      this.contracts.staking.on('RewardsClaimed', (user, amount) => {
        logger.info(`[EVENT] RewardsClaimed: ${user} claimed ${ethers.formatEther(amount)} ETH`);
      });
      
      this.contracts.staking.on('RewardsDistributed', (amount) => {
        logger.info(`[EVENT] RewardsDistributed: ${ethers.formatEther(amount)} ETH added to pool`);
      });
    }
    
    if (this.contracts.creditManager) {
      this.contracts.creditManager.on('Deposited', (user, amount) => {
        logger.info(`[EVENT] Deposited: ${user} deposited ${ethers.formatEther(amount)} credits`);
      });
      
      this.contracts.creditManager.on('Spent', (user, amount) => {
        logger.info(`[EVENT] Spent: ${user} spent ${ethers.formatEther(amount)} credits`);
      });
    }
  }

  // --------------------------------------------------------
  // Run All Validations
  // --------------------------------------------------------

  async runAllValidations(addresses: string[] = []): Promise<void> {
    console.log('\n');
    console.log('╔═════════════════════════════════════════════════════════════════╗');
    console.log(`║  ON-CHAIN VALIDATION - ${this.network.name.padEnd(39)}║`);
    console.log(`║  ${new Date().toISOString().padEnd(62)}║`);
    console.log('╠═════════════════════════════════════════════════════════════════╣');
    
    // Pool State
    const poolChecks = await this.validatePoolState();
    this.printChecks('Pool State', poolChecks);
    
    // Balances
    if (addresses.length > 0) {
      const balanceChecks = await this.validateBalances(addresses);
      this.printChecks('Balances', balanceChecks);
    }
    
    // Fee Distribution
    const feeChecks = await this.validateFeeDistribution();
    this.printChecks('Fee Distribution', feeChecks);
    
    console.log('╚═════════════════════════════════════════════════════════════════╝');
    console.log('\n');
  }

  private printChecks(section: string, checks: ValidationCheck[]): void {
    console.log(`║  ${section}:`.padEnd(66) + '║');
    
    for (const check of checks) {
      const icon = check.status === 'pass' ? '✅' : 
                   check.status === 'fail' ? '❌' : 
                   check.status === 'warn' ? '⚠️' : '⏭️';
      const line = `    ${icon} ${check.name}: ${check.message}`;
      console.log(`║${line.substring(0, 64).padEnd(64)}║`);
    }
    console.log('║                                                                 ║');
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch');
  const networkArg = args.find(a => a.startsWith('--network='))?.split('=')[1] || 'localnet';
  
  const network = NETWORKS[networkArg];
  if (!network) {
    logger.error(`Unknown network: ${networkArg}`);
    logger.info(`Available: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }
  
  const validator = new OnChainValidator(network);
  
  try {
    await validator.initialize();
    
    // Get addresses to monitor from env or use defaults
    const monitorAddresses = process.env.MONITOR_ADDRESSES?.split(',') || [];
    
    if (watchMode) {
      logger.info('Watch mode enabled - monitoring events...');
      await validator.watchEvents();
      
      // Run validations every 30 seconds
      const runValidation = () => validator.runAllValidations(monitorAddresses);
      await runValidation();
      setInterval(runValidation, 30000);
      
      // Keep process alive
      await new Promise(() => {});
    } else {
      await validator.runAllValidations(monitorAddresses);
    }
    
  } catch (error) {
    logger.error('Validation failed:', error);
    process.exit(1);
  }
}

main();

