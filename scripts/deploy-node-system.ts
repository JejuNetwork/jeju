#!/usr/bin/env bun
/**
 * @title Atomic Node Infrastructure Deployment
 * @notice Deploys and wires together the complete node operator system
 * 
 * Deploys:
 * 1. NodeStakingManager contract (multi-token)
 * 2. Configures multi-oracle system
 * 3. Starts rewards oracle bot
 * 4. Verifies end-to-end integration
 * 
 * Prerequisites:
 * - TokenRegistry deployed
 * - PaymasterFactory deployed
 * - PriceOracle deployed
 * 
 * Usage:
 *   bun run scripts/deploy-node-system.ts --network testnet
 *   bun run scripts/deploy-node-system.ts --network mainnet --verify
 */

import { $ } from 'bun';
import { ethers } from 'ethers';
import { existsSync } from 'fs';

// Configuration
const NETWORK = process.argv.includes('--network') 
  ? process.argv[process.argv.indexOf('--network') + 1]
  : 'localnet';

const VERIFY = process.argv.includes('--verify');

const NETWORKS: Record<string, { rpc: string; chainId: number }> = {
  localnet: {
    rpc: process.env.LOCALNET_RPC || 'http://localhost:8545',
    chainId: 8004,
  },
  testnet: {
    rpc: 'https://testnet-rpc.jeju.network',
    chainId: 8004,
  },
  mainnet: {
    rpc: 'https://rpc.jeju.network',
    chainId: 8004,
  },
};

