#!/usr/bin/env bun
/**
 * Deploy Contracts to Testnet
 * 
 * Reads configuration from packages/config/testnet.json
 * Private key must be in DEPLOYER_KEY env var
 * 
 * Usage:
 *   DEPLOYER_KEY=0x... bun scripts/deploy-contracts.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

// Load testnet config
const configPath = join(import.meta.dir, '../packages/config/testnet.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// Contract deployment order and scripts
const DEPLOY_SCRIPTS = [
  { name: 'OIF', script: 'DeployOIF.s.sol:DeployOIF', chain: 'jeju_testnet' },
  { name: 'Tokens', script: 'DeployTokens.s.sol:DeployTokens', chain: 'jeju_testnet' },
  { name: 'DeFi', script: 'DeployDeFi.s.sol:DeployDeFi', chain: 'jeju_testnet' },
];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function error(msg: string) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
}

async function deployContract(scriptName: string, chain: string): Promise<Record<string, string>> {
  log(`Deploying ${scriptName} to ${chain}...`);
  
  const contractsDir = join(import.meta.dir, '../packages/contracts');
  
  const result = await $`cd ${contractsDir} && forge script script/${scriptName} \
    --rpc-url ${chain} \
    --broadcast \
    --skip-simulation \
    2>&1`.text();
  
  console.log(result);
  
  // Parse deployed addresses from output
  const addresses: Record<string, string> = {};
  const addressRegex = /(\w+):\s*(0x[a-fA-F0-9]{40})/g;
  let match;
  while ((match = addressRegex.exec(result)) !== null) {
    addresses[match[1]] = match[2];
  }
  
  return addresses;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    JEJU TESTNET CONTRACT DEPLOYMENT      ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  // Check for deployer key
  if (!process.env.DEPLOYER_KEY) {
    error('DEPLOYER_KEY environment variable not set');
    console.log('\nUsage: DEPLOYER_KEY=0x... bun scripts/deploy-contracts.ts');
    process.exit(1);
  }
  
  log(`Network: ${config.jeju.networkName} (${config.jeju.chainId})`);
  log(`RPC: ${config.jeju.rpc.http}`);
  log(`Deployer: ${config.deployer.address}`);
  
  const allAddresses: Record<string, Record<string, string>> = {};
  
  for (const deploy of DEPLOY_SCRIPTS) {
    try {
      const addresses = await deployContract(deploy.script, deploy.chain);
      allAddresses[deploy.name] = addresses;
      success(`${deploy.name} deployed`);
    } catch (e) {
      error(`Failed to deploy ${deploy.name}: ${(e as Error).message}`);
    }
  }
  
  // Update config with new addresses
  const updatedConfig = { ...config };
  
  if (allAddresses.OIF) {
    updatedConfig.contracts.jeju = {
      ...updatedConfig.contracts.jeju,
      ...allAddresses.OIF
    };
  }
  
  // Save updated config
  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
  success(`Config updated: ${configPath}`);
  
  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    DEPLOYMENT SUMMARY                    ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  for (const [name, addresses] of Object.entries(allAddresses)) {
    console.log(`\n${name}:`);
    for (const [contract, address] of Object.entries(addresses)) {
      console.log(`  ${contract}: ${address}`);
    }
  }
}

main().catch(console.error);

