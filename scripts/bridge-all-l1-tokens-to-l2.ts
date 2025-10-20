#!/usr/bin/env bun
/**
 * Bridge All L1 Tokens to L2
 * 
 * Bridges ALL protocol tokens from L1 to L2:
 * - elizaOS
 * - USDC
 * - CLANKER
 * - VIRTUAL
 * - CLANKERMON
 * 
 * This simulates the real-world flow where tokens exist on Base
 * and are bridged to Jeju for use in the ecosystem.
 * 
 * ALL tokens go through the SAME Standard Bridge process.
 * NO special treatment for elizaOS.
 * 
 * Usage:
 *   bun run scripts/bridge-all-l1-tokens-to-l2.ts
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

class L1ToL2Bridger {
  private l1RpcUrl: string;
  private l2RpcUrl: string;
  private privateKey: string;
  private l1Tokens: Record<string, string>;

  constructor() {
    this.l1RpcUrl = process.env.L1_RPC_URL || 'http://localhost:8545';
    this.l2RpcUrl = process.env.L2_RPC_URL || 'http://localhost:9545';
    this.privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    // Load L1 token addresses
    const l1Deployment = JSON.parse(
      readFileSync(join(process.cwd(), 'deployments', 'l1-tokens.json'), 'utf-8')
    );
    
    this.l1Tokens = {
      elizaOS: l1Deployment.elizaOS,
      USDC: l1Deployment.usdc,
      CLANKER: l1Deployment.clanker,
      VIRTUAL: l1Deployment.virtualToken,
      CLANKERMON: l1Deployment.clankermon,
    };
  }

  async bridge() {
    console.log('🌉 BRIDGING ALL L1 TOKENS TO L2');
    console.log('='.repeat(70));
    console.log('L1 RPC:', this.l1RpcUrl);
    console.log('L2 RPC:', this.l2RpcUrl);
    console.log('');

    const standardBridge = '0x4200000000000000000000000000000000000010';

    const tokensTobridge = [
      { symbol: 'elizaOS', address: this.l1Tokens.elizaOS, amount: '10000000000000000000000000' }, // 10M
      { symbol: 'USDC', address: this.l1Tokens.USDC, amount: '10000000000' }, // 10M USDC (6 decimals)
      { symbol: 'CLANKER', address: this.l1Tokens.CLANKER, amount: '100000000000000000000000' }, // 100k
      { symbol: 'VIRTUAL', address: this.l1Tokens.VIRTUAL, amount: '1000000000000000000000000' }, // 1M
      { symbol: 'CLANKERMON', address: this.l1Tokens.CLANKERMON, amount: '10000000000000000000000000' }, // 10M
    ];

    for (const token of tokensTobridge) {
      console.log(`\n📝 Bridging ${token.symbol}...`);
      console.log(`   L1 Address: ${token.address}`);
      console.log(`   Amount: ${token.amount}`);

      // Approve bridge
      const approveCmd = `cast send ${token.address} \
        "approve(address,uint256)" \
        ${standardBridge} \
        ${token.amount} \
        --rpc-url ${this.l1RpcUrl} \
        --private-key ${this.privateKey}`;
      
      execSync(approveCmd, { stdio: 'pipe' });
      console.log('   ✅ Approved');

      // Bridge
      const bridgeCmd = `cast send ${standardBridge} \
        "bridgeERC20(address,address,uint256,uint32,bytes)" \
        ${token.address} \
        ${token.address} \
        ${token.amount} \
        200000 \
        0x \
        --rpc-url ${this.l1RpcUrl} \
        --private-key ${this.privateKey}`;
      
      execSync(bridgeCmd, { stdio: 'pipe' });
      console.log('   ✅ Bridged (waiting for L2 confirmation...)');
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL TOKENS BRIDGED TO L2');
    console.log('='.repeat(70));
    console.log('');
    console.log('All 5 tokens now on L2 with identical treatment:');
    console.log('  • elizaOS');
    console.log('  • USDC');
    console.log('  • CLANKER');
    console.log('  • VIRTUAL');
    console.log('  • CLANKERMON');
    console.log('');
    console.log('Next: Deploy paymasters on L2');
    console.log('  forge script script/DeployL2Paymasters.s.sol --broadcast');
    console.log('');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bridger = new L1ToL2Bridger();
  bridger.bridge().catch(error => {
    console.error('❌ Bridge failed:', error);
    process.exit(1);
  });
}

export { L1ToL2Bridger };

