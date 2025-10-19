#!/usr/bin/env bun
/**
 * Initialize Oracle Prices for All Supported Tokens
 * 
 * Sets prices for:
 * - elizaOS: $0.10
 * - CLANKER: $26.14
 * - VIRTUAL: $1.85
 * - CLANKERMON: $0.15
 * - ETH: $3500
 * - USDC: $1.00
 * 
 * Usage:
 *   bun run scripts/init-multi-token-prices.ts
 */

import { execSync } from 'child_process';
import { loadTokenConfig, getAllSupportedTokens } from './shared/token-utils';

interface TokenPrice {
  address: string;
  symbol: string;
  priceUSD: number;
  decimals: number;
}

class OraclePriceInitializer {
  private rpcUrl: string;
  private deployerKey: string;
  private oracleAddress: string;

  constructor() {
    this.rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:9545';
    this.deployerKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    this.oracleAddress = process.env.ORACLE_ADDRESS || process.env.PRICE_ORACLE_ADDRESS || '';
  }

  async initialize() {
    console.log('🎯 Initializing Oracle Prices for All Tokens');
    console.log('='.repeat(70));
    console.log('Oracle:', this.oracleAddress);
    console.log('RPC:', this.rpcUrl);
    console.log('');

    if (!this.oracleAddress) {
      console.error('❌ ORACLE_ADDRESS not set!');
      console.error('   Deploy oracle first or set ORACLE_ADDRESS env var');
      process.exit(1);
    }

    // Get all supported tokens
    const tokens = getAllSupportedTokens();
    
    // Add ETH and USDC
    const allPrices: TokenPrice[] = [
      {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        priceUSD: 3500,
        decimals: 18,
      },
      {
        address: process.env.USDC_ADDRESS || '0x0000000000000000000000000000000000000001',
        symbol: 'USDC',
        priceUSD: 1.00,
        decimals: 6,
      },
      ...tokens.map(t => ({
        address: t.address,
        symbol: t.symbol,
        priceUSD: t.priceUSD,
        decimals: 18,
      })),
    ];

    console.log('Setting prices for tokens:\n');
    
    for (const token of allPrices) {
      await this.setPrice(token);
    }

    console.log('');
    console.log('✅ All prices initialized!');
    console.log('='.repeat(70));
    console.log('');
    console.log('Verify prices:');
    console.log(`  cast call ${this.oracleAddress} "getPrice(address)(uint256,uint256)" ${allPrices[0].address} \\`);
    console.log(`    --rpc-url ${this.rpcUrl}`);
    console.log('');
  }

  private async setPrice(token: TokenPrice) {
    console.log(`📊 ${token.symbol}`);
    console.log(`   Address: ${token.address}`);
    console.log(`   Price: $${token.priceUSD.toFixed(6)}`);
    
    // Convert price to 18 decimals for oracle
    const price18Decimals = Math.floor(token.priceUSD * 1e18);
    
    const cmd = `cast send ${this.oracleAddress} \
      "setPrice(address,uint256,uint256)" \
      ${token.address} \
      ${price18Decimals} \
      18 \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.deployerKey}`;
    
    execSync(cmd, { stdio: 'pipe' });
    console.log('   ✅ Set');
    console.log('');
  }
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  const initializer = new OraclePriceInitializer();
  initializer.initialize().catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
}

export { OraclePriceInitializer };

