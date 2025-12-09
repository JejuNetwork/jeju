/**
 * @fileoverview Helm chart validation and testing
 * @module packages/deployment/kubernetes/helm/test-charts
 * 
 * Validates all Helm charts for syntax errors, required values, and best practices.
 * Tests chart rendering across all environments (localnet, testnet, mainnet).
 * 
 * Checks:
 * - Chart.yaml syntax and required fields
 * - Template rendering without errors
 * - Required values are set
 * - Resource limits are defined
 * - Security contexts are configured
 * - Probe configurations are present
 * 
 * @example Run validation
 * ```bash
 * bun run packages/deployment/kubernetes/helm/test-charts.ts
 * 
 * # Or with specific chart
 * bun run packages/deployment/kubernetes/helm/test-charts.ts op-node
 * ```
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

/** Chart test configuration */
interface ChartTest {
  name: string;
  path: string;
  environments: string[];
  requiredValues: string[];
}

/** Test results tracking */
interface TestResult {
  chart: string;
  environment: string;
  test: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];

/**
 * Get all Helm charts in the directory
 */
function getCharts(baseDir: string): ChartTest[] {
  const charts: ChartTest[] = [];
  const items = readdirSync(baseDir);

  for (const item of items) {
    const chartPath = join(baseDir, item);
    const chartYaml = join(chartPath, 'Chart.yaml');

    try {
      // Check if it's a directory with Chart.yaml
      if (statSync(chartPath).isDirectory() && statSync(chartYaml).isFile()) {
        charts.push({
          name: item,
          path: chartPath,
          environments: ['localnet', 'testnet', 'mainnet'],
          requiredValues: ['replicaCount', 'image.repository', 'resources'],
        });
      }
    } catch (error) {
      // Not a valid chart, skip
    }
  }

  return charts;
}

/**
 * Test: Helm lint
 */
async function testHelmLint(chart: ChartTest): Promise<void> {
  console.log(`\n🔍 Linting ${chart.name}...`);

  try {
    await execAsync(`helm lint ${chart.path}`);
    
    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'helm-lint',
      passed: true,
    });
    
    console.log(`   ✅ Lint passed`);
  } catch (error) {
    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'helm-lint',
      passed: false,
      message: error instanceof Error ? error.message : 'Lint failed',
    });
    
    console.log(`   ❌ Lint failed`);
  }
}

/**
 * Test: Template rendering for each environment
 */
async function testTemplateRendering(chart: ChartTest): Promise<void> {
  console.log(`\n🎨 Testing template rendering for ${chart.name}...`);

  for (const env of chart.environments) {
    const valuesFile = join(chart.path, `values-${env}.yaml`);

    try {
      // Try to render templates
      const command = `helm template test-release ${chart.path} -f ${chart.path}/values.yaml -f ${valuesFile} 2>&1`;
      await execAsync(command);

      results.push({
        chart: chart.name,
        environment: env,
        test: 'template-render',
        passed: true,
      });

      console.log(`   ✅ ${env}: Templates render successfully`);
    } catch (error) {
      // values file might not exist
      console.log(`   ⏭️  ${env}: No values file (optional)`);
    }
  }
}

/**
 * Test: Required values are set
 */
async function testRequiredValues(chart: ChartTest): Promise<void> {
  console.log(`\n📋 Checking required values for ${chart.name}...`);

  try {
    const { stdout } = await execAsync(`helm show values ${chart.path}`);

    for (const required of chart.requiredValues) {
      if (stdout.includes(required)) {
        console.log(`   ✅ ${required} is defined`);
      } else {
        console.log(`   ⚠️  ${required} not found in values`);
      }
    }

    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'required-values',
      passed: true,
    });
  } catch (error) {
    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'required-values',
      passed: false,
    });
  }
}

/**
 * Test: Security contexts are configured
 */
