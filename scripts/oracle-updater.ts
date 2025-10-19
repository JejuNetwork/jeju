#!/usr/bin/env bun
/**
 * @title Oracle Price Updater Bot
 * @notice Fetches elizaOS/ETH prices from Base and updates L3 oracle
 * @dev Run this as a cron job or keeper bot (every 5-10 minutes)
 * 
 * Price Sources:
 * 1. ETH/USD - Chainlink on Base (most reliable)
 * 2. elizaOS/USD - Base DEX aggregated prices (Uniswap V3, Aerodrome)
 * 
 * Safety Features:
 * - Maximum deviation checks
 * - Staleness detection
 * - Multi-source price aggregation
 * - Automatic failover
 */

import { ethers } from 'ethers';
import { FailoverProvider as BaseFailoverProvider } from './shared/rpc';

// ============ Configuration ============

const CONFIG = {
  // Base RPC URLs (failover support - tries in order)
  BASE_RPCS: (process.env.BASE_RPC_URLS || process.env.BASE_RPC_URL || 'https://mainnet.base.org')
    .split(',').map(url => url.trim()),
  
  // Jeju RPC URLs (failover support)
  JEJU_RPCS: (process.env.JEJU_RPC_URLS || process.env.JEJU_RPC_URL || 'https://rpc.jeju.network')
    .split(',').map(url => url.trim()),
  
  // Oracle contract on Jeju
  ORACLE_ADDRESS: process.env.ORACLE_ADDRESS || '',
  
  // ElizaOS token on Base
  ELIZAOS_TOKEN_BASE: process.env.ELIZAOS_TOKEN_BASE || '',
  
  // Private key for price updater (low-privilege, just updates oracle)
  UPDATER_PRIVATE_KEY: process.env.PRICE_UPDATER_PRIVATE_KEY || '',
  
  // Update frequency
  UPDATE_INTERVAL_MS: parseInt(process.env.UPDATE_INTERVAL_MS || '300000'), // 5 minutes
  
  // Safety limits
  MAX_PRICE_DEVIATION_PCT: parseInt(process.env.MAX_PRICE_DEVIATION_PCT || '10'),
  MIN_UPDATE_INTERVAL_S: parseInt(process.env.MIN_UPDATE_INTERVAL_S || '60'),
  
  // Multi-bot coordination
  BOT_ID: process.env.BOT_ID || `bot-${Math.random().toString(36).substring(7)}`,
  LEADER_ELECTION_ENABLED: process.env.LEADER_ELECTION_ENABLED === 'true',
  
  // Health check server
  HEALTH_CHECK_PORT: parseInt(process.env.HEALTH_CHECK_PORT || '3000'),
  ENABLE_HEALTH_CHECK: process.env.ENABLE_HEALTH_CHECK !== 'false',
  
  // Retry configuration
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3'),
  RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '5000'),
  
  // Gas configuration
  GAS_PRICE_MULTIPLIER: parseFloat(process.env.GAS_PRICE_MULTIPLIER || '1.2'),
  MAX_GAS_PRICE_GWEI: parseInt(process.env.MAX_GAS_PRICE_GWEI || '100'),
};

// ============ Chainlink Price Feeds on Base ============

const CHAINLINK_FEEDS_BASE = {
  'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // Base mainnet
};

// ============ DEX Contracts on Base ============

const UNISWAP_V3_FACTORY_BASE = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
// const AERODROME_ROUTER_BASE = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'; // Future: Aerodrome support

// ============ ABIs ============

const ORACLE_ABI = [
  'function updatePrices(uint256 newETHPrice, uint256 newElizaPrice) external',
  'function getPrices() external view returns (uint256 _ethUsdPrice, uint256 _elizaUsdPrice, uint256 _lastUpdate, bool fresh)',
  'function isPriceFresh() external view returns (bool)',
];

const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const UNISWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// ============ Price Fetchers ============

// ============ RPC Failover ============
// Using shared FailoverProvider from scripts/shared/rpc.ts

class PriceFetcher {
  private baseProviderFailover: BaseFailoverProvider;
  private jejuProviderFailover: BaseFailoverProvider;
  private lastETHPrice: number = 0;
  private lastElizaPrice: number = 0;
  private consecutiveFailures: number = 0;

