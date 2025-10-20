#!/usr/bin/env bun
/**
 * @title Deploy Oracle Setup Script
 * @notice One-command deployment and configuration of oracle system
 */

import { execSync } from 'child_process';

const NETWORKS = {
  testnet: {
    jejuRpc: 'https://testnet-rpc.jeju.network',
    baseRpc: 'https://sepolia.base.org',
    chainId: 420690,
  },
  mainnet: {
    jejuRpc: 'https://rpc.jeju.network',
    baseRpc: 'https://mainnet.base.org',
    chainId: 420691,
  },
} as const;

async function deployOracle() {
  console.log('🚀 Deploying Oracle System\n');
  
  // 1. Get network
  const network = process.env.NETWORK || 'testnet';
  if (!['testnet', 'mainnet'].includes(network)) {
    throw new Error('Invalid network. Use: testnet or mainnet');
  }
  
  console.log(`📡 Network: ${network}`);
  console.log(`   Jeju RPC: ${NETWORKS[network as keyof typeof NETWORKS].jejuRpc}`);
  console.log(`   Base RPC: ${NETWORKS[network as keyof typeof NETWORKS].baseRpc}\n`);
  
  // 2. Deploy contracts
  console.log('📝 Deploying contracts via Foundry...\n');
  
  try {
    execSync(
      `cd contracts && forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem --rpc-url ${NETWORKS[network as keyof typeof NETWORKS].jejuRpc} --broadcast --verify`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('❌ Contract deployment failed');
    throw error;
  }
  
  // 3. Read deployment addresses
  console.log('\n📋 Reading deployment addresses...');
  
  const deploymentPath = `contracts/deployments/${network}/.latest.json`;
  const deployment = await Bun.file(deploymentPath).json();
  
  console.log(`   Oracle: ${deployment.priceOracle}`);
  console.log(`   Paymaster: ${deployment.liquidityPaymaster}`);
  console.log(`   Vault: ${deployment.liquidityVault}`);
  console.log(`   Distributor: ${deployment.feeDistributor}\n`);
  
  // 4. Create .env.oracle
  console.log('⚙️  Creating .env.oracle configuration...\n');
  
  const envContent = `# Auto-generated oracle configuration
# ${new Date().toISOString()}

BASE_RPC_URL=${NETWORKS[network as keyof typeof NETWORKS].baseRpc}
JEJU_RPC_URL=${NETWORKS[network as keyof typeof NETWORKS].jejuRpc}

ORACLE_ADDRESS=${deployment.priceOracle}
ELIZAOS_TOKEN_BASE=${process.env.ELIZAOS_TOKEN_BASE || ''}

# Add your price updater private key here (required)
PRICE_UPDATER_PRIVATE_KEY=

UPDATE_INTERVAL_MS=300000
MAX_PRICE_DEVIATION_PCT=10
MIN_UPDATE_INTERVAL_S=60
`;
  
  await Bun.write('.env.oracle', envContent);
  console.log('✅ Created .env.oracle - Please fill in PRICE_UPDATER_PRIVATE_KEY\n');
  
  // 5. Setup instructions
  console.log('📚 Next Steps:\n');
  console.log('   1. Create a dedicated wallet for price updates:');
  console.log('      npx ethers-cli wallet create --save price-updater.json\n');
  
  console.log('   2. Fund the wallet with ~0.1 ETH on Jeju:');
  console.log('      Bridge to: [wallet address]\n');
  
  console.log('   3. Set the updater address in the oracle:');
  console.log(`      cast send ${deployment.priceOracle} "setPriceUpdater(address)" [wallet address] --rpc-url ${NETWORKS[network as keyof typeof NETWORKS].jejuRpc}\n`);
  
  console.log('   4. Add private key to .env.oracle\n');
  
  console.log('   5. Test the oracle updater:');
  console.log('      bun run oracle:start\n');
  
  console.log('   6. Deploy to production:');
  console.log('      bun run oracle:docker:build');
  console.log('      bun run oracle:docker:run\n');
  
  console.log('✅ Oracle system deployed successfully!\n');
}

deployOracle().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

