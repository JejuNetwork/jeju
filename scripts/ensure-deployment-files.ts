#!/usr/bin/env bun
/**
 * Ensure Deployment Files Exist
 * 
 * Creates template deployment files if they don't exist.
 * This prevents TypeScript import errors before contracts are deployed.
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const deploymentsDir = join(process.cwd(), 'contracts', 'deployments');
const templates = {
  'uniswap-v4-1337.json': {
    poolManager: '0x0000000000000000000000000000000000000000',
    weth: '0x4200000000000000000000000000000000000006',
    swapRouter: null,
    positionManager: null,
    quoterV4: null,
    stateView: null,
    timestamp: new Date().toISOString(),
    note: 'Template file - will be updated during localnet bootstrap'
  },
  'erc20-factory-1337.json': {
    factory: '0x0000000000000000000000000000000000000000',
    timestamp: new Date().toISOString(),
    note: 'Template file - will be updated during localnet bootstrap'
  },
  'bazaar-marketplace-1337.json': {
    marketplace: '0x0000000000000000000000000000000000000000',
    goldToken: '0x0000000000000000000000000000000000000000',
    timestamp: new Date().toISOString(),
    note: 'Template file - will be updated during localnet bootstrap'
  }
};

// Ensure deployments directory exists
if (!existsSync(deploymentsDir)) {
  mkdirSync(deploymentsDir, { recursive: true });
  console.log('✅ Created deployments directory');
}

// Create template files if they don't exist
for (const [filename, template] of Object.entries(templates)) {
  const filepath = join(deploymentsDir, filename);
  
  if (!existsSync(filepath)) {
    writeFileSync(filepath, JSON.stringify(template, null, 2));
    console.log(`✅ Created template: ${filename}`);
  }
}

console.log('\n✅ All deployment files ready');
console.log('💡 Run "bun run dev" to deploy actual contracts\n');

