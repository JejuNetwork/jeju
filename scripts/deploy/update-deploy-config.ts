#!/usr/bin/env bun
/**
 * Update Deploy Config with Generated Addresses
 * 
 * Reads the generated operator addresses and updates the deploy config.
 * 
 * Usage:
 *   bun run scripts/deploy/update-deploy-config.ts [network]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');
const CONFIG_DIR = join(ROOT, 'packages/contracts/deploy-config');

async function main() {
  const network = process.argv[2] || 'testnet';
  
  console.log(`Updating deploy config for ${network}...`);

  const addressesFile = join(KEYS_DIR, 'deploy-config-addresses.json');
  const configFile = join(CONFIG_DIR, `${network}.json`);

  if (!existsSync(addressesFile)) {
    console.error(`❌ Addresses file not found: ${addressesFile}`);
    console.error('   Run: bun run scripts/deploy/generate-operator-keys.ts');
    process.exit(1);
  }

  if (!existsSync(configFile)) {
    console.error(`❌ Config file not found: ${configFile}`);
    process.exit(1);
  }

  const addresses = JSON.parse(readFileSync(addressesFile, 'utf-8'));
  const config = JSON.parse(readFileSync(configFile, 'utf-8'));

  // Update config with addresses
  const updatedConfig = {
    ...config,
    ...addresses,
  };

  // Write updated config
  writeFileSync(configFile, JSON.stringify(updatedConfig, null, 2));
  console.log(`✅ Updated: ${configFile}`);

  // Show what was updated
  console.log('\nUpdated addresses:');
  for (const [key, value] of Object.entries(addresses)) {
    console.log(`  ${key}: ${value}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});