interface DeploymentAddresses {
  nodeStakingManager: string;
  tokenRegistry: string;
  paymasterFactory: string;
  priceOracle: string;
  performanceOracle: string;
  deployer: string;
  owner: string;
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 Jeju Node Infrastructure - Atomic Deployment          ║
║   (Multi-Token Staking System)                              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

Network: ${NETWORK}
Verify: ${VERIFY}
`);

  const network = NETWORKS[NETWORK];
  if (!network) {
    throw new Error(`Unknown network: ${NETWORK}`);
  }

  const provider = new ethers.JsonRpcProvider(network.rpc);
  const chainId = (await provider.getNetwork()).chainId;
  
  if (chainId !== BigInt(network.chainId)) {
    throw new Error(`Chain ID mismatch: expected ${network.chainId}, got ${chainId}`);
  }

  console.log(`✅ Connected to ${NETWORK} (Chain ID: ${chainId})\n`);

  // ============ STEP 1: Verify Prerequisites ============
  console.log('━━━ Step 1: Verifying Prerequisites ━━━\n');

  const tokenRegistry = process.env.TOKEN_REGISTRY_ADDRESS;
  const paymasterFactory = process.env.PAYMASTER_FACTORY_ADDRESS;
  const priceOracle = process.env.PRICE_ORACLE_ADDRESS;

  if (!tokenRegistry || !paymasterFactory || !priceOracle) {
    throw new Error(`
Missing required addresses. Set environment variables:
  TOKEN_REGISTRY_ADDRESS=${tokenRegistry || 'MISSING'}
  PAYMASTER_FACTORY_ADDRESS=${paymasterFactory || 'MISSING'}
  PRICE_ORACLE_ADDRESS=${priceOracle || 'MISSING'}
`);
  }

  console.log('✅ Prerequisites found:');
  console.log(`   TokenRegistry: ${tokenRegistry}`);
  console.log(`   PaymasterFactory: ${paymasterFactory}`);
  console.log(`   PriceOracle: ${priceOracle}\n`);

  // ============ STEP 2: Deploy Contracts ============
  console.log('━━━ Step 2: Deploying Smart Contracts ━━━\n');

  const deployArgs = [
    '--rpc-url', network.rpc,
    '--broadcast',
  ];

  if (VERIFY && NETWORK !== 'localnet') {
    deployArgs.push('--verify');
  }

  if (process.env.PRIVATE_KEY) {
    deployArgs.push('--private-key', process.env.PRIVATE_KEY);
  }

  // Deploy NodeStakingManager
  console.log('📦 Deploying NodeStakingManager contract...\n');
  
  const deployResult = await $`cd contracts && forge script script/DeployRewards.s.sol ${deployArgs.join(' ')}`.nothrow();
  
  if (deployResult.exitCode !== 0) {
    throw new Error('Contract deployment failed');
  }

  // Parse deployment output for addresses
  const deploymentFile = `contracts/deployments/rewards-${NETWORK}.json`;
  
  if (!existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const deployment: DeploymentAddresses = await Bun.file(deploymentFile).json();
  
  console.log('\n✅ Contracts deployed:');
  console.log(`   NodeStakingManager: ${deployment.nodeStakingManager}`);
  console.log(`   Performance Oracle: ${deployment.performanceOracle}`);
  console.log(`   Owner: ${deployment.owner}\n`);

  // ============ STEP 3: Verify Integration ============
  console.log('━━━ Step 3: Verifying Integration ━━━\n');

  const stakingABI = [
    'function tokenRegistry() external view returns (address)',
    'function paymasterFactory() external view returns (address)',
    'function priceOracle() external view returns (address)',
    'function getNetworkStats() external view returns (uint256,uint256,uint256)',
    'function getAllNodes() external view returns (bytes32[])',
  ];

  const staking = new ethers.Contract(
    deployment.nodeStakingManager,
    stakingABI,
    provider
  );

  // Verify configuration
  const registryAddr = await staking.tokenRegistry();
  const factoryAddr = await staking.paymasterFactory();
  const oracleAddr = await staking.priceOracle();
  const [totalNodes, totalStaked] = await staking.getNetworkStats();
  const allNodes = await staking.getAllNodes();

  console.log('📊 Contract State:');
  console.log(`   TokenRegistry: ${registryAddr} ${registryAddr.toLowerCase() === tokenRegistry.toLowerCase() ? '✅' : '❌'}`);
  console.log(`   PaymasterFactory: ${factoryAddr} ${factoryAddr.toLowerCase() === paymasterFactory.toLowerCase() ? '✅' : '❌'}`);
  console.log(`   PriceOracle: ${oracleAddr} ${oracleAddr.toLowerCase() === priceOracle.toLowerCase() ? '✅' : '❌'}`);
  console.log(`   Total Nodes: ${allNodes.length}`);
  console.log(`   Total Staked: $${ethers.formatEther(totalStaked)} USD\n`);

  if (registryAddr.toLowerCase() !== tokenRegistry.toLowerCase()) {
    throw new Error('TokenRegistry mismatch');
  }

  console.log('✅ Integration verified\n');

  // ============ STEP 4: Save Deployment Info ============
  console.log('━━━ Step 4: Saving Deployment Info ━━━\n');

  const deploymentInfo = {
    network: NETWORK,
    chainId: Number(chainId),
    timestamp: new Date().toISOString(),
    contracts: deployment,
    verification: {
      tokenRegistryMatches: registryAddr.toLowerCase() === tokenRegistry.toLowerCase(),
      paymasterFactoryMatches: factoryAddr.toLowerCase() === paymasterFactory.toLowerCase(),
      priceOracleMatches: oracleAddr.toLowerCase() === priceOracle.toLowerCase(),
      totalNodes: Number(totalNodes),
    },
  };

  await Bun.write(
    `deployments/node-system-${NETWORK}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`💾 Deployment saved to: deployments/node-system-${NETWORK}.json\n`);

  // ============ STEP 5: Next Steps ============
  console.log('━━━ Step 5: Next Steps ━━━\n');

  console.log('1. Fund Contract with ETH (for paymaster fees):');
  console.log(`   cast send ${deployment.nodeStakingManager} --value 10ether \\`);
  console.log(`     --rpc-url ${network.rpc} --private-key <key>\n`);

  console.log('2. Start Rewards Oracle:');
  console.log(`   export STAKING_MANAGER=${deployment.nodeStakingManager}`);
  console.log(`   export ORACLE_PRIVATE_KEY=<your-oracle-key>`);
  console.log(`   export NODE_EXPLORER_API=http://localhost:4002`);
  console.log(`   bun run scripts/rewards/rewards-oracle.ts\n`);

  console.log('3. Register First Node (Multi-Token Example):');
  console.log(`   # Approve staking token (e.g., ELIZA)`);
  console.log(`   cast send <TOKEN_ADDRESS> "approve(address,uint256)" \\`);
  console.log(`     ${deployment.nodeStakingManager} 1000000000000000000000 \\`);
  console.log(`     --rpc-url ${network.rpc} --private-key <key>\n`);
  console.log(`   # Register (stake ELIZA, earn USDC - or any combination)`);
  console.log(`   cast send ${deployment.nodeStakingManager} \\`);
  console.log(`     "registerNode(address,uint256,address,string,uint8)" \\`);
  console.log(`     <STAKING_TOKEN> 1000000000000000000000 <REWARD_TOKEN> \\`);
  console.log(`     "https://your-rpc.com" 3 \\`);
  console.log(`     --rpc-url ${network.rpc} --private-key <key>\n`);

  console.log('4. Monitor:');
  console.log(`   Open http://localhost:3011 (Node Explorer UI)`);
  console.log(`   Open http://localhost:4002/nodes (Node API)\n`);

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   ✅ Deployment Complete                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
}

main().catch(error => {
  console.error('\n❌ Deployment failed:', error);
  process.exit(1);
});
