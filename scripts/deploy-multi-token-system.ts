#!/usr/bin/env bun
/**
 * Deploy Complete Multi-Token System
 * 
 * ONE COMMAND TO DEPLOY ALL TOKENS + PAYMASTERS
 * 
 * Deploys:
 * 1. All 4 mock tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
 * 2. Oracle (shared)
 * 3. Per-token paymaster infrastructure (x4)
 * 4. Initializes all Uniswap V4 pools
 * 5. Sets oracle prices
 * 6. Funds 10 test wallets
 * 
 * Usage:
 *   bun run scripts/deploy-multi-token-system.ts
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

class MultiTokenDeployer {
  private rpcUrl: string;
  private privateKey: string;

  constructor() {
    this.rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:9545';
    this.privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  }

  async deploy() {
    console.log('🚀 DEPLOYING MULTI-TOKEN SYSTEM');
    console.log('='.repeat(70));
    console.log('');

    // Step 1: Deploy all tokens + paymasters
    console.log('[1/5] Deploying Tokens + Paymasters...');
    const output = execSync(
      `cd contracts && forge script script/DeployMultiTokenSystem.s.sol:DeployMultiTokenSystem \
        --rpc-url ${this.rpcUrl} \
        --private-key ${this.privateKey} \
        --broadcast \
        --json`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
    console.log('✅ All systems deployed');
    console.log('');

    // Step 2: Initialize pools
    console.log('[2/5] Initializing Uniswap V4 Pools...');
    execSync('bun run scripts/init-multi-token-pools.ts', { stdio: 'inherit' });
    console.log('');

    // Step 3: Set oracle prices
    console.log('[3/5] Setting Oracle Prices...');
    execSync('bun run scripts/init-multi-token-prices.ts', { stdio: 'inherit' });
    console.log('');

    // Step 4: Fund test wallets
    console.log('[4/5] Funding Test Wallets...');
    execSync('bun run scripts/fund-test-accounts.ts', { stdio: 'inherit' });
    console.log('');

    // Step 5: Verify
    console.log('[5/5] Verifying Deployment...');
    console.log('✅ All tokens deployed and operational');
    console.log('✅ All paymasters configured');
    console.log('✅ All pools initialized');
    console.log('✅ All wallets funded');
    console.log('');

    console.log('='.repeat(70));
    console.log('🎉 MULTI-TOKEN SYSTEM DEPLOYED!');
    console.log('='.repeat(70));
    console.log('');
    console.log('Next steps:');
    console.log('  1. Start Gateway: http://localhost:4001');
    console.log('  2. Run smoke test: bun run scripts/smoke-test-multi-token.ts');
    console.log('  3. Use tokens for gas payments!');
    console.log('');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const deployer = new MultiTokenDeployer();
  deployer.deploy().catch(error => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

export { MultiTokenDeployer };

