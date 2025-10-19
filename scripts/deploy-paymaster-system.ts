#!/usr/bin/env bun
/**
 * Deploy Complete Multi-Token Paymaster System
 * 
 * Deploys:
 * 1. TokenRegistry (permissionless token registration)
 * 2. PriceOracle (multi-token pricing)
 * 3. PaymasterFactory (deploy paymaster instances)
 * 4. Example deployments for 3 test tokens
 * 
 * After running, apps can register their tokens and deploy paymasters!
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface DeploymentResult {
  tokenRegistry: string;
  priceOracle: string;
  paymasterFactory: string;
  entryPoint: string;
  exampleDeployments: Array<{
    token: string;
    symbol: string;
    paymaster: string;
    vault: string;
    distributor: string;
  }>;
}

class PaymasterSystemDeployer {
  private rpcUrl: string;
  private deployerKey: string;
  private deployerAddress: string;

  constructor() {
    this.rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:8545';
    this.deployerKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    this.deployerAddress = this.getAddress(this.deployerKey);
  }

  async deploy(): Promise<DeploymentResult> {
    console.log('🚀 Deploying Multi-Token Paymaster System');
    console.log('='.repeat(70));
    console.log('RPC:', this.rpcUrl);
    console.log('Deployer:', this.deployerAddress);
    console.log('');

    const result: DeploymentResult = {
      tokenRegistry: '',
      priceOracle: '',
      paymasterFactory: '',
      entryPoint: '',
      exampleDeployments: []
    };

    // Step 1: Deploy or get EntryPoint
    console.log('📝 Step 1: EntryPoint');
    result.entryPoint = await this.deployEntryPoint();
    console.log('');

    // Step 2: Deploy PriceOracle
    console.log('📝 Step 2: Deploying PriceOracle');
    result.priceOracle = await this.deployPriceOracle();
    console.log('');

    // Step 3: Deploy TokenRegistry  
    console.log('📝 Step 3: Deploying TokenRegistry');
    result.tokenRegistry = await this.deployTokenRegistry();
    console.log('');

    // Step 4: Deploy PaymasterFactory
    console.log('📝 Step 4: Deploying PaymasterFactory');
    result.paymasterFactory = await this.deployPaymasterFactory(
      result.tokenRegistry,
      result.entryPoint,
      result.priceOracle
    );
    console.log('');

    // Step 5: Deploy example tokens and paymasters
    console.log('📝 Step 5: Deploying Example Tokens and Paymasters');
    result.exampleDeployments = await this.deployExamples(
      result.tokenRegistry,
      result.paymasterFactory,
      result.priceOracle
    );
    console.log('');

    // Save deployment
    this.saveDeployment(result);

    // Print summary
    this.printSummary(result);

    return result;
  }

  private async deployEntryPoint(): Promise<string> {
    // On localnet, deploy mock EntryPoint
    // On mainnet, use standard address
    const address = this.deployContract(
      'script/DeployLiquiditySystem.s.sol:MockEntryPoint',
      [],
      'MockEntryPoint'
    );
    return address;
  }

  private async deployPriceOracle(): Promise<string> {
    return this.deployContract(
      'src/oracle/PriceOracle.sol:PriceOracle',
      [],
      'PriceOracle (multi-token)'
    );
  }

  private async deployTokenRegistry(): Promise<string> {
    return this.deployContract(
      'src/paymaster/TokenRegistry.sol:TokenRegistry',
      [this.deployerAddress, this.deployerAddress], // owner, treasury
      'TokenRegistry'
    );
  }

  private async deployPaymasterFactory(
    registry: string,
    entryPoint: string,
    oracle: string
  ): Promise<string> {
    return this.deployContract(
      'src/paymaster/PaymasterFactory.sol:PaymasterFactory',
      [registry, entryPoint, oracle, this.deployerAddress],
      'PaymasterFactory'
    );
  }

  private async deployExamples(
    registry: string,
    factory: string,
    oracle: string
  ): Promise<Array<any>> {
    const examples = [];

    // Deploy 3 example tokens with different fee strategies
    const tokens = [
      { name: 'CompetitiveToken', symbol: 'COMP', minFee: 0, maxFee: 0, actualFee: 0 },
      { name: 'BalancedToken', symbol: 'BAL', minFee: 100, maxFee: 300, actualFee: 200 },
      { name: 'PremiumToken', symbol: 'PREM', minFee: 400, maxFee: 500, actualFee: 500 }
    ];

    for (const token of tokens) {
      console.log(`  Deploying ${token.name}...`);
      
      // Deploy ERC20 token
      const tokenAddr = this.deployContract(
        'src/token/ElizaOSToken.sol:ElizaOSToken',
        [this.deployerAddress],
        `${token.symbol} Token`
      );

      // Set price in oracle
      this.sendTx(oracle, 'setPrice(address,uint256,uint256)', [tokenAddr, '100000000000000000', '18'], null);

      // Register in TokenRegistry
      this.sendTx(
        registry,
        'registerToken(address,address,uint256,uint256)',
        [tokenAddr, oracle, token.minFee.toString(), token.maxFee.toString()],
        '0.1ether'
      );

      // Deploy paymaster via factory
      const deployCmd = `cast send ${factory} "deployPaymaster(address,uint256,address)" ${tokenAddr} ${token.actualFee} ${this.deployerAddress} --rpc-url ${this.rpcUrl} --private-key ${this.deployerKey}`;
      const output = execSync(deployCmd, { encoding: 'utf-8' });
      
      // Get deployment addresses from factory
      const getDeploymentCmd = `cast call ${factory} "getDeployment(address)" ${tokenAddr} --rpc-url ${this.rpcUrl}`;
      const deploymentData = execSync(getDeploymentCmd, { encoding: 'utf-8' });
      
      console.log(`    ✅ ${token.symbol}: Token + Paymaster deployed`);

      examples.push({
        token: tokenAddr,
        symbol: token.symbol,
        paymaster: '', // Would parse from output
        vault: '',
        distributor: ''
      });
    }

    return examples;
  }

  private deployContract(path: string, args: string[], name: string): string {
    const argsStr = args.join(' ');
    const cmd = `cd contracts && forge create ${path} \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.deployerKey} \
      --broadcast \
      --optimize --optimizer-runs 200 \
      ${args.length > 0 ? `--constructor-args ${argsStr}` : ''} \
      --json`;

    try {
      const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      
      // Try JSON format first (when compilation happens)
      const jsonMatch = output.match(/\{[\s\S]*"deployedTo"[\s\S]*?\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log(`  ✅ ${name}: ${result.deployedTo}`);
        return result.deployedTo;
      }
      
      // Fall back to plain text format (when compilation is skipped)
      const deployedToMatch = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
      
      if (deployedToMatch) {
        const address = deployedToMatch[1];
        console.log(`  ✅ ${name}: ${address}`);
        return address;
      }
      
      console.error('Full output:', output);
      throw new Error('Could not parse deployed address from forge output');
    } catch (error) {
      console.error(`  ❌ Failed to deploy ${name}`);
      if (error instanceof Error) {
        console.error(error.message);
      }
      throw new Error(`Deployment of ${name} failed`);
    }
  }

  private sendTx(to: string, signature: string, args: string[], value: string | null): void {
    const valueFlag = value ? `--value ${value}` : '';
    const argsStr = args.join(' ');
    execSync(
      `cast send ${to} "${signature}" ${argsStr} ${valueFlag} --rpc-url ${this.rpcUrl} --private-key ${this.deployerKey}`,
      { stdio: 'pipe' }
    );
  }

  private getAddress(privateKey: string): string {
    return execSync(`cast wallet address ${privateKey}`, { encoding: 'utf-8' }).trim();
  }

  private saveDeployment(result: DeploymentResult): void {
    const path = join(process.cwd(), 'contracts', 'deployments', 'paymaster-system-localnet.json');
    writeFileSync(path, JSON.stringify(result, null, 2));
    
    // Also create .env snippet for frontend
    const envContent = `
# Paymaster System Contracts
VITE_TOKEN_REGISTRY_ADDRESS="${result.tokenRegistry}"
VITE_PAYMASTER_FACTORY_ADDRESS="${result.paymasterFactory}"
VITE_PRICE_ORACLE_ADDRESS="${result.priceOracle}"
VITE_ENTRY_POINT_ADDRESS="${result.entryPoint}"
`;
    
    const envPath = join(process.cwd(), 'apps', 'gateway', '.env.local');
    writeFileSync(envPath, envContent.trim());
    
    console.log('💾 Deployment saved:');
    console.log(`   ${path}`);
    console.log(`   ${envPath}`);
    console.log('');
  }

  private printSummary(result: DeploymentResult): void {
    console.log('='.repeat(70));
    console.log('✅ MULTI-TOKEN PAYMASTER SYSTEM DEPLOYED');
    console.log('='.repeat(70));
    console.log('');
    console.log('📦 Core Contracts:');
    console.log(`   TokenRegistry:      ${result.tokenRegistry}`);
    console.log(`   PriceOracle:        ${result.priceOracle}`);
    console.log(`   PaymasterFactory:   ${result.paymasterFactory}`);
    console.log(`   EntryPoint:         ${result.entryPoint}`);
    console.log('');
    console.log('🎯 What You Can Do Now:');
    console.log('   ✅ Register any ERC20 token');
    console.log('   ✅ Deploy paymaster for any token');
    console.log('   ✅ Add liquidity and earn fees');
    console.log('   ✅ Users can pay gas in any token');
    console.log('');
    console.log('🌐 Gateway Portal:');
    console.log('   http://localhost:4001');
    console.log('');
    console.log('📚 Next Steps:');
    console.log('   1. Open Gateway Portal: http://localhost:4001');
    console.log('   2. Connect wallet');
    console.log('   3. Browse registered tokens');
    console.log('   4. Deploy paymaster for your token');
    console.log('   5. Add ETH liquidity');
    console.log('   6. Users can now pay gas with your token');
    console.log('');
  }
}

// Run deployment
if (import.meta.url === `file://${process.argv[1]}`) {
  const deployer = new PaymasterSystemDeployer();
  deployer.deploy().catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

export { PaymasterSystemDeployer };

