#!/usr/bin/env bun
/**
 * Deploy USDC to Jeju Localnet
 * 
 * Deploys MockJejuUSDC (simple USDC mock) to local Jeju chain
 * Automatically provides faucet for local development
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface DeploymentAddresses {
  usdc: string;
  paymaster?: string;
  deployer: string;
  treasury: string;
}

async function deployUSDCLocalnet(): Promise<DeploymentAddresses> {
  console.log('🚀 Deploying USDC to Jeju Localnet');
  console.log('='.repeat(60));

  // Localnet configuration
  const rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:8545';
  const chainId = process.env.CHAIN_ID || '1337';
  
  // Use default test private key (from Anvil/Hardhat)
  const deployerKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  
  // Get deployer address
  const deployerAddress = execSync(
    `cast wallet address ${deployerKey}`,
    { encoding: 'utf-8' }
  ).trim();

  console.log('Network: Jeju Localnet');
  console.log('RPC URL:', rpcUrl);
  console.log('Chain ID:', chainId);
  console.log('Deployer:', deployerAddress);
  console.log('');

  // Check if RPC is accessible
  try {
    const blockNumber = execSync(
      `cast block-number --rpc-url ${rpcUrl}`,
      { encoding: 'utf-8' }
    ).trim();
    console.log('✅ RPC accessible, current block:', blockNumber);
  } catch (error) {
    console.error('❌ Cannot connect to Jeju localnet RPC');
    console.error('   Start localnet first: bun run scripts/localnet/start.ts');
    process.exit(1);
  }

  console.log('');
  console.log('📝 Step 1: Deploying MockJejuUSDC...');
  
  // Deploy MockJejuUSDC with:
  // - Initial owner = deployer
  // - Initial supply = 100M USDC (minted on deployment)
  
  const usdcDeploy = execSync(
    `cd contracts && forge create src/tokens/MockJejuUSDC.sol:MockJejuUSDC \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --constructor-args ${deployerAddress} \
      --json`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  const usdcResult = JSON.parse(usdcDeploy);
  const usdcAddress = usdcResult.deployedTo;

  console.log('✅ USDC deployed at:', usdcAddress);
  console.log('   Initial supply: 100,000,000 USDC minted to deployer');
  console.log('   Faucet: Available (100,000 USDC per call)');
  console.log('');

  // Test faucet
  console.log('💧 Step 2: Testing faucet...');
  try {
    execSync(
      `cd contracts && cast send ${usdcAddress} "faucet()" \
        --rpc-url ${rpcUrl} \
        --private-key ${deployerKey}`,
      { stdio: 'inherit' }
    );

    const balance = execSync(
      `cd contracts && cast call ${usdcAddress} "balanceOf(address)(uint256)" ${deployerAddress} \
        --rpc-url ${rpcUrl}`,
      { encoding: 'utf-8' }
    ).trim();

    const balanceNum = parseInt(balance, 16) / 1e6;
    console.log(`✅ Faucet claimed successfully! Balance: ${balanceNum} USDC`);
  } catch (error) {
    console.log('⚠️  Faucet test failed (non-critical)');
  }
  console.log('');

  // Save deployment
  const deployment: DeploymentAddresses = {
    usdc: usdcAddress,
    deployer: deployerAddress,
    treasury: deployerAddress
  };

  const deploymentPath = join(process.cwd(), 'contracts', 'deployments', 'jeju-localnet-usdc.json');
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log('💾 Deployment saved to:', deploymentPath);
  console.log('');

  // Print environment variables
  console.log('='.repeat(60));
  console.log('✅ DEPLOYMENT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('Add to your .env:');
  console.log('');
  console.log(`JEJU_LOCALNET_USDC_ADDRESS="${usdcAddress}"`);
  console.log(`JEJU_USDC_ADDRESS="${usdcAddress}"`);
  console.log('');
  console.log('🎯 Next Steps:');
  console.log('');
  console.log('1. Add Jeju localnet to MCP Gateway:');
  console.log('   # mcp-gateway/examples/jeju-localnet-config.yaml');
  console.log('');
  console.log('2. Get testnet USDC via faucet:');
  console.log(`   cast send ${usdcAddress} "faucet()" --rpc-url ${rpcUrl} --private-key $YOUR_KEY`);
  console.log('');
  console.log('3. Bridge USDC from L1 to L2 for testing:');
  console.log('   bun run scripts/bridge-multi-tokens.ts');
  console.log('');

  return deployment;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  deployUSDCLocalnet().catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

export { deployUSDCLocalnet };

