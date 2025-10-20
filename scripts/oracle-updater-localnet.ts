#!/usr/bin/env bun
/**
 * @title Oracle Price Updater Bot (Localnet Version)
 * @notice Updates price oracle on localnet with mock/configurable prices
 * @dev Simplified version for localnet testing - no Base DEX integration
 *
 * Features:
 * - Uses mock prices from environment variables
 * - Fast update intervals for testing (30s default)
 * - No external API dependencies
 * - Health check server for monitoring
 *
 * Usage:
 *   bun run scripts/oracle-updater-localnet.ts         # Continuous updates
 *   bun run scripts/oracle-updater-localnet.ts --once  # Single update
 */

import { ethers } from 'ethers';

// ============ Configuration ============

const CONFIG = {
  // Localnet RPC
  JEJU_RPC: process.env.JEJU_RPC_URL || 'http://localhost:8545',

  // Oracle contract on Jeju
  ORACLE_ADDRESS: process.env.ORACLE_ADDRESS || '',

  // Private key for price updater
  UPDATER_PRIVATE_KEY: process.env.PRICE_UPDATER_PRIVATE_KEY || '',

  // Update frequency (30 seconds for localnet)
  UPDATE_INTERVAL_MS: parseInt(process.env.UPDATE_INTERVAL_MS || '30000'),

  // Mock prices (8 decimals, Chainlink format)
  MOCK_ETH_PRICE: parseInt(process.env.MOCK_ETH_PRICE || '350000000000'), // $3500
  MOCK_ELIZA_PRICE: parseInt(process.env.MOCK_ELIZA_PRICE || '5000000'), // $0.05

  // Bot ID
  BOT_ID: process.env.BOT_ID || 'localnet-oracle-1',

  // Health check
  HEALTH_CHECK_PORT: parseInt(process.env.HEALTH_CHECK_PORT || '3001'),
  ENABLE_HEALTH_CHECK: process.env.ENABLE_HEALTH_CHECK !== 'false',

  // Price variation for realistic testing
  ENABLE_PRICE_VARIATION: process.env.ENABLE_PRICE_VARIATION === 'true',
  PRICE_VARIATION_PCT: parseFloat(process.env.PRICE_VARIATION_PCT || '2'), // +/- 2%
};

// ============ ABIs ============

const ORACLE_ABI = [
  'function updatePrices(uint256 newETHPrice, uint256 newElizaPrice) external',
  'function getPrices() external view returns (uint256 _ethUsdPrice, uint256 _elizaUsdPrice, uint256 _lastUpdate, bool fresh)',
  'function isPriceFresh() external view returns (bool)',
  'function ethUsdPrice() external view returns (uint256)',
  'function elizaUsdPrice() external view returns (uint256)',
  'function lastUpdateTime() external view returns (uint256)',
  'function setPriceUpdater(address) external',
];

// ============ Health Check Server ============

class HealthCheckServer {
  private status: {
    healthy: boolean;
    lastUpdate: number;
    consecutiveFailures: number;
    totalUpdates: number;
    uptime: number;
    ethPrice: number;
    elizaPrice: number;
    updateFailures: number;
  };

  constructor() {
    this.status = {
      healthy: true,
      lastUpdate: 0,
      consecutiveFailures: 0,
      totalUpdates: 0,
      uptime: Date.now(),
      ethPrice: 0,
      elizaPrice: 0,
      updateFailures: 0,
    };

    if (CONFIG.ENABLE_HEALTH_CHECK) {
      this.start();
    }
  }