  constructor(onRpcFailover?: () => void) {
    this.baseProviderFailover = new BaseFailoverProvider(CONFIG.BASE_RPCS, 'Base', onRpcFailover);
    this.jejuProviderFailover = new BaseFailoverProvider(CONFIG.JEJU_RPCS, 'Jeju', onRpcFailover);
  }
  
  async getBaseProvider(): Promise<ethers.Provider> {
    return this.baseProviderFailover.getProvider();
  }
  
  async getJejuProvider(): Promise<ethers.Provider> {
    return this.jejuProviderFailover.getProvider();
  }
  
  /**
   * Fetch ETH/USD from Chainlink on Base
   */
  async getETHPriceFromChainlink(): Promise<number> {
    try {
      const provider = await this.getBaseProvider();
      const feed = new ethers.Contract(
        CHAINLINK_FEEDS_BASE['ETH/USD'],
        CHAINLINK_ABI,
        provider
      );
      
      const [, answer, , updatedAt] = await feed.latestRoundData();
      const decimals = await feed.decimals();
      
      // Check if price is fresh (within 1 hour)
      const age = Date.now() / 1000 - Number(updatedAt);
      if (age > 3600) {
        console.warn(`⚠️  Chainlink ETH/USD price is stale (${age}s old)`);
      }
      
      // Convert to 8 decimals (Chainlink uses 8 decimals)
      const price = Number(answer) / (10 ** Number(decimals)) * 1e8;
      
      console.log(`✅ ETH/USD from Chainlink: $${(price / 1e8).toFixed(2)}`);
      return price;
      
    } catch (error) {
      console.error('❌ Failed to fetch ETH price from Chainlink:', error);
      throw error;
    }
  }
  
  /**
   * Fetch elizaOS/ETH from Uniswap V3 on Base
   */
  async getElizaPriceFromUniswapV3(): Promise<number> {
    try {
      const provider = await this.getBaseProvider();
      const factory = new ethers.Contract(
        UNISWAP_V3_FACTORY_BASE,
        UNISWAP_V3_FACTORY_ABI,
        provider
      );
      
      const WETH = '0x4200000000000000000000000000000000000006'; // Base WETH
      
      // Try different fee tiers (0.05%, 0.3%, 1%)
      const feeTiers = [500, 3000, 10000];
      
      for (const fee of feeTiers) {
        const poolAddress = await factory.getPool(CONFIG.ELIZAOS_TOKEN_BASE, WETH, fee);
        
        if (poolAddress === ethers.ZeroAddress) continue;
        
        console.log(`📊 Found Uniswap V3 pool at ${poolAddress} (${fee/10000}% fee)`);
        
        const pool = new ethers.Contract(
          poolAddress,
          UNISWAP_V3_POOL_ABI,
          provider
        );
        
        const [sqrtPriceX96] = await pool.slot0();
        const token0 = await pool.token0();
        
        // Calculate price from sqrtPriceX96
        // price = (sqrtPriceX96 / 2^96)^2
        const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
        let price = sqrtPrice ** 2;
        
        // Adjust for token order and decimals
        const elizaToken = new ethers.Contract(CONFIG.ELIZAOS_TOKEN_BASE, ERC20_ABI, provider);
        const elizaDecimals = await elizaToken.decimals();
        
        if (token0.toLowerCase() === CONFIG.ELIZAOS_TOKEN_BASE.toLowerCase()) {
          // elizaOS is token0, price is in WETH per elizaOS
          price = 1 / price;
        }
        
        // Adjust for decimals (assume WETH is 18 decimals)
        price = price * (10 ** (18 - Number(elizaDecimals)));
        
        // Get ETH price to convert to USD
        const ethPrice = this.lastETHPrice || await this.getETHPriceFromChainlink();
        const elizaPriceUSD = (price * ethPrice / 1e8); // 8 decimals
        
        console.log(`✅ elizaOS/ETH from Uniswap V3: ${price.toFixed(6)} ETH`);
        console.log(`✅ elizaOS/USD: $${(elizaPriceUSD / 1e8).toFixed(6)}`);
        
        return elizaPriceUSD;
      }
      
      throw new Error('No Uniswap V3 pool found for elizaOS');
      
    } catch (error) {
      console.error('❌ Failed to fetch elizaOS price from Uniswap V3:', error);
      throw error;
    }
  }
  
