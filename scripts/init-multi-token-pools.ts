#!/usr/bin/env bun
/**
 * Initialize Uniswap V4 Pools for All Supported Tokens
 * 
 * Creates pools for:
 * - elizaOS/ETH (0.3% fee)
 * - CLANKER/ETH (0.3% fee)
 * - VIRTUAL/ETH (0.3% fee)
 * - CLANKERMON/ETH (0.3% fee)
 * - CLANKER/USDC (0.3% fee)
 * - VIRTUAL/USDC (0.3% fee)
 * - CLANKERMON/USDC (0.3% fee)
 * - elizaOS/USDC (0.3% fee)
 * 
 * Usage:
 *   bun run scripts/init-multi-token-pools.ts
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getAllSupportedTokens, calculateSqrtPriceX96, getTokenPriceUSD } from './shared/token-utils';

interface PoolConfig {
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: string;
  liquidityETH: number;
  priceToken1PerToken0: number;
}

class MultiTokenPoolInitializer {
  private rpcUrl: string;
  private deployerKey: string;
  private poolManager: string;
  private positionManager: string;
  private weth: string;
  private usdc: string;

  constructor() {
    this.rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:9545';
    this.deployerKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    this.weth = '0x4200000000000000000000000000000000000006';
    this.usdc = process.env.USDC_ADDRESS || '';
    
    // Load deployed addresses
    this.poolManager = this.loadDeployedAddress('poolManager') || '';
    this.positionManager = this.loadDeployedAddress('positionManager') || '';
  }

  async initializeAllPools() {
    console.log('🏊 Initializing Uniswap V4 Pools for All Tokens');
    console.log('='.repeat(70));
    console.log('');

    if (!this.poolManager) {
      console.error('❌ PoolManager not deployed!');
      console.error('   Run: bun run scripts/deploy-uniswap-v4.ts');
      process.exit(1);
    }

    console.log('PoolManager:', this.poolManager);
    console.log('PositionManager:', this.positionManager || 'Not deployed');
    console.log('WETH:', this.weth);
    console.log('USDC:', this.usdc || 'Not deployed');
    console.log('');

    // Get all tokens
    const tokens = getAllSupportedTokens();
    const tokenDeployments = await this.loadTokenDeployments();

    // Generate pool configurations
    const pools: PoolConfig[] = [];

    // Token/ETH pools
    for (const token of tokens) {
      const tokenAddress = tokenDeployments[token.symbol] || token.address;
      const priceInETH = token.priceUSD / 3500; // Assuming ETH = $3500
      
      pools.push(this.createPoolConfig(
        tokenAddress,
        this.weth,
        token.symbol,
        'ETH',
        priceInETH,
        5 // 5 ETH liquidity
      ));
    }

    // Token/USDC pools (if USDC deployed)
    if (this.usdc) {
      for (const token of tokens) {
        const tokenAddress = tokenDeployments[token.symbol] || token.address;
        const priceInUSDC = token.priceUSD; // USDC = $1
        
        pools.push(this.createPoolConfig(
          tokenAddress,
          this.usdc,
          token.symbol,
          'USDC',
          priceInUSDC,
          10000 // $10k USD liquidity
        ));
      }
    }

    // Initialize each pool
    console.log(`Initializing ${pools.length} pools...\n`);
    
    const initializedPools = [];
    for (const [index, pool] of pools.entries()) {
      console.log(`Pool ${index + 1}/${pools.length}: ${pool.token0Symbol}/${pool.token1Symbol}`);
      const success = await this.initializePool(pool);
      if (success) {
        initializedPools.push(pool);
      }
      console.log('');
    }

    // Save pool configurations
    this.savePoolConfigs(initializedPools);

    console.log('✅ Pool initialization complete!');
    console.log(`   ${initializedPools.length}/${pools.length} pools initialized`);
  }

  private createPoolConfig(
    tokenA: string,
    tokenB: string,
    symbolA: string,
    symbolB: string,
    priceTokenBPerTokenA: number,
    liquidityInB: number
  ): PoolConfig {
    // Sort tokens (token0 < token1)
    const [token0, token1, token0Symbol, token1Symbol, price] = 
      tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB, symbolA, symbolB, priceTokenBPerTokenA]
        : [tokenB, tokenA, symbolB, symbolA, 1 / priceTokenBPerTokenA];

    return {
      token0,
      token1,
      token0Symbol,
      token1Symbol,
      fee: 3000, // 0.3%
      tickSpacing: 60,
      sqrtPriceX96: calculateSqrtPriceX96(price).toString(),
      liquidityETH: liquidityInB,
      priceToken1PerToken0: price,
    };
  }

  private async initializePool(pool: PoolConfig): Promise<boolean> {
    console.log(`   Price: 1 ${pool.token0Symbol} = ${pool.priceToken1PerToken0.toFixed(6)} ${pool.token1Symbol}`);
    console.log(`   sqrtPriceX96: ${pool.sqrtPriceX96}`);
    
    if (!this.positionManager) {
      console.log('   ⚠️  PositionManager not deployed - skipping');
      return false;
    }

    // Approve tokens
    this.approveToken(pool.token0);
    this.approveToken(pool.token1);

    // Initialize pool
    const cmd = `cast send ${this.positionManager} \
      "initialize((address,address,uint24,int24,address),uint160,bytes)" \
      "(${pool.token0},${pool.token1},${pool.fee},${pool.tickSpacing},0x0000000000000000000000000000000000000000)" \
      ${pool.sqrtPriceX96} \
      0x \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.deployerKey}`;

    execSync(cmd, { stdio: 'pipe' });
    console.log('   ✅ Initialized');
    
    return true;
  }

  private approveToken(tokenAddress: string) {
    if (tokenAddress === this.weth) return;
    
    const maxApproval = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    
    execSync(
      `cast send ${tokenAddress} "approve(address,uint256)" ${this.positionManager} ${maxApproval} \
        --rpc-url ${this.rpcUrl} \
        --private-key ${this.deployerKey}`,
      { stdio: 'pipe' }
    );
  }

  private loadDeployedAddress(contract: string): string {
    const deploymentPath = join(process.cwd(), 'contracts', 'deployments', 'uniswap-v4-1337.json');
    const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
    return deployment[contract] || '';
  }

  private async loadTokenDeployments(): Promise<Record<string, string>> {
    const deploymentPath = join(process.cwd(), 'contracts', 'deployments', 'localnet', 'multi-token-system.json');
    
    const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
    
    return {
      elizaOS: deployment.elizaOS_token,
      CLANKER: deployment.clanker_token,
      VIRTUAL: deployment.virtual_token,
      CLANKERMON: deployment.clankermon_token,
    };
  }

  private savePoolConfigs(pools: PoolConfig[]) {
    const outputPath = join(process.cwd(), 'deployments', 'uniswap-v4-pools.json');
    
    const poolData = {
      network: 'localnet',
      chainId: 1337,
      poolManager: this.poolManager,
      positionManager: this.positionManager,
      pools: pools.map(p => ({
        pair: `${p.token0Symbol}/${p.token1Symbol}`,
        token0: p.token0,
        token1: p.token1,
        fee: p.fee,
        tickSpacing: p.tickSpacing,
        sqrtPriceX96: p.sqrtPriceX96,
        price: p.priceToken1PerToken0,
      })),
      timestamp: Date.now(),
    };

    writeFileSync(outputPath, JSON.stringify(poolData, null, 2));
    console.log('💾 Pool configurations saved to:', outputPath);
  }
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  const initializer = new MultiTokenPoolInitializer();
  initializer.initializeAllPools().catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
}

export { MultiTokenPoolInitializer };

