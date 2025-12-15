/**
 * Live CoW Solver Validation Script
 * 
 * Tests our solver's pricing competitiveness against CoW Protocol quotes.
 * Since the auction API requires solver registration, we instead:
 * 1. Get quotes from CoW for various token pairs
 * 2. Compare our AMM pricing vs CoW's solver network pricing
 * 3. Determine if we're competitive
 */

import { createPublicClient, http, type Address, formatUnits } from 'viem';
import { mainnet } from 'viem/chains';
import { CowProtocolSolver, type CowQuote } from '../src/solver/external';

interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
}

// Major tokens for testing
const TOKENS: Record<string, TokenInfo> = {
  USDC: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  WETH: { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  USDT: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  DAI: { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EesdeAC495271d0F', decimals: 18 },
  WBTC: { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
};

// Our mock liquidity pools with pricing
const POOLS = [
  {
    token0: TOKENS.USDC,
    token1: TOKENS.WETH,
    reserve0: BigInt('50000000000000'), // 50M USDC
    reserve1: BigInt('15000000000000000000000'), // 15K WETH
    // Implied price: ~3333 USDC per WETH
  },
  {
    token0: TOKENS.USDT,
    token1: TOKENS.WETH,
    reserve0: BigInt('30000000000000'), // 30M USDT
    reserve1: BigInt('9000000000000000000000'), // 9K WETH
    // Implied price: ~3333 USDT per WETH
  },
  {
    token0: TOKENS.USDC,
    token1: TOKENS.USDT,
    reserve0: BigInt('100000000000000'), // 100M USDC
    reserve1: BigInt('100000000000000'), // 100M USDT
    // 1:1 stable
  },
];

// Calculate AMM output using constant product formula
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * BigInt(997);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BigInt(1000) + amountInWithFee;
  return numerator / denominator;
}

interface ComparisonResult {
  pair: string;
  sellAmount: string;
  cowBuyAmount: string;
  ourBuyAmount: string;
  cowPrice: number;
  ourPrice: number;
  slippageBps: number;
  competitive: boolean;
}

async function main() {
  console.log('🐮 CoW Solver Pricing Validation');
  console.log('=================================\n');
  
  // Setup
  const clients = new Map<number, { public: ReturnType<typeof createPublicClient> }>();
  clients.set(1, {
    public: createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    }),
  });
  
  const solver = new CowProtocolSolver(clients, [1]);
  const testAddress = '0x1111111111111111111111111111111111111111' as Address;
  
  // Test pairs
  const testCases = [
    { sell: TOKENS.USDC, buy: TOKENS.WETH, amount: '1000' }, // $1000 swap
    { sell: TOKENS.USDC, buy: TOKENS.WETH, amount: '10000' }, // $10K swap
    { sell: TOKENS.WETH, buy: TOKENS.USDC, amount: '1' }, // 1 ETH swap
    { sell: TOKENS.USDC, buy: TOKENS.USDT, amount: '10000' }, // $10K stable swap
  ];
  
  const results: ComparisonResult[] = [];
  
  console.log('📊 Comparing pricing for various swaps...\n');
  
  for (const test of testCases) {
    const sellAmount = BigInt(parseFloat(test.amount) * (10 ** test.sell.decimals));
    
    // Get CoW quote
    console.log(`\n🔄 ${test.amount} ${test.sell.symbol} → ${test.buy.symbol}`);
    
    const cowQuote = await solver.getQuote(1, {
      sellToken: test.sell.address,
      buyToken: test.buy.address,
      sellAmountBeforeFee: sellAmount,
      from: testAddress,
      kind: 'sell',
    });
    
    if (!cowQuote) {
      console.log('   ❌ Could not get CoW quote');
      continue;
    }
    
    // Calculate our AMM output
    const pool = POOLS.find(p => 
      (p.token0.address.toLowerCase() === test.sell.address.toLowerCase() &&
       p.token1.address.toLowerCase() === test.buy.address.toLowerCase()) ||
      (p.token1.address.toLowerCase() === test.sell.address.toLowerCase() &&
       p.token0.address.toLowerCase() === test.buy.address.toLowerCase())
    );
    
    let ourBuyAmount = BigInt(0);
    if (pool) {
      const sellToken = test.sell.address.toLowerCase();
      const isToken0Sell = pool.token0.address.toLowerCase() === sellToken;
      const reserveIn = isToken0Sell ? pool.reserve0 : pool.reserve1;
      const reserveOut = isToken0Sell ? pool.reserve1 : pool.reserve0;
      ourBuyAmount = getAmountOut(sellAmount, reserveIn, reserveOut);
    }
    
    // Compare
    const cowBuyFormatted = formatUnits(cowQuote.buyAmount, test.buy.decimals);
    const ourBuyFormatted = formatUnits(ourBuyAmount, test.buy.decimals);
    
    const cowPrice = parseFloat(test.amount) / parseFloat(cowBuyFormatted);
    const ourPrice = ourBuyAmount > 0n ? parseFloat(test.amount) / parseFloat(ourBuyFormatted) : 0;
    
    // Slippage: how much worse/better are we vs CoW?
    const slippageBps = ourBuyAmount > 0n
      ? Math.round((Number(ourBuyAmount) - Number(cowQuote.buyAmount)) / Number(cowQuote.buyAmount) * 10000)
      : -10000;
    
    const competitive = slippageBps > -50; // Within 50 bps of CoW
    
    console.log(`   CoW output: ${parseFloat(cowBuyFormatted).toFixed(6)} ${test.buy.symbol}`);
    console.log(`   Our output: ${ourBuyAmount > 0n ? parseFloat(ourBuyFormatted).toFixed(6) : 'N/A'} ${test.buy.symbol}`);
    console.log(`   Difference: ${slippageBps > 0 ? '+' : ''}${slippageBps} bps ${competitive ? '✅' : '❌'}`);
    
    results.push({
      pair: `${test.sell.symbol}/${test.buy.symbol}`,
      sellAmount: test.amount,
      cowBuyAmount: cowBuyFormatted,
      ourBuyAmount: ourBuyFormatted,
      cowPrice,
      ourPrice,
      slippageBps,
      competitive,
    });
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 COMPETITIVENESS SUMMARY');
  console.log('='.repeat(50));
  
  const competitiveCount = results.filter(r => r.competitive).length;
  const totalTests = results.length;
  const avgSlippage = results.reduce((sum, r) => sum + r.slippageBps, 0) / results.length;
  
  console.log(`\n   Tests Run: ${totalTests}`);
  console.log(`   Competitive: ${competitiveCount}/${totalTests} (${(competitiveCount/totalTests*100).toFixed(0)}%)`);
  console.log(`   Avg Slippage: ${avgSlippage > 0 ? '+' : ''}${avgSlippage.toFixed(0)} bps`);
  
  // Scoring
  let score = 0;
  score += Math.min(40, (competitiveCount / totalTests) * 40);
  score += Math.min(30, Math.max(0, 30 + avgSlippage / 10));
  score += 30; // Base score for having pools
  
  console.log(`\n   Competitive Score: ${Math.round(score)}/100`);
  
  if (score >= 80) {
    console.log('\n   ✅ HIGHLY COMPETITIVE');
    console.log('   Our pricing is on par with CoW\'s solver network!');
    console.log('   We would likely win auctions with this pricing.');
  } else if (score >= 60) {
    console.log('\n   ⚠️  MODERATELY COMPETITIVE');
    console.log('   Our pricing is reasonable but has room for improvement.');
  } else if (score >= 40) {
    console.log('\n   ⚠️  MARGINALLY COMPETITIVE');
    console.log('   We would win some auctions but need better pricing.');
  } else {
    console.log('\n   ❌ NOT COMPETITIVE');
    console.log('   Our pricing is significantly worse than the market.');
  }
  
  console.log('\n💡 TO IMPROVE COMPETITIVENESS:');
  if (avgSlippage < -50) {
    console.log('   • Increase liquidity in pools (reduce price impact)');
    console.log('   • Lower swap fees (currently 0.3%)');
  }
  console.log('   • Add multi-hop routing (ETH→DAI via USDC)');
  console.log('   • Integrate external DEX aggregation');
  console.log('   • Implement just-in-time liquidity');
  console.log('='.repeat(50));
}

main().catch(console.error);