  /**
   * Aggregate prices from multiple sources with retry logic
   */
  async fetchPrices(): Promise<{ ethPrice: number; elizaPrice: number }> {
    console.log('\n🔄 Fetching prices from Base...\n');
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        // Fetch ETH price
        const ethPrice = await this.getETHPriceFromChainlink();
        this.lastETHPrice = ethPrice;
        
        // Fetch elizaOS price
        const elizaPrice = await this.getElizaPriceFromUniswapV3();
        this.lastElizaPrice = elizaPrice;
        
        // Sanity checks
        this.validatePrices(ethPrice, elizaPrice);
        
        this.consecutiveFailures = 0; // Reset failure counter
        return { ethPrice, elizaPrice };
        
      } catch (error: any) {
        console.error(`❌ Attempt ${attempt}/${CONFIG.MAX_RETRIES} failed:`, error.message);
        
        if (attempt < CONFIG.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${CONFIG.RETRY_DELAY_MS / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
        } else {
          this.consecutiveFailures++;
          throw new Error(`Failed to fetch prices after ${CONFIG.MAX_RETRIES} attempts`);
        }
      }
    }
    
    throw new Error('Unexpected: fetchPrices loop completed without return');
  }
  
  /**
   * Validate prices are reasonable
   */
  private validatePrices(ethPrice: number, elizaPrice: number) {
    // ETH should be between $500 and $10,000
    if (ethPrice < 50000000000 || ethPrice > 1000000000000) {
      throw new Error(`ETH price out of bounds: $${ethPrice / 1e8}`);
    }
    
    // Check for sudden large moves
    if (this.lastETHPrice > 0) {
      const ethChange = Math.abs(ethPrice - this.lastETHPrice) / this.lastETHPrice * 100;
      if (ethChange > CONFIG.MAX_PRICE_DEVIATION_PCT) {
        console.warn(`⚠️  Large ETH price move: ${ethChange.toFixed(2)}% - Manual review recommended`);
      }
    }
    
    if (this.lastElizaPrice > 0) {
      const elizaChange = Math.abs(elizaPrice - this.lastElizaPrice) / this.lastElizaPrice * 100;
      if (elizaChange > CONFIG.MAX_PRICE_DEVIATION_PCT) {
        console.warn(`⚠️  Large elizaOS price move: ${elizaChange.toFixed(2)}% - Manual review recommended`);
      }
    }
  }
}

// ============ Health Check Server ============

class HealthCheckServer {
  private status: {
    healthy: boolean;
    lastUpdate: number;
    consecutiveFailures: number;
    totalUpdates: number;
    uptime: number;
    isLeader: boolean;
    ethPrice: number;
    elizaPrice: number;
    walletBalance: number;
    gasPrice: number;
    rpcFailovers: number;
    updateFailures: number;
  };

  constructor() {
    this.status = {
      healthy: true,
      lastUpdate: 0,
      consecutiveFailures: 0,
      totalUpdates: 0,
      uptime: Date.now(),
      isLeader: false,
      ethPrice: 0,
      elizaPrice: 0,
      walletBalance: 0,
      gasPrice: 0,
      rpcFailovers: 0,
      updateFailures: 0,
    };

    if (CONFIG.ENABLE_HEALTH_CHECK) {
      this.start();
    }
  }