  start() {
    Bun.serve({
      port: CONFIG.HEALTH_CHECK_PORT,
      fetch: (req) => {
        const url = new URL(req.url);

        if (url.pathname === '/health') {
          const healthy = this.status.healthy &&
                         (Date.now() - this.status.lastUpdate < 120000); // 2 min

          return new Response(JSON.stringify({
            status: healthy ? 'healthy' : 'unhealthy',
            botId: CONFIG.BOT_ID,
            mode: 'localnet',
            ...this.status,
            uptime: Math.floor((Date.now() - this.status.uptime) / 1000),
          }), {
            status: healthy ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/metrics') {
          const metrics = [
            `# HELP oracle_last_update_timestamp Unix timestamp of last successful update`,
            `# TYPE oracle_last_update_timestamp gauge`,
            `oracle_last_update_timestamp{bot_id="${CONFIG.BOT_ID}",mode="localnet"} ${this.status.lastUpdate}`,
            ``,
            `# HELP oracle_consecutive_failures Number of consecutive update failures`,
            `# TYPE oracle_consecutive_failures gauge`,
            `oracle_consecutive_failures{bot_id="${CONFIG.BOT_ID}",mode="localnet"} ${this.status.consecutiveFailures}`,
            ``,
            `# HELP oracle_total_updates Total number of successful updates`,
            `# TYPE oracle_total_updates counter`,
            `oracle_total_updates{bot_id="${CONFIG.BOT_ID}",mode="localnet"} ${this.status.totalUpdates}`,
            ``,
            `# HELP oracle_eth_usd_price Current ETH/USD price (8 decimals)`,
            `# TYPE oracle_eth_usd_price gauge`,
            `oracle_eth_usd_price{bot_id="${CONFIG.BOT_ID}",mode="localnet"} ${this.status.ethPrice}`,
            ``,
            `# HELP oracle_eliza_usd_price Current elizaOS/USD price (8 decimals)`,
            `# TYPE oracle_eliza_usd_price gauge`,
            `oracle_eliza_usd_price{bot_id="${CONFIG.BOT_ID}",mode="localnet"} ${this.status.elizaPrice}`,
            ``,
          ].join('\n');

          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain; version=0.0.4' },
          });
        }

        return new Response('Oracle Price Updater Bot (Localnet)', { status: 200 });
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

    if (additionalData) {
      Object.assign(this.status, additionalData);
    }
  }
}

// ============ Price Generator ============

class MockPriceGenerator {
  /**
   * Generate realistic price with optional variation
   */
  generatePrice(basePrice: number, enableVariation: boolean = false): number {
    if (!enableVariation) {
      return basePrice;
    }

    // Add random variation +/- PRICE_VARIATION_PCT
    const variationPct = (Math.random() * 2 - 1) * CONFIG.PRICE_VARIATION_PCT;
    const variation = basePrice * (variationPct / 100);
    const newPrice = Math.floor(basePrice + variation);

    return newPrice;
  }

  /**
   * Get current mock prices with optional variation
   */
  getPrices(): { ethPrice: number; elizaPrice: number } {
    const ethPrice = this.generatePrice(
      CONFIG.MOCK_ETH_PRICE,
      CONFIG.ENABLE_PRICE_VARIATION
    );
    const elizaPrice = this.generatePrice(
      CONFIG.MOCK_ELIZA_PRICE,
      CONFIG.ENABLE_PRICE_VARIATION
    );

    return { ethPrice, elizaPrice };
  }
}

// ============ Oracle Updater ============

class OracleUpdater {
  private priceGenerator: MockPriceGenerator;
  private wallet: ethers.Wallet | null = null;
  private oracle: ethers.Contract | null = null;
  private provider: ethers.JsonRpcProvider | null = null;
  private healthCheck: HealthCheckServer | null = null;

  constructor(enableHealthCheck: boolean = true) {
    if (enableHealthCheck) {
      this.healthCheck = new HealthCheckServer();
    }
    this.priceGenerator = new MockPriceGenerator();
  }

  async initialize() {
    console.log('🔧 Initializing oracle updater for localnet...\n');

    this.provider = new ethers.JsonRpcProvider(CONFIG.JEJU_RPC);
    this.wallet = new ethers.Wallet(CONFIG.UPDATER_PRIVATE_KEY, this.provider);
    this.oracle = new ethers.Contract(CONFIG.ORACLE_ADDRESS, ORACLE_ABI, this.wallet);

    // Verify connection
    const chainId = await this.provider.getNetwork().then(n => n.chainId);
    console.log(`✅ Connected to chain ID: ${chainId}`);
    console.log(`✅ Updater address: ${this.wallet.address}`);
    console.log(`✅ Oracle contract: ${CONFIG.ORACLE_ADDRESS}\n`);

    // Check if we're authorized
    try {
      const currentPrices = await this.oracle.getPrices();
      console.log(`📊 Current oracle prices:`);
      console.log(`   ETH/USD: $${(Number(currentPrices[0]) / 1e8).toFixed(2)}`);
      console.log(`   elizaOS/USD: $${(Number(currentPrices[1]) / 1e8).toFixed(6)}`);
      console.log(`   Last update: ${new Date(Number(currentPrices[2]) * 1000).toISOString()}\n`);
    } catch (error: any) {
      console.warn(`⚠️  Could not read current prices: ${error.message}\n`);
    }
  }

  /**
   * Update oracle with new prices
   */
  async updateOracle() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log(`🚀 Starting oracle update - ${new Date().toISOString()}`);
      console.log('='.repeat(60));

      if (!this.oracle || !this.provider || !this.wallet) {
        throw new Error('Oracle not initialized');
      }

      // Check wallet balance
      const balance = await this.provider.getBalance(this.wallet.address);
      const balanceEth = Number(ethers.formatEther(balance));
      console.log(`\n💰 Wallet Balance: ${balanceEth.toFixed(4)} ETH`);

      if (balanceEth < 0.001) {
        console.warn(`⚠️  Low wallet balance: ${balanceEth.toFixed(4)} ETH`);
      }

      // Get current oracle state
      const [currentEthPrice, currentElizaPrice, lastUpdate, fresh] = await this.oracle.getPrices();

      console.log('\n📊 Current Oracle State:');
      console.log(`   ETH/USD: $${(Number(currentEthPrice) / 1e8).toFixed(2)}`);
      console.log(`   elizaOS/USD: $${(Number(currentElizaPrice) / 1e8).toFixed(6)}`);
      console.log(`   Last Update: ${new Date(Number(lastUpdate) * 1000).toISOString()}`);
      console.log(`   Fresh: ${fresh}`);

      // Generate new prices
      const { ethPrice, elizaPrice } = this.priceGenerator.getPrices();

      console.log('\n📝 New Prices (Mock):');
      console.log(`   ETH/USD: $${(ethPrice / 1e8).toFixed(2)}`);
      console.log(`   elizaOS/USD: $${(elizaPrice / 1e8).toFixed(6)}`);

      // Calculate change
      const ethChangePercent = currentEthPrice > 0
        ? Math.abs(ethPrice - Number(currentEthPrice)) / Number(currentEthPrice) * 100
        : 100;
      const elizaChangePercent = currentElizaPrice > 0
        ? Math.abs(elizaPrice - Number(currentElizaPrice)) / Number(currentElizaPrice) * 100
        : 100;

      console.log(`   ETH change: ${ethChangePercent >= 0 ? '+' : ''}${ethChangePercent.toFixed(2)}%`);
      console.log(`   elizaOS change: ${elizaChangePercent >= 0 ? '+' : ''}${elizaChangePercent.toFixed(2)}%`);

      // Update oracle
      console.log('\n🔄 Submitting transaction to oracle...');

      const tx = await this.oracle.updatePrices(
        Math.floor(ethPrice),
        Math.floor(elizaPrice)
      );

      console.log(`   Transaction: ${tx.hash}`);
      console.log('   Waiting for confirmation...');

      const receipt = await tx.wait();

      console.log(`\n✅ Oracle updated successfully!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

      if (this.healthCheck) {
        this.healthCheck.updateStatus(true, {
          ethPrice: ethPrice,
          elizaPrice: elizaPrice,
        });
      }

    } catch (error: any) {
      console.error('\n❌ Oracle update failed:', error.message);

      // More detailed error logging
      if (error.code === 'CALL_EXCEPTION') {
        console.error('   Contract call failed. Possible reasons:');
        console.error('   - Not authorized as price updater');
        console.error('   - Price deviation too large');
        console.error('   - Price out of bounds');
      }

      if (this.healthCheck) {
        this.healthCheck.updateStatus(false);
      }
      throw error;
    }
  }

  /**
   * Run continuous updates
   */
  async start() {
    await this.initialize();

    console.log('🤖 Oracle updater bot started (LOCALNET MODE)');
    console.log(`   Bot ID: ${CONFIG.BOT_ID}`);
    console.log(`   Update interval: ${CONFIG.UPDATE_INTERVAL_MS / 1000}s`);
    console.log(`   Oracle: ${CONFIG.ORACLE_ADDRESS}`);
    console.log(`   Updater: ${this.wallet?.address}`);
    console.log(`   Price variation: ${CONFIG.ENABLE_PRICE_VARIATION ? 'enabled' : 'disabled'}`);
    console.log(`   Health check: http://localhost:${CONFIG.HEALTH_CHECK_PORT}/health\n`);

    // Initial update
    await this.updateOracle();

    // Schedule recurring updates
    setInterval(() => {
      this.updateOracle().catch(console.error);
    }, CONFIG.UPDATE_INTERVAL_MS);
  }

  /**
   * Run a single update and exit
   */
  async runOnce() {
    await this.initialize();
    await this.updateOracle();
    console.log('\n✅ Single update complete. Exiting...\n');
  }
}

// ============ Main ============

async function main() {
  // Validate config
  if (!CONFIG.ORACLE_ADDRESS) {
    throw new Error('ORACLE_ADDRESS environment variable required');
  }
  if (!CONFIG.UPDATER_PRIVATE_KEY) {
    throw new Error('PRICE_UPDATER_PRIVATE_KEY environment variable required');
  }

  // Check for --once flag
  const runOnce = process.argv.includes('--once');

  // Disable health check for one-time updates
  const updater = new OracleUpdater(!runOnce);

  if (runOnce) {
    await updater.runOnce();
    process.exit(0);
  } else {
    await updater.start();
  }
}

// Run if called directly
if (import.meta.main) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { OracleUpdater, MockPriceGenerator };
