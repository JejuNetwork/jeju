#!/usr/bin/env bun
/**
 * Load Contract Addresses
 * 
 * Reads deployed contract addresses from localnet-addresses.json
 * and updates .env file
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function main() {
  console.log('📍 Loading contract addresses from deployments...');
  
  const addressesPath = '../../contracts/deployments/localnet-addresses.json';
  const addresses = JSON.parse(await readFile(addressesPath, 'utf-8'));
  
  let envContent = await readFile('.env', 'utf-8');
  
  // Update addresses in .env
  envContent = envContent.replace(/^IDENTITY_REGISTRY=.*/m, `IDENTITY_REGISTRY=${addresses.identityRegistry}`);
  envContent = envContent.replace(/^REPUTATION_REGISTRY=.*/m, `REPUTATION_REGISTRY=${addresses.reputationRegistry}`);
  envContent = envContent.replace(/^VALIDATION_REGISTRY=.*/m, `VALIDATION_REGISTRY=${addresses.validationRegistry}`);
  envContent = envContent.replace(/^SERVICE_REGISTRY=.*/m, `SERVICE_REGISTRY=${addresses.serviceRegistry}`);
  envContent = envContent.replace(/^CREDIT_MANAGER=.*/m, `CREDIT_MANAGER=${addresses.creditManager}`);
  envContent = envContent.replace(/^ELIZA_TOKEN=.*/m, `ELIZA_TOKEN=${addresses.elizaOS}`);
  envContent = envContent.replace(/^USDC=.*/m, `USDC=${addresses.usdc}`);
  
  await writeFile('.env', envContent);
  
  console.log('✅ Contract addresses loaded:');
  console.log(`   IdentityRegistry: ${addresses.identityRegistry}`);
  console.log(`   ReputationRegistry: ${addresses.reputationRegistry}`);
  console.log(`   ServiceRegistry: ${addresses.serviceRegistry}`);
  console.log(`   elizaOS Token: ${addresses.elizaOS}`);
  console.log('');
  console.log('Ready to fund wallets and start!');
}

main().catch(console.error);
