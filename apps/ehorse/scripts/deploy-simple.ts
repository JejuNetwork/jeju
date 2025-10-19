#!/usr/bin/env bun
/**
 * Simple Direct Deployment using ethers.js
 * Bypasses forge issues by deploying directly with ethers
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const DEPLOYER_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ELIZAOS_ADDRESS = process.env.ELIZAOS_ADDRESS || '';

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function step(num: number, title: string): void {
  console.log(`\n${num}. ${title}`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🐴 eHorse Simple Deployment                                ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Compile contracts first
  console.log('🔨 Compiling contracts...\n');
  const { execSync } = await import('child_process');
  execSync(
    'cd /Users/shawwalters/jeju/contracts && forge build src/tokens/ElizaOSToken.sol src/prediction-markets/PredictionOracle.sol src/prediction-markets/Predimarket.sol src/prediction-markets/MarketFactory.sol --force',
    { stdio: 'inherit' }
  );
  console.log('');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  console.log('Configuration:');
  log(`RPC URL: ${RPC_URL}`);
  log(`Deployer: ${wallet.address}`);
  console.log('');

  const addresses: Record<string, string> = {};
  
  // Load contract ABIs and bytecode from forge artifacts
  const artifactsPath = '/Users/shawwalters/jeju/contracts/out';

  // Deploy elizaOS if not provided
  if (!ELIZAOS_ADDRESS) {
    step(1, 'Deploying elizaOS Token');
    const elizaOSArtifact = JSON.parse(
      readFileSync(join(artifactsPath, 'ElizaOSToken.sol/ElizaOSToken.json'), 'utf-8')
    );
    const ElizaOSFactory = new ethers.ContractFactory(
      elizaOSArtifact.abi,
      elizaOSArtifact.bytecode.object,
      wallet
    );
    const elizaOS = await ElizaOSFactory.deploy(wallet.address);
    await elizaOS.waitForDeployment();
    addresses.elizaOS = await elizaOS.getAddress();
    log(`✅ ${addresses.elizaOS}`);
  } else {
    addresses.elizaOS = ELIZAOS_ADDRESS;
    log(`Using existing elizaOS: ${addresses.elizaOS}`);
  }
  
  step(2, 'Deploying PredictionOracle');
  const oracleArtifact = JSON.parse(
    readFileSync(join(artifactsPath, 'PredictionOracle.sol/PredictionOracle.json'), 'utf-8')
  );
  const OracleFactory = new ethers.ContractFactory(
    oracleArtifact.abi,
    oracleArtifact.bytecode.object,
    wallet
  );
  const oracle = await OracleFactory.deploy(wallet.address);
  await oracle.waitForDeployment();
  addresses.predictionOracle = await oracle.getAddress();
  log(`✅ ${addresses.predictionOracle}`);

  step(3, 'Deploying Predimarket');
  const predimarketArtifact = JSON.parse(
    readFileSync(join(artifactsPath, 'Predimarket.sol/Predimarket.json'), 'utf-8')
  );
  const PredimarketFactory = new ethers.ContractFactory(
    predimarketArtifact.abi,
    predimarketArtifact.bytecode.object,
    wallet
  );
  const predimarket = await PredimarketFactory.deploy(
    addresses.elizaOS,
    addresses.predictionOracle,
    wallet.address,
    wallet.address
  );
  await predimarket.waitForDeployment();
  addresses.predimarket = await predimarket.getAddress();
  log(`✅ ${addresses.predimarket}`);

  step(4, 'Deploying MarketFactory');
  const factoryArtifact = JSON.parse(
    readFileSync(join(artifactsPath, 'MarketFactory.sol/MarketFactory.json'), 'utf-8')
  );
  const MarketFactoryFactory = new ethers.ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode.object,
    wallet
  );
  const factory = await MarketFactoryFactory.deploy(
    addresses.predimarket,
    addresses.predictionOracle,
    ethers.parseEther('1000'),
    wallet.address
  );
  await factory.waitForDeployment();
  addresses.marketFactory = await factory.getAddress();
  log(`✅ ${addresses.marketFactory}`);

  step(5, 'Configuring Contracts');
  
  log('✅ gameServer already set in oracle constructor');

  const transferOwnershipTx = await predimarket.transferOwnership(addresses.marketFactory);
  await transferOwnershipTx.wait();
  log('✅ Transferred Predimarket ownership to MarketFactory');

  step(6, 'Saving Configuration');
  
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

# Agent wallet (Anvil default #2)
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
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
  console.log('  1. Restart eHorse: bun run dev');
  console.log('  2. Run agent:      bun run agent');
  console.log('');
}

main();

