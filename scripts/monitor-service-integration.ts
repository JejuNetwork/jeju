#!/usr/bin/env bun
/**
 * Cloud Integration Monitoring Dashboard
 * 
 * Real-time monitoring for the web2/web3 hybrid cloud integration:
 * - Contract event streams (purchases, usage, migrations)
 * - Treasury and paymaster balances
 * - Service usage metrics and revenue
 * - System health checks
 * - Alert triggers for anomalies
 *
 * Run with: bun scripts/monitor-cloud-integration.ts
 */

import { createPublicClient, http, parseAbi, formatEther, formatUnits, watchContractEvent } from 'viem';
import { logger } from './shared/logger';

// Monitor configuration
const MONITOR_CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL || 
          process.env.L2_RPC_URL || 
          `http://localhost:${process.env.L2_RPC_PORT || '9545'}`,
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  contracts: {
    ElizaOSToken: process.env.ELIZAOS_TOKEN_ADDRESS || '',
    cloudServiceRegistry: process.env.CLOUD_SERVICE_REGISTRY_ADDRESS || '',
    cloudPaymaster: process.env.CLOUD_PAYMASTER_ADDRESS || '',
    creditPurchaseContract: process.env.CREDIT_PURCHASE_CONTRACT || ''
  },
  treasury: process.env.APP_REVENUE_WALLET || '',
  refreshInterval: 30000, // 30 seconds
  alertThresholds: {
    lowBalance: '1', // 1 ETH
    highGasPrice: '100', // 100 gwei
    unusualVolume: 10000 // 10k requests/hour
  }
};

// Chain configuration
const jejuChain = {
  id: MONITOR_CONFIG.chainId,
  name: 'Jeju',
  network: 'jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [MONITOR_CONFIG.rpcUrl] },
    public: { http: [MONITOR_CONFIG.rpcUrl] }
  }
} as const;

const publicClient = createPublicClient({ chain: jejuChain, transport: http() });

// Monitoring state
const state = {
  lastBlockNumber: 0n,
  totalRevenue: 0n,
  totalUsageCount: 0,
  creditsPurchased: 0,
  migrationsCompleted: 0,
  serviceMetrics: {} as Record<string, { count: number; revenue: bigint }>,
  alerts: [] as string[]
};

const banner = `
╔════════════════════════════════════════════╗
║     Cloud Integration Monitor v1.0        ║
║          Real-Time System Dashboard        ║
╚════════════════════════════════════════════╝
`;

async function main() {
  console.log(banner);
  logger.info('Starting cloud integration monitoring');

  try {
    // Validate configuration
    await validateConfiguration();

    // Start monitoring loops
    console.log('\n🔄 Starting monitoring services...\n');

    // Event watchers (async streams)
    startEventWatchers();

    // Periodic health checks
    startHealthChecks();

    // Dashboard display
    startDashboardDisplay();

    // Keep process alive
    await new Promise(() => {}); // Run forever

  } catch (error) {
    logger.error('Monitor failed:', error);
    console.error('💥 Monitor failed:', error.message);
    process.exit(1);
  }
}

async function validateConfiguration(): Promise<void> {
  console.log('🔍 Validating monitor configuration...');

  // Check all contracts configured
  for (const [name, address] of Object.entries(MONITOR_CONFIG.contracts)) {
    if (!address) {
      throw new Error(`Missing contract address: ${name}`);
    }
  }

  // Verify RPC connection
  const blockNumber = await publicClient.getBlockNumber();
  state.lastBlockNumber = blockNumber;
  console.log(`✅ Connected to chain (block: ${blockNumber})`);

  // Check contracts are deployed
  for (const [name, address] of Object.entries(MONITOR_CONFIG.contracts)) {
    const code = await publicClient.getBytecode({ address: address as `0x${string}` });
    if (!code || code === '0x') {
      throw new Error(`Contract ${name} not deployed at ${address}`);
    }
  }
  console.log('✅ All contracts deployed and accessible');
}

function startEventWatchers(): void {
  console.log('👀 Starting event watchers...');

  // Watch CreditsPurchased events
  const creditPurchaseAbi = parseAbi([
    'event CreditsPurchased(address indexed user, address indexed paymentToken, uint256 paymentAmount, uint256 creditsReceived, uint256 pricePerCredit)'
  ]);

  watchContractEvent(publicClient, {
    address: MONITOR_CONFIG.contracts.creditPurchaseContract as `0x${string}`,
    abi: creditPurchaseAbi,
    eventName: 'CreditsPurchased',
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, paymentToken, paymentAmount, creditsReceived, pricePerCredit } = log.args;
        state.creditsPurchased++;
        state.totalRevenue += creditsReceived || 0n;
        
        logger.info('Credit Purchase', {
          user,
          paymentToken,
          paymentAmount: paymentAmount?.toString(),
          creditsReceived: formatUnits(creditsReceived || 0n, 18)
        });

        console.log(`💰 Credit Purchase: ${formatUnits(creditsReceived || 0n, 18)} elizaOS`);
      }
    }
  });

  // Watch ServiceUsageRecorded events
  const registryAbi = parseAbi([
    'event ServiceUsageRecorded(address indexed user, string serviceName, uint256 cost, bytes32 sessionId, uint256 volumeDiscount)'
  ]);

  watchContractEvent(publicClient, {
    address: MONITOR_CONFIG.contracts.cloudServiceRegistry as `0x${string}`,
    abi: registryAbi,
    eventName: 'ServiceUsageRecorded',
    onLogs: (logs) => {
      for (const log of logs) {
        const { user, serviceName, cost, sessionId, volumeDiscount } = log.args;
        state.totalUsageCount++;
        state.totalRevenue += cost || 0n;

        if (!state.serviceMetrics[serviceName as string]) {
          state.serviceMetrics[serviceName as string] = { count: 0, revenue: 0n };
        }
        state.serviceMetrics[serviceName as string].count++;
        state.serviceMetrics[serviceName as string].revenue += cost || 0n;

        logger.info('Service Usage', {
          user,
          serviceName,
          cost: formatUnits(cost || 0n, 18),
          discount: volumeDiscount?.toString()
        });

        console.log(`🔧 Service Used: ${serviceName} - ${formatUnits(cost || 0n, 18)} elizaOS`);
      }
    }
  });

  console.log('✅ Event watchers active');
}

