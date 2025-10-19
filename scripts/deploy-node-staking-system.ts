#!/usr/bin/env bun
/**
 * @fileoverview Deploy complete node staking system
 * @module scripts/deploy-node-staking-system
 * 
 * Deploys:
 * - NodeStakingManager contract
 * - Configures integration with TokenRegistry, PaymasterFactory, PriceOracle
 * - Funds contract with reward tokens and ETH
 * - Updates .env files
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONTRACTS_DIR = join(process.cwd(), 'contracts');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  🚀 Deploying Node Staking System                     ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Get dependency addresses from environment or .env.local
const TOKEN_REGISTRY = process.env.TOKEN_REGISTRY_ADDRESS || process.env.VITE_TOKEN_REGISTRY_ADDRESS;
const PAYMASTER_FACTORY = process.env.PAYMASTER_FACTORY_ADDRESS || process.env.VITE_PAYMASTER_FACTORY_ADDRESS;
const PRICE_ORACLE = process.env.PRICE_ORACLE_ADDRESS || process.env.VITE_PRICE_ORACLE_ADDRESS;

if (!TOKEN_REGISTRY || !PAYMASTER_FACTORY || !PRICE_ORACLE) {
  console.error('❌ Missing dependencies!');
  console.error('   Required: TOKEN_REGISTRY_ADDRESS, PAYMASTER_FACTORY_ADDRESS, PRICE_ORACLE_ADDRESS');
  console.error('   Run: bun run scripts/deploy-paymaster-system.ts first');
  process.exit(1);
}

console.log('📋 Using existing contracts:');
console.log(`   TokenRegistry:    ${TOKEN_REGISTRY}`);
console.log(`   PaymasterFactory: ${PAYMASTER_FACTORY}`);
console.log(`   PriceOracle:      ${PRICE_ORACLE}\n`);

// Deploy NodeStakingManager
console.log('[1/4] Deploying NodeStakingManager...');

const deployCmd = `forge script script/DeployNodeStaking.s.sol \
  --rpc-url ${process.env.L2_RPC_URL || 'http://localhost:8545'} \
  --private-key ${process.env.DEPLOYER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'} \
  --broadcast \
  --json`;

const output = execSync(deployCmd, { cwd: CONTRACTS_DIR, encoding: 'utf-8' });
const lines = output.split('\n');
const deploymentLine = lines.find(l => l.includes('NodeStakingManager:'));
const stakingManagerAddress = deploymentLine?.match(/0x[a-fA-F0-9]{40}/)?.[0];

if (!stakingManagerAddress) {
  console.error('❌ Failed to deploy NodeStakingManager');
  process.exit(1);
}

console.log(`   ✅ Deployed: ${stakingManagerAddress}\n`);

// Update .env.local for gateway
console.log('[2/4] Updating environment variables...');

const envPath = join(process.cwd(), 'apps', 'gateway', '.env.local');
let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

if (!envContent.includes('NODE_STAKING_MANAGER_ADDRESS')) {
  envContent += `\n# Node Staking System\n`;
  envContent += `VITE_NODE_STAKING_MANAGER_ADDRESS=${stakingManagerAddress}\n`;
  envContent += `VITE_NODE_PERFORMANCE_ORACLE_ADDRESS=${process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'}\n`;
  envContent += `VITE_NODE_EXPLORER_API_URL=http://localhost:4002\n`;
  
  writeFileSync(envPath, envContent);
  console.log(`   ✅ Updated: apps/gateway/.env.local\n`);
}

// Fund contract with reward tokens
console.log('[3/4] Funding contract with reward tokens...');
console.log('   (Run manually): Transfer tokens to', stakingManagerAddress);
console.log('   Recommended amounts:');
console.log('     - 100,000 elizaOS');
console.log('     - 500 CLANKER');
console.log('     - 10,000 VIRTUAL');
console.log('     - 100,000 CLANKERMON\n');

// Fund contract with ETH for paymaster fees
console.log('[4/4] Funding contract with ETH...');
console.log('   (Run manually): Send 10 ETH to', stakingManagerAddress);
console.log('   Purpose: Pay paymaster fees (5% + 2% of rewards)\n');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║  ✅ Node Staking System Deployed                       ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

console.log('📝 Summary:');
console.log(`   NodeStakingManager: ${stakingManagerAddress}`);
console.log(`   Min Stake: $1,000 USD`);
console.log(`   Paymaster Fees: 7% (5% + 2%)`);
console.log(`   Max Nodes/Operator: 5`);
console.log(`   Max Network Ownership: 20%\n`);

console.log('🚀 Next Steps:');
console.log('   1. Fund contract with reward tokens (see amounts above)');
console.log('   2. Fund contract with 10 ETH for paymaster fees');
console.log('   3. Restart gateway: cd apps/gateway && bun run dev');
console.log('   4. Visit: http://localhost:4001');
console.log('   5. Click "Node Staking" tab');
console.log('   6. Register your first node!\n');



