#!/usr/bin/env bun
/**
 * Final Simple Deployment
 * Uses Bun $ shell for maximum simplicity
 */

import { $ } from 'bun';
import { writeFileSync } from 'fs';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ELIZAOS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                                                              ║');
console.log('║   🐴 eHorse Contract Deployment                              ║');
console.log('║                                                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('Configuration:');
console.log(`  RPC URL: ${RPC_URL}`);
console.log(`  Deployer: ${DEPLOYER}`);
console.log(`  elizaOS: ${ELIZAOS}`);
console.log('');

console.log('1. Deploying PredictionOracle...');
const oracleResult = await $`forge create src/prediction-markets/PredictionOracle.sol:PredictionOracle --rpc-url ${RPC_URL} --private-key ${PRIVATE_KEY} --constructor-args ${DEPLOYER} --legacy --broadcast`.cwd('/Users/shawwalters/jeju/contracts').text();
const oracleMatch = oracleResult.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
if (!oracleMatch) {
  console.error('Failed to deploy PredictionOracle');
  console.error('Output:', oracleResult);
  process.exit(1);
}
const ORACLE = oracleMatch[1];
console.log(`  ✅ ${ORACLE}\n`);

console.log('2. Deploying Predimarket...');
const predimarketResult = await $`forge create src/prediction-markets/Predimarket.sol:Predimarket --rpc-url ${RPC_URL} --private-key ${PRIVATE_KEY} --constructor-args ${ELIZAOS} ${ORACLE} ${DEPLOYER} ${DEPLOYER} --legacy --broadcast`.cwd('/Users/shawwalters/jeju/contracts').text();
const predimarketMatch = predimarketResult.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
if (!predimarketMatch) {
  console.error('Failed to deploy Predimarket');
  process.exit(1);
}
const PREDIMARKET = predimarketMatch[1];
console.log(`  ✅ ${PREDIMARKET}\n`);

console.log('3. Deploying MarketFactory...');
const factoryResult = await $`forge create src/prediction-markets/MarketFactory.sol:MarketFactory --rpc-url ${RPC_URL} --private-key ${PRIVATE_KEY} --constructor-args ${PREDIMARKET} ${ORACLE} 1000000000000000000000 ${DEPLOYER} --legacy --broadcast`.cwd('/Users/shawwalters/jeju/contracts').text();
const factoryMatch = factoryResult.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
if (!factoryMatch) {
  console.error('Failed to deploy MarketFactory');
  process.exit(1);
}
const FACTORY = factoryMatch[1];
console.log(`  ✅ ${FACTORY}\n`);

console.log('4. Configuring Contracts...');
await $`cast send ${PREDIMARKET} "transferOwnership(address)" ${FACTORY} --rpc-url ${RPC_URL} --private-key ${PRIVATE_KEY}`.quiet();
console.log(`  ✅ Transferred Predimarket ownership\n`);

console.log('5. Saving Configuration...');

const envContent = `# eHorse Configuration
# Generated: ${new Date().toISOString()}

EHORSE_PORT=5700
EHORSE_SERVER_URL=http://localhost:5700

RPC_URL=${RPC_URL}
PRIVATE_KEY=${PRIVATE_KEY}

PREDICTION_ORACLE_ADDRESS=${ORACLE}
MARKET_FACTORY_ADDRESS=${FACTORY}
PREDIMARKET_ADDRESS=${PREDIMARKET}
ELIZAOS_ADDRESS=${ELIZAOS}

# Agent wallet (Anvil default #2)
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
`;

writeFileSync('.env', envContent);
console.log(`  ✅ Saved to .env\n`);

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                                                              ║');
console.log('║   ✅ Deployment Complete!                                    ║');
console.log('║                                                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('Contract Addresses:');
console.log(`  PredictionOracle: ${ORACLE}`);
console.log(`  Predimarket:      ${PREDIMARKET}`);
console.log(`  MarketFactory:    ${FACTORY}`);
console.log(`  elizaOS:          ${ELIZAOS}`);
console.log('');
console.log('Next Steps:');
console.log('  1. Restart eHorse: source .env && bun run dev');
console.log('  2. Run agent:      source .env && bun run agent');
console.log('');

