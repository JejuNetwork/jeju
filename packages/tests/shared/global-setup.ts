/**
 * Global setup for Playwright/Synpress tests
 * 
 * This runs once before all tests:
 * 1. Checks if localnet is running
 * 2. Waits for chain to be ready
 * 3. Sets up test environment
 */

import { chromium, FullConfig } from '@playwright/test';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const JEJU_RPC = process.env.JEJU_RPC_URL || process.env.L2_RPC_URL || 'http://127.0.0.1:9545';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1337');

async function globalSetup(config: FullConfig) {
  console.log('\n🔧 Global Setup Starting...\n');

  // 1. Check if chain is running
  console.log(`Checking chain at ${JEJU_RPC}...`);
  
  let chainReady = false;
  const maxAttempts = 30;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(JEJU_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const remoteChainId = parseInt(data.result, 16);
        
        if (remoteChainId === CHAIN_ID) {
          chainReady = true;
          console.log(`✅ Chain ready (ID: ${remoteChainId})`);
          break;
        } else {
          console.log(`⚠️  Chain ID mismatch: expected ${CHAIN_ID}, got ${remoteChainId}`);
        }
      }
    } catch {
      if (i === 0) {
        console.log('   Waiting for chain...');
      }
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  if (!chainReady) {
    console.error('\n❌ Chain not ready after 60 seconds');
    console.error('   Start localnet with: jeju up\n');
    throw new Error('Chain not ready');
  }

  // 2. Get block number
  try {
    const response = await fetch(JEJU_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    
    const data = await response.json();
    const blockNumber = parseInt(data.result, 16);
    console.log(`   Block: ${blockNumber}`);
  } catch {
    // Non-fatal
  }

  // 3. Create output directory
  const outputDir = join(process.cwd(), 'test-results');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 4. Write test environment info
  const envInfo = {
    rpcUrl: JEJU_RPC,
    chainId: CHAIN_ID,
    startTime: new Date().toISOString(),
    ci: !!process.env.CI,
  };
  
  writeFileSync(
    join(outputDir, 'test-env.json'),
    JSON.stringify(envInfo, null, 2)
  );

  console.log('\n✅ Global Setup Complete\n');
}

export default globalSetup;
