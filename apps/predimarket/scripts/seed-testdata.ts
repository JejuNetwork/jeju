#!/usr/bin/env bun
/**
 * Seed Test Data for Real E2E Testing
 * Creates markets and trades on local Anvil for integration testing
 * 
 * Prerequisites:
 * - Anvil running on port 9545
 * - Contracts deployed (run test-env-setup.sh first)
 * - Indexer running on port 4350
 */

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Anvil default accounts
const accounts = {
  deployer: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
  trader1: privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
  trader2: privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'),
};

const chain = {
  id: 1337,
  name: 'Local Anvil',
  network: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:9545'] } },
};

const publicClient = createPublicClient({
  chain,
  transport: http('http://localhost:9545'),
});

function createClient(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({
    account,
    chain,
    transport: http('http://localhost:9545'),
  });
}

// Load contract addresses from .env.local
const PREDIMARKET_ADDRESS = process.env.NEXT_PUBLIC_PREDIMARKET_ADDRESS as `0x${string}`;
const ELIZAOS_ADDRESS = process.env.NEXT_PUBLIC_ELIZA_OS_ADDRESS as `0x${string}`;

console.log('🌱 Seeding test data for Predimarket e2e tests...\n');
console.log('Contract Addresses:');
console.log(`  Predimarket: ${PREDIMARKET_ADDRESS}`);
console.log(`  ElizaOS:     ${ELIZAOS_ADDRESS}\n`);

/**
 * Step 1: Create test markets
 * 
 * Note: This requires the actual Predimarket contract ABI
 * Update once deployment scripts are complete
 */
async function createTestMarkets() {
  console.log('📝 Creating test markets...');
  
  const client = createClient(accounts.deployer);
  
  try {
    // TODO: Call createMarket function on Predimarket contract
    // Example:
    // const hash = await client.writeContract({
    //   address: PREDIMARKET_ADDRESS,
    //   abi: PREDIMARKET_ABI,
    //   functionName: 'createMarket',
    //   args: [sessionId, question, liquidityParam],
    // });
    // await publicClient.waitForTransactionReceipt({ hash });
    
    console.log('⚠️  Market creation not yet implemented - needs Predimarket deployment script');
    console.log('   TODO: Add createMarket calls here once deployment is complete');
    
  } catch (error) {
    console.error('❌ Failed to create markets:', error);
    throw error;
  }
}

/**
 * Step 2: Seed initial trades
 * 
 * Places bets from test accounts to create price history
 */
async function seedTrades() {
  console.log('\n💰 Seeding test trades...');
  
  try {
    // TODO: Execute buy() transactions from different accounts
    // This creates:
    // - Price history for charts
    // - Market volume
    // - User positions for portfolio tests
    
    console.log('⚠️  Trade seeding not yet implemented');
    console.log('   TODO: Add buy() calls here once Predimarket is deployed');
    
  } catch (error) {
    console.error('❌ Failed to seed trades:', error);
    throw error;
  }
}

/**
 * Step 3: Resolve one market for resolution tests
 */
async function resolveTestMarket() {
  console.log('\n🏁 Resolving test market...');
  
  try {
    // TODO: Call oracle to resolve one market
    // This enables testing claim functionality
    
    console.log('⚠️  Market resolution not yet implemented');
    console.log('   TODO: Add resolution logic once oracle is integrated');
    
  } catch (error) {
    console.error('❌ Failed to resolve market:', error);
    throw error;
  }
}

/**
 * Main seeding flow
 */
async function main() {
  try {
    // Verify Anvil is running
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`✅ Connected to Anvil (block ${blockNumber})\n`);
    
    // Verify contracts are deployed
    const predimarketCode = await publicClient.getBytecode({ address: PREDIMARKET_ADDRESS });
    const elizaosCode = await publicClient.getBytecode({ address: ELIZAOS_ADDRESS });
    
    if (!predimarketCode || predimarketCode === '0x') {
      throw new Error(`Predimarket not deployed at ${PREDIMARKET_ADDRESS}`);
    }
    if (!elizaosCode || elizaosCode === '0x') {
      throw new Error(`ElizaOS not deployed at ${ELIZAOS_ADDRESS}`);
    }
    
    console.log('✅ Contracts verified on-chain\n');
    
    // Run seeding steps
    await createTestMarkets();
    await seedTrades();
    await resolveTestMarket();
    
    console.log('\n================================================');
    console.log('🎉 Test data seeded successfully!');
    console.log('================================================\n');
    console.log('You can now run e2e tests:');
    console.log('  cd apps/predimarket');
    console.log('  bun run test:e2e\n');
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    console.error('\nMake sure:');
    console.error('1. Anvil is running: anvil --port 9545');
    console.error('2. Contracts are deployed: ./scripts/test-env-setup.sh');
    console.error('3. Addresses in .env.local are correct\n');
    process.exit(1);
  }
}

main();

