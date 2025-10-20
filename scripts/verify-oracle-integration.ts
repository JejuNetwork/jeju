#!/usr/bin/env bun
/**
 * @title Verify Oracle Integration
 * @notice Comprehensive check that oracle system is properly integrated
 */

import { ethers } from 'ethers';

const CONFIG = {
  JEJU_RPC: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network',
  BASE_RPC: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  ORACLE_ADDRESS: process.env.ORACLE_ADDRESS || '',
  PAYMASTER_ADDRESS: process.env.PAYMASTER_ADDRESS || '',
  VAULT_ADDRESS: process.env.VAULT_ADDRESS || '',
  DISTRIBUTOR_ADDRESS: process.env.DISTRIBUTOR_ADDRESS || '',
  BOT_ADDRESS: process.env.BOT_ADDRESS || '',
};

// ABIs
const ORACLE_ABI = [
  'function isPriceFresh() external view returns (bool)',
  'function getPrices() external view returns (uint256, uint256, uint256, bool)',
  'function priceUpdater() external view returns (address)',
  'function owner() external view returns (address)',
];

const PAYMASTER_ABI = [
  'function priceOracle() external view returns (address)',
  'function liquidityVault() external view returns (address)',
  'function feeDistributor() external view returns (address)',
  'function isOperational() external view returns (bool)',
  'function paused() external view returns (bool)',
];

const VAULT_ABI = [
  'function paymaster() external view returns (address)',
  'function feeDistributor() external view returns (address)',
  'function availableETH() external view returns (uint256)',
  'function paused() external view returns (bool)',
];

const DISTRIBUTOR_ABI = [
  'function paymaster() external view returns (address)',
  'function liquidityVault() external view returns (address)',
];

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
}

class IntegrationVerifier {
  private jejuProvider: ethers.Provider;
  private baseProvider: ethers.Provider;
  private results: CheckResult[] = [];
  