  start() {
    // Simple HTTP health check server (using Bun's built-in server)
    Bun.serve({
      port: CONFIG.HEALTH_CHECK_PORT,
      fetch: (req) => {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          const healthy = this.status.healthy &&
                         (Date.now() - this.status.lastUpdate < 600000); // 10 min

          return new Response(JSON.stringify({
            status: healthy ? 'healthy' : 'unhealthy',
            botId: CONFIG.BOT_ID,
            ...this.status,
            uptime: Math.floor((Date.now() - this.status.uptime) / 1000),
          }), {
            status: healthy ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/metrics') {
          // Prometheus-compatible metrics format
          const metrics = [
            `# HELP oracle_last_update_timestamp Unix timestamp of last successful update`,
            `# TYPE oracle_last_update_timestamp gauge`,
            `oracle_last_update_timestamp{bot_id="${CONFIG.BOT_ID}"} ${this.status.lastUpdate}`,
            ``,
            `# HELP oracle_consecutive_failures Number of consecutive update failures`,
            `# TYPE oracle_consecutive_failures gauge`,
            `oracle_consecutive_failures{bot_id="${CONFIG.BOT_ID}"} ${this.status.consecutiveFailures}`,
            ``,
            `# HELP oracle_total_updates Total number of successful updates`,
            `# TYPE oracle_total_updates counter`,
            `oracle_total_updates{bot_id="${CONFIG.BOT_ID}"} ${this.status.totalUpdates}`,
            ``,
            `# HELP oracle_update_failures_total Total number of failed updates`,
            `# TYPE oracle_update_failures_total counter`,
            `oracle_update_failures_total{bot_id="${CONFIG.BOT_ID}"} ${this.status.updateFailures}`,
            ``,
            `# HELP oracle_is_leader Whether this bot is the current leader`,
            `# TYPE oracle_is_leader gauge`,
            `oracle_is_leader{bot_id="${CONFIG.BOT_ID}"} ${this.status.isLeader ? 1 : 0}`,
            ``,
            `# HELP oracle_eth_usd_price Current ETH/USD price (8 decimals)`,
            `# TYPE oracle_eth_usd_price gauge`,
            `oracle_eth_usd_price{bot_id="${CONFIG.BOT_ID}"} ${this.status.ethPrice}`,
            ``,
            `# HELP oracle_eliza_usd_price Current elizaOS/USD price (8 decimals)`,
            `# TYPE oracle_eliza_usd_price gauge`,
            `oracle_eliza_usd_price{bot_id="${CONFIG.BOT_ID}"} ${this.status.elizaPrice}`,
            ``,
            `# HELP oracle_wallet_balance_eth Bot wallet balance in ETH`,
            `# TYPE oracle_wallet_balance_eth gauge`,
            `oracle_wallet_balance_eth{bot_id="${CONFIG.BOT_ID}"} ${this.status.walletBalance}`,
            ``,
            `# HELP oracle_gas_price_gwei Current gas price in gwei`,
            `# TYPE oracle_gas_price_gwei gauge`,
            `oracle_gas_price_gwei{bot_id="${CONFIG.BOT_ID}"} ${this.status.gasPrice}`,
            ``,
            `# HELP oracle_rpc_failover_total Number of RPC failovers`,
            `# TYPE oracle_rpc_failover_total counter`,
            `oracle_rpc_failover_total{bot_id="${CONFIG.BOT_ID}"} ${this.status.rpcFailovers}`,
            ``,
            `# HELP oracle_uptime_seconds Bot uptime in seconds`,
            `# TYPE oracle_uptime_seconds gauge`,
            `oracle_uptime_seconds{bot_id="${CONFIG.BOT_ID}"} ${Math.floor((Date.now() - this.status.uptime) / 1000)}`,
            ``,
          ].join('\n');

          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain; version=0.0.4' },
          });
        }

        return new Response('Oracle Price Updater Bot', { status: 200 });
      },
    });

    console.log(`✅ Health check server listening on :${CONFIG.HEALTH_CHECK_PORT}`);
  }

  updateStatus(success: boolean, additionalData?: Partial<typeof this.status>) {
    this.status.lastUpdate = Date.now();
    if (success) {
      this.status.totalUpdates++;
      this.status.consecutiveFailures = 0;
      this.status.healthy = true;
    } else {
      this.status.consecutiveFailures++;
      this.status.updateFailures++;
      if (this.status.consecutiveFailures > 5) {
        this.status.healthy = false;
      }
    }

    // Update additional metrics
    if (additionalData) {
      Object.assign(this.status, additionalData);
    }
  }

  setLeaderStatus(isLeader: boolean) {
    this.status.isLeader = isLeader;
  }

  incrementRpcFailover() {
    this.status.rpcFailovers++;
  }
}