async function startHealthChecks(): Promise<void> {
  console.log('🏥 Starting health check monitor...');

  setInterval(async () => {
    try {
      await performHealthCheck();
    } catch (error) {
      logger.error('Health check failed', error);
      state.alerts.push(`Health check error: ${error.message}`);
    }
  }, MONITOR_CONFIG.refreshInterval);

  console.log('✅ Health checks scheduled');
}

async function performHealthCheck(): Promise<void> {
  const erc20Abi = parseAbi([
    'function balanceOf(address account) external view returns (uint256)'
  ]);

  // Check treasury balance
  if (MONITOR_CONFIG.treasury) {
    const treasuryBalance = await publicClient.getBalance({
      address: MONITOR_CONFIG.treasury as `0x${string}`
    });

    const balanceEth = formatEther(treasuryBalance);
    if (Number(balanceEth) < Number(MONITOR_CONFIG.alertThresholds.lowBalance)) {
      const alert = `⚠️ Low treasury ETH balance: ${balanceEth}`;
      if (!state.alerts.includes(alert)) {
        state.alerts.push(alert);
        console.log(alert);
      }
    }

    // Check elizaOS token balance
    const tokenBalance = await publicClient.readContract({
      address: MONITOR_CONFIG.contracts.ElizaOSToken as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [MONITOR_CONFIG.treasury as `0x${string}`]
    });

    logger.debug('Treasury balances', {
      eth: balanceEth,
      elizaOS: formatUnits(tokenBalance, 18)
    });
  }

  // Check paymaster deposit
  const paymasterAbi = parseAbi([
    'function getDeposit() external view returns (uint256)'
  ]);

  const paymasterDeposit = await publicClient.readContract({
    address: MONITOR_CONFIG.contracts.cloudPaymaster as `0x${string}`,
    abi: paymasterAbi,
    functionName: 'getDeposit'
  });

  const depositEth = formatEther(paymasterDeposit);
  if (Number(depositEth) < Number(MONITOR_CONFIG.alertThresholds.lowBalance)) {
    const alert = `⚠️ Low paymaster deposit: ${depositEth} ETH`;
    if (!state.alerts.includes(alert)) {
      state.alerts.push(alert);
      console.log(alert);
    }
  }

  // Update last block
  state.lastBlockNumber = await publicClient.getBlockNumber();
}

async function startDashboardDisplay(): Promise<void> {
  console.log('📊 Starting dashboard display...\n');

  setInterval(() => {
    displayDashboard();
  }, MONITOR_CONFIG.refreshInterval);

  // Initial display
  setTimeout(displayDashboard, 2000);
}

function displayDashboard(): void {
  console.clear();
  console.log(banner);
  console.log(`🕐 ${new Date().toISOString()}`);
  console.log(`📦 Block: ${state.lastBlockNumber.toString()}\n`);

  console.log('='.repeat(60));
  console.log('📊 SYSTEM METRICS');
  console.log('='.repeat(60));
  console.log(`Total Revenue:          ${formatUnits(state.totalRevenue, 18)} elizaOS`);
  console.log(`Total Usage Count:      ${state.totalUsageCount.toLocaleString()}`);
  console.log(`Credits Purchased:      ${state.creditsPurchased.toLocaleString()}`);
  console.log(`Migrations Completed:   ${state.migrationsCompleted.toLocaleString()}`);
  console.log('');

  if (Object.keys(state.serviceMetrics).length > 0) {
    console.log('='.repeat(60));
    console.log('🔧 SERVICE BREAKDOWN');
    console.log('='.repeat(60));
    for (const [service, metrics] of Object.entries(state.serviceMetrics)) {
      console.log(`${service}:`);
      console.log(`  Requests:  ${metrics.count.toLocaleString()}`);
      console.log(`  Revenue:   ${formatUnits(metrics.revenue, 18)} elizaOS`);
    }
    console.log('');
  }

  if (state.alerts.length > 0) {
    console.log('='.repeat(60));
    console.log('⚠️  ACTIVE ALERTS');
    console.log('='.repeat(60));
    state.alerts.slice(-5).forEach(alert => console.log(alert));
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('💡 Press Ctrl+C to stop monitoring');
  console.log('='.repeat(60));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Monitoring stopped');
  logger.info('Monitor shutdown');
  process.exit(0);
});

// Run monitor
if (import.meta.main) {
  main().catch(console.error);
}