  constructor() {
    this.jejuProvider = new ethers.JsonRpcProvider(CONFIG.JEJU_RPC);
    this.baseProvider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC);
  }
  
  async runAllChecks() {
    console.log('🔍 Jeju Oracle Integration Verification\n');
    console.log('='.repeat(60));
    
    // 1. RPC Connectivity
    await this.checkRPCConnectivity();
    
    // 2. Contract Deployments
    await this.checkContractDeployments();
    
    // 3. Contract Integration
    await this.checkContractIntegration();
    
    // 4. Oracle Configuration
    await this.checkOracleConfiguration();
    
    // 5. Paymaster Configuration
    await this.checkPaymasterConfiguration();
    
    // 6. Vault Configuration
    await this.checkVaultConfiguration();
    
    // 7. Operational Status
    await this.checkOperationalStatus();
    
    // 8. Bot Configuration
    await this.checkBotConfiguration();
    
    // 9. Multi-Node Setup (if applicable)
    await this.checkMultiNodeSetup();
    
    // Print summary
    this.printSummary();
  }
  
  private async checkRPCConnectivity() {
    console.log('\n📡 RPC Connectivity');
    console.log('-'.repeat(60));
    
    try {
      const jejuBlock = await this.jejuProvider.getBlockNumber();
      this.pass('Jeju RPC', `Connected (block ${jejuBlock})`);
    } catch (error: any) {
      this.fail('Jeju RPC', `Failed to connect: ${error.message}`);
    }
    
    try {
      const baseBlock = await this.baseProvider.getBlockNumber();
      this.pass('Base RPC', `Connected (block ${baseBlock})`);
    } catch (error: any) {
      this.fail('Base RPC', `Failed to connect: ${error.message}`);
    }
  }
  
  private async checkContractDeployments() {
    console.log('\n📦 Contract Deployments');
    console.log('-'.repeat(60));
    
    const contracts = {
      'Oracle': CONFIG.ORACLE_ADDRESS,
      'Paymaster': CONFIG.PAYMASTER_ADDRESS,
      'Vault': CONFIG.VAULT_ADDRESS,
      'Distributor': CONFIG.DISTRIBUTOR_ADDRESS,
    };
    
    for (const [name, address] of Object.entries(contracts)) {
      if (!address) {
        this.fail(name, 'Address not configured');
        continue;
      }
      
      try {
        const code = await this.jejuProvider.getCode(address);
        if (code === '0x') {
          this.fail(name, `No code at ${address}`);
        } else {
          this.pass(name, `Deployed at ${address}`);
        }
      } catch (error: any) {
        this.fail(name, `Error checking: ${error.message}`);
      }
    }
  }
  
  private async checkContractIntegration() {
    console.log('\n🔗 Contract Integration');
    console.log('-'.repeat(60));
    
    try {
      const paymaster = new ethers.Contract(CONFIG.PAYMASTER_ADDRESS, PAYMASTER_ABI, this.jejuProvider);
      
      // Check paymaster → oracle
      const oracleFromPaymaster = await paymaster.priceOracle();
      if (oracleFromPaymaster.toLowerCase() === CONFIG.ORACLE_ADDRESS.toLowerCase()) {
        this.pass('Paymaster → Oracle', `Correctly configured`);
      } else {
        this.fail('Paymaster → Oracle', `Mismatch: ${oracleFromPaymaster} != ${CONFIG.ORACLE_ADDRESS}`);
      }
      
      // Check paymaster → vault
      const vaultFromPaymaster = await paymaster.liquidityVault();
      if (vaultFromPaymaster.toLowerCase() === CONFIG.VAULT_ADDRESS.toLowerCase()) {
        this.pass('Paymaster → Vault', `Correctly configured`);
      } else {
        this.fail('Paymaster → Vault', `Mismatch: ${vaultFromPaymaster} != ${CONFIG.VAULT_ADDRESS}`);
      }
      
      // Check paymaster → distributor
      const distributorFromPaymaster = await paymaster.feeDistributor();
      if (distributorFromPaymaster.toLowerCase() === CONFIG.DISTRIBUTOR_ADDRESS.toLowerCase()) {
        this.pass('Paymaster → Distributor', `Correctly configured`);
      } else {
        this.fail('Paymaster → Distributor', `Mismatch`);
      }
      
      // Check vault → paymaster
      const vault = new ethers.Contract(CONFIG.VAULT_ADDRESS, VAULT_ABI, this.jejuProvider);
      const paymasterFromVault = await vault.paymaster();
      if (paymasterFromVault.toLowerCase() === CONFIG.PAYMASTER_ADDRESS.toLowerCase()) {
        this.pass('Vault → Paymaster', `Correctly configured`);
      } else {
        this.fail('Vault → Paymaster', `Mismatch`);
      }
      
      // Check vault → distributor
      const distributorFromVault = await vault.feeDistributor();
      if (distributorFromVault.toLowerCase() === CONFIG.DISTRIBUTOR_ADDRESS.toLowerCase()) {
        this.pass('Vault → Distributor', `Correctly configured`);
      } else {
        this.fail('Vault → Distributor', `Mismatch`);
      }
      
      // Check distributor → paymaster
      const distributor = new ethers.Contract(CONFIG.DISTRIBUTOR_ADDRESS, DISTRIBUTOR_ABI, this.jejuProvider);
      const paymasterFromDistributor = await distributor.paymaster();
      if (paymasterFromDistributor.toLowerCase() === CONFIG.PAYMASTER_ADDRESS.toLowerCase()) {
        this.pass('Distributor → Paymaster', `Correctly configured`);
      } else {
        this.fail('Distributor → Paymaster', `Mismatch`);
      }
      
      // Check distributor → vault
      const vaultFromDistributor = await distributor.liquidityVault();
      if (vaultFromDistributor.toLowerCase() === CONFIG.VAULT_ADDRESS.toLowerCase()) {
        this.pass('Distributor → Vault', `Correctly configured`);
      } else {
        this.fail('Distributor → Vault', `Mismatch`);
      }
      
    } catch (error: any) {
      this.fail('Integration Check', `Error: ${error.message}`);
    }
  }
  
  private async checkOracleConfiguration() {
    console.log('\n⚙️  Oracle Configuration');
    console.log('-'.repeat(60));
    
    try {
      const oracle = new ethers.Contract(CONFIG.ORACLE_ADDRESS, ORACLE_ABI, this.jejuProvider);
      
      // Check price freshness
      const isFresh = await oracle.isPriceFresh();
      if (isFresh) {
        this.pass('Price Freshness', 'Prices are fresh (<1 hour old)');
      } else {
        this.warn('Price Freshness', 'Prices are stale (>1 hour old) - update needed');
      }
      
      // Check prices
      const [ethPrice, elizaPrice, lastUpdate] = await oracle.getPrices();
      const ethPriceUsd = Number(ethPrice) / 1e8;
      const elizaPriceUsd = Number(elizaPrice) / 1e8;
      const lastUpdateDate = new Date(Number(lastUpdate) * 1000);
      
      this.pass('ETH Price', `$${ethPriceUsd.toFixed(2)}`, { ethPrice: ethPriceUsd });
      this.pass('elizaOS Price', `$${elizaPriceUsd.toFixed(6)}`, { elizaPrice: elizaPriceUsd });
      this.pass('Last Update', lastUpdateDate.toISOString(), { lastUpdate: lastUpdateDate });
      
      // Check updater is configured
      const updater = await oracle.priceUpdater();
      if (updater === ethers.ZeroAddress) {
        this.fail('Price Updater', 'Not configured! Run setPriceUpdater()');
      } else if (CONFIG.BOT_ADDRESS && updater.toLowerCase() === CONFIG.BOT_ADDRESS.toLowerCase()) {
        this.pass('Price Updater', `Correctly set to bot: ${updater}`);
      } else {
        this.pass('Price Updater', `Set to: ${updater}`);
      }
      
    } catch (error: any) {
      this.fail('Oracle Configuration', `Error: ${error.message}`);
    }
  }
  
  private async checkPaymasterConfiguration() {
    console.log('\n⚙️  Paymaster Configuration');
    console.log('-'.repeat(60));
    
    try {
      const paymaster = new ethers.Contract(CONFIG.PAYMASTER_ADDRESS, PAYMASTER_ABI, this.jejuProvider);
      
      // Check if paused
      const isPaused = await paymaster.paused();
      if (isPaused) {
        this.warn('Paymaster Status', 'PAUSED - unpause to accept transactions');
      } else {
        this.pass('Paymaster Status', 'Active');
      }
      
      // Check operational status
      const isOperational = await paymaster.isOperational();
      if (isOperational) {
        this.pass('Operational Check', 'All systems operational');
      } else {
        this.fail('Operational Check', 'Not operational - check EntryPoint balance, oracle freshness, vault liquidity');
      }
      
    } catch (error: any) {
      this.fail('Paymaster Configuration', `Error: ${error.message}`);
    }
  }
  
  private async checkVaultConfiguration() {
    console.log('\n⚙️  Vault Configuration');
    console.log('-'.repeat(60));
    
    try {
      const vault = new ethers.Contract(CONFIG.VAULT_ADDRESS, VAULT_ABI, this.jejuProvider);
      
      // Check if paused
      const isPaused = await vault.paused();
      if (isPaused) {
        this.warn('Vault Status', 'PAUSED');
      } else {
        this.pass('Vault Status', 'Active');
      }
      
      // Check available ETH
      const availableETH = await vault.availableETH();
      const ethAmount = Number(ethers.formatEther(availableETH));
      
      if (ethAmount >= 1) {
        this.pass('Available ETH', `${ethAmount.toFixed(4)} ETH (healthy)`);
      } else if (ethAmount > 0) {
        this.warn('Available ETH', `${ethAmount.toFixed(4)} ETH (low liquidity)`);
      } else {
        this.fail('Available ETH', 'No liquidity available! Add ETH to vault');
      }
      
    } catch (error: any) {
      this.fail('Vault Configuration', `Error: ${error.message}`);
    }
  }
  
  private async checkOperationalStatus() {
    console.log('\n✅ Operational Status');
    console.log('-'.repeat(60));
    
    // Summary check
    const hasFailures = this.results.some(r => r.status === 'fail');
    const hasWarnings = this.results.some(r => r.status === 'warn');
    
    if (!hasFailures && !hasWarnings) {
      this.pass('System Status', '🎉 All systems operational!');
    } else if (!hasFailures) {
      this.warn('System Status', '⚠️  System operational with warnings');
    } else {
      this.fail('System Status', '❌ System has failures - fix before launching');
    }
  }
  
  private async checkBotConfiguration() {
    console.log('\n🤖 Bot Configuration');
    console.log('-'.repeat(60));
    
    if (!CONFIG.BOT_ADDRESS) {
      this.warn('Bot Wallet', 'BOT_ADDRESS not set - skipping bot checks');
      return;
    }
    
    try {
      // Check bot balance
      const balance = await this.jejuProvider.getBalance(CONFIG.BOT_ADDRESS);
      const ethBalance = Number(ethers.formatEther(balance));
      
      if (ethBalance >= 0.05) {
        this.pass('Bot Balance', `${ethBalance.toFixed(4)} ETH (healthy)`);
      } else if (ethBalance > 0.01) {
        this.warn('Bot Balance', `${ethBalance.toFixed(4)} ETH (running low)`);
      } else {
        this.fail('Bot Balance', `${ethBalance.toFixed(4)} ETH (insufficient! Add more ETH)`);
      }
      
    } catch (error: any) {
      this.fail('Bot Configuration', `Error: ${error.message}`);
    }
  }
  
  private async checkMultiNodeSetup() {
    console.log('\n🌐 Multi-Node Setup');
    console.log('-'.repeat(60));
    
    const leaderElectionEnabled = process.env.LEADER_ELECTION_ENABLED === 'true';
    const multipleRPCs = (process.env.BASE_RPC_URLS || '').split(',').length > 1;
    
    if (leaderElectionEnabled) {
      this.pass('Leader Election', 'Enabled - supports multiple bots');
    } else {
      this.warn('Leader Election', 'Disabled - single bot mode');
    }
    
    if (multipleRPCs) {
      const baseRPCs = (process.env.BASE_RPC_URLS || '').split(',').length;
      const jejuRPCs = (process.env.JEJU_RPC_URLS || '').split(',').length;
      this.pass('RPC Failover', `${baseRPCs} Base RPCs, ${jejuRPCs} Jeju RPCs`);
    } else {
      this.warn('RPC Failover', 'Single RPC endpoint - no failover');
    }
  }
  
  private pass(name: string, message: string, details?: any) {
    this.results.push({ name, status: 'pass', message, details });
    console.log(`✅ ${name}: ${message}`);
  }
  
  private fail(name: string, message: string, details?: any) {
    this.results.push({ name, status: 'fail', message, details });
    console.log(`❌ ${name}: ${message}`);
  }
  
  private warn(name: string, message: string, details?: any) {
    this.results.push({ name, status: 'warn', message, details });
    console.log(`⚠️  ${name}: ${message}`);
  }
  
  private printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warnings = this.results.filter(r => r.status === 'warn').length;
    
    console.log(`✅ Passed:   ${passed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`❌ Failed:   ${failed}`);
    console.log();
    
    if (failed === 0 && warnings === 0) {
      console.log('🎉 All checks passed! System is ready for production.');
      console.log();
      console.log('Next steps:');
      console.log('  1. Start oracle bot: bun run oracle:start');
      console.log('  2. Monitor health: curl http://localhost:3000/health');
      console.log('  3. Check logs for updates');
    } else if (failed === 0) {
      console.log('⚠️  System operational but has warnings. Review above.');
    } else {
      console.log('❌ System has failures. Fix issues before deploying to production.');
      console.log();
      console.log('Failed checks:');
      this.results.filter(r => r.status === 'fail').forEach(r => {
        console.log(`  - ${r.name}: ${r.message}`);
      });
    }
    
    console.log();
  }
}

async function main() {
  const verifier = new IntegrationVerifier();
  await verifier.runAllChecks();
}

if (import.meta.main) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { IntegrationVerifier };

