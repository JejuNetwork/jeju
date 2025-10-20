#!/usr/bin/env bun
/**
 * @title Node Operator Economics Model
 * @notice Validates token economics for the node staking system (multi-token)
 * 
 * Calculates:
 * - Expected monthly rewards distribution (USD-denominated)
 * - Token supply requirements
 * - Inflation rates
 * - Sustainability analysis
 * - Multi-token staking scenarios
 */

interface EconomicsParams {
  baseRewardPerNode: number; // JEJU per month
  expectedNodes: number;
  avgUptimeMultiplier: number; // 1.0 = 100%
  avgVolumeBonus: number; // JEJU per month
  avgGeoBonus: number; // JEJU per month
  rewardTokenSupply: number; // Total supply
  yearlyDistributionCap: number; // Max % to distribute per year
}

function calculateMonthlyDistribution(params: EconomicsParams): {
  monthlyTotal: number;
  yearlyTotal: number;
  inflationRate: number;
  sustainable: boolean;
  yearsOfRunway: number;
} {
  // Monthly reward per node
  const rewardPerNode = 
    (params.baseRewardPerNode * params.avgUptimeMultiplier) + 
    params.avgVolumeBonus + 
    params.avgGeoBonus;
  
  // Total monthly distribution
  const monthlyTotal = rewardPerNode * params.expectedNodes;
  
  // Yearly distribution
  const yearlyTotal = monthlyTotal * 12;
  
  // Inflation rate
  const inflationRate = (yearlyTotal / params.rewardTokenSupply) * 100;
  
  // Check sustainability
  const maxYearlyDistribution = params.rewardTokenSupply * (params.yearlyDistributionCap / 100);
  const sustainable = yearlyTotal <= maxYearlyDistribution;
  
  // Years of runway
  const yearsOfRunway = params.rewardTokenSupply / yearlyTotal;
  
  return {
    monthlyTotal,
    yearlyTotal,
    inflationRate,
    sustainable,
    yearsOfRunway,
  };
}

function printEconomicsReport(scenario: string, params: EconomicsParams) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Economics Model: ${scenario}`);
  console.log('='.repeat(60));
  console.log('\nInput Parameters:');
  console.log(`  Base reward per node: ${params.baseRewardPerNode} JEJU/month`);
  console.log(`  Expected nodes: ${params.expectedNodes.toLocaleString()}`);
  console.log(`  Avg uptime multiplier: ${params.avgUptimeMultiplier}x`);
  console.log(`  Avg volume bonus: ${params.avgVolumeBonus} JEJU/month`);
  console.log(`  Avg geographic bonus: ${params.avgGeoBonus} JEJU/month`);
  console.log(`  Total token supply: ${params.rewardTokenSupply.toLocaleString()} JEJU`);
  console.log(`  Yearly distribution cap: ${params.yearlyDistributionCap}%`);
  
  const results = calculateMonthlyDistribution(params);
  
  console.log('\nResults:');
  console.log(`  Monthly distribution: ${results.monthlyTotal.toLocaleString()} JEJU`);
  console.log(`  Yearly distribution: ${results.yearlyTotal.toLocaleString()} JEJU`);
  console.log(`  Inflation rate: ${results.inflationRate.toFixed(2)}% per year`);
  console.log(`  Sustainable: ${results.sustainable ? '✅ Yes' : '❌ No'}`);
  console.log(`  Years of runway: ${results.yearsOfRunway.toFixed(1)} years`);
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  return results;
}

// ============ Main Analysis ============

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   📊 Jeju Node Staking Economics Analysis (Multi-Token)   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Scenario 1: Early Stage (100 nodes)
  const scenario1 = printEconomicsReport('Early Stage (100 nodes)', {
    baseRewardPerNode: 100,
    expectedNodes: 100,
    avgUptimeMultiplier: 1.2,
    avgVolumeBonus: 5,
    avgGeoBonus: 10,
    rewardTokenSupply: 100_000_000, // 100M JEJU
    yearlyDistributionCap: 5, // 5% max per year
  });

  // Scenario 2: Growth Stage (500 nodes)
  const scenario2 = printEconomicsReport('Growth Stage (500 nodes)', {
    baseRewardPerNode: 100,
    expectedNodes: 500,
    avgUptimeMultiplier: 1.3,
    avgVolumeBonus: 8,
    avgGeoBonus: 15,
    rewardTokenSupply: 100_000_000,
    yearlyDistributionCap: 5,
  });

  // Scenario 3: Mature Stage (1000 nodes)
  const scenario3 = printEconomicsReport('Mature Stage (1000 nodes)', {
    baseRewardPerNode: 100,
    expectedNodes: 1000,
    avgUptimeMultiplier: 1.4,
    avgVolumeBonus: 10,
    avgGeoBonus: 20,
    rewardTokenSupply: 100_000_000,
    yearlyDistributionCap: 5,
  });

  // Summary and Recommendations
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   📋 Summary and Recommendations                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  if (!scenario1.sustainable || !scenario2.sustainable || !scenario3.sustainable) {
    console.log('🚨 CRITICAL: Economics model is NOT sustainable at scale!\n');
    console.log('Recommendations:');
    console.log('  1. Reduce base reward per node');
    console.log('  2. Increase total token supply');
    console.log('  3. Implement token buyback from fee revenue');
    console.log('  4. Cap total number of registered nodes\n');
  } else {
    console.log('✅ Economics model is sustainable across all scenarios\n');
    console.log('Runway Analysis:');
    console.log(`  - Early stage: ${scenario1.yearsOfRunway.toFixed(1)} years`);
    console.log(`  - Growth stage: ${scenario2.yearsOfRunway.toFixed(1)} years`);
    console.log(`  - Mature stage: ${scenario3.yearsOfRunway.toFixed(1)} years\n`);
  }

  console.log('💡 Key Insights:');
  console.log(`  - Inflation rate scales with node count`);
  console.log(`  - Geographic diversity bonuses incentivize global distribution`);
  console.log(`  - Volume bonuses reward actual usage`);
  console.log(`  - System needs ${scenario3.yearlyTotal.toLocaleString()} JEJU/year at scale\n`);

  // Save model to file
  const modelData = {
    timestamp: new Date().toISOString(),
    scenarios: {
      early: { params: { expectedNodes: 100 }, results: scenario1 },
      growth: { params: { expectedNodes: 500 }, results: scenario2 },
      mature: { params: { expectedNodes: 1000 }, results: scenario3 },
    },
    recommendations: scenario3.sustainable 
      ? ['Monitor inflation rate', 'Consider token buyback from fees']
      : ['Reduce rewards', 'Increase token supply', 'Implement fee revenue recycling'],
  };

  await Bun.write(
    'documentation/economics/node-rewards-model.json',
    JSON.stringify(modelData, null, 2)
  );

  console.log('💾 Model saved to: documentation/economics/node-rewards-model.json\n');
}

main().catch(error => {
  console.error('❌ Analysis failed:', error);
  process.exit(1);
});

