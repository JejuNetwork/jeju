#!/usr/bin/env bun
/**
 * Deploy eHorse Contracts
 * Unified deployment script for all eHorse prediction market contracts
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const DEPLOYER_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Use existing elizaOS token
const ELIZAOS_ADDRESS = process.env.ELIZAOS_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

function exec(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function step(num: number, title: string): void {
  console.log(`\n${num}. ${title}`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🐴 eHorse Contract Deployment                              ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  log(`RPC URL: ${RPC_URL}`);
  log(`Deployer: ${DEPLOYER_ADDRESS}`);
  log(`elizaOS: ${ELIZAOS_ADDRESS}`);
  console.log('');

  const addresses: Record<string, string> = {
    elizaOS: ELIZAOS_ADDRESS
  };

  step(1, 'Deploying PredictionOracle');
  const oracleOutput = exec(
    `cd ../../contracts && forge create src/prediction-markets/PredictionOracle.sol:PredictionOracle ` +
    `--rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} --constructor-args ${DEPLOYER_ADDRESS} --legacy --broadcast 2>&1`
  );
  const oracleMatch = oracleOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!oracleMatch) throw new Error('Failed to deploy PredictionOracle');
  addresses.predictionOracle = oracleMatch[1];
  log(`✅ ${addresses.predictionOracle}`);

  step(2, 'Deploying Predimarket');
  const predimarketOutput = exec(
    `cd ../../contracts && forge create src/prediction-markets/Predimarket.sol:Predimarket ` +
    `--rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} ` +
    `--constructor-args ${addresses.elizaOS} ${addresses.predictionOracle} ${DEPLOYER_ADDRESS} ${DEPLOYER_ADDRESS} --legacy --broadcast 2>&1`
  );
  const predimarketMatch = predimarketOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!predimarketMatch) throw new Error('Failed to deploy Predimarket');
  addresses.predimarket = predimarketMatch[1];
  log(`✅ ${addresses.predimarket}`);

  step(3, 'Deploying MarketFactory');
  const factoryOutput = exec(
    `cd ../../contracts && forge create src/prediction-markets/MarketFactory.sol:MarketFactory ` +
    `--rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} ` +
    `--constructor-args ${addresses.predimarket} ${addresses.predictionOracle} 1000000000000000000000 ${DEPLOYER_ADDRESS} --legacy --broadcast 2>&1`
  );
  const factoryMatch = factoryOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!factoryMatch) throw new Error('Failed to deploy MarketFactory');
  addresses.marketFactory = factoryMatch[1];
  log(`✅ ${addresses.marketFactory}`);

  step(4, 'Configuring Contracts');
  
  exec(`cast send ${addresses.predictionOracle} "setGameServer(address)" ${DEPLOYER_ADDRESS} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} --legacy`);
  log('✅ Set gameServer in oracle');

  exec(`cast send ${addresses.predimarket} "transferOwnership(address)" ${addresses.marketFactory} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} --legacy`);
  log('✅ Transferred Predimarket ownership to MarketFactory');

  step(5, 'Saving Configuration');
  
  const envContent = `# eHorse Configuration
# Generated: ${new Date().toISOString()}

EHORSE_PORT=5700
EHORSE_SERVER_URL=http://localhost:5700

RPC_URL=${RPC_URL}
PRIVATE_KEY=${DEPLOYER_KEY}

PREDICTION_ORACLE_ADDRESS=${addresses.predictionOracle}
MARKET_FACTORY_ADDRESS=${addresses.marketFactory}
PREDIMARKET_ADDRESS=${addresses.predimarket}
ELIZAOS_ADDRESS=${addresses.elizaOS}
`;

  writeFileSync('.env', envContent);
  log('✅ Saved to .env');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   ✅ Deployment Complete!                                    ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Contract Addresses:');
  console.log(`  PredictionOracle: ${addresses.predictionOracle}`);
  console.log(`  Predimarket:      ${addresses.predimarket}`);
  console.log(`  MarketFactory:    ${addresses.marketFactory}`);
  console.log(`  elizaOS:          ${addresses.elizaOS}`);
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Start eHorse:  bun run dev');
  console.log('  2. Run agent:     bun run agent');
  console.log('  3. Open browser:  http://localhost:5700');
  console.log('');
}

main();