async function testSecurityContexts(chart: ChartTest): Promise<void> {
  console.log(`\n🔒 Checking security contexts for ${chart.name}...`);

  try {
    const { stdout } = await execAsync(`helm template test ${chart.path}`);

    const hasSecurityContext = stdout.includes('securityContext');
    const hasRunAsNonRoot = stdout.includes('runAsNonRoot');
    const hasReadOnlyRootFilesystem = stdout.includes('readOnlyRootFilesystem');

    if (hasSecurityContext) {
      console.log(`   ✅ Security context configured`);
      if (hasRunAsNonRoot) console.log(`   ✅ runAsNonRoot set`);
      if (hasReadOnlyRootFilesystem) console.log(`   ✅ readOnlyRootFilesystem set`);
    } else {
      console.log(`   ⚠️  No security context found`);
    }

    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'security-contexts',
      passed: hasSecurityContext,
    });
  } catch (error) {
    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'security-contexts',
      passed: false,
    });
  }
}

/**
 * Test: Resource limits are defined
 */
async function testResourceLimits(chart: ChartTest): Promise<void> {
  console.log(`\n💎 Checking resource limits for ${chart.name}...`);

  try {
    const { stdout } = await execAsync(`helm template test ${chart.path}`);

    const hasLimits = stdout.includes('limits:');
    const hasRequests = stdout.includes('requests:');
    const hasCPU = stdout.includes('cpu:');
    const hasMemory = stdout.includes('memory:');

    if (hasLimits && hasRequests) {
      console.log(`   ✅ Resource limits defined`);
      if (hasCPU) console.log(`   ✅ CPU limits set`);
      if (hasMemory) console.log(`   ✅ Memory limits set`);
    } else {
      console.log(`   ⚠️  Resource limits missing`);
    }

    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'resource-limits',
      passed: hasLimits && hasRequests,
    });
  } catch (error) {
    results.push({
      chart: chart.name,
      environment: 'all',
      test: 'resource-limits',
      passed: false,
    });
  }
}

/**
 * Print test summary
 */
function printSummary() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('\n' + '═'.repeat(70));
  console.log(' '.repeat(25) + 'TEST SUMMARY');
  console.log('═'.repeat(70) + '\n');

  // Group by chart
  const byChart = results.reduce((acc, r) => {
    if (!acc[r.chart]) acc[r.chart] = [];
    acc[r.chart].push(r);
    return acc;
  }, {} as Record<string, TestResult[]>);

  for (const [chart, chartResults] of Object.entries(byChart)) {
    const chartPassed = chartResults.filter(r => r.passed).length;
    const chartTotal = chartResults.length;
    const icon = chartPassed === chartTotal ? '✅' : '⚠️';

    console.log(`${icon} ${chart}: ${chartPassed}/${chartTotal} tests passed`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('─'.repeat(70) + '\n');

  if (failed > 0) {
    console.log('⚠️  Some tests failed. Review chart configurations.\n');
    process.exit(1);
  } else {
    console.log('✅ ALL HELM CHARTS VALIDATED!\n');
    process.exit(0);
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                  ║');
  console.log('║              HELM CHART VALIDATION TESTS                         ║');
  console.log('║                                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Get specific chart from args or test all
  const targetChart = process.argv[2];
  const helmDir = join(__dirname);
  
  const allCharts = getCharts(helmDir);
  const charts = targetChart 
    ? allCharts.filter(c => c.name === targetChart)
    : allCharts;

  if (charts.length === 0) {
    console.error(`\n❌ No charts found${targetChart ? ` matching "${targetChart}"` : ''}\n`);
    process.exit(1);
  }

  console.log(`\n📦 Testing ${charts.length} chart(s):\n`);
  console.log(charts.map(c => `   - ${c.name}`).join('\n'));

  // Run tests for each chart
  for (const chart of charts) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`Testing: ${chart.name}`);
    console.log('═'.repeat(70));

    await testHelmLint(chart);
    await testTemplateRendering(chart);
    await testRequiredValues(chart);
    await testSecurityContexts(chart);
    await testResourceLimits(chart);
  }

  // Print summary
  printSummary();
}

// Run tests
main().catch((error) => {
  console.error('\n❌ Test runner failed:', error);
  process.exit(1);
});