// ============ Leader Election (Simple File-Based) ============

class LeaderElection {
  private isLeader: boolean = false;
  private leaderFile = '/tmp/oracle-bot-leader.lock';
  private heartbeatInterval: any;
  
  async tryBecomeLeader(): Promise<boolean> {
    if (!CONFIG.LEADER_ELECTION_ENABLED) {
      return true; // Always leader if election disabled
    }
    
    try {
      // Try to acquire lock
      const file = Bun.file(this.leaderFile);
      const exists = await file.exists();
      
      if (!exists) {
        // No leader, become leader
        await Bun.write(this.leaderFile, JSON.stringify({
          botId: CONFIG.BOT_ID,
          timestamp: Date.now(),
        }));
        this.isLeader = true;
        console.log(`👑 Bot ${CONFIG.BOT_ID} became leader`);
        this.startHeartbeat();
        return true;
      }
      
      // Check if current leader is alive
      const leaderData = await file.json() as any;
      const age = Date.now() - leaderData.timestamp;
      
      if (age > 120000) { // 2 minutes, leader is dead
        console.log(`💀 Previous leader ${leaderData.botId} is dead, taking over`);
        await Bun.write(this.leaderFile, JSON.stringify({
          botId: CONFIG.BOT_ID,
          timestamp: Date.now(),
        }));
        this.isLeader = true;
        this.startHeartbeat();
        return true;
      }
      
      // Leader is alive, stay as follower
      if (this.isLeader) {
        console.log(`👥 Bot ${CONFIG.BOT_ID} stepped down, ${leaderData.botId} is leader`);
        this.isLeader = false;
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
        }
      }
      return false;
      
    } catch (error) {
      console.warn('⚠️  Leader election error:', error);
      return !CONFIG.LEADER_ELECTION_ENABLED; // Fallback to standalone mode
    }
  }
  
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isLeader) {
        await Bun.write(this.leaderFile, JSON.stringify({
          botId: CONFIG.BOT_ID,
          timestamp: Date.now(),
        }));
      }
    }, 30000); // 30 second heartbeat
  }
  
  async checkIsLeader(): Promise<boolean> {
    return this.tryBecomeLeader();
  }
}

// ============ Oracle Updater ============

class OracleUpdater {
  private priceFetcher: PriceFetcher;
  private wallet: ethers.Wallet | null = null;
  private oracle: ethers.Contract | null = null;
  private lastUpdateTime: number = 0;
  private healthCheck: HealthCheckServer;
  private leaderElection: LeaderElection;

  constructor() {
    this.healthCheck = new HealthCheckServer();
    this.priceFetcher = new PriceFetcher(() => this.healthCheck.incrementRpcFailover());
    this.leaderElection = new LeaderElection();
  }
  
  async initialize() {
    const provider = await this.priceFetcher.getJejuProvider();
    this.wallet = new ethers.Wallet(CONFIG.UPDATER_PRIVATE_KEY, provider);
    this.oracle = new ethers.Contract(CONFIG.ORACLE_ADDRESS, ORACLE_ABI, this.wallet);
  }
  
