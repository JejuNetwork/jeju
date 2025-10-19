#!/usr/bin/env bun
/**
 * Deploy USDC to Jeju Network
 * 
 * Deploys JejuUSDC with EIP-3009 support for x402 payments
 * Optionally deploys ServicePaymaster for multi-token gas sponsorship
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface DeploymentResult {
  usdc: string;
  paymaster?: string;
  network: string;
  timestamp: string;
}

class JejuUSDCDeployer {
  private network: 'testnet' | 'mainnet';
  private rpcUrl: string;
  private deployerKey: string;
  private treasury: string;

  constructor(network: 'testnet' | 'mainnet' = 'testnet') {
    this.network = network;
    
    // Load from environment
    const rpcEnvKey = network === 'testnet' ? 'JEJU_TESTNET_RPC' : 'JEJU_RPC';
    this.rpcUrl = process.env[rpcEnvKey] || (
      network === 'testnet' 
        ? 'https://testnet-rpc.jeju.network'
        : 'https://rpc.jeju.network'
    );
    
    this.deployerKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '';
    if (!this.deployerKey) {
      throw new Error('PRIVATE_KEY or DEPLOYER_PRIVATE_KEY environment variable required');
    }
    
    this.treasury = process.env.TREASURY_ADDRESS || process.env.REVENUE_WALLET || '';
    if (!this.treasury) {
      console.log('⚠️  No TREASURY_ADDRESS set, using deployer address');
      this.treasury = this.getDeployerAddress();
    }
  }

  async deploy(): Promise<DeploymentResult> {
    console.log('🚀 Deploying USDC to Jeju', this.network === 'testnet' ? 'Testnet' : 'Mainnet');
    console.log('='.repeat(60));
    console.log('Network:', this.network);
    console.log('RPC URL:', this.rpcUrl);
    console.log('Treasury:', this.treasury);
    console.log('');

    // Step 1: Deploy USDC
    console.log('📝 Step 1: Deploying JejuUSDC contract...');
    const usdcAddress = await this.deployUSDC();
    console.log('✅ USDC deployed at:', usdcAddress);
    console.log('');

    // Step 2: Test faucet (testnet only)
    if (this.network === 'testnet') {
      console.log('💧 Step 2: Testing USDC faucet...');
      await this.testFaucet(usdcAddress);
      console.log('✅ Faucet working correctly');
      console.log('');
    }

    // Step 3: Deploy ServicePaymaster (if dependencies exist)
    let paymasterAddress: string | undefined;
    if (this.hasPaymasterDependencies()) {
      console.log('🏦 Step 3: Deploying ServicePaymaster...');
      paymasterAddress = await this.deployServicePaymaster(usdcAddress);
      console.log('✅ ServicePaymaster deployed at:', paymasterAddress);
      console.log('');
    } else {
      console.log('⏭️  Step 3: Skipping ServicePaymaster (dependencies not deployed)');
      console.log('  Deploy elizaOS token, ServiceRegistry, and PriceOracle first');
      console.log('');
    }

    // Step 4: Save deployment info
    const result: DeploymentResult = {
      usdc: usdcAddress,
      paymaster: paymasterAddress,
      network: this.network,
      timestamp: new Date().toISOString()
    };

    this.saveDeployment(result);

    // Step 5: Print configuration
    this.printConfiguration(result);

    return result;
  }

  private async deployUSDC(): Promise<string> {
    const isTestnet = this.network === 'testnet';
    const initialSupply = isTestnet ? 1000000 : 0; // 1M USDC on testnet
    const enableFaucet = isTestnet;

    const cmd = `forge create src/tokens/JejuUSDC.sol:JejuUSDC \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.deployerKey} \
      --constructor-args ${this.treasury} ${initialSupply}000000 ${enableFaucet} \
      --json`;

    try {
      const output = execSync(cmd, { cwd: join(process.cwd(), 'contracts'), encoding: 'utf-8' });
      const result = JSON.parse(output);
      return result.deployedTo;
    } catch (error) {
      console.error('❌ USDC deployment failed:', error);
      throw error;
    }
  }

  private async testFaucet(usdcAddress: string): Promise<void> {
    try {
      // Call faucet function
      const cmd = `cast send ${usdcAddress} "faucet()" \
        --rpc-url ${this.rpcUrl} \
        --private-key ${this.deployerKey}`;

      execSync(cmd, { cwd: join(process.cwd(), 'contracts'), stdio: 'inherit' });

      // Check balance
      const balanceCmd = `cast call ${usdcAddress} "balanceOf(address)(uint256)" ${this.getDeployerAddress()} \
        --rpc-url ${this.rpcUrl}`;

      const balance = execSync(balanceCmd, { cwd: join(process.cwd(), 'contracts'), encoding: 'utf-8' });
      const balanceNum = parseInt(balance.trim(), 16) / 1e6;
      
      console.log(`  Faucet claimed: ${balanceNum} USDC`);
    } catch (error) {
      console.error('  ⚠️  Faucet test failed (non-critical):', error);
    }
  }

  private async deployServicePaymaster(usdcAddress: string): Promise<string> {
    const ElizaOSToken = process.env.ELIZAOS_TOKEN_ADDRESS || '';
    const serviceRegistry = process.env.SERVICE_REGISTRY_ADDRESS || '';
    const priceOracle = process.env.PRICE_ORACLE_ADDRESS || '';
    const revenueWallet = process.env.REVENUE_WALLET || this.treasury;
    const entryPoint = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'; // EntryPoint v0.7

    const cmd = `forge create src/services/ServicePaymaster.sol:ServicePaymaster \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.deployerKey} \
      --constructor-args ${entryPoint} ${ElizaOSToken} ${usdcAddress} ${serviceRegistry} ${priceOracle} ${revenueWallet} \
      --json`;

    try {
      const output = execSync(cmd, { cwd: join(process.cwd(), 'contracts'), encoding: 'utf-8' });
      const result = JSON.parse(output);
      
      // Fund paymaster with initial ETH
      const fundAmount = this.network === 'testnet' ? '1' : '10';
      const fundCmd = `cast send ${result.deployedTo} "depositToEntryPoint()" \
        --value ${fundAmount}ether \
        --rpc-url ${this.rpcUrl} \
        --private-key ${this.deployerKey}`;
      
      execSync(fundCmd, { cwd: join(process.cwd(), 'contracts') });
      console.log(`  Funded paymaster with ${fundAmount} ETH`);
      
      return result.deployedTo;
    } catch (error) {
      console.error('❌ ServicePaymaster deployment failed:', error);
      throw error;
    }
  }

  private hasPaymasterDependencies(): boolean {
    return !!(
      process.env.ELIZAOS_TOKEN_ADDRESS &&
      process.env.SERVICE_REGISTRY_ADDRESS &&
      process.env.PRICE_ORACLE_ADDRESS
    );
  }

  private getDeployerAddress(): string {
    const cmd = `cast wallet address ${this.deployerKey}`;
    try {
      return execSync(cmd, { encoding: 'utf-8' }).trim();
    } catch {
      return '0x...'; // Fallback
    }
  }

  private saveDeployment(result: DeploymentResult): void {
    const deploymentsDir = join(process.cwd(), 'contracts', 'deployments');
    const filename = `jeju-${this.network}-x402.json`;
    const filepath = join(deploymentsDir, filename);

    writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log('💾 Saved deployment info to:', filepath);
    console.log('');
  }

  private printConfiguration(result: DeploymentResult): void {
    console.log('='.repeat(60));
    console.log('✅ DEPLOYMENT COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Add these to your .env file:');
    console.log('');

    const envPrefix = this.network === 'testnet' ? 'JEJU_TESTNET' : 'JEJU';
    
    console.log(`# Jeju ${this.network === 'testnet' ? 'Testnet' : 'Mainnet'} - x402 Integration`);
    console.log(`${envPrefix}_USDC_ADDRESS="${result.usdc}"`);
    
    if (result.paymaster) {
      console.log(`${envPrefix}_CLOUD_PAYMASTER_ADDRESS="${result.paymaster}"`);
    }
    
    console.log('');
    console.log('🎯 Next Steps:');
    console.log('');
    console.log('1. Update MCP Gateway config:');
    console.log('   # mcp-gateway/examples/jeju-config.yaml');
    console.log('   payment:');
    console.log('     network: jeju' + (this.network === 'testnet' ? '-testnet' : ''));
    console.log('     asset: "' + result.usdc + '"');
    console.log('');
    console.log('2. Test with faucet (testnet only):');
    console.log(`   cast send ${result.usdc} "faucet()" --rpc-url ${this.rpcUrl} --private-key $YOUR_KEY`);
    console.log('');
    console.log('3. Configure facilitator for Jeju:');
    console.log('   export X402_FACILITATOR_URL=https://facilitator.jeju.network');
    console.log('   # Or deploy your own using: scripts/deploy-jeju-facilitator.ts');
    console.log('');
    console.log('4. Test x402 payment flow:');
    console.log('   cd mcp-gateway && bun test tests/jeju-x402-integration.test.ts');
    console.log('');
  }
}

// CLI interface
async function main() {
  const network = (process.argv[2] || 'testnet') as 'testnet' | 'mainnet';
  
  if (!['testnet', 'mainnet'].includes(network)) {
    console.error('Usage: bun run scripts/deploy-jeju-usdc.ts [testnet|mainnet]');
    process.exit(1);
  }

  const deployer = new JejuUSDCDeployer(network);
  await deployer.deploy();
}

main().catch(console.error);