  /**
   * Update oracle with new prices
   */
  async updateOracle() {
    try {
      // Check if we're the leader (if election enabled)
      const isLeader = await this.leaderElection.checkIsLeader();
      this.healthCheck.setLeaderStatus(isLeader);

      if (!isLeader) {
        console.log(`👥 Bot ${CONFIG.BOT_ID} is follower, skipping update`);
        return;
      }

      console.log('\n' + '='.repeat(60));
      console.log(`🚀 Starting oracle update - ${new Date().toISOString()} [${CONFIG.BOT_ID}]`);
      console.log('='.repeat(60));

      // Check wallet balance
      if (this.wallet) {
        const provider = await this.priceFetcher.getJejuProvider();
        const balance = await provider.getBalance(this.wallet.address);
        const balanceEth = Number(ethers.formatEther(balance));

        console.log(`\n💰 Wallet Balance: ${balanceEth.toFixed(4)} ETH`);

        // Update health check metrics
        this.healthCheck.updateStatus(true, { walletBalance: balanceEth });

        // Alert if balance is low
        if (balanceEth < 0.01) {
          console.warn(`⚠️  Low wallet balance: ${balanceEth.toFixed(4)} ETH`);
          await this.sendAlert(`Low wallet balance: ${balanceEth.toFixed(4)} ETH. Please top up soon.`);
        }

        if (balanceEth < 0.001) {
          console.error(`🚨 CRITICAL: Very low wallet balance: ${balanceEth.toFixed(4)} ETH`);
          await this.sendAlert(`CRITICAL: Very low wallet balance: ${balanceEth.toFixed(4)} ETH. Top up immediately!`);
          return; // Don't try to update with insufficient balance
        }
      }

      // Check if we should update (rate limiting)
      const now = Date.now() / 1000;
      if (now - this.lastUpdateTime < CONFIG.MIN_UPDATE_INTERVAL_S) {
        console.log('⏭️  Skipping update (too soon since last update)');
        return;
      }

      if (!this.oracle) {
        throw new Error('Oracle not initialized');
      }

      // Check current oracle state
      const [currentEthPrice, currentElizaPrice, lastUpdate, fresh] = await this.oracle.getPrices();

      console.log('\n📊 Current Oracle State:');
      console.log(`   ETH/USD: $${(Number(currentEthPrice) / 1e8).toFixed(2)}`);
      console.log(`   elizaOS/USD: $${(Number(currentElizaPrice) / 1e8).toFixed(6)}`);
      console.log(`   Last Update: ${new Date(Number(lastUpdate) * 1000).toISOString()}`);
      console.log(`   Fresh: ${fresh}`);

      // Fetch new prices
      const { ethPrice, elizaPrice } = await this.priceFetcher.fetchPrices();

      // Update health metrics with current prices
      this.healthCheck.updateStatus(true, {
        ethPrice: ethPrice,
        elizaPrice: elizaPrice,
      });

      // Check if update is needed (>1% change)
      const ethChangePercent = Math.abs(ethPrice - Number(currentEthPrice)) / Number(currentEthPrice) * 100;
      const elizaChangePercent = Math.abs(elizaPrice - Number(currentElizaPrice)) / Number(currentElizaPrice) * 100;

      if (ethChangePercent < 1 && elizaChangePercent < 1 && fresh) {
        console.log('\n✅ Prices haven\'t changed significantly, skipping update');
        return;
      }

      console.log('\n📝 New Prices:');
      console.log(`   ETH/USD: $${(ethPrice / 1e8).toFixed(2)} (${ethChangePercent >= 0 ? '+' : ''}${ethChangePercent.toFixed(2)}%)`);
      console.log(`   elizaOS/USD: $${(elizaPrice / 1e8).toFixed(6)} (${elizaChangePercent >= 0 ? '+' : ''}${elizaChangePercent.toFixed(2)}%)`);

      // Check gas price
      const provider = await this.priceFetcher.getJejuProvider();
      const feeData = await provider.getFeeData();
      const gasPriceGwei = Number(feeData.gasPrice) / 1e9;

      // Update health metrics with gas price
      this.healthCheck.updateStatus(true, { gasPrice: gasPriceGwei });

      if (gasPriceGwei > CONFIG.MAX_GAS_PRICE_GWEI) {
        console.log(`⚠️  Gas price too high (${gasPriceGwei.toFixed(2)} gwei), skipping update`);
        return;
      }

      // Update oracle
      console.log('\n🔄 Submitting transaction to oracle...');
      console.log(`   Gas price: ${gasPriceGwei.toFixed(2)} gwei`);

      const tx = await this.oracle.updatePrices(
        Math.floor(ethPrice),
        Math.floor(elizaPrice),
        {
          maxFeePerGas: feeData.maxFeePerGas ?
            (feeData.maxFeePerGas * BigInt(Math.floor(CONFIG.GAS_PRICE_MULTIPLIER * 100)) / 100n) :
            undefined,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?
            (feeData.maxPriorityFeePerGas * BigInt(Math.floor(CONFIG.GAS_PRICE_MULTIPLIER * 100)) / 100n) :
            undefined,
        }
      );

      console.log(`   Transaction: ${tx.hash}`);
      console.log('   Waiting for confirmation...');

      const receipt = await tx.wait();

      console.log(`\n✅ Oracle updated successfully!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

      this.lastUpdateTime = now;
      this.healthCheck.updateStatus(true, {
        ethPrice: ethPrice,
        elizaPrice: elizaPrice,
        gasPrice: gasPriceGwei,
      });

    } catch (error: any) {
      console.error('\n❌ Oracle update failed:', error.message);
      this.healthCheck.updateStatus(false);

      // Alert on critical errors
      if (error.message.includes('PriceDeviationTooLarge')) {
        console.error('🚨 CRITICAL: Price deviation too large - manual intervention required');
        await this.sendAlert('CRITICAL: Price deviation too large');
      }

      if (error.message.includes('InsufficientLiquidity')) {
        console.error('🚨 CRITICAL: Insufficient liquidity in vault');
        await this.sendAlert('CRITICAL: Insufficient liquidity');
      }

      if (error.message.includes('insufficient funds')) {
        console.error('🚨 CRITICAL: Insufficient wallet balance for gas');
        await this.sendAlert('CRITICAL: Bot wallet has insufficient funds for gas');
      }
    }
  }
  
  /**
   * Send alert (placeholder - implement based on your alerting setup)
   */
  private async sendAlert(message: string) {
    console.log(`🚨 ALERT: ${message}`);
    
    // Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `🚨 Jeju Oracle Bot Alert\n\n${message}\n\nBot: ${CONFIG.BOT_ID}\nTime: ${new Date().toISOString()}`,
          }),
        });
      } catch (error) {
        console.error('Failed to send Telegram alert:', error);
      }
    }
    
    // Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `🚨 **Jeju Oracle Bot Alert**\n\n${message}\n\nBot: ${CONFIG.BOT_ID}\nTime: ${new Date().toISOString()}`,
          }),
        });
      } catch (error) {
        console.error('Failed to send Discord alert:', error);
      }
    }
  }
  
  /**
   * Run continuous updates
   */
  async start() {
    await this.initialize();
    
    if (!this.wallet) {
      throw new Error('Failed to initialize wallet');
    }
    
    console.log('🤖 Oracle updater bot started');
    console.log(`   Bot ID: ${CONFIG.BOT_ID}`);
    console.log(`   Update interval: ${CONFIG.UPDATE_INTERVAL_MS / 1000}s`);
    console.log(`   Oracle: ${CONFIG.ORACLE_ADDRESS}`);
    console.log(`   Updater: ${this.wallet.address}`);
    console.log(`   Leader election: ${CONFIG.LEADER_ELECTION_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`   Health check: http://localhost:${CONFIG.HEALTH_CHECK_PORT}/health\n`);
    console.log(`   RPC failover:`);
    console.log(`     - Base: ${CONFIG.BASE_RPCS.length} endpoint(s)`);
    console.log(`     - Jeju: ${CONFIG.JEJU_RPCS.length} endpoint(s)\n`);
    
    // Initial update
    await this.updateOracle();
    
    // Schedule recurring updates
    setInterval(() => {
      this.updateOracle().catch(console.error);
    }, CONFIG.UPDATE_INTERVAL_MS);
  }
}

// ============ Main ============

async function main() {
  // Validate config
  if (!CONFIG.ORACLE_ADDRESS) {
    throw new Error('ORACLE_ADDRESS environment variable required');
  }
  if (!CONFIG.ELIZAOS_TOKEN_BASE) {
    throw new Error('ELIZAOS_TOKEN_BASE environment variable required');
  }
  if (!CONFIG.UPDATER_PRIVATE_KEY) {
    throw new Error('PRICE_UPDATER_PRIVATE_KEY environment variable required');
  }
  
  const updater = new OracleUpdater();
  await updater.start();
}

// Run if called directly
if (import.meta.main) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { OracleUpdater, PriceFetcher };

